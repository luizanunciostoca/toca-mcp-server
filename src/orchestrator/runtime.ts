import { ExecutionError } from '../core/errors.js';
import { assertExecutionIdentity } from '../core/identity.js';
import { getRouteDefinition } from '../governance/route-catalog.js';
import type { DeadLetterSink } from '../worker/worker.js';
import type {
  CanonicalArtifactRef,
  CanonicalArtifactResolver,
  ConversationRecord,
  ConversationStore,
  CoreCapabilityGateway,
  IntentRouteResolver,
  OrchestratorBudget,
  OrchestratorCheckpoint,
  OrchestratorPlan,
  OrchestratorPlanStep,
  OrchestratorRequest,
  OrchestratorResponse,
  PlanBuilder,
} from './contracts.js';
import {
  assessPromptInjection,
  deterministicId,
  estimateTokens,
  redactSensitiveData,
  requireEvidence,
  sourceContentSha256,
  summarizeRedactedMessages,
  withTimeout,
} from './safety.js';

export const DEFAULT_ORCHESTRATOR_BUDGET: OrchestratorBudget = {
  maxToolCalls: 12,
  maxToolCallsPerResume: 4,
  maxTotalAttempts: 24,
  maxContextTokens: 16_000,
  runtimeTimeoutMs: 60_000,
  toolTimeoutMs: 20_000,
  circuitFailureThreshold: 3,
  circuitOpenMs: 60_000,
  approvalTtlMs: 24 * 60 * 60 * 1000,
};

export interface TocaOrchestratorRuntimeDependencies {
  readonly conversations: ConversationStore;
  readonly routeResolver: IntentRouteResolver;
  readonly artifacts: CanonicalArtifactResolver;
  readonly planner: PlanBuilder;
  readonly core: CoreCapabilityGateway;
  readonly deadLetters: DeadLetterSink;
  readonly budget?: Partial<OrchestratorBudget>;
  readonly now?: () => Date;
}

export class TocaOrchestratorRuntime {
  readonly #budget: OrchestratorBudget;
  readonly #now: () => Date;

  constructor(private readonly dependencies: TocaOrchestratorRuntimeDependencies) {
    this.#budget = validateBudget({ ...DEFAULT_ORCHESTRATOR_BUDGET, ...dependencies.budget });
    this.#now = dependencies.now ?? (() => new Date());
  }

  async handle(request: OrchestratorRequest): Promise<OrchestratorResponse> {
    const startedAt = Date.now();
    assertRequest(request);
    const now = this.#now().toISOString();
    const identity = request.identity;
    assertExecutionIdentity(identity, now);
    const tenantId = identity.principal.tenantId;
    const conversationId =
      request.conversationId?.trim() ||
      deterministicId('ag01conv', tenantId, request.idempotencyKey);
    const messageId =
      request.messageId?.trim() || deterministicId('ag01msg', tenantId, request.idempotencyKey);
    const correlationId =
      request.correlationId?.trim() ||
      deterministicId('ag01corr', tenantId, request.idempotencyKey);
    const causationId = request.causationId?.trim() || null;

    let conversation = await this.dependencies.conversations.getConversation(
      tenantId,
      conversationId,
    );
    if (!conversation) {
      conversation = await this.dependencies.conversations.createConversation({
        conversationId,
        tenantId,
        workspaceId: identity.principal.workspaceId,
        organizationId: identity.principal.organizationId,
        userPrincipalId: identity.principal.principalId,
        correlationId,
        status: 'ACTIVE',
        humanReason: null,
        routeId: null,
        primaryAgent: null,
        sopId: null,
        templateId: null,
        contextSummary: '',
        summarizedMessageCount: 0,
        checkpoint: null,
        createdAt: now,
        updatedAt: now,
        version: 1,
      });
    }
    assertConversationIdentity(conversation, request);

    const redaction = redactSensitiveData(request.message);
    const injection = assessPromptInjection(redaction.content);
    const append = await this.dependencies.conversations.appendMessage({
      messageId,
      conversationId,
      tenantId,
      userPrincipalId: identity.principal.principalId,
      role: 'USER',
      content: redaction.content,
      sourceContentSha256: sourceContentSha256(request.message),
      correlationId,
      causationId,
      idempotencyKey: request.idempotencyKey.trim(),
      promptInjectionDetected: injection.blocked,
      redactionCount: redaction.redactionCount,
      createdAt: now,
    });

    conversation =
      (await this.dependencies.conversations.getConversation(tenantId, conversationId)) ??
      conversation;
    if (append.duplicate && conversation.checkpoint?.messageId === append.record.messageId) {
      return this.resume(conversationId, identity, true);
    }

    if (injection.blocked) {
      const reason = `PROMPT_INJECTION_BLOCKED:${injection.signals.join(',') || 'UNTRUSTED_CONTROL'}`;
      const halted = await this.#haltWithoutCheckpoint(conversation, reason, now);
      return responseFrom(halted, null, false, [], reason);
    }

    const messages = await this.dependencies.conversations.listMessages(
      tenantId,
      conversationId,
      200,
    );
    const summaryBudget = Math.max(256, Math.floor(this.#budget.maxContextTokens / 2));
    const summary = summarizeRedactedMessages(messages, summaryBudget);
    const contextTokens = estimateTokens(`${summary}\n${redaction.content}`);
    if (contextTokens > this.#budget.maxContextTokens) {
      const reason = 'CONTEXT_TOKEN_BUDGET_EXCEEDED';
      const halted = await this.#haltWithoutCheckpoint(conversation, reason, now);
      return responseFrom(halted, null, false, [], reason);
    }
    conversation = await this.#updateConversation(conversation, {
      status: 'ACTIVE',
      humanReason: null,
      contextSummary: summary,
      summarizedMessageCount: messages.length,
      now,
    });
    this.#assertRuntimeDeadline(startedAt);

    const resolution = await this.dependencies.routeResolver.resolve({
      message: redaction.content,
      contextSummary: summary,
      identity,
      ...(request.routeHint ? { routeHint: request.routeHint } : {}),
    });
    requireEvidence(resolution.evidence, 'AG01_ROUTE_EVIDENCE_REQUIRED');
    if (
      !Number.isFinite(resolution.confidence) ||
      resolution.confidence < 0 ||
      resolution.confidence > 1
    )
      throw new Error('AG01_ROUTE_CONFIDENCE_INVALID');
    const route = getRouteDefinition(resolution.routeId);
    if (request.routeHint && request.routeHint !== resolution.routeId) {
      const reason = `ROUTE_HINT_CONFLICT:${request.routeHint}:${resolution.routeId}`;
      const halted = await this.#haltWithoutCheckpoint(
        conversation,
        reason,
        this.#now().toISOString(),
      );
      return responseFrom(halted, null, false, [], reason);
    }

    const sop = await this.dependencies.artifacts.resolveSop({
      routeId: route.routeId,
      primaryAgent: route.primaryAgent,
      message: redaction.content,
    });
    validateArtifact(sop, 'SOP');
    const template = await this.dependencies.artifacts.resolveTemplate({
      routeId: route.routeId,
      primaryAgent: route.primaryAgent,
      message: redaction.content,
    });
    if (template) validateArtifact(template, 'TEMPLATE');
    this.#assertRuntimeDeadline(startedAt);

    const steps = await this.dependencies.planner.build({
      message: redaction.content,
      contextSummary: summary,
      routeId: route.routeId,
      primaryAgent: route.primaryAgent,
      auxiliaryAgents: route.auxiliaryAgents,
      sop,
      template,
      identity,
    });
    validatePlanSteps(steps, this.#budget);
    const plan: OrchestratorPlan = {
      routeId: route.routeId,
      primaryAgent: route.primaryAgent,
      auxiliaryAgents: route.auxiliaryAgents,
      sop,
      template,
      steps,
      evidence: requireEvidence(
        [...resolution.evidence, ...sop.evidence, ...(template?.evidence ?? [])],
        'AG01_PLAN_EVIDENCE_REQUIRED',
      ),
    };
    const checkpoint: OrchestratorCheckpoint = {
      runId: deterministicId('ag01run', tenantId, messageId),
      messageId,
      correlationId,
      causationId,
      plan,
      nextStepIndex: 0,
      currentAttempt: 0,
      totalToolCalls: 0,
      approvalId: null,
      status: steps.length === 0 ? 'SUCCEEDED' : 'READY',
      humanReason: null,
      lastErrorCode: null,
      updatedAt: this.#now().toISOString(),
    };
    conversation = await this.#updateConversation(conversation, {
      status: steps.length === 0 ? 'SUCCEEDED' : 'ACTIVE',
      humanReason: null,
      routeId: route.routeId,
      primaryAgent: route.primaryAgent,
      sopId: sop.artifactId,
      templateId: template?.artifactId ?? null,
      checkpoint,
      now: checkpoint.updatedAt,
    });
    if (steps.length === 0) return responseFrom(conversation, checkpoint, false, [], null);
    return this.resume(conversationId, identity, false);
  }

  async resume(
    conversationId: string,
    identity: OrchestratorRequest['identity'],
    duplicate = false,
  ): Promise<OrchestratorResponse> {
    const startedAt = Date.now();
    const now = this.#now().toISOString();
    assertExecutionIdentity(identity, now);
    let conversation = await this.dependencies.conversations.getConversation(
      identity.principal.tenantId,
      conversationId,
    );
    if (!conversation) throw new Error('AG01_CONVERSATION_NOT_FOUND');
    assertConversationIdentity(conversation, { identity });
    let checkpoint = conversation.checkpoint;
    if (!checkpoint) {
      return responseFrom(
        conversation,
        null,
        duplicate,
        [],
        conversation.status === 'HUMAN_REQUIRED' ? conversation.humanReason : null,
      );
    }
    if (
      checkpoint.status === 'SUCCEEDED' ||
      checkpoint.status === 'DEAD_LETTERED' ||
      checkpoint.status === 'HUMAN_REQUIRED'
    )
      return responseFrom(conversation, checkpoint, duplicate, [], checkpoint.humanReason);

    const outputs: unknown[] = [];
    let callsThisResume = 0;
    while (checkpoint.nextStepIndex < checkpoint.plan.steps.length) {
      if (callsThisResume >= this.#budget.maxToolCallsPerResume) {
        return responseFrom(conversation, checkpoint, duplicate, outputs, checkpoint.humanReason);
      }
      if (Date.now() - startedAt >= this.#budget.runtimeTimeoutMs) {
        return responseFrom(conversation, checkpoint, duplicate, outputs, checkpoint.humanReason);
      }
      const step = checkpoint.plan.steps[checkpoint.nextStepIndex];
      if (!step) throw new Error('AG01_CHECKPOINT_STEP_INVALID');
      const inspection = this.dependencies.core.inspect({
        capabilityId: step.capabilityId,
        payload: step.payload,
        identity,
      });
      if (inspection.routeId && inspection.routeId !== checkpoint.plan.routeId) {
        const reason = `CAPABILITY_ROUTE_MISMATCH:${inspection.canonicalCapabilityId}:${inspection.routeId}`;
        ({ conversation, checkpoint } = await this.#humanRequired(
          conversation,
          checkpoint,
          reason,
        ));
        return responseFrom(conversation, checkpoint, duplicate, outputs, reason);
      }

      const circuit = await this.dependencies.conversations.getCircuit(
        identity.principal.tenantId,
        inspection.canonicalCapabilityId,
      );
      if (
        circuit?.openedUntil &&
        Date.parse(circuit.openedUntil) > Date.parse(this.#now().toISOString())
      ) {
        const reason = `CIRCUIT_OPEN:${inspection.canonicalCapabilityId}`;
        ({ conversation, checkpoint } = await this.#humanRequired(
          conversation,
          checkpoint,
          reason,
        ));
        return responseFrom(conversation, checkpoint, duplicate, outputs, reason);
      }

      if (checkpoint.status === 'RUNNING' && checkpoint.currentAttempt > 0) {
        if (inspection.sideEffects) {
          const reason = `PROVIDER_OUTCOME_UNCERTAIN_AFTER_RESTART:${inspection.canonicalCapabilityId}`;
          ({ conversation, checkpoint } = await this.#humanRequired(
            conversation,
            checkpoint,
            reason,
          ));
          return responseFrom(conversation, checkpoint, duplicate, outputs, reason);
        }
        checkpoint = {
          ...checkpoint,
          status: 'READY',
          lastErrorCode: 'RECOVERED_AFTER_RESTART',
          updatedAt: this.#now().toISOString(),
        };
        conversation = await this.#updateConversation(conversation, {
          status: 'ACTIVE',
          checkpoint,
          now: checkpoint.updatedAt,
        });
      }

      if (inspection.approvalRequired) {
        if (!checkpoint.approvalId) {
          const requested = await this.dependencies.core.requestApproval({
            capabilityId: inspection.canonicalCapabilityId,
            payload: step.payload,
            correlationId: checkpoint.correlationId,
            expiresAt: new Date(this.#now().getTime() + this.#budget.approvalTtlMs).toISOString(),
            evidence: [`ag01:run:${checkpoint.runId}`, `ag01:step:${step.stepId}`],
            identity,
          });
          checkpoint = {
            ...checkpoint,
            approvalId: requested.approvalId,
            status: 'WAITING_APPROVAL',
            humanReason: `APPROVAL_REQUIRED:${requested.approvalId}`,
            updatedAt: this.#now().toISOString(),
          };
          conversation = await this.#updateConversation(conversation, {
            status: 'WAITING_APPROVAL',
            checkpoint,
            now: checkpoint.updatedAt,
          });
          return responseFrom(conversation, checkpoint, duplicate, outputs, checkpoint.humanReason);
        }
        const approval = await this.dependencies.core.getApproval(checkpoint.approvalId);
        if (!approval || !['APPROVED', 'RELEASED'].includes(approval.status)) {
          if (
            approval &&
            ['REVOKED', 'EXPIRED', 'FAILED_REVIEW_REQUIRED'].includes(approval.status)
          ) {
            const reason = `APPROVAL_UNUSABLE:${approval.status}:${approval.approvalId}`;
            ({ conversation, checkpoint } = await this.#humanRequired(
              conversation,
              checkpoint,
              reason,
            ));
            return responseFrom(conversation, checkpoint, duplicate, outputs, reason);
          }
          return responseFrom(
            conversation,
            checkpoint,
            duplicate,
            outputs,
            checkpoint.humanReason ?? `APPROVAL_PENDING:${checkpoint.approvalId}`,
          );
        }
      }

      if (checkpoint.totalToolCalls >= this.#budget.maxTotalAttempts) {
        return this.#deadLetter(
          conversation,
          checkpoint,
          step,
          'AG01_TOTAL_ATTEMPT_BUDGET_EXHAUSTED',
          duplicate,
          outputs,
        );
      }

      checkpoint = {
        ...checkpoint,
        status: 'RUNNING',
        currentAttempt: checkpoint.currentAttempt + 1,
        totalToolCalls: checkpoint.totalToolCalls + 1,
        humanReason: null,
        lastErrorCode: null,
        updatedAt: this.#now().toISOString(),
      };
      conversation = await this.#updateConversation(conversation, {
        status: 'ACTIVE',
        checkpoint,
        now: checkpoint.updatedAt,
      });
      callsThisResume += 1;

      try {
        const execution = await withTimeout(
          this.dependencies.core.execute({
            capabilityId: inspection.canonicalCapabilityId,
            payload: step.payload,
            correlationId: checkpoint.correlationId,
            identity,
            ...(checkpoint.approvalId ? { approvalId: checkpoint.approvalId } : {}),
          }),
          this.#budget.toolTimeoutMs,
        );
        if (inspection.sideEffects && !execution.providerReadbackVerified) {
          throw new Error('AG01_PROVIDER_READBACK_UNCERTAIN');
        }
        await this.dependencies.conversations.resetCircuit(
          identity.principal.tenantId,
          inspection.canonicalCapabilityId,
          this.#now().toISOString(),
        );
        outputs.push(execution.result);
        const nextStepIndex = incrementCheckpointStep(checkpoint);
        const succeeded: boolean = nextStepIndex >= checkpoint.plan.steps.length;
        checkpoint = {
          ...checkpoint,
          nextStepIndex,
          currentAttempt: 0,
          approvalId: null,
          status: succeeded ? 'SUCCEEDED' : 'READY',
          humanReason: null,
          lastErrorCode: null,
          updatedAt: this.#now().toISOString(),
        };
        conversation = await this.#updateConversation(conversation, {
          status: succeeded ? 'SUCCEEDED' : 'ACTIVE',
          checkpoint,
          now: checkpoint.updatedAt,
        });
        if (succeeded) return responseFrom(conversation, checkpoint, duplicate, outputs, null);
      } catch (error) {
        const errorCode = normalizeErrorCode(error);
        const openedUntil = new Date(
          this.#now().getTime() + this.#budget.circuitOpenMs,
        ).toISOString();
        const nextCircuit = await this.dependencies.conversations.recordCircuitFailure({
          tenantId: identity.principal.tenantId,
          capabilityId: inspection.canonicalCapabilityId,
          errorCode,
          threshold: this.#budget.circuitFailureThreshold,
          openedUntil,
          now: this.#now().toISOString(),
        });
        if (inspection.sideEffects) {
          const reason = `PROVIDER_OUTCOME_UNCERTAIN:${inspection.canonicalCapabilityId}:${errorCode}`;
          ({ conversation, checkpoint } = await this.#humanRequired(
            conversation,
            checkpoint,
            reason,
            errorCode,
          ));
          return responseFrom(conversation, checkpoint, duplicate, outputs, reason);
        }
        if (
          checkpoint.currentAttempt < step.maxAttempts &&
          checkpoint.totalToolCalls < this.#budget.maxTotalAttempts &&
          !nextCircuit.openedUntil
        ) {
          checkpoint = {
            ...checkpoint,
            status: 'READY',
            lastErrorCode: errorCode,
            updatedAt: this.#now().toISOString(),
          };
          conversation = await this.#updateConversation(conversation, {
            status: 'ACTIVE',
            checkpoint,
            now: checkpoint.updatedAt,
          });
          continue;
        }
        if (nextCircuit.openedUntil) {
          const reason = `CIRCUIT_OPEN:${inspection.canonicalCapabilityId}:${errorCode}`;
          ({ conversation, checkpoint } = await this.#humanRequired(
            conversation,
            checkpoint,
            reason,
            errorCode,
          ));
          return responseFrom(conversation, checkpoint, duplicate, outputs, reason);
        }
        return this.#deadLetter(conversation, checkpoint, step, errorCode, duplicate, outputs);
      }
    }
    return responseFrom(conversation, checkpoint, duplicate, outputs, checkpoint.humanReason);
  }

  async #deadLetter(
    conversation: ConversationRecord,
    checkpoint: OrchestratorCheckpoint,
    step: OrchestratorPlanStep,
    errorCode: string,
    duplicate: boolean,
    outputs: readonly unknown[],
  ): Promise<OrchestratorResponse> {
    await this.dependencies.deadLetters.put({
      id: deterministicId('ag01dlq', checkpoint.runId, step.stepId),
      originalJobId: checkpoint.runId,
      toolName: 'ag01.orchestrator.runtime',
      payload: {
        conversationId: conversation.conversationId,
        runId: checkpoint.runId,
        messageId: checkpoint.messageId,
        stepId: step.stepId,
        capabilityId: step.capabilityId,
        correlationId: checkpoint.correlationId,
        causationId: checkpoint.causationId,
      },
      attempts: Math.max(1, checkpoint.currentAttempt),
      lastError: errorCode,
      failedAt: this.#now().toISOString(),
    });
    const next: OrchestratorCheckpoint = {
      ...checkpoint,
      status: 'DEAD_LETTERED',
      humanReason: 'DEAD_LETTER_REVIEW_REQUIRED',
      lastErrorCode: errorCode,
      updatedAt: this.#now().toISOString(),
    };
    const updated = await this.#updateConversation(conversation, {
      status: 'DEAD_LETTERED',
      checkpoint: next,
      now: next.updatedAt,
    });
    return responseFrom(updated, next, duplicate, outputs, next.humanReason);
  }

  async #humanRequired(
    conversation: ConversationRecord,
    checkpoint: OrchestratorCheckpoint,
    reason: string,
    errorCode: string | null = null,
  ): Promise<{
    readonly conversation: ConversationRecord;
    readonly checkpoint: OrchestratorCheckpoint;
  }> {
    const next: OrchestratorCheckpoint = {
      ...checkpoint,
      status: 'HUMAN_REQUIRED',
      humanReason: reason,
      lastErrorCode: errorCode,
      updatedAt: this.#now().toISOString(),
    };
    const updated = await this.#updateConversation(conversation, {
      status: 'HUMAN_REQUIRED',
      checkpoint: next,
      now: next.updatedAt,
    });
    return { conversation: updated, checkpoint: next };
  }

  #haltWithoutCheckpoint(conversation: ConversationRecord, reason: string, now: string) {
    return this.#updateConversation(conversation, {
      status: 'HUMAN_REQUIRED',
      humanReason: reason,
      checkpoint: null,
      now,
    }).then((updated) => ({ ...updated, contextSummary: `${updated.contextSummary}` }));
  }

  #updateConversation(
    current: ConversationRecord,
    patch: {
      readonly status?: ConversationRecord['status'];
      readonly humanReason?: string | null;
      readonly routeId?: ConversationRecord['routeId'];
      readonly primaryAgent?: string | null;
      readonly sopId?: string | null;
      readonly templateId?: string | null;
      readonly contextSummary?: string;
      readonly summarizedMessageCount?: number;
      readonly checkpoint?: OrchestratorCheckpoint | null;
      readonly now: string;
    },
  ) {
    return this.dependencies.conversations.updateConversation({
      tenantId: current.tenantId,
      conversationId: current.conversationId,
      expectedVersion: current.version,
      status: patch.status ?? current.status,
      humanReason: patch.humanReason === undefined ? current.humanReason : patch.humanReason,
      routeId: patch.routeId === undefined ? current.routeId : patch.routeId,
      primaryAgent: patch.primaryAgent === undefined ? current.primaryAgent : patch.primaryAgent,
      sopId: patch.sopId === undefined ? current.sopId : patch.sopId,
      templateId: patch.templateId === undefined ? current.templateId : patch.templateId,
      contextSummary: patch.contextSummary ?? current.contextSummary,
      summarizedMessageCount: patch.summarizedMessageCount ?? current.summarizedMessageCount,
      checkpoint: patch.checkpoint === undefined ? current.checkpoint : patch.checkpoint,
      now: patch.now,
    });
  }

  #assertRuntimeDeadline(startedAt: number): void {
    if (Date.now() - startedAt >= this.#budget.runtimeTimeoutMs)
      throw new Error('AG01_RUNTIME_TIMEOUT');
  }
}

function incrementCheckpointStep(checkpoint: OrchestratorCheckpoint): number {
  const nextStepIndex = checkpoint.nextStepIndex + 1;
  if (!Number.isSafeInteger(nextStepIndex) || nextStepIndex < 1) {
    throw new Error('AG01_CHECKPOINT_STEP_INDEX_INVALID');
  }
  return nextStepIndex;
}

function validateArtifact(artifact: CanonicalArtifactRef, kind: 'SOP' | 'TEMPLATE'): void {
  if (!artifact.artifactId.trim()) throw new Error(`AG01_${kind}_ID_REQUIRED`);
  if (!artifact.version.trim()) throw new Error(`AG01_${kind}_VERSION_REQUIRED`);
  if (!artifact.sourceRef.trim()) throw new Error(`AG01_${kind}_SOURCE_REQUIRED`);
  requireEvidence(artifact.evidence, `AG01_${kind}_EVIDENCE_REQUIRED`);
}

function validatePlanSteps(
  steps: readonly OrchestratorPlanStep[],
  budget: OrchestratorBudget,
): void {
  if (steps.length > budget.maxToolCalls) throw new Error('AG01_TOOL_BUDGET_EXCEEDED');
  const ids = new Set<string>();
  for (const step of steps) {
    if (!step.stepId.trim()) throw new Error('AG01_STEP_ID_REQUIRED');
    if (ids.has(step.stepId)) throw new Error(`AG01_STEP_ID_DUPLICATE:${step.stepId}`);
    ids.add(step.stepId);
    if (!step.name.trim()) throw new Error(`AG01_STEP_NAME_REQUIRED:${step.stepId}`);
    if (!step.capabilityId.trim()) throw new Error(`AG01_CAPABILITY_ID_REQUIRED:${step.stepId}`);
    if (
      !Number.isInteger(step.maxAttempts) ||
      step.maxAttempts < 1 ||
      step.maxAttempts > budget.maxTotalAttempts
    )
      throw new Error(`AG01_STEP_ATTEMPTS_INVALID:${step.stepId}`);
    assertJsonSerializable(step.payload);
  }
}

function assertRequest(request: OrchestratorRequest): void {
  if (!request.idempotencyKey.trim()) throw new Error('AG01_IDEMPOTENCY_KEY_REQUIRED');
  if (!request.message.trim()) throw new Error('AG01_MESSAGE_REQUIRED');
  if (request.message.length > 200_000) throw new Error('AG01_MESSAGE_TOO_LARGE');
}

function assertConversationIdentity(
  conversation: ConversationRecord,
  request: Pick<OrchestratorRequest, 'identity'>,
): void {
  const principal = request.identity.principal;
  if (conversation.tenantId !== principal.tenantId) throw new Error('AG01_TENANT_MISMATCH');
  if (conversation.workspaceId !== principal.workspaceId)
    throw new Error('AG01_WORKSPACE_MISMATCH');
  if (conversation.organizationId !== principal.organizationId)
    throw new Error('AG01_ORGANIZATION_MISMATCH');
  if (conversation.userPrincipalId !== principal.principalId)
    throw new Error('AG01_PRINCIPAL_MISMATCH');
}

function validateBudget(budget: OrchestratorBudget): OrchestratorBudget {
  for (const [name, value] of Object.entries(budget)) {
    if (!Number.isInteger(value) || value <= 0) throw new Error(`AG01_BUDGET_INVALID:${name}`);
  }
  if (budget.maxToolCallsPerResume > budget.maxToolCalls)
    throw new Error('AG01_RESUME_TOOL_BUDGET_EXCEEDS_PLAN_BUDGET');
  return budget;
}

function normalizeErrorCode(error: unknown): string {
  if (error instanceof ExecutionError) return error.code;
  if (error instanceof Error && error.message.trim()) return error.message.trim().slice(0, 200);
  return 'AG01_TOOL_FAILURE';
}

function assertJsonSerializable(value: unknown): void {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error('undefined');
  } catch {
    throw new Error('AG01_PAYLOAD_NOT_JSON_SERIALIZABLE');
  }
}

function responseFrom(
  conversation: ConversationRecord,
  checkpoint: OrchestratorCheckpoint | null,
  duplicate: boolean,
  outputs: readonly unknown[],
  humanReason: string | null,
): OrchestratorResponse {
  return {
    conversationId: conversation.conversationId,
    runId: checkpoint?.runId ?? null,
    correlationId: checkpoint?.correlationId ?? conversation.correlationId,
    status:
      checkpoint?.status ?? (conversation.status === 'HUMAN_REQUIRED' ? 'HUMAN_REQUIRED' : 'READY'),
    routeId: conversation.routeId,
    primaryAgent: conversation.primaryAgent,
    nextStepIndex: checkpoint?.nextStepIndex ?? null,
    duplicate,
    humanReason,
    lastErrorCode: checkpoint?.lastErrorCode ?? null,
    outputs,
  };
}
