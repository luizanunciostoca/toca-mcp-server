import { createHash } from 'node:crypto';
import type { ExecutionIdentity } from '../core/identity.js';
import type { CrmScope } from '../crm/crm-records.js';
import type {
  CrmSalesStore,
  NextActionRecord,
  SalesActivityType,
  SalesChannel,
} from '../crm/sales-engine.js';
import type {
  WorkflowInstance,
  WorkflowSnapshot,
  WorkflowStep,
  WorkflowStepClaim,
  WorkflowStore,
} from '../workflow/workflow-contracts.js';
import type { DeadLetterSink } from '../worker/worker.js';
import type { CoreCapabilityGateway } from './contracts.js';

export const DURABLE_FOLLOWUP_DEFINITION_ID = 'toca-os-durable-followup';
export const DURABLE_FOLLOWUP_DEFINITION_VERSION = '1.0.0';
export const DURABLE_FOLLOWUP_STEP_ID = 'dispatch-followup';
export const DURABLE_FOLLOWUP_WORKER_ID = 'ag01-durable-followup';

const DURABLE_FOLLOWUP_ROUTE_ID = 'R10' as const;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 60_000;
const DEFAULT_RETRY_MAX_DELAY_MS = 15 * 60_000;
const TERMINAL_BLOCK_CODES = new Set([
  'EMAIL_PRIVACY_REVALIDATION_BLOCKED',
  'WHATSAPP_PRIVACY_REVALIDATION_BLOCKED',
  'EMAIL_UNSUBSCRIBED',
  'WHATSAPP_SUPPRESSED',
  'POLICY_DENIED',
  'APPROVAL_REQUIRED',
  'APPROVAL_REVIEW_REQUIRED',
  'DUPLICATE_PREVENTED',
  'OMNICHANNEL_OUTBOUND_SCOPE_MISMATCH',
  'OMNICHANNEL_OUTBOUND_CORRELATION_MISMATCH',
  'OMNICHANNEL_OUTBOUND_APPROVAL_MISMATCH',
  'OMNICHANNEL_OUTBOUND_APPROVAL_CONTEXT_REQUIRED',
  'WHATSAPP_PROVIDER_OUTCOME_UNCERTAIN',
]);

export type DurableFollowupChannel = Extract<SalesChannel, 'EMAIL' | 'WHATSAPP'>;

export interface DurableFollowupScheduleInput extends CrmScope {
  readonly nextActionId: string;
  readonly channel: DurableFollowupChannel;
  readonly outboundPayload: unknown;
  readonly approvalId: string;
  readonly correlationId: string;
  readonly identity: ExecutionIdentity;
  readonly evidence: readonly string[];
  readonly maxAttempts?: number;
  readonly now?: string;
}

export interface DurableFollowupRetryPolicy {
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export interface DurableFollowupDependencies {
  readonly workflows: WorkflowStore;
  readonly sales: CrmSalesStore;
  readonly core: CoreCapabilityGateway;
  readonly deadLetters: DeadLetterSink;
  readonly resolveIdentity: (
    instance: WorkflowInstance,
  ) => ExecutionIdentity | Promise<ExecutionIdentity>;
  readonly now?: () => Date;
  readonly retry?: DurableFollowupRetryPolicy;
  readonly workerId?: string;
}

export interface DurableFollowupTickResult {
  readonly firedTimerIds: readonly string[];
  readonly processedWorkflowIds: readonly string[];
}

interface DurableFollowupWorkflowInput {
  readonly nextActionId: string;
  readonly channel: DurableFollowupChannel;
  readonly outboundPayload: unknown;
  readonly outboundPayloadSha256: string;
  readonly approvalId: string;
  readonly evidence: readonly string[];
}

interface NormalizedCoreSendResult {
  readonly state: string | null;
  readonly providerMessageId: string | null;
}

export class DurableFollowupCoordinator {
  readonly #now: () => Date;
  readonly #retry: DurableFollowupRetryPolicy;
  readonly #workerId: string;

  constructor(private readonly deps: DurableFollowupDependencies) {
    this.#now = deps.now ?? (() => new Date());
    this.#retry = deps.retry ?? {
      baseDelayMs: DEFAULT_RETRY_BASE_DELAY_MS,
      maxDelayMs: DEFAULT_RETRY_MAX_DELAY_MS,
    };
    this.#workerId = deps.workerId?.trim() || DURABLE_FOLLOWUP_WORKER_ID;
    assertRetryPolicy(this.#retry);
  }

  /**
   * Arms a durable workflow for an already-canonical NextActionRecord. Creation of
   * that record remains owned by sales.followup.schedule / CrmSalesStore; this
   * composition intentionally does not create a second nurture state model.
   */
  async schedule(input: DurableFollowupScheduleInput): Promise<WorkflowSnapshot> {
    const now = normalizeNow(input.now, this.#now);
    assertIdentityScope(input, input.identity);
    const evidence = normalizeEvidence(input.evidence, 'DURABLE_FOLLOWUP_EVIDENCE_REQUIRED');
    const nextAction = await this.requireNextAction(input, input.nextActionId);
    assertSchedulableNextAction(nextAction);
    if (!nextAction.dueAt) throw new Error('DURABLE_FOLLOWUP_DUE_AT_REQUIRED');

    const capabilityId = outboundCapabilityId(input.channel);
    const approvalId = requireText(input.approvalId, 'DURABLE_FOLLOWUP_APPROVAL_ID_REQUIRED');
    const correlationId = requireText(
      input.correlationId,
      'DURABLE_FOLLOWUP_CORRELATION_ID_REQUIRED',
    );
    assertOutboundEnvelope(input, approvalId, correlationId);
    const maxAttempts = normalizeMaxAttempts(input.maxAttempts);
    const workflowId = durableFollowupWorkflowId(input, input.nextActionId);
    const durableInput: DurableFollowupWorkflowInput = {
      nextActionId: input.nextActionId,
      channel: input.channel,
      outboundPayload: input.outboundPayload,
      outboundPayloadSha256: sha256Canonical(input.outboundPayload),
      approvalId,
      evidence,
    };

    let snapshot = await this.deps.workflows.create(
      {
        workflowId,
        routeId: DURABLE_FOLLOWUP_ROUTE_ID,
        definitionId: DURABLE_FOLLOWUP_DEFINITION_ID,
        definitionVersion: DURABLE_FOLLOWUP_DEFINITION_VERSION,
        idempotencyKey: `durable-followup:${input.nextActionId}`,
        correlationId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        organizationId: input.organizationId,
        requesterPrincipalId: input.identity.principal.principalId,
        input: durableInput,
        steps: [
          {
            stepId: DURABLE_FOLLOWUP_STEP_ID,
            name: `Durable ${input.channel} follow-up`,
            capabilityId,
            input: input.outboundPayload,
            maxAttempts,
          },
        ],
      },
      now,
    );
    assertWorkflowReplayMatches(snapshot, durableInput, input, correlationId, maxAttempts);

    const step = requireFollowupStep(snapshot);
    if (step.status === 'WAITING_TIMER' || isTerminalWorkflowStep(step)) return snapshot;
    if (step.status !== 'READY' && step.status !== 'RUNNING') {
      throw new Error(`DURABLE_FOLLOWUP_ARM_STATE_INVALID:${step.status}`);
    }

    const fireAt = laterTimestamp(nextAction.dueAt, now);
    snapshot = await this.armTimer(snapshot, fireAt, now, evidence);
    return snapshot;
  }

  /**
   * Uses the existing Workflow timer pump. Non-follow-up timers may also become
   * READY; they are never claimed here, so their owning workers retain control.
   */
  async tick(limit = 50, nowInput?: string): Promise<DurableFollowupTickResult> {
    const now = normalizeNow(nowInput, this.#now);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new Error('DURABLE_FOLLOWUP_TICK_LIMIT_INVALID');
    }
    const firedTimerIds = await this.deps.workflows.fireDueTimers({ now, limit });
    const processedWorkflowIds: string[] = [];
    for (const timerId of firedTimerIds) {
      const parsed = parseFollowupTimerId(timerId);
      if (!parsed) continue;
      const snapshot = await this.deps.workflows.get(parsed.workflowId);
      if (!snapshot || snapshot.instance.definitionId !== DURABLE_FOLLOWUP_DEFINITION_ID) continue;
      await this.processReadyWorkflow(snapshot, now);
      processedWorkflowIds.push(parsed.workflowId);
    }
    return { firedTimerIds, processedWorkflowIds };
  }

  private async processReadyWorkflow(snapshot: WorkflowSnapshot, now: string): Promise<void> {
    const workflowInput = parseWorkflowInput(snapshot.instance.input);
    const identity = await this.deps.resolveIdentity(snapshot.instance);
    assertIdentityMatchesWorkflow(identity, snapshot.instance);
    const nextAction = await this.requireNextAction(snapshot.instance, workflowInput.nextActionId);

    const claims = await this.deps.workflows.claimReadySteps({
      workerId: this.#workerId,
      now,
      limit: 1,
      workflowId: snapshot.instance.workflowId,
    });
    const claim = claims[0];
    if (!claim) return;
    if (claim.stepId !== DURABLE_FOLLOWUP_STEP_ID) {
      throw new Error('DURABLE_FOLLOWUP_UNEXPECTED_STEP_CLAIM');
    }
    const claimedSnapshot = await this.requireWorkflow(snapshot.instance.workflowId);
    const step = requireFollowupStep(claimedSnapshot);

    if (nextAction.status === 'CANCELED' || nextAction.status === 'COMPLETED') {
      const outcome = nextAction.status === 'CANCELED' ? 'CANCELED' : 'ALREADY_COMPLETED';
      await this.recordOutcome(claimedSnapshot, nextAction, identity, claim, outcome, now);
      await this.deps.workflows.completeStep({
        workflowId: claimedSnapshot.instance.workflowId,
        stepId: claim.stepId,
        executionId: claim.executionId,
        output: { outcome, nextActionId: nextAction.nextActionId },
        evidence: [`durable-followup:terminal:${outcome.toLowerCase()}`],
        now,
      });
      return;
    }

    if (nextAction.dueAt && Date.parse(nextAction.dueAt) > Date.parse(now)) {
      await this.armTimer(claimedSnapshot, nextAction.dueAt, now, [
        'durable-followup:next-action-rescheduled',
      ]);
      return;
    }

    const capabilityId = outboundCapabilityId(workflowInput.channel);
    try {
      const execution = await this.deps.core.execute({
        capabilityId,
        payload: workflowInput.outboundPayload,
        correlationId: claimedSnapshot.instance.correlationId,
        identity,
        approvalId: workflowInput.approvalId,
      });
      if (!execution.providerReadbackVerified) {
        throw new Error('DURABLE_FOLLOWUP_PROVIDER_READBACK_UNVERIFIED');
      }
      const normalized = normalizeCoreSendResult(execution.result);
      if (normalized.state === 'REJECTED') {
        await this.completeBlocked(
          claimedSnapshot,
          nextAction,
          identity,
          claim,
          'PROVIDER_REJECTED',
          now,
        );
        return;
      }
      await this.recordOutcome(claimedSnapshot, nextAction, identity, claim, 'SENT', now, {
        providerExecutionId: execution.executionId,
        providerMessageId: normalized.providerMessageId,
      });
      await this.deps.workflows.completeStep({
        workflowId: claimedSnapshot.instance.workflowId,
        stepId: claim.stepId,
        executionId: claim.executionId,
        output: {
          outcome: 'SENT',
          nextActionId: nextAction.nextActionId,
          channel: workflowInput.channel,
          providerExecutionId: execution.executionId,
          providerMessageId: normalized.providerMessageId,
        },
        evidence: [
          `durable-followup:provider-execution:${execution.executionId}`,
          'durable-followup:provider-readback-verified',
        ],
        now,
      });
    } catch (error) {
      const code = errorCode(error);
      if (isTerminalBlockCode(code)) {
        await this.completeBlocked(claimedSnapshot, nextAction, identity, claim, code, now);
        return;
      }
      if (code === 'DURABLE_FOLLOWUP_PROVIDER_READBACK_UNVERIFIED') {
        await this.completeBlocked(claimedSnapshot, nextAction, identity, claim, code, now);
        return;
      }
      await this.retryOrDeadLetter(claimedSnapshot, nextAction, identity, step, claim, code, now);
    }
  }

  private async retryOrDeadLetter(
    snapshot: WorkflowSnapshot,
    nextAction: NextActionRecord,
    identity: ExecutionIdentity,
    step: WorkflowStep,
    claim: WorkflowStepClaim,
    errorCodeValue: string,
    now: string,
  ): Promise<void> {
    const failed = await this.deps.workflows.failStep({
      workflowId: snapshot.instance.workflowId,
      stepId: claim.stepId,
      executionId: claim.executionId,
      errorCode: errorCodeValue,
      evidence: [`durable-followup:attempt-failed:${step.attempts}`, `error:${errorCodeValue}`],
      now,
    });
    const failedStep = requireFollowupStep(failed);
    if (failedStep.attempts < failedStep.maxAttempts) {
      const retried = await this.deps.workflows.retryStep({
        workflowId: snapshot.instance.workflowId,
        stepId: claim.stepId,
        evidence: [`durable-followup:retry:${failedStep.attempts + 1}`],
        now,
      });
      const retryAt = new Date(
        Date.parse(now) + retryDelayMs(failedStep.attempts, this.#retry),
      ).toISOString();
      await this.armTimer(retried, retryAt, now, [
        `durable-followup:retry-timer:${failedStep.attempts + 1}`,
      ]);
      return;
    }

    await this.deps.deadLetters.put({
      id: deterministicId('dfu-dlq', snapshot.instance.workflowId, String(failedStep.attempts)),
      originalJobId: snapshot.instance.workflowId,
      toolName: outboundCapabilityId(parseWorkflowInput(snapshot.instance.input).channel),
      payload: {
        workflowId: snapshot.instance.workflowId,
        nextActionId: nextAction.nextActionId,
        correlationId: snapshot.instance.correlationId,
        tenantId: snapshot.instance.tenantId,
      },
      attempts: failedStep.attempts,
      lastError: errorCodeValue,
      failedAt: now,
    });
    await this.recordOutcome(
      snapshot,
      nextAction,
      identity,
      claim,
      `DEAD_LETTERED:${errorCodeValue}`,
      now,
    );
  }

  private async completeBlocked(
    snapshot: WorkflowSnapshot,
    nextAction: NextActionRecord,
    identity: ExecutionIdentity,
    claim: WorkflowStepClaim,
    code: string,
    now: string,
  ): Promise<void> {
    await this.recordOutcome(snapshot, nextAction, identity, claim, `BLOCKED:${code}`, now);
    await this.deps.workflows.completeStep({
      workflowId: snapshot.instance.workflowId,
      stepId: claim.stepId,
      executionId: claim.executionId,
      output: {
        outcome: 'BLOCKED',
        reason: code,
        nextActionId: nextAction.nextActionId,
      },
      evidence: [`durable-followup:blocked:${code}`],
      now,
    });
  }

  private async recordOutcome(
    snapshot: WorkflowSnapshot,
    nextAction: NextActionRecord,
    identity: ExecutionIdentity,
    claim: WorkflowStepClaim,
    outcome: string,
    now: string,
    provider: {
      readonly providerExecutionId?: string;
      readonly providerMessageId?: string | null;
    } = {},
  ): Promise<void> {
    const workflowInput = parseWorkflowInput(snapshot.instance.input);
    const activityType = salesActivityType(nextAction);
    const evidence = normalizeEvidence([
      ...workflowInput.evidence,
      `durable-followup:workflow:${snapshot.instance.workflowId}`,
      `durable-followup:next-action:${nextAction.nextActionId}`,
      `durable-followup:claim:${claim.executionId}`,
      ...(provider.providerExecutionId
        ? [`durable-followup:provider-execution:${provider.providerExecutionId}`]
        : []),
      ...(provider.providerMessageId
        ? [`durable-followup:provider-message:${provider.providerMessageId}`]
        : []),
    ]);
    await this.deps.sales.appendActivity({
      tenantId: snapshot.instance.tenantId,
      workspaceId: snapshot.instance.workspaceId,
      organizationId: snapshot.instance.organizationId,
      activityId: deterministicId('dfu-activity', snapshot.instance.workflowId, outcome),
      contactId: nextAction.contactId,
      leadId: nextAction.leadId,
      opportunityId: nextAction.opportunityId,
      activityType,
      channel: workflowInput.channel,
      summary: `Durable follow-up ${outcome.toLowerCase()} via ${workflowInput.channel}.`,
      outcome,
      occurredAt: now,
      executionId: provider.providerExecutionId ?? claim.executionId,
      correlationId: snapshot.instance.correlationId,
      actorPrincipalId: identity.principal.principalId,
      idempotencyKey: `durable-followup-outcome:${snapshot.instance.workflowId}:${outcome}`,
      evidence,
      now,
    });
  }

  private async armTimer(
    snapshot: WorkflowSnapshot,
    fireAt: string,
    now: string,
    evidence: readonly string[],
  ): Promise<WorkflowSnapshot> {
    const step = requireFollowupStep(snapshot);
    let claim: WorkflowStepClaim | undefined;
    if (step.status === 'READY') {
      claim = (
        await this.deps.workflows.claimReadySteps({
          workerId: this.#workerId,
          now,
          limit: 1,
          workflowId: snapshot.instance.workflowId,
        })
      )[0];
      if (!claim) throw new Error('DURABLE_FOLLOWUP_TIMER_CLAIM_REQUIRED');
    } else if (step.status === 'RUNNING' && step.claimExecutionId) {
      claim = {
        workflowId: snapshot.instance.workflowId,
        stepId: step.stepId,
        workerId: step.claimedBy ?? this.#workerId,
        executionId: step.claimExecutionId,
        claimedAt: step.claimedAt ?? now,
      };
    } else if (step.status === 'WAITING_TIMER') {
      return snapshot;
    } else {
      throw new Error(`DURABLE_FOLLOWUP_TIMER_ARM_STATE_INVALID:${step.status}`);
    }

    const claimedSnapshot = await this.requireWorkflow(snapshot.instance.workflowId);
    const claimedStep = requireFollowupStep(claimedSnapshot);
    const attempt = Math.max(1, claimedStep.attempts);
    const timerId = followupTimerId(snapshot.instance.workflowId, attempt, fireAt);
    return this.deps.workflows.scheduleTimer({
      timerId,
      workflowId: snapshot.instance.workflowId,
      stepId: DURABLE_FOLLOWUP_STEP_ID,
      executionId: claim.executionId,
      fireAt: laterTimestamp(fireAt, now),
      payload: {
        definitionId: DURABLE_FOLLOWUP_DEFINITION_ID,
        nextActionId: parseWorkflowInput(snapshot.instance.input).nextActionId,
        attempt,
      },
      evidence: normalizeEvidence([
        ...evidence,
        `durable-followup:timer:${timerId}`,
        `durable-followup:attempt:${attempt}`,
      ]),
      now,
    });
  }

  private async requireNextAction(
    scope: CrmScope,
    nextActionId: string,
  ): Promise<NextActionRecord> {
    const nextAction = await this.deps.sales.getNextAction({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      organizationId: scope.organizationId,
      nextActionId: requireText(nextActionId, 'DURABLE_FOLLOWUP_NEXT_ACTION_ID_REQUIRED'),
    });
    if (!nextAction) throw new Error('DURABLE_FOLLOWUP_NEXT_ACTION_NOT_FOUND');
    return nextAction;
  }

  private async requireWorkflow(workflowId: string): Promise<WorkflowSnapshot> {
    const snapshot = await this.deps.workflows.get(workflowId);
    if (!snapshot) throw new Error('DURABLE_FOLLOWUP_WORKFLOW_NOT_FOUND');
    return snapshot;
  }
}

export function durableFollowupWorkflowId(scope: CrmScope, nextActionId: string): string {
  return deterministicId(
    'dfu',
    scope.tenantId,
    scope.workspaceId,
    scope.organizationId,
    requireText(nextActionId, 'DURABLE_FOLLOWUP_NEXT_ACTION_ID_REQUIRED'),
  );
}

function assertSchedulableNextAction(nextAction: NextActionRecord): void {
  if (!['FOLLOW_UP', 'CONTACT', 'REACTIVATE', 'POST_SALE'].includes(nextAction.actionType)) {
    throw new Error(`DURABLE_FOLLOWUP_ACTION_TYPE_INVALID:${nextAction.actionType}`);
  }
  if (!['PENDING', 'IN_PROGRESS'].includes(nextAction.status)) {
    throw new Error(`DURABLE_FOLLOWUP_NEXT_ACTION_STATE_INVALID:${nextAction.status}`);
  }
}

function assertOutboundEnvelope(
  scope: CrmScope & {
    readonly channel: DurableFollowupChannel;
    readonly outboundPayload: unknown;
  },
  approvalId: string,
  correlationId: string,
): void {
  const payload = asRecord(scope.outboundPayload, 'DURABLE_FOLLOWUP_OUTBOUND_PAYLOAD_REQUIRED');
  const expected = {
    tenant_id: scope.tenantId,
    workspace_id: scope.workspaceId,
    organization_id: scope.organizationId,
    correlation_id: correlationId,
    approval_id: approvalId,
  } as const;
  for (const [key, value] of Object.entries(expected)) {
    if (payload[key] !== value)
      throw new Error(`DURABLE_FOLLOWUP_OUTBOUND_${key.toUpperCase()}_MISMATCH`);
  }
  requireRecordText(payload, 'idempotency_key', 'DURABLE_FOLLOWUP_OUTBOUND_IDEMPOTENCY_REQUIRED');
  requireRecordText(payload, 'message_id', 'DURABLE_FOLLOWUP_OUTBOUND_MESSAGE_ID_REQUIRED');
  if (scope.channel === 'EMAIL') {
    requireRecordText(
      payload,
      'prepared_campaign_id',
      'DURABLE_FOLLOWUP_PREPARED_CAMPAIGN_ID_REQUIRED',
    );
  } else {
    requireRecordText(
      payload,
      'prepared_message_id',
      'DURABLE_FOLLOWUP_PREPARED_MESSAGE_ID_REQUIRED',
    );
  }
}

function assertWorkflowReplayMatches(
  snapshot: WorkflowSnapshot,
  expected: DurableFollowupWorkflowInput,
  scope: CrmScope,
  correlationId: string,
  maxAttempts: number,
): void {
  const instance = snapshot.instance;
  if (
    instance.definitionId !== DURABLE_FOLLOWUP_DEFINITION_ID ||
    instance.definitionVersion !== DURABLE_FOLLOWUP_DEFINITION_VERSION ||
    instance.routeId !== DURABLE_FOLLOWUP_ROUTE_ID ||
    instance.tenantId !== scope.tenantId ||
    instance.workspaceId !== scope.workspaceId ||
    instance.organizationId !== scope.organizationId ||
    instance.correlationId !== correlationId
  ) {
    throw new Error('DURABLE_FOLLOWUP_WORKFLOW_REPLAY_CONFLICT');
  }
  const actual = parseWorkflowInput(instance.input);
  if (
    actual.nextActionId !== expected.nextActionId ||
    actual.channel !== expected.channel ||
    actual.approvalId !== expected.approvalId ||
    actual.outboundPayloadSha256 !== expected.outboundPayloadSha256
  ) {
    throw new Error('DURABLE_FOLLOWUP_WORKFLOW_REPLAY_CONFLICT');
  }
  const step = requireFollowupStep(snapshot);
  if (
    step.maxAttempts !== maxAttempts ||
    step.capabilityId !== outboundCapabilityId(expected.channel)
  ) {
    throw new Error('DURABLE_FOLLOWUP_WORKFLOW_REPLAY_CONFLICT');
  }
}

function parseWorkflowInput(value: unknown): DurableFollowupWorkflowInput {
  const record = asRecord(value, 'DURABLE_FOLLOWUP_WORKFLOW_INPUT_INVALID');
  const channel = record.channel;
  if (channel !== 'EMAIL' && channel !== 'WHATSAPP') {
    throw new Error('DURABLE_FOLLOWUP_WORKFLOW_CHANNEL_INVALID');
  }
  const evidence = Array.isArray(record.evidence)
    ? record.evidence.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    nextActionId: requireRecordText(
      record,
      'nextActionId',
      'DURABLE_FOLLOWUP_WORKFLOW_NEXT_ACTION_INVALID',
    ),
    channel,
    outboundPayload: record.outboundPayload,
    outboundPayloadSha256: requireRecordText(
      record,
      'outboundPayloadSha256',
      'DURABLE_FOLLOWUP_WORKFLOW_PAYLOAD_DIGEST_INVALID',
    ),
    approvalId: requireRecordText(
      record,
      'approvalId',
      'DURABLE_FOLLOWUP_WORKFLOW_APPROVAL_INVALID',
    ),
    evidence: normalizeEvidence(evidence, 'DURABLE_FOLLOWUP_WORKFLOW_EVIDENCE_INVALID'),
  };
}

function requireFollowupStep(snapshot: WorkflowSnapshot): WorkflowStep {
  const step = snapshot.steps.find((candidate) => candidate.stepId === DURABLE_FOLLOWUP_STEP_ID);
  if (!step) throw new Error('DURABLE_FOLLOWUP_STEP_NOT_FOUND');
  return step;
}

function isTerminalWorkflowStep(step: WorkflowStep): boolean {
  return ['SUCCEEDED', 'FAILED', 'BLOCKED', 'CANCELED', 'SKIPPED'].includes(step.status);
}

function outboundCapabilityId(channel: DurableFollowupChannel): string {
  return channel === 'EMAIL' ? 'email.campaign.send' : 'whatsapp.message.send';
}

function salesActivityType(nextAction: NextActionRecord): SalesActivityType {
  switch (nextAction.actionType) {
    case 'CONTACT':
      return 'CONTACT_ATTEMPT';
    case 'REACTIVATE':
      return 'REACTIVATION';
    case 'POST_SALE':
      return 'POST_SALE';
    default:
      return 'FOLLOW_UP';
  }
}

function normalizeCoreSendResult(result: unknown): NormalizedCoreSendResult {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return { state: null, providerMessageId: null };
  }
  const record = result as Readonly<Record<string, unknown>>;
  const state = typeof record.state === 'string' ? record.state : null;
  const providerMessageId = [record.provider_message_id, record.provider_dispatch_id].find(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );
  return { state, providerMessageId: providerMessageId ?? null };
}

function followupTimerId(workflowId: string, attempt: number, fireAt: string): string {
  return `dfu-timer:${workflowId}:${attempt}:${sha256(fireAt).slice(0, 12)}`;
}

function parseFollowupTimerId(
  timerId: string,
): { readonly workflowId: string; readonly attempt: number } | undefined {
  const match = /^dfu-timer:(dfu_[a-f0-9]{32}):(\d+):[a-f0-9]{12}$/.exec(timerId);
  if (!match) return undefined;
  return { workflowId: match[1]!, attempt: Number(match[2]) };
}

function retryDelayMs(attempt: number, policy: DurableFollowupRetryPolicy): number {
  return Math.min(policy.baseDelayMs * 2 ** Math.max(0, attempt - 1), policy.maxDelayMs);
}

function isTerminalBlockCode(code: string): boolean {
  return (
    TERMINAL_BLOCK_CODES.has(code) ||
    code.includes('PRIVACY_REVALIDATION_BLOCKED') ||
    code.includes('UNSUBSCRIB') ||
    code.includes('SUPPRESS') ||
    code.includes('CONSENT_REVOK')
  );
}

function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return 'DURABLE_FOLLOWUP_EXECUTION_ERROR';
  const message = error.message.trim();
  return (message.split(':')[0] || error.name || 'DURABLE_FOLLOWUP_EXECUTION_ERROR').trim();
}

function assertIdentityScope(scope: CrmScope, identity: ExecutionIdentity): void {
  const principal = identity.principal;
  if (
    principal.tenantId !== scope.tenantId ||
    principal.workspaceId !== scope.workspaceId ||
    principal.organizationId !== scope.organizationId
  ) {
    throw new Error('DURABLE_FOLLOWUP_IDENTITY_SCOPE_MISMATCH');
  }
}

function assertIdentityMatchesWorkflow(
  identity: ExecutionIdentity,
  instance: WorkflowInstance,
): void {
  assertIdentityScope(instance, identity);
  if (identity.principal.principalId !== instance.requesterPrincipalId) {
    throw new Error('DURABLE_FOLLOWUP_REQUESTER_MISMATCH');
  }
}

function normalizeMaxAttempts(value: number | undefined): number {
  const normalized = value ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 20) {
    throw new Error('DURABLE_FOLLOWUP_MAX_ATTEMPTS_INVALID');
  }
  return normalized;
}

function assertRetryPolicy(policy: DurableFollowupRetryPolicy): void {
  if (
    !Number.isFinite(policy.baseDelayMs) ||
    policy.baseDelayMs < 1 ||
    !Number.isFinite(policy.maxDelayMs) ||
    policy.maxDelayMs < policy.baseDelayMs
  ) {
    throw new Error('DURABLE_FOLLOWUP_RETRY_POLICY_INVALID');
  }
}

function normalizeNow(value: string | undefined, fallback: () => Date): string {
  const normalized = value ?? fallback().toISOString();
  if (!Number.isFinite(Date.parse(normalized))) throw new Error('DURABLE_FOLLOWUP_NOW_INVALID');
  return new Date(normalized).toISOString();
}

function laterTimestamp(value: string, floor: string): string {
  const valueMs = Date.parse(value);
  const floorMs = Date.parse(floor);
  if (!Number.isFinite(valueMs)) throw new Error('DURABLE_FOLLOWUP_DUE_AT_INVALID');
  return new Date(Math.max(valueMs, floorMs)).toISOString();
}

function normalizeEvidence(values: readonly string[], code = 'DURABLE_FOLLOWUP_EVIDENCE_REQUIRED') {
  const normalized = [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
  if (normalized.length === 0) throw new Error(code);
  return normalized;
}

function asRecord(value: unknown, code: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
  return value as Readonly<Record<string, unknown>>;
}

function requireRecordText(
  record: Readonly<Record<string, unknown>>,
  key: string,
  code: string,
): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(code);
  return value.trim();
}

function requireText(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function deterministicId(prefix: string, ...parts: readonly string[]): string {
  return `${prefix}_${sha256(parts.join('\u001f')).slice(0, 32)}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sha256Canonical(value: unknown): string {
  return sha256(canonicalJson(value));
}

function canonicalJson(value: unknown): string {
  if (value === undefined) throw new Error('DURABLE_FOLLOWUP_PAYLOAD_NOT_JSON_SERIALIZABLE');
  if (value === null || typeof value !== 'object') {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error('DURABLE_FOLLOWUP_PAYLOAD_NOT_JSON_SERIALIZABLE');
    return serialized;
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const entries = Object.entries(value as Readonly<Record<string, unknown>>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}
