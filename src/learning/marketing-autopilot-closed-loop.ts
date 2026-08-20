import { createHash } from 'node:crypto';
import type { ExecutionIdentity } from '../core/identity.js';
import type { ApprovalRecord } from '../governance/approval-governance.js';
import type { CoreCapabilityGateway } from '../orchestrator/contracts.js';
import {
  requireWorkflowEvidence,
  type WorkflowSnapshot,
  type WorkflowStepClaim,
  type WorkflowStore,
} from '../workflow/workflow-contracts.js';
import { assertLearningBoundary } from './marketing-autopilot-cycle.js';

export const MARKETING_AUTOPILOT_CLOSED_LOOP_DEFINITION_ID =
  'marketing-autopilot-closed-loop-r31';
export const MARKETING_AUTOPILOT_CLOSED_LOOP_DEFINITION_VERSION = '1.0.0';

export const MARKETING_AUTOPILOT_STAGES = [
  'OBSERVE',
  'DIAGNOSE',
  'DECIDE/PLAN',
  'CREATIVE_TRUTH',
  'ASSET',
  'GATES',
  'APPROVAL',
  'SCHEDULE_OR_PUBLISH',
  'READBACK',
  'MEASURE',
  'LEARN',
  'NEXT_RECOMMENDATION',
] as const;

export type MarketingAutopilotStage = (typeof MARKETING_AUTOPILOT_STAGES)[number];

const STAGE_STEP_IDS: Readonly<Record<MarketingAutopilotStage, string>> = {
  OBSERVE: '01-observe',
  DIAGNOSE: '02-diagnose',
  'DECIDE/PLAN': '03-decide-plan',
  CREATIVE_TRUTH: '04-creative-truth',
  ASSET: '05-asset',
  GATES: '06-gates',
  APPROVAL: '07-approval',
  SCHEDULE_OR_PUBLISH: '08-schedule-or-publish',
  READBACK: '09-readback',
  MEASURE: '10-measure',
  LEARN: '11-learn',
  NEXT_RECOMMENDATION: '12-next-recommendation',
};

const STEP_STAGE = new Map(
  Object.entries(STAGE_STEP_IDS).map(([stage, stepId]) => [
    stepId,
    stage as MarketingAutopilotStage,
  ]),
);

export interface MarketingAutopilotClosedLoopStartInput {
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly identity: ExecutionIdentity;
  readonly asOf: string;
  readonly campaignScope?: string;
  readonly objective?: unknown;
}

export interface MarketingAutopilotStageContext {
  readonly workflowId: string;
  readonly stage: MarketingAutopilotStage;
  readonly asOf: string;
  readonly campaignScope?: string;
  readonly objective: unknown;
  readonly identity: ExecutionIdentity;
  readonly correlationId: string;
  readonly outputs: Readonly<Partial<Record<MarketingAutopilotStage, unknown>>>;
  readonly evidenceRefs: readonly string[];
  readonly now: string;
}

export interface MarketingAutopilotStageResult {
  readonly output?: unknown;
  readonly evidenceRefs: readonly string[];
  readonly partial?: boolean;
}

export interface MarketingAutopilotSideEffectPlan {
  readonly capabilityId: string;
  readonly payload: unknown;
  readonly approvalExpiresAt: string;
}

export interface MarketingAutopilotGatesResult extends MarketingAutopilotStageResult {
  readonly sideEffect: MarketingAutopilotSideEffectPlan;
}

export interface MarketingAutopilotReadbackResult extends MarketingAutopilotStageResult {
  readonly providerBacked: boolean;
}

export interface MarketingAutopilotMeasurementResult extends MarketingAutopilotStageResult {
  readonly revenue: number | null;
  readonly revenueProviderBacked: boolean;
}

export interface MarketingAutopilotLearningResult extends MarketingAutopilotStageResult {
  readonly actionRequested?: boolean;
}

export interface MarketingAutopilotClosedLoopAdapters {
  readonly observe: (
    context: MarketingAutopilotStageContext,
  ) => Promise<MarketingAutopilotStageResult>;
  readonly diagnose: (
    context: MarketingAutopilotStageContext,
  ) => Promise<MarketingAutopilotStageResult>;
  readonly decidePlan: (
    context: MarketingAutopilotStageContext,
  ) => Promise<MarketingAutopilotStageResult>;
  readonly creativeTruth: (
    context: MarketingAutopilotStageContext,
  ) => Promise<MarketingAutopilotStageResult>;
  readonly asset: (
    context: MarketingAutopilotStageContext,
  ) => Promise<MarketingAutopilotStageResult>;
  readonly gates: (
    context: MarketingAutopilotStageContext,
  ) => Promise<MarketingAutopilotGatesResult>;
  readonly readback: (
    context: MarketingAutopilotStageContext,
  ) => Promise<MarketingAutopilotReadbackResult>;
  readonly measure: (
    context: MarketingAutopilotStageContext,
  ) => Promise<MarketingAutopilotMeasurementResult>;
  readonly learn: (
    context: MarketingAutopilotStageContext,
  ) => Promise<MarketingAutopilotLearningResult>;
  readonly nextRecommendation: (
    context: MarketingAutopilotStageContext,
  ) => Promise<MarketingAutopilotStageResult>;
}

export interface MarketingAutopilotClosedLoopRunnerOptions {
  readonly workflowStore: WorkflowStore;
  readonly core: CoreCapabilityGateway;
  readonly adapters: MarketingAutopilotClosedLoopAdapters;
}

interface PersistedAutopilotInput {
  readonly asOf: string;
  readonly campaignScope?: string;
  readonly objective: unknown;
  readonly identity: ExecutionIdentity;
}

interface ApprovalStepOutput {
  readonly approvalId: string | null;
  readonly capabilityId: string;
  readonly payload: unknown;
}

interface ScheduleStepOutput {
  readonly executionId: string;
  readonly capabilityId: string;
  readonly providerReadbackVerified: boolean;
  readonly result: unknown;
}

export class MarketingAutopilotClosedLoopRunner {
  readonly #workflowStore: WorkflowStore;
  readonly #core: CoreCapabilityGateway;
  readonly #adapters: MarketingAutopilotClosedLoopAdapters;

  constructor(options: MarketingAutopilotClosedLoopRunnerOptions) {
    this.#workflowStore = options.workflowStore;
    this.#core = options.core;
    this.#adapters = options.adapters;
  }

  start(
    input: MarketingAutopilotClosedLoopStartInput,
    now = new Date().toISOString(),
  ): Promise<WorkflowSnapshot> {
    requireText(input.idempotencyKey, 'MARKETING_AUTOPILOT_IDEMPOTENCY_KEY_REQUIRED');
    requireText(input.correlationId, 'MARKETING_AUTOPILOT_CORRELATION_ID_REQUIRED');
    requireText(input.asOf, 'MARKETING_AUTOPILOT_AS_OF_REQUIRED');
    const principal = input.identity.principal;
    const workflowId = stableWorkflowId(principal.tenantId, input.idempotencyKey);
    const persistedInput: PersistedAutopilotInput = {
      asOf: input.asOf,
      ...(input.campaignScope ? { campaignScope: input.campaignScope } : {}),
      objective: input.objective ?? null,
      identity: input.identity,
    };

    return this.#workflowStore.create(
      {
        workflowId,
        routeId: 'R31',
        definitionId: MARKETING_AUTOPILOT_CLOSED_LOOP_DEFINITION_ID,
        definitionVersion: MARKETING_AUTOPILOT_CLOSED_LOOP_DEFINITION_VERSION,
        idempotencyKey: input.idempotencyKey,
        correlationId: input.correlationId,
        tenantId: principal.tenantId,
        workspaceId: principal.workspaceId,
        organizationId: principal.organizationId,
        requesterPrincipalId: principal.principalId,
        input: persistedInput,
        steps: MARKETING_AUTOPILOT_STAGES.map((stage, index) => ({
          stepId: STAGE_STEP_IDS[stage],
          name: stage,
          maxAttempts: stage === 'SCHEDULE_OR_PUBLISH' ? 1 : 3,
          ...(index > 0
            ? {
                dependsOn: [STAGE_STEP_IDS[MARKETING_AUTOPILOT_STAGES[index - 1]!]],
              }
            : {}),
        })),
      },
      now,
    );
  }

  async resumeRunningCheckpoint(
    workflowId: string,
    now = new Date().toISOString(),
  ): Promise<WorkflowSnapshot> {
    const snapshot = await this.#requireAutopilotSnapshot(workflowId);
    const running = snapshot.steps.filter((step) => step.status === 'RUNNING');
    if (running.length !== 1) {
      throw new Error('MARKETING_AUTOPILOT_RUNNING_CHECKPOINT_REQUIRED');
    }
    const step = running[0]!;
    if (!step.claimedBy || !step.claimExecutionId || !step.claimedAt) {
      throw new Error('MARKETING_AUTOPILOT_RUNNING_CHECKPOINT_INVALID');
    }
    return this.handleClaim(
      {
        workflowId,
        stepId: step.stepId,
        workerId: step.claimedBy,
        executionId: step.claimExecutionId,
        claimedAt: step.claimedAt,
      },
      now,
    );
  }

  async handleClaim(
    claim: WorkflowStepClaim,
    now = new Date().toISOString(),
  ): Promise<WorkflowSnapshot> {
    const snapshot = await this.#requireAutopilotSnapshot(claim.workflowId);
    const step = snapshot.steps.find((item) => item.stepId === claim.stepId);
    if (!step) throw new Error('MARKETING_AUTOPILOT_STEP_NOT_FOUND');
    if (step.status !== 'RUNNING' || step.claimExecutionId !== claim.executionId) {
      throw new Error('MARKETING_AUTOPILOT_STALE_OR_DUPLICATE_WAKEUP');
    }
    const stage = STEP_STAGE.get(step.stepId);
    if (!stage) throw new Error('MARKETING_AUTOPILOT_STAGE_UNKNOWN');

    try {
      if (stage === 'APPROVAL') return await this.#handleApproval(snapshot, claim, now);
      if (stage === 'SCHEDULE_OR_PUBLISH') {
        return await this.#handleSideEffect(snapshot, claim, now);
      }

      const context = this.#context(snapshot, stage, now);
      if (stage === 'READBACK') {
        const result = await this.#adapters.readback(context);
        const evidence = requireStageEvidence(result.evidenceRefs, stage);
        if (!result.providerBacked) {
          return this.#failClaim(
            claim,
            stage,
            'MARKETING_AUTOPILOT_PROVIDER_READBACK_REQUIRED',
            evidence,
            now,
          );
        }
        return this.#completeStage(claim, stage, result, now);
      }

      if (stage === 'MEASURE') {
        const result = await this.#adapters.measure(context);
        requireStageEvidence(result.evidenceRefs, stage);
        if (
          result.revenue !== null &&
          (!Number.isFinite(result.revenue) || !result.revenueProviderBacked)
        ) {
          return this.#failClaim(
            claim,
            stage,
            'MARKETING_AUTOPILOT_REVENUE_NOT_PROVIDER_BACKED',
            result.evidenceRefs,
            now,
          );
        }
        return this.#completeStage(claim, stage, result, now);
      }

      if (stage === 'LEARN') {
        const priorEvidence = requireWorkflowEvidence(
          snapshot.steps
            .filter((item) => item.status === 'SUCCEEDED')
            .flatMap((item) => item.evidence),
          'MARKETING_AUTOPILOT_LEARNING_EVIDENCE_REQUIRED',
        );
        assertLearningBoundary({
          creativeTruthRefs: this.#stageEvidence(snapshot, 'CREATIVE_TRUTH'),
          assetRefs: this.#stageEvidence(snapshot, 'ASSET'),
          gateRefs: this.#stageEvidence(snapshot, 'GATES'),
          approvalRefs: this.#stageEvidence(snapshot, 'APPROVAL'),
          scheduleOrPublishRefs: this.#stageEvidence(snapshot, 'SCHEDULE_OR_PUBLISH'),
          providerReadbackRefs: this.#stageEvidence(snapshot, 'READBACK'),
          measurementRefs: this.#stageEvidence(snapshot, 'MEASURE'),
        });
        const result = await this.#adapters.learn({
          ...context,
          evidenceRefs: priorEvidence,
        });
        requireStageEvidence(result.evidenceRefs, stage);
        if (result.actionRequested) {
          return this.#failClaim(
            claim,
            stage,
            'MARKETING_AUTOPILOT_R31_DIRECT_ACTION_FORBIDDEN',
            result.evidenceRefs,
            now,
          );
        }
        return this.#completeStage(claim, stage, result, now);
      }

      const result = await this.#runOrdinaryStage(stage, context);
      return this.#completeStage(claim, stage, result, now);
    } catch (error) {
      const latest = await this.#workflowStore.get(claim.workflowId);
      const latestStep = latest?.steps.find((item) => item.stepId === claim.stepId);
      if (latestStep?.status === 'RUNNING' && latestStep.claimExecutionId === claim.executionId) {
        await this.#workflowStore.failStep({
          workflowId: claim.workflowId,
          stepId: claim.stepId,
          executionId: claim.executionId,
          errorCode: errorCodeForStage(stage),
          evidence: [`marketing-autopilot://stage/${encodeURIComponent(stage)}/failed`],
          now,
        });
      }
      throw error;
    }
  }

  retryFailedStage(input: {
    readonly workflowId: string;
    readonly stepId: string;
    readonly evidenceRefs: readonly string[];
    readonly now?: string;
  }): Promise<WorkflowSnapshot> {
    return this.#workflowStore.retryStep({
      workflowId: input.workflowId,
      stepId: input.stepId,
      evidence: requireWorkflowEvidence(
        input.evidenceRefs,
        'MARKETING_AUTOPILOT_RETRY_EVIDENCE_REQUIRED',
      ),
      now: input.now ?? new Date().toISOString(),
    });
  }

  async #runOrdinaryStage(
    stage: Exclude<
      MarketingAutopilotStage,
      'APPROVAL' | 'SCHEDULE_OR_PUBLISH' | 'READBACK' | 'MEASURE' | 'LEARN'
    >,
    context: MarketingAutopilotStageContext,
  ): Promise<MarketingAutopilotStageResult> {
    switch (stage) {
      case 'OBSERVE':
        return this.#adapters.observe(context);
      case 'DIAGNOSE':
        return this.#adapters.diagnose(context);
      case 'DECIDE/PLAN':
        return this.#adapters.decidePlan(context);
      case 'CREATIVE_TRUTH':
        return this.#adapters.creativeTruth(context);
      case 'ASSET':
        return this.#adapters.asset(context);
      case 'GATES':
        return this.#adapters.gates(context);
      case 'NEXT_RECOMMENDATION':
        return this.#adapters.nextRecommendation(context);
    }
  }

  async #completeStage(
    claim: WorkflowStepClaim,
    stage: MarketingAutopilotStage,
    result: MarketingAutopilotStageResult,
    now: string,
  ): Promise<WorkflowSnapshot> {
    const evidence = requireStageEvidence(result.evidenceRefs, stage);
    if (result.partial) {
      return this.#failClaim(
        claim,
        stage,
        'MARKETING_AUTOPILOT_PARTIAL_CYCLE',
        evidence,
        now,
      );
    }
    return this.#workflowStore.completeStep({
      workflowId: claim.workflowId,
      stepId: claim.stepId,
      executionId: claim.executionId,
      output: persistedStageOutput(stage, result),
      evidence,
      now,
    });
  }

  async #handleApproval(
    snapshot: WorkflowSnapshot,
    claim: WorkflowStepClaim,
    now: string,
  ): Promise<WorkflowSnapshot> {
    const gates = this.#gatesResult(snapshot);
    const inspection = this.#core.inspect({
      capabilityId: gates.sideEffect.capabilityId,
      payload: gates.sideEffect.payload,
      identity: this.#persistedInput(snapshot).identity,
    });
    if (!inspection.sideEffects) {
      throw new Error('MARKETING_AUTOPILOT_SIDE_EFFECT_CAPABILITY_REQUIRED');
    }
    if (!inspection.idempotent) {
      throw new Error('MARKETING_AUTOPILOT_NON_IDEMPOTENT_SIDE_EFFECT_FORBIDDEN');
    }

    if (!inspection.approvalRequired) {
      return this.#workflowStore.completeStep({
        workflowId: claim.workflowId,
        stepId: claim.stepId,
        executionId: claim.executionId,
        output: {
          approvalId: null,
          capabilityId: inspection.canonicalCapabilityId,
          payload: gates.sideEffect.payload,
        } satisfies ApprovalStepOutput,
        evidence: requireStageEvidence(
          [
            ...gates.evidenceRefs,
            `core://inspection/${inspection.canonicalCapabilityId}/approval-not-required`,
          ],
          'APPROVAL',
        ),
        now,
      });
    }

    const task = snapshot.humanTasks.find((item) => item.stepId === claim.stepId);
    if (!task) {
      const approval = await this.#core.requestApproval({
        capabilityId: inspection.canonicalCapabilityId,
        payload: gates.sideEffect.payload,
        correlationId: snapshot.instance.correlationId,
        expiresAt: gates.sideEffect.approvalExpiresAt,
        evidence: requireStageEvidence(gates.evidenceRefs, 'APPROVAL'),
        identity: this.#persistedInput(snapshot).identity,
      });
      return this.#workflowStore.openHumanTask({
        taskId: approvalTaskId(snapshot.instance.workflowId),
        workflowId: claim.workflowId,
        stepId: claim.stepId,
        executionId: claim.executionId,
        requiredRole: 'APPROVER',
        payload: {
          approvalId: approval.approvalId,
          capabilityId: inspection.canonicalCapabilityId,
        },
        evidence: requireStageEvidence(
          [...approval.evidence, `approval://${approval.approvalId}/requested`],
          'APPROVAL',
        ),
        now,
      });
    }

    if (task.status !== 'COMPLETED') {
      throw new Error('MARKETING_AUTOPILOT_APPROVAL_TASK_NOT_COMPLETED');
    }
    const approvalId = approvalIdFromTask(task.payload);
    const approval = await this.#core.getApproval(approvalId);
    if (!approval || !isExecutableApproval(approval)) {
      throw new Error('MARKETING_AUTOPILOT_APPROVAL_NOT_APPROVED');
    }
    return this.#workflowStore.completeStep({
      workflowId: claim.workflowId,
      stepId: claim.stepId,
      executionId: claim.executionId,
      output: {
        approvalId,
        capabilityId: inspection.canonicalCapabilityId,
        payload: gates.sideEffect.payload,
      } satisfies ApprovalStepOutput,
      evidence: requireStageEvidence(
        [
          ...task.evidence,
          ...approval.evidence,
          `approval://${approvalId}/${approval.status.toLowerCase()}`,
        ],
        'APPROVAL',
      ),
      now,
    });
  }

  async #handleSideEffect(
    snapshot: WorkflowSnapshot,
    claim: WorkflowStepClaim,
    now: string,
  ): Promise<WorkflowSnapshot> {
    const approval = approvalOutput(snapshot);
    const input = this.#persistedInput(snapshot);
    const result = await this.#core.execute({
      capabilityId: approval.capabilityId,
      payload: approval.payload,
      correlationId: stableSideEffectCorrelationId(snapshot),
      identity: input.identity,
      ...(approval.approvalId ? { approvalId: approval.approvalId } : {}),
    });
    if (!result.providerReadbackVerified) {
      return this.#failClaim(
        claim,
        'SCHEDULE_OR_PUBLISH',
        'MARKETING_AUTOPILOT_CORE_READBACK_NOT_VERIFIED',
        [`core://execution/${result.executionId}/readback-unverified`],
        now,
      );
    }
    return this.#workflowStore.completeStep({
      workflowId: claim.workflowId,
      stepId: claim.stepId,
      executionId: claim.executionId,
      output: {
        executionId: result.executionId,
        capabilityId: result.capabilityId,
        providerReadbackVerified: result.providerReadbackVerified,
        result: result.result,
      } satisfies ScheduleStepOutput,
      evidence: [
        `core://execution/${result.executionId}`,
        `core://provider-readback/${result.executionId}/verified`,
      ],
      now,
    });
  }

  #context(
    snapshot: WorkflowSnapshot,
    stage: MarketingAutopilotStage,
    now: string,
  ): MarketingAutopilotStageContext {
    const input = this.#persistedInput(snapshot);
    const outputs: Partial<Record<MarketingAutopilotStage, unknown>> = {};
    for (const step of snapshot.steps) {
      const completedStage = STEP_STAGE.get(step.stepId);
      if (completedStage && step.status === 'SUCCEEDED') {
        outputs[completedStage] = step.output;
      }
    }
    return {
      workflowId: snapshot.instance.workflowId,
      stage,
      asOf: input.asOf,
      ...(input.campaignScope ? { campaignScope: input.campaignScope } : {}),
      objective: input.objective,
      identity: input.identity,
      correlationId: snapshot.instance.correlationId,
      outputs,
      evidenceRefs: snapshot.steps.flatMap((step) => step.evidence),
      now,
    };
  }

  #gatesResult(snapshot: WorkflowSnapshot): MarketingAutopilotGatesResult {
    const step = snapshot.steps.find((item) => item.stepId === STAGE_STEP_IDS.GATES);
    const output = step?.output;
    if (!step || step.status !== 'SUCCEEDED' || !isRecord(output)) {
      throw new Error('MARKETING_AUTOPILOT_GATES_OUTPUT_REQUIRED');
    }
    const sideEffect = output.sideEffect;
    if (!isRecord(sideEffect)) {
      throw new Error('MARKETING_AUTOPILOT_SIDE_EFFECT_PLAN_REQUIRED');
    }
    const capabilityId = text(sideEffect.capabilityId);
    const approvalExpiresAt = text(sideEffect.approvalExpiresAt);
    if (!capabilityId || !approvalExpiresAt) {
      throw new Error('MARKETING_AUTOPILOT_SIDE_EFFECT_PLAN_INVALID');
    }
    return {
      sideEffect: {
        capabilityId,
        payload: sideEffect.payload ?? null,
        approvalExpiresAt,
      },
      output,
      evidenceRefs: step.evidence,
    };
  }

  #stageEvidence(
    snapshot: WorkflowSnapshot,
    stage: MarketingAutopilotStage,
  ): readonly string[] {
    const step = snapshot.steps.find((item) => item.stepId === STAGE_STEP_IDS[stage]);
    return step?.status === 'SUCCEEDED' ? step.evidence : [];
  }

  #persistedInput(snapshot: WorkflowSnapshot): PersistedAutopilotInput {
    const input = snapshot.instance.input;
    if (!isRecord(input) || !isRecord(input.identity)) {
      throw new Error('MARKETING_AUTOPILOT_WORKFLOW_INPUT_INVALID');
    }
    return input as unknown as PersistedAutopilotInput;
  }

  async #requireAutopilotSnapshot(workflowId: string): Promise<WorkflowSnapshot> {
    const snapshot = await this.#workflowStore.get(workflowId);
    if (!snapshot) throw new Error('MARKETING_AUTOPILOT_WORKFLOW_NOT_FOUND');
    if (
      snapshot.instance.routeId !== 'R31' ||
      snapshot.instance.definitionId !== MARKETING_AUTOPILOT_CLOSED_LOOP_DEFINITION_ID
    ) {
      throw new Error('MARKETING_AUTOPILOT_WORKFLOW_DEFINITION_MISMATCH');
    }
    return snapshot;
  }

  #failClaim(
    claim: WorkflowStepClaim,
    stage: MarketingAutopilotStage,
    errorCode: string,
    evidenceRefs: readonly string[],
    now: string,
  ): Promise<WorkflowSnapshot> {
    return this.#workflowStore.failStep({
      workflowId: claim.workflowId,
      stepId: claim.stepId,
      executionId: claim.executionId,
      errorCode,
      evidence: requireStageEvidence(evidenceRefs, stage),
      now,
    });
  }
}

function persistedStageOutput(
  stage: MarketingAutopilotStage,
  result: MarketingAutopilotStageResult,
): unknown {
  if (stage === 'GATES') {
    const gates = result as MarketingAutopilotGatesResult;
    return {
      ...recordOutput(result.output),
      sideEffect: gates.sideEffect,
    };
  }
  if (stage === 'READBACK') {
    const readback = result as MarketingAutopilotReadbackResult;
    return {
      ...recordOutput(result.output),
      providerBacked: readback.providerBacked,
    };
  }
  if (stage === 'MEASURE') {
    const measurement = result as MarketingAutopilotMeasurementResult;
    return {
      ...recordOutput(result.output),
      revenue: measurement.revenue,
      revenueProviderBacked: measurement.revenueProviderBacked,
    };
  }
  if (stage === 'LEARN') {
    const learning = result as MarketingAutopilotLearningResult;
    return {
      ...recordOutput(result.output),
      actionRequested: learning.actionRequested === true,
    };
  }
  return result.output ?? null;
}

function recordOutput(output: unknown): Record<string, unknown> {
  return isRecord(output) ? output : {};
}

function approvalOutput(snapshot: WorkflowSnapshot): ApprovalStepOutput {
  const step = snapshot.steps.find((item) => item.stepId === STAGE_STEP_IDS.APPROVAL);
  if (!step || step.status !== 'SUCCEEDED' || !isRecord(step.output)) {
    throw new Error('MARKETING_AUTOPILOT_APPROVAL_OUTPUT_REQUIRED');
  }
  const capabilityId = text(step.output.capabilityId);
  if (!capabilityId) throw new Error('MARKETING_AUTOPILOT_APPROVAL_OUTPUT_INVALID');
  return {
    approvalId: text(step.output.approvalId),
    capabilityId,
    payload: step.output.payload ?? null,
  };
}

function approvalIdFromTask(payload: unknown): string {
  if (!isRecord(payload)) {
    throw new Error('MARKETING_AUTOPILOT_APPROVAL_TASK_PAYLOAD_INVALID');
  }
  const approvalId = text(payload.approvalId);
  if (!approvalId) throw new Error('MARKETING_AUTOPILOT_APPROVAL_ID_REQUIRED');
  return approvalId;
}

function isExecutableApproval(approval: ApprovalRecord): boolean {
  return approval.status === 'APPROVED' || approval.status === 'RELEASED';
}

function requireStageEvidence(
  evidenceRefs: readonly string[],
  stage: MarketingAutopilotStage,
): readonly string[] {
  return requireWorkflowEvidence(
    evidenceRefs,
    `MARKETING_AUTOPILOT_${stage.replace(/[^A-Z]+/g, '_')}_EVIDENCE_REQUIRED`,
  );
}

function stableWorkflowId(tenantId: string, idempotencyKey: string): string {
  const digest = createHash('sha256')
    .update(`${tenantId.trim()}\u0000${idempotencyKey.trim()}`)
    .digest('hex')
    .slice(0, 32);
  return `marketing-autopilot-r31-${digest}`;
}

function stableSideEffectCorrelationId(snapshot: WorkflowSnapshot): string {
  return `${snapshot.instance.correlationId}:${snapshot.instance.workflowId}:schedule-or-publish`;
}

function approvalTaskId(workflowId: string): string {
  return `${workflowId}:approval`;
}

function errorCodeForStage(stage: MarketingAutopilotStage): string {
  return `MARKETING_AUTOPILOT_${stage.replace(/[^A-Z]+/g, '_')}_FAILED`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requireText(value: string, errorCode: string): void {
  if (!value.trim()) throw new Error(errorCode);
}
