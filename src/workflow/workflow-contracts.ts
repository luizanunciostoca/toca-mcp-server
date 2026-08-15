import type { RouteId } from '../governance/types.js';

export const WORKFLOW_INSTANCE_STATUSES = [
  'RUNNING',
  'WAITING',
  'BLOCKED',
  'SUCCEEDED',
  'FAILED',
  'CANCELED',
] as const;
export type WorkflowInstanceStatus = (typeof WORKFLOW_INSTANCE_STATUSES)[number];

export const WORKFLOW_STEP_STATUSES = [
  'PENDING',
  'READY',
  'RUNNING',
  'WAITING_HUMAN',
  'WAITING_TIMER',
  'SUCCEEDED',
  'FAILED',
  'SKIPPED',
  'BLOCKED',
  'CANCELED',
] as const;
export type WorkflowStepStatus = (typeof WORKFLOW_STEP_STATUSES)[number];

export const WORKFLOW_HUMAN_TASK_STATUSES = ['OPEN', 'CLAIMED', 'COMPLETED', 'CANCELED'] as const;
export type WorkflowHumanTaskStatus = (typeof WORKFLOW_HUMAN_TASK_STATUSES)[number];

export const WORKFLOW_TIMER_STATUSES = ['SCHEDULED', 'FIRED', 'CANCELED'] as const;
export type WorkflowTimerStatus = (typeof WORKFLOW_TIMER_STATUSES)[number];

export const WORKFLOW_COMPENSATION_STATUSES = [
  'PENDING',
  'READY',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'SKIPPED',
] as const;
export type WorkflowCompensationStatus = (typeof WORKFLOW_COMPENSATION_STATUSES)[number];

export const WORKFLOW_EVENT_TYPES = [
  'WORKFLOW_CREATED',
  'WORKFLOW_STATUS_CHANGED',
  'STEP_READY',
  'STEP_CLAIMED',
  'STEP_SUCCEEDED',
  'STEP_FAILED',
  'STEP_RETRIED',
  'HUMAN_TASK_OPENED',
  'HUMAN_TASK_CLAIMED',
  'HUMAN_TASK_COMPLETED',
  'TIMER_SCHEDULED',
  'TIMER_FIRED',
  'COMPENSATION_REGISTERED',
  'COMPENSATION_READY',
  'COMPENSATION_CLAIMED',
  'COMPENSATION_SUCCEEDED',
  'COMPENSATION_FAILED',
] as const;
export type WorkflowEventType = (typeof WORKFLOW_EVENT_TYPES)[number];

export interface WorkflowInstance {
  readonly workflowId: string;
  readonly routeId: RouteId;
  readonly definitionId: string;
  readonly definitionVersion: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly requesterPrincipalId: string;
  readonly status: WorkflowInstanceStatus;
  readonly input: unknown;
  readonly output: unknown | null;
  readonly errorCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly version: number;
}

export interface WorkflowStep {
  readonly workflowId: string;
  readonly stepId: string;
  readonly name: string;
  readonly capabilityId: string | null;
  readonly status: WorkflowStepStatus;
  readonly input: unknown;
  readonly output: unknown | null;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly claimedBy: string | null;
  readonly claimExecutionId: string | null;
  readonly claimedAt: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly errorCode: string | null;
  readonly evidence: readonly string[];
  readonly version: number;
}

export interface WorkflowDependency {
  readonly workflowId: string;
  readonly stepId: string;
  readonly dependsOnStepId: string;
}

export interface WorkflowEvent {
  readonly eventId: string;
  readonly workflowId: string;
  readonly stepId: string | null;
  readonly eventType: WorkflowEventType;
  readonly correlationId: string;
  readonly payload: unknown;
  readonly evidence: readonly string[];
  readonly occurredAt: string;
}

export interface WorkflowHumanTask {
  readonly taskId: string;
  readonly workflowId: string;
  readonly stepId: string;
  readonly status: WorkflowHumanTaskStatus;
  readonly requiredRole: string | null;
  readonly assignedPrincipalId: string | null;
  readonly payload: unknown;
  readonly dueAt: string | null;
  readonly claimedAt: string | null;
  readonly completedAt: string | null;
  readonly completion: unknown | null;
  readonly evidence: readonly string[];
  readonly version: number;
}

export interface WorkflowTimer {
  readonly timerId: string;
  readonly workflowId: string;
  readonly stepId: string;
  readonly status: WorkflowTimerStatus;
  readonly fireAt: string;
  readonly firedAt: string | null;
  readonly payload: unknown;
  readonly version: number;
}

export interface WorkflowCompensation {
  readonly compensationId: string;
  readonly workflowId: string;
  readonly stepId: string;
  readonly orderIndex: number;
  readonly capabilityId: string | null;
  readonly status: WorkflowCompensationStatus;
  readonly input: unknown;
  readonly output: unknown | null;
  readonly claimedBy: string | null;
  readonly claimExecutionId: string | null;
  readonly claimedAt: string | null;
  readonly completedAt: string | null;
  readonly errorCode: string | null;
  readonly evidence: readonly string[];
  readonly version: number;
}

export interface WorkflowStepBlueprint {
  readonly stepId: string;
  readonly name: string;
  readonly capabilityId?: string | null;
  readonly input?: unknown;
  readonly maxAttempts?: number;
  readonly dependsOn?: readonly string[];
}

export interface WorkflowBlueprint {
  readonly workflowId: string;
  readonly routeId: RouteId;
  readonly definitionId: string;
  readonly definitionVersion: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly requesterPrincipalId: string;
  readonly input?: unknown;
  readonly steps: readonly WorkflowStepBlueprint[];
}

export interface WorkflowSnapshot {
  readonly instance: WorkflowInstance;
  readonly steps: readonly WorkflowStep[];
  readonly dependencies: readonly WorkflowDependency[];
  readonly events: readonly WorkflowEvent[];
  readonly humanTasks: readonly WorkflowHumanTask[];
  readonly timers: readonly WorkflowTimer[];
  readonly compensations: readonly WorkflowCompensation[];
}

export interface WorkflowStepClaim {
  readonly workflowId: string;
  readonly stepId: string;
  readonly workerId: string;
  readonly executionId: string;
  readonly claimedAt: string;
}

export interface WorkflowStore {
  create(blueprint: WorkflowBlueprint, now?: string): Promise<WorkflowSnapshot>;
  get(workflowId: string): Promise<WorkflowSnapshot | undefined>;
  claimReadySteps(input: {
    readonly workerId: string;
    readonly now: string;
    readonly limit: number;
  }): Promise<readonly WorkflowStepClaim[]>;
  completeStep(input: {
    readonly workflowId: string;
    readonly stepId: string;
    readonly executionId: string;
    readonly output?: unknown;
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<WorkflowSnapshot>;
  failStep(input: {
    readonly workflowId: string;
    readonly stepId: string;
    readonly executionId: string;
    readonly errorCode: string;
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<WorkflowSnapshot>;
  retryStep(input: {
    readonly workflowId: string;
    readonly stepId: string;
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<WorkflowSnapshot>;
  openHumanTask(input: {
    readonly taskId: string;
    readonly workflowId: string;
    readonly stepId: string;
    readonly executionId: string;
    readonly requiredRole?: string | null;
    readonly payload?: unknown;
    readonly dueAt?: string | null;
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<WorkflowSnapshot>;
  claimHumanTask(input: {
    readonly taskId: string;
    readonly principalId: string;
    readonly principalRoles?: readonly string[];
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<WorkflowSnapshot>;
  completeHumanTask(input: {
    readonly taskId: string;
    readonly principalId: string;
    readonly completion?: unknown;
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<WorkflowSnapshot>;
  scheduleTimer(input: {
    readonly timerId: string;
    readonly workflowId: string;
    readonly stepId: string;
    readonly executionId: string;
    readonly fireAt: string;
    readonly payload?: unknown;
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<WorkflowSnapshot>;
  fireDueTimers(input: {
    readonly now: string;
    readonly limit: number;
  }): Promise<readonly string[]>;
  registerCompensation(input: {
    readonly compensationId: string;
    readonly workflowId: string;
    readonly stepId: string;
    readonly orderIndex: number;
    readonly capabilityId?: string | null;
    readonly payload?: unknown;
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<WorkflowSnapshot>;
  activateCompensations(input: {
    readonly workflowId: string;
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<WorkflowSnapshot>;
}

export function validateWorkflowBlueprint(blueprint: WorkflowBlueprint): void {
  requireText(blueprint.workflowId, 'WORKFLOW_ID_REQUIRED');
  requireText(blueprint.definitionId, 'WORKFLOW_DEFINITION_ID_REQUIRED');
  requireText(blueprint.definitionVersion, 'WORKFLOW_DEFINITION_VERSION_REQUIRED');
  requireText(blueprint.idempotencyKey, 'WORKFLOW_IDEMPOTENCY_KEY_REQUIRED');
  requireText(blueprint.correlationId, 'WORKFLOW_CORRELATION_ID_REQUIRED');
  requireText(blueprint.tenantId, 'WORKFLOW_TENANT_ID_REQUIRED');
  requireText(blueprint.workspaceId, 'WORKFLOW_WORKSPACE_ID_REQUIRED');
  requireText(blueprint.organizationId, 'WORKFLOW_ORGANIZATION_ID_REQUIRED');
  requireText(blueprint.requesterPrincipalId, 'WORKFLOW_REQUESTER_REQUIRED');
  assertJsonSerializable(blueprint.input ?? null);
  if (blueprint.steps.length === 0) throw new Error('WORKFLOW_STEPS_REQUIRED');

  const stepIds = new Set<string>();
  for (const step of blueprint.steps) {
    requireText(step.stepId, 'WORKFLOW_STEP_ID_REQUIRED');
    requireText(step.name, 'WORKFLOW_STEP_NAME_REQUIRED');
    if (stepIds.has(step.stepId)) throw new Error(`WORKFLOW_STEP_DUPLICATE:${step.stepId}`);
    stepIds.add(step.stepId);
    const maxAttempts = step.maxAttempts ?? 1;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1)
      throw new Error(`WORKFLOW_STEP_MAX_ATTEMPTS_INVALID:${step.stepId}`);
    assertJsonSerializable(step.input ?? null);
  }

  for (const step of blueprint.steps) {
    const dependencies = new Set(step.dependsOn ?? []);
    if (dependencies.size !== (step.dependsOn ?? []).length)
      throw new Error(`WORKFLOW_DEPENDENCY_DUPLICATE:${step.stepId}`);
    for (const dependency of dependencies) {
      if (dependency === step.stepId) throw new Error(`WORKFLOW_DEPENDENCY_SELF:${step.stepId}`);
      if (!stepIds.has(dependency))
        throw new Error(`WORKFLOW_DEPENDENCY_UNKNOWN:${step.stepId}->${dependency}`);
    }
  }

  assertAcyclic(blueprint.steps);
}

export function assertWorkflowStepClaim(step: WorkflowStep, executionId: string): void {
  if (step.status !== 'RUNNING')
    throw new Error(`WORKFLOW_STEP_NOT_RUNNING:${step.workflowId}:${step.stepId}`);
  if (!executionId.trim() || step.claimExecutionId !== executionId)
    throw new Error(`WORKFLOW_STEP_CLAIM_MISMATCH:${step.workflowId}:${step.stepId}`);
}

export function requireWorkflowEvidence(
  evidence: readonly string[],
  errorCode = 'WORKFLOW_EVIDENCE_REQUIRED',
): readonly string[] {
  const normalized = unique(evidence.map((item) => item.trim()).filter(Boolean)).sort();
  if (normalized.length === 0) throw new Error(errorCode);
  return normalized;
}

export function assertJsonSerializable(value: unknown): void {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error('undefined');
  } catch {
    throw new Error('WORKFLOW_PAYLOAD_NOT_JSON_SERIALIZABLE');
  }
}

function assertAcyclic(steps: readonly WorkflowStepBlueprint[]): void {
  const dependencies = new Map(
    steps.map((step) => [step.stepId, [...new Set(step.dependsOn ?? [])]] as const),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (stepId: string): void => {
    if (visited.has(stepId)) return;
    if (visiting.has(stepId)) throw new Error(`WORKFLOW_DEPENDENCY_CYCLE:${stepId}`);
    visiting.add(stepId);
    for (const dependency of dependencies.get(stepId) ?? []) visit(dependency);
    visiting.delete(stepId);
    visited.add(stepId);
  };

  for (const step of steps) visit(step.stepId);
}

function requireText(value: string, errorCode: string): void {
  if (!value.trim()) throw new Error(errorCode);
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
