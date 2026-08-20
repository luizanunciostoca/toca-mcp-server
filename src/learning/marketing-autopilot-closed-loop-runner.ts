import { createHash } from 'node:crypto';
import type { ExecutionIdentity } from '../core/identity.js';
import type { ApprovalRecord } from '../governance/approval-governance.js';
import type {
  RevenueEvidenceRecord,
} from '../measurement/attribution-revenue-contracts.js';
import { validateRevenueEvidence } from '../measurement/attribution-revenue-contracts.js';
import type { CoreCapabilityGateway } from '../orchestrator/contracts.js';
import type {
  WorkflowSnapshot,
  WorkflowStep,
  WorkflowStore,
} from '../workflow/workflow-contracts.js';
import {
  assertLearningBoundary,
  MARKETING_AUTOPILOT_CLOSED_LOOP,
  type MarketingAutopilotClosedLoopStage,
  type MarketingAutopilotCycleEvidence,
} from './marketing-autopilot-cycle.js';

const DEFINITION_ID = 'marketing-autopilot.closed-loop';
const DEFINITION_VERSION = '1';
const APPROVAL_TASK_SUFFIX = 'approval';
const APPROVAL_ACCEPTED_STATUSES = new Set<ApprovalRecord['status']>(['APPROVED', 'RELEASED']);
const APPROVAL_PENDING_STATUSES = new Set<ApprovalRecord['status']>(['REQUESTED']);

export interface MarketingAutopilotStageResult {
  readonly output: unknown;
  readonly evidence: readonly string[];
}

export interface MarketingAutopilotStageContext {
  readonly workflowId: string;
  readonly stage: Exclude<
    MarketingAutopilotClosedLoopStage,
    'APPROVAL' | 'SCHEDULE_OR_PUBLISH'
  >;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly identity: ExecutionIdentity;
  readonly snapshot: WorkflowSnapshot;
  readonly now: string;
}

/**
 * Adapter over the already-existing domain implementations. It deliberately never receives
 * APPROVAL or SCHEDULE_OR_PUBLISH: governed external execution is owned by Core below.
 */
export interface MarketingAutopilotStageExecutor {
  execute(input: MarketingAutopilotStageContext): Promise<MarketingAutopilotStageResult>;
}

export interface PlannedCoreAction {
  readonly capabilityId: string;
  readonly payload: unknown;
}

export interface MarketingAutopilotClosedLoopRunnerOptions {
  readonly workflowStore: WorkflowStore;
  readonly coreGateway: CoreCapabilityGateway;
  readonly stageExecutor: MarketingAutopilotStageExecutor;
  readonly workerId?: string;
  readonly maxStagesPerWake?: number;
  readonly staleClaimAfterMs?: number;
  readonly approvalTtlMs?: number;
  readonly now?: () => string;
}

export interface StartMarketingAutopilotCycleInput {
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly identity: ExecutionIdentity;
  readonly input?: unknown;
  readonly workflowId?: string;
  readonly now?: string;
}

export interface WakeMarketingAutopilotCycleInput {
  readonly workflowId: string;
  readonly identity: ExecutionIdentity;
  readonly now?: string;
  readonly maxStages?: number;
}

export interface MarketingAutopilotCheckpoint {
  readonly workflowId: string;
  readonly checkpointRef: string;
  readonly stage: MarketingAutopilotClosedLoopStage;
  readonly status: WorkflowSnapshot['instance']['status'];
  readonly waitingApprovalId: string | null;
  readonly evidence: MarketingAutopilotCycleEvidence;
}

export class MarketingAutopilotClosedLoopRunner {
  readonly #workflowStore: WorkflowStore;
  readonly #coreGateway: CoreCapabilityGateway;
  readonly #stageExecutor: MarketingAutopilotStageExecutor;
  readonly #workerId: string;
  readonly #maxStagesPerWake: number;
  readonly #staleClaimAfterMs: number;
  readonly #approvalTtlMs: number;
  readonly #now: () => string;

  constructor(options: MarketingAutopilotClosedLoopRunnerOptions) {
    this.#workflowStore = options.workflowStore;
    this.#coreGateway = options.coreGateway;
    this.#stageExecutor = options.stageExecutor;
    this.#workerId = options.workerId ?? 'marketing-autopilot-closed-loop';
    this.#maxStagesPerWake = positiveInteger(options.maxStagesPerWake ?? 13, 'AUTOPILOT_MAX_STAGES_INVALID');
    this.#staleClaimAfterMs = positiveInteger(
      options.staleClaimAfterMs ?? 5 * 60_000,
      'AUTOPILOT_STALE_CLAIM_WINDOW_INVALID',
    );
    this.#approvalTtlMs = positiveInteger(
      options.approvalTtlMs ?? 24 * 60 * 60_000,
      'AUTOPILOT_APPROVAL_TTL_INVALID',
    );
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async start(input: StartMarketingAutopilotCycleInput): Promise<MarketingAutopilotCheckpoint> {
    const now = input.now ?? this.#now();
    assertTimestamp(now);
    requireText(input.idempotencyKey, 'AUTOPILOT_IDEMPOTENCY_KEY_REQUIRED');
    requireText(input.correlationId, 'AUTOPILOT_CORRELATION_ID_REQUIRED');
    assertIdentityScope(input.identity);
    const workflowId = input.workflowId ?? buildMarketingAutopilotWorkflowId(
      input.identity.principal.tenantId,
      input.idempotencyKey,
    );
    requireText(workflowId, 'AUTOPILOT_WORKFLOW_ID_REQUIRED');

    const snapshot = await this.#workflowStore.create(
      {
        workflowId,
        routeId: 'R31',
        definitionId: DEFINITION_ID,
        definitionVersion: DEFINITION_VERSION,
        idempotencyKey: input.idempotencyKey,
        correlationId: input.correlationId,
        tenantId: input.identity.principal.tenantId,
        workspaceId: input.identity.principal.workspaceId,
        organizationId: input.identity.principal.organizationId,
        requesterPrincipalId: input.identity.principal.principalId,
        input: input.input ?? null,
        steps: MARKETING_AUTOPILOT_CLOSED_LOOP.map((stage, index) => ({
          stepId: stepIdFor(stage),
          name: stage,
          maxAttempts: stage === 'APPROVAL' ? 1 : 3,
          dependsOn: index === 0 ? [] : [stepIdFor(MARKETING_AUTOPILOT_CLOSED_LOOP[index - 1]!)],
        })),
      },
      now,
    );
    assertSnapshotScope(snapshot, input.identity);
    return projectMarketingAutopilotCheckpoint(snapshot);
  }

  async wake(input: WakeMarketingAutopilotCycleInput): Promise<MarketingAutopilotCheckpoint> {
    const now = input.now ?? this.#now();
    assertTimestamp(now);
    requireText(input.workflowId, 'AUTOPILOT_WORKFLOW_ID_REQUIRED');
    const maxStages = positiveInteger(
      input.maxStages ?? this.#maxStagesPerWake,
      'AUTOPILOT_WAKE_STAGE_LIMIT_INVALID',
    );

    let snapshot = await this.#requireSnapshot(input.workflowId);
    assertSnapshotScope(snapshot, input.identity);
    if (snapshot.instance.definitionId !== DEFINITION_ID)
      throw new Error('AUTOPILOT_WORKFLOW_DEFINITION_MISMATCH');

    snapshot = await this.#recoverOrObserveRunningClaim(snapshot, input.identity, now);
    snapshot = await this.#resumeApprovalIfReady(snapshot, input.identity, now);
    snapshot = await this.#retryRecoverableFailure(snapshot, now);

    let executed = 0;
    while (executed < maxStages && !isTerminal(snapshot)) {
      if (snapshot.instance.status === 'WAITING') break;
      if (snapshot.instance.status === 'BLOCKED') {
        snapshot = await this.#retryRecoverableFailure(snapshot, now);
        if (snapshot.instance.status === 'BLOCKED') break;
      }

      const claims = await this.#workflowStore.claimReadySteps({
        workerId: this.#workerId,
        now,
        limit: 1,
        workflowId: input.workflowId,
      });
      const claim = claims[0];
      if (!claim) break;

      const claimedSnapshot = await this.#requireSnapshot(input.workflowId);
      const step = requireStep(claimedSnapshot, claim.stepId);
      const stage = stageForStep(step);
      try {
        if (stage === 'APPROVAL') {
          const result = await this.#executeApproval(claimedSnapshot, step, claim.executionId, input.identity, now);
          snapshot = result;
          executed += 1;
          if (snapshot.instance.status === 'WAITING') break;
          continue;
        }

        const result = stage === 'SCHEDULE_OR_PUBLISH'
          ? await this.#executeCoreAction(claimedSnapshot, input.identity)
          : await this.#executeDomainStage(stage, claimedSnapshot, input.identity, now);
        this.#assertStageResult(stage, result, claimedSnapshot);
        snapshot = await this.#workflowStore.completeStep({
          workflowId: input.workflowId,
          stepId: step.stepId,
          executionId: claim.executionId,
          output: result.output,
          evidence: result.evidence,
          now,
        });
        executed += 1;
      } catch (error) {
        const code = errorCode(error);
        await this.#workflowStore.failStep({
          workflowId: input.workflowId,
          stepId: step.stepId,
          executionId: claim.executionId,
          errorCode: code,
          evidence: [`autopilot:error:${stage}:${code}`],
          now,
        });
        throw error;
      }
    }

    return projectMarketingAutopilotCheckpoint(snapshot);
  }

  async #executeApproval(
    snapshot: WorkflowSnapshot,
    step: WorkflowStep,
    executionId: string,
    identity: ExecutionIdentity,
    now: string,
  ): Promise<WorkflowSnapshot> {
    const action = requirePlannedCoreAction(snapshot);
    const inspection = this.#coreGateway.inspect({
      capabilityId: action.capabilityId,
      payload: action.payload,
      identity,
    });
    const existingTask = approvalTask(snapshot);
    if (!inspection.approvalRequired) {
      return this.#workflowStore.completeStep({
        workflowId: snapshot.instance.workflowId,
        stepId: step.stepId,
        executionId,
        output: { approvalRequired: false, canonicalCapabilityId: inspection.canonicalCapabilityId },
        evidence: [`core:approval:not-required:${inspection.canonicalCapabilityId}`],
        now,
      });
    }

    if (existingTask) {
      const approvalId = approvalIdFromTask(existingTask.payload);
      const approval = await this.#coreGateway.getApproval(approvalId);
      if (!approval) throw new Error('AUTOPILOT_APPROVAL_RECORD_NOT_FOUND');
      if (!APPROVAL_ACCEPTED_STATUSES.has(approval.status))
        throw new Error(`AUTOPILOT_APPROVAL_NOT_EXECUTABLE:${approval.status}`);
      return this.#workflowStore.completeStep({
        workflowId: snapshot.instance.workflowId,
        stepId: step.stepId,
        executionId,
        output: { approvalRequired: true, approvalId: approval.approvalId },
        evidence: approvalEvidence(approval),
        now,
      });
    }

    const expiresAt = new Date(Date.parse(now) + this.#approvalTtlMs).toISOString();
    const approval = await this.#coreGateway.requestApproval({
      capabilityId: action.capabilityId,
      payload: action.payload,
      correlationId: snapshot.instance.correlationId,
      expiresAt,
      evidence: [`workflow:${snapshot.instance.workflowId}`, `stage:${step.name}`],
      identity,
    });
    return this.#workflowStore.openHumanTask({
      taskId: approvalTaskId(snapshot.instance.workflowId),
      workflowId: snapshot.instance.workflowId,
      stepId: step.stepId,
      executionId,
      payload: { approvalId: approval.approvalId },
      evidence: approvalEvidence(approval),
      now,
    });
  }

  async #resumeApprovalIfReady(
    snapshot: WorkflowSnapshot,
    identity: ExecutionIdentity,
    now: string,
  ): Promise<WorkflowSnapshot> {
    const step = snapshot.steps.find(
      (candidate) => candidate.name === 'APPROVAL' && candidate.status === 'WAITING_HUMAN',
    );
    if (!step) return snapshot;
    const task = approvalTask(snapshot);
    if (!task) throw new Error('AUTOPILOT_APPROVAL_WAIT_WITHOUT_TASK');
    const approvalId = approvalIdFromTask(task.payload);
    const approval = await this.#coreGateway.getApproval(approvalId);
    if (!approval) throw new Error('AUTOPILOT_APPROVAL_RECORD_NOT_FOUND');
    if (APPROVAL_PENDING_STATUSES.has(approval.status)) return snapshot;

    if (task.status === 'OPEN') {
      snapshot = await this.#workflowStore.claimHumanTask({
        taskId: task.taskId,
        principalId: identity.principal.principalId,
        principalRoles: identity.authorization.roles,
        evidence: approvalEvidence(approval),
        now,
      });
    }
    const claimed = approvalTask(snapshot);
    if (!claimed) throw new Error('AUTOPILOT_APPROVAL_TASK_NOT_FOUND');
    if (claimed.status === 'CLAIMED') {
      if (claimed.assignedPrincipalId !== identity.principal.principalId)
        throw new Error('AUTOPILOT_APPROVAL_TASK_PRINCIPAL_MISMATCH');
      snapshot = await this.#workflowStore.completeHumanTask({
        taskId: claimed.taskId,
        principalId: identity.principal.principalId,
        completion: { approvalId, canonicalStatus: approval.status },
        evidence: approvalEvidence(approval),
        now,
      });
    }
    return snapshot;
  }

  async #executeCoreAction(
    snapshot: WorkflowSnapshot,
    identity: ExecutionIdentity,
  ): Promise<MarketingAutopilotStageResult> {
    const action = requirePlannedCoreAction(snapshot);
    const inspection = this.#coreGateway.inspect({
      capabilityId: action.capabilityId,
      payload: action.payload,
      identity,
    });
    if (inspection.sideEffects) {
      if (!inspection.idempotent) throw new Error('AUTOPILOT_CORE_SIDE_EFFECT_NOT_IDEMPOTENT');
      requireStableActionIdempotency(action.payload);
    }
    const approvalId = inspection.approvalRequired ? requireApprovalId(snapshot) : undefined;
    const execution = await this.#coreGateway.execute({
      capabilityId: action.capabilityId,
      payload: action.payload,
      correlationId: snapshot.instance.correlationId,
      identity,
      ...(approvalId ? { approvalId } : {}),
    });
    return {
      output: {
        coreExecutionRef: `core-execution:${execution.executionId}`,
        capabilityId: execution.capabilityId,
        providerReadbackVerified: execution.providerReadbackVerified,
        result: execution.result,
      },
      evidence: [`core-execution:${execution.executionId}`],
    };
  }

  async #executeDomainStage(
    stage: Exclude<MarketingAutopilotClosedLoopStage, 'APPROVAL' | 'SCHEDULE_OR_PUBLISH'>,
    snapshot: WorkflowSnapshot,
    identity: ExecutionIdentity,
    now: string,
  ): Promise<MarketingAutopilotStageResult> {
    if (stage === 'LEARN') assertLearningBoundary(cycleEvidence(snapshot));
    return this.#stageExecutor.execute({
      workflowId: snapshot.instance.workflowId,
      stage,
      idempotencyKey: `${snapshot.instance.idempotencyKey}:${stage}`,
      correlationId: snapshot.instance.correlationId,
      identity,
      snapshot,
      now,
    });
  }

  #assertStageResult(
    stage: MarketingAutopilotClosedLoopStage,
    result: MarketingAutopilotStageResult,
    snapshot: WorkflowSnapshot,
  ): void {
    requireEvidence(result.evidence, `AUTOPILOT_${stage}_EVIDENCE_REQUIRED`);
    if (stage === 'PLAN') requirePlannedCoreActionFromOutput(result.output);
    if (stage === 'READBACK') {
      const output = readbackOutput(result.output);
      if (output.providerBacked !== true) throw new Error('AUTOPILOT_PROVIDER_READBACK_NOT_BACKED');
      requireEvidence(output.providerReadbackRefs, 'AUTOPILOT_PROVIDER_READBACK_EVIDENCE_REQUIRED');
    }
    if (stage === 'MEASURE') {
      const output = measurementOutput(result.output);
      requireEvidence(output.measurementRefs, 'AUTOPILOT_MEASUREMENT_EVIDENCE_REQUIRED');
      for (const record of output.revenueEvidence) {
        validateRevenueEvidence(record);
        assertRevenueScope(record, snapshot);
      }
    }
    if (stage === 'LEARN') {
      requireEvidence(result.evidence, 'AUTOPILOT_LEARNING_EVIDENCE_REQUIRED');
    }
  }

  async #recoverOrObserveRunningClaim(
    snapshot: WorkflowSnapshot,
    identity: ExecutionIdentity,
    now: string,
  ): Promise<WorkflowSnapshot> {
    const running = snapshot.steps.find((step) => step.status === 'RUNNING');
    if (!running) return snapshot;
    if (!running.claimedAt || !running.claimExecutionId)
      throw new Error('AUTOPILOT_RUNNING_CLAIM_INVALID');
    if (Date.parse(now) - Date.parse(running.claimedAt) < this.#staleClaimAfterMs) return snapshot;
    const stage = stageForStep(running);
    if (stage === 'APPROVAL') {
      return this.#workflowStore.failStep({
        workflowId: snapshot.instance.workflowId,
        stepId: running.stepId,
        executionId: running.claimExecutionId,
        errorCode: 'AUTOPILOT_STALE_APPROVAL_REQUIRES_REVIEW',
        evidence: ['autopilot:stale-claim:approval:manual-review'],
        now,
      });
    }
    if (stage === 'SCHEDULE_OR_PUBLISH') {
      const action = requirePlannedCoreAction(snapshot);
      const inspection = this.#coreGateway.inspect({
        capabilityId: action.capabilityId,
        payload: action.payload,
        identity,
      });
      if (!inspection.idempotent) {
        return this.#workflowStore.failStep({
          workflowId: snapshot.instance.workflowId,
          stepId: running.stepId,
          executionId: running.claimExecutionId,
          errorCode: 'AUTOPILOT_STALE_SIDE_EFFECT_REQUIRES_REVIEW',
          evidence: ['autopilot:stale-claim:side-effect:not-idempotent'],
          now,
        });
      }
      requireStableActionIdempotency(action.payload);
    }
    snapshot = await this.#workflowStore.failStep({
      workflowId: snapshot.instance.workflowId,
      stepId: running.stepId,
      executionId: running.claimExecutionId,
      errorCode: 'AUTOPILOT_STALE_CLAIM_RECOVERED',
      evidence: [`autopilot:stale-claim:${stage}`],
      now,
    });
    return this.#retryRecoverableFailure(snapshot, now);
  }

  async #retryRecoverableFailure(snapshot: WorkflowSnapshot, now: string): Promise<WorkflowSnapshot> {
    const failed = snapshot.steps.find((step) => step.status === 'FAILED');
    if (!failed || failed.attempts >= failed.maxAttempts) return snapshot;
    if (failed.errorCode?.endsWith('REQUIRES_REVIEW')) return snapshot;
    return this.#workflowStore.retryStep({
      workflowId: snapshot.instance.workflowId,
      stepId: failed.stepId,
      evidence: [`autopilot:retry:${failed.name}:${failed.attempts + 1}`],
      now,
    });
  }

  async #requireSnapshot(workflowId: string): Promise<WorkflowSnapshot> {
    const snapshot = await this.#workflowStore.get(workflowId);
    if (!snapshot) throw new Error('AUTOPILOT_WORKFLOW_NOT_FOUND');
    return snapshot;
  }
}

export function buildMarketingAutopilotWorkflowId(tenantId: string, idempotencyKey: string): string {
  requireText(tenantId, 'AUTOPILOT_TENANT_ID_REQUIRED');
  requireText(idempotencyKey, 'AUTOPILOT_IDEMPOTENCY_KEY_REQUIRED');
  const digest = createHash('sha256').update(`${tenantId}:${idempotencyKey}`).digest('hex').slice(0, 24);
  return `marketing-autopilot:${digest}`;
}

export function projectMarketingAutopilotCheckpoint(snapshot: WorkflowSnapshot): MarketingAutopilotCheckpoint {
  const current = snapshot.steps.find((step) => !['SUCCEEDED', 'SKIPPED'].includes(step.status));
  const stage = current ? stageForStep(current) : 'NEXT_RECOMMENDATION';
  return {
    workflowId: snapshot.instance.workflowId,
    checkpointRef: `workflow:${snapshot.instance.workflowId}:v${snapshot.instance.version}`,
    stage,
    status: snapshot.instance.status,
    waitingApprovalId: approvalTask(snapshot) ? approvalIdFromTask(approvalTask(snapshot)!.payload) : null,
    evidence: cycleEvidence(snapshot),
  };
}

function stepIdFor(stage: MarketingAutopilotClosedLoopStage): string {
  const index = MARKETING_AUTOPILOT_CLOSED_LOOP.indexOf(stage);
  if (index < 0) throw new Error(`AUTOPILOT_STAGE_UNKNOWN:${stage}`);
  return `${String(index + 1).padStart(2, '0')}_${stage}`;
}

function stageForStep(step: WorkflowStep): MarketingAutopilotClosedLoopStage {
  const stage = step.name as MarketingAutopilotClosedLoopStage;
  if (!MARKETING_AUTOPILOT_CLOSED_LOOP.includes(stage))
    throw new Error(`AUTOPILOT_WORKFLOW_STAGE_INVALID:${step.name}`);
  return stage;
}

function cycleEvidence(snapshot: WorkflowSnapshot): MarketingAutopilotCycleEvidence {
  return {
    creativeTruthRefs: evidenceFor(snapshot, 'CREATIVE_TRUTH'),
    assetRefs: evidenceFor(snapshot, 'ASSET'),
    gateRefs: evidenceFor(snapshot, 'GATES'),
    approvalRefs: evidenceFor(snapshot, 'APPROVAL'),
    scheduleOrPublishRefs: evidenceFor(snapshot, 'SCHEDULE_OR_PUBLISH'),
    providerReadbackRefs: providerReadbackRefs(snapshot),
    measurementRefs: measurementRefs(snapshot),
  };
}

function evidenceFor(snapshot: WorkflowSnapshot, stage: MarketingAutopilotClosedLoopStage): readonly string[] {
  return snapshot.steps.find((step) => step.name === stage)?.evidence ?? [];
}

function providerReadbackRefs(snapshot: WorkflowSnapshot): readonly string[] {
  const step = snapshot.steps.find((candidate) => candidate.name === 'READBACK');
  if (!step || step.status !== 'SUCCEEDED') return [];
  return readbackOutput(step.output).providerReadbackRefs;
}

function measurementRefs(snapshot: WorkflowSnapshot): readonly string[] {
  const step = snapshot.steps.find((candidate) => candidate.name === 'MEASURE');
  if (!step || step.status !== 'SUCCEEDED') return [];
  return measurementOutput(step.output).measurementRefs;
}

function requirePlannedCoreAction(snapshot: WorkflowSnapshot): PlannedCoreAction {
  const plan = snapshot.steps.find((step) => step.name === 'PLAN' && step.status === 'SUCCEEDED');
  if (!plan) throw new Error('AUTOPILOT_PLAN_NOT_COMPLETE');
  return requirePlannedCoreActionFromOutput(plan.output);
}

function requirePlannedCoreActionFromOutput(output: unknown): PlannedCoreAction {
  const root = asRecord(output, 'AUTOPILOT_PLAN_OUTPUT_INVALID');
  const action = asRecord(root.plannedAction, 'AUTOPILOT_PLANNED_ACTION_REQUIRED');
  const capabilityId = typeof action.capabilityId === 'string' ? action.capabilityId.trim() : '';
  if (!capabilityId) throw new Error('AUTOPILOT_PLANNED_CAPABILITY_REQUIRED');
  if (!Object.hasOwn(action, 'payload')) throw new Error('AUTOPILOT_PLANNED_PAYLOAD_REQUIRED');
  return { capabilityId, payload: action.payload };
}

function requireStableActionIdempotency(payload: unknown): string {
  const record = asRecord(payload, 'AUTOPILOT_SIDE_EFFECT_PAYLOAD_INVALID');
  const value = [record.idempotencyKey, record.idempotency_key].find(
    (candidate) => typeof candidate === 'string' && candidate.trim().length > 0,
  );
  if (typeof value !== 'string') throw new Error('AUTOPILOT_SIDE_EFFECT_IDEMPOTENCY_REQUIRED');
  return value.trim();
}

function requireApprovalId(snapshot: WorkflowSnapshot): string {
  const task = approvalTask(snapshot);
  if (!task) throw new Error('AUTOPILOT_APPROVAL_REQUIRED_BUT_MISSING');
  return approvalIdFromTask(task.payload);
}

function approvalTask(snapshot: WorkflowSnapshot): WorkflowSnapshot['humanTasks'][number] | undefined {
  return snapshot.humanTasks.find((task) => task.taskId === approvalTaskId(snapshot.instance.workflowId));
}

function approvalTaskId(workflowId: string): string {
  return `${workflowId}:${APPROVAL_TASK_SUFFIX}`;
}

function approvalIdFromTask(payload: unknown): string {
  const record = asRecord(payload, 'AUTOPILOT_APPROVAL_TASK_PAYLOAD_INVALID');
  const approvalId = typeof record.approvalId === 'string' ? record.approvalId.trim() : '';
  if (!approvalId) throw new Error('AUTOPILOT_APPROVAL_ID_REQUIRED');
  return approvalId;
}

function approvalEvidence(approval: ApprovalRecord): readonly string[] {
  return [...new Set([`approval:${approval.approvalId}`, ...approval.evidence].filter((value) => value.trim()))];
}

function readbackOutput(output: unknown): {
  readonly providerBacked: boolean;
  readonly providerReadbackRefs: readonly string[];
} {
  const record = asRecord(output, 'AUTOPILOT_READBACK_OUTPUT_INVALID');
  return {
    providerBacked: record.providerBacked === true,
    providerReadbackRefs: stringArray(record.providerReadbackRefs, 'AUTOPILOT_PROVIDER_READBACK_REFS_INVALID'),
  };
}

function measurementOutput(output: unknown): {
  readonly measurementRefs: readonly string[];
  readonly revenueEvidence: readonly RevenueEvidenceRecord[];
} {
  const record = asRecord(output, 'AUTOPILOT_MEASUREMENT_OUTPUT_INVALID');
  const revenue = record.revenueEvidence ?? [];
  if (!Array.isArray(revenue)) throw new Error('AUTOPILOT_REVENUE_EVIDENCE_INVALID');
  return {
    measurementRefs: stringArray(record.measurementRefs, 'AUTOPILOT_MEASUREMENT_REFS_INVALID'),
    revenueEvidence: revenue as RevenueEvidenceRecord[],
  };
}

function assertRevenueScope(record: RevenueEvidenceRecord, snapshot: WorkflowSnapshot): void {
  if (
    record.tenantId !== snapshot.instance.tenantId ||
    record.workspaceId !== snapshot.instance.workspaceId ||
    record.organizationId !== snapshot.instance.organizationId
  ) {
    throw new Error('AUTOPILOT_REVENUE_SCOPE_MISMATCH');
  }
}

function assertSnapshotScope(snapshot: WorkflowSnapshot, identity: ExecutionIdentity): void {
  if (
    snapshot.instance.tenantId !== identity.principal.tenantId ||
    snapshot.instance.workspaceId !== identity.principal.workspaceId ||
    snapshot.instance.organizationId !== identity.principal.organizationId ||
    identity.authorization.tenantId !== identity.principal.tenantId ||
    identity.authorization.principalId !== identity.principal.principalId
  ) {
    throw new Error('AUTOPILOT_EXECUTION_SCOPE_MISMATCH');
  }
}

function assertIdentityScope(identity: ExecutionIdentity): void {
  requireText(identity.principal.tenantId, 'AUTOPILOT_TENANT_ID_REQUIRED');
  requireText(identity.principal.workspaceId, 'AUTOPILOT_WORKSPACE_ID_REQUIRED');
  requireText(identity.principal.organizationId, 'AUTOPILOT_ORGANIZATION_ID_REQUIRED');
  requireText(identity.principal.principalId, 'AUTOPILOT_PRINCIPAL_ID_REQUIRED');
  if (
    identity.authorization.tenantId !== identity.principal.tenantId ||
    identity.authorization.principalId !== identity.principal.principalId
  ) {
    throw new Error('AUTOPILOT_IDENTITY_AUTHORIZATION_MISMATCH');
  }
}

function requireStep(snapshot: WorkflowSnapshot, stepId: string): WorkflowStep {
  const step = snapshot.steps.find((candidate) => candidate.stepId === stepId);
  if (!step) throw new Error('AUTOPILOT_CLAIMED_STEP_NOT_FOUND');
  return step;
}

function isTerminal(snapshot: WorkflowSnapshot): boolean {
  return ['SUCCEEDED', 'FAILED', 'CANCELED'].includes(snapshot.instance.status);
}

function requireEvidence(values: readonly string[], code: string): void {
  if (!values.some((value) => value.trim().length > 0)) throw new Error(code);
}

function stringArray(value: unknown, code: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(code);
  return value as string[];
}

function asRecord(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function requireText(value: string, code: string): void {
  if (!value.trim()) throw new Error(code);
}

function positiveInteger(value: number, code: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(code);
  return value;
}

function assertTimestamp(value: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error('AUTOPILOT_TIMESTAMP_INVALID');
}

function errorCode(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.slice(0, 240);
  return 'AUTOPILOT_STAGE_FAILED';
}
