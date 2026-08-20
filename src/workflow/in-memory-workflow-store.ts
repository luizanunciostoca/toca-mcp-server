import { randomUUID } from 'node:crypto';
import {
  assertJsonSerializable,
  assertWorkflowStepClaim,
  requireWorkflowEvidence,
  validateWorkflowBlueprint,
  type WorkflowBlueprint,
  type WorkflowCompensation,
  type WorkflowDependency,
  type WorkflowEvent,
  type WorkflowEventType,
  type WorkflowHumanTask,
  type WorkflowInstance,
  type WorkflowSnapshot,
  type WorkflowStep,
  type WorkflowStepClaim,
  type WorkflowStore,
  type WorkflowTimer,
} from './workflow-contracts.js';

export interface InMemoryWorkflowStoreOptions {
  readonly createId?: () => string;
}

export class InMemoryWorkflowStore implements WorkflowStore {
  readonly #instances = new Map<string, WorkflowInstance>();
  readonly #steps = new Map<string, Map<string, WorkflowStep>>();
  readonly #dependencies = new Map<string, WorkflowDependency[]>();
  readonly #events = new Map<string, WorkflowEvent[]>();
  readonly #humanTasks = new Map<string, WorkflowHumanTask>();
  readonly #timers = new Map<string, WorkflowTimer>();
  readonly #compensations = new Map<string, WorkflowCompensation>();
  readonly #idempotency = new Map<string, string>();
  readonly #claimedExecutionIds = new Set<string>();
  readonly #createId: () => string;

  constructor(options: InMemoryWorkflowStoreOptions = {}) {
    this.#createId = options.createId ?? randomUUID;
  }

  async create(
    blueprint: WorkflowBlueprint,
    now = new Date().toISOString(),
  ): Promise<WorkflowSnapshot> {
    await Promise.resolve();
    validateWorkflowBlueprint(blueprint);
    assertTimestamp(now, 'WORKFLOW_NOW_INVALID');

    const idempotencyScope = scopedIdempotencyKey(blueprint);
    const existingWorkflowId = this.#idempotency.get(idempotencyScope);
    if (existingWorkflowId) {
      if (existingWorkflowId !== blueprint.workflowId)
        throw new Error('WORKFLOW_IDEMPOTENCY_CONFLICT');
      return this.#snapshot(existingWorkflowId);
    }
    if (this.#instances.has(blueprint.workflowId)) throw new Error('WORKFLOW_ALREADY_EXISTS');

    const instance: WorkflowInstance = {
      workflowId: blueprint.workflowId,
      routeId: blueprint.routeId,
      definitionId: blueprint.definitionId,
      definitionVersion: blueprint.definitionVersion,
      idempotencyKey: blueprint.idempotencyKey,
      correlationId: blueprint.correlationId,
      tenantId: blueprint.tenantId,
      workspaceId: blueprint.workspaceId,
      organizationId: blueprint.organizationId,
      requesterPrincipalId: blueprint.requesterPrincipalId,
      status: 'RUNNING',
      input: cloneJson(blueprint.input ?? null),
      output: null,
      errorCode: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      version: 1,
    };

    const dependencies: WorkflowDependency[] = blueprint.steps.flatMap((step) =>
      (step.dependsOn ?? []).map((dependsOnStepId) => ({
        workflowId: blueprint.workflowId,
        stepId: step.stepId,
        dependsOnStepId,
      })),
    );
    const stepMap = new Map<string, WorkflowStep>();
    for (const step of blueprint.steps) {
      const hasDependencies = dependencies.some((dependency) => dependency.stepId === step.stepId);
      stepMap.set(step.stepId, {
        workflowId: blueprint.workflowId,
        stepId: step.stepId,
        name: step.name,
        capabilityId: step.capabilityId ?? null,
        status: hasDependencies ? 'PENDING' : 'READY',
        input: cloneJson(step.input ?? null),
        output: null,
        attempts: 0,
        maxAttempts: step.maxAttempts ?? 1,
        claimedBy: null,
        claimExecutionId: null,
        claimedAt: null,
        startedAt: null,
        completedAt: null,
        errorCode: null,
        evidence: [],
        version: 1,
      });
    }

    this.#instances.set(blueprint.workflowId, instance);
    this.#steps.set(blueprint.workflowId, stepMap);
    this.#dependencies.set(blueprint.workflowId, dependencies);
    this.#events.set(blueprint.workflowId, []);
    this.#idempotency.set(idempotencyScope, blueprint.workflowId);
    this.#appendEvent(
      blueprint.workflowId,
      null,
      'WORKFLOW_CREATED',
      { definitionId: blueprint.definitionId, definitionVersion: blueprint.definitionVersion },
      [],
      now,
    );
    for (const step of stepMap.values()) {
      if (step.status === 'READY')
        this.#appendEvent(blueprint.workflowId, step.stepId, 'STEP_READY', {}, [], now);
    }
    return this.#snapshot(blueprint.workflowId);
  }

  get(workflowId: string): Promise<WorkflowSnapshot | undefined> {
    return Promise.resolve(
      this.#instances.has(workflowId) ? this.#snapshot(workflowId) : undefined,
    );
  }

  claimReadySteps(input: {
    readonly workerId: string;
    readonly now: string;
    readonly limit: number;
    readonly workflowId?: string;
  }): Promise<readonly WorkflowStepClaim[]> {
    requireText(input.workerId, 'WORKFLOW_WORKER_ID_REQUIRED');
    if (input.workflowId !== undefined) requireText(input.workflowId, 'WORKFLOW_ID_REQUIRED');
    assertTimestamp(input.now, 'WORKFLOW_NOW_INVALID');
    assertLimit(input.limit);

    const claims: WorkflowStepClaim[] = [];
    const workflowIds = input.workflowId
      ? this.#instances.has(input.workflowId)
        ? [input.workflowId]
        : []
      : [...this.#instances.keys()].sort();
    for (const workflowId of workflowIds) {
      const instance = this.#requireInstance(workflowId);
      if (!['RUNNING', 'WAITING'].includes(instance.status)) continue;
      const steps = [...this.#requireSteps(workflowId).values()].sort((a, b) =>
        a.stepId.localeCompare(b.stepId),
      );
      for (const step of steps) {
        if (claims.length >= input.limit) return Promise.resolve(claims);
        if (step.status !== 'READY') continue;
        if (step.startedAt === null && step.attempts >= step.maxAttempts) continue;
        const executionId = this.#nextUniqueExecutionId();
        const nextAttempts = step.startedAt === null ? step.attempts + 1 : step.attempts;
        const claimed: WorkflowStep = {
          ...step,
          status: 'RUNNING',
          attempts: nextAttempts,
          claimedBy: input.workerId,
          claimExecutionId: executionId,
          claimedAt: input.now,
          startedAt: input.now,
          completedAt: null,
          errorCode: null,
          version: step.version + 1,
        };
        this.#requireSteps(workflowId).set(step.stepId, claimed);
        this.#updateInstanceStatus(workflowId, 'RUNNING', input.now);
        this.#appendEvent(
          workflowId,
          step.stepId,
          'STEP_CLAIMED',
          { workerId: input.workerId, executionId, attempt: claimed.attempts },
          [],
          input.now,
        );
        claims.push({
          workflowId,
          stepId: step.stepId,
          workerId: input.workerId,
          executionId,
          claimedAt: input.now,
        });
      }
    }
    return Promise.resolve(claims);
  }

  async completeStep(input: {
    readonly workflowId: string;
    readonly stepId: string;
    readonly executionId: string;
    readonly output?: unknown;
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<WorkflowSnapshot> {
    await Promise.resolve();
    const evidence = requireWorkflowEvidence(input.evidence);
    assertJsonSerializable(input.output ?? null);
    assertTimestamp(input.now, 'WORKFLOW_NOW_INVALID');
    const step = this.#requireStep(input.workflowId, input.stepId);
    assertWorkflowStepClaim(step, input.executionId);

    this.#requireSteps(input.workflowId).set(input.stepId, {
      ...step,
      status: 'SUCCEEDED',
      output: cloneJson(input.output ?? null),
      claimedBy: null,
      claimExecutionId: null,
      claimedAt: null,
      completedAt: input.now,
      errorCode: null,
      evidence: mergeEvidence(step.evidence, evidence),
      version: step.version + 1,
    });
    this.#appendEvent(
      input.workflowId,
      input.stepId,
      'STEP_SUCCEEDED',
      { executionId: input.executionId },
      evidence,
      input.now,
    );
    this.#unlockDependents(input.workflowId, input.stepId, input.now);
    this.#recomputeInstanceStatus(input.workflowId, input.now);
    return this.#snapshot(input.workflowId);
  }

  async failStep(input: {
    readonly workflowId: string;
    readonly stepId: string;
    readonly executionId: string;
    readonly errorCode: string;
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<WorkflowSnapshot> {
    await Promise.resolve();
    const evidence = requireWorkflowEvidence(input.evidence);
    requireText(input.errorCode, 'WORKFLOW_STEP_ERROR_CODE_REQUIRED');
    assertTimestamp(input.now, 'WORKFLOW_NOW_INVALID');
    const step = this.#requireStep(input.workflowId, input.stepId);
    assertWorkflowStepClaim(step, input.executionId);

    this.#requireSteps(input.workflowId).set(input.stepId, {
      ...step,
      status: 'FAILED',
      claimedBy: null,
      claimExecutionId: null,
      claimedAt: null,
      completedAt: input.now,
      errorCode: input.errorCode,
      evidence: mergeEvidence(step.evidence, evidence),
      version: step.version + 1,
    });
    this.#appendEvent(
      input.workflowId,
      input.stepId,
      'STEP_FAILED',
      { executionId: input.executionId, errorCode: input.errorCode },
      evidence,
      input.now,
    );

    this.#updateInstanceStatus(input.workflowId, 'BLOCKED', input.now, input.errorCode);
    return this.#snapshot(input.workflowId);
  }

  async retryStep(input: {
    readonly workflowId: string;
    readonly stepId: string;
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<WorkflowSnapshot> {
    await Promise.resolve();
    const evidence = requireWorkflowEvidence(input.evidence);
    assertTimestamp(input.now, 'WORKFLOW_NOW_INVALID');
    const step = this.#requireStep(input.workflowId, input.stepId);
    if (step.status !== 'FAILED') throw new Error('WORKFLOW_STEP_NOT_FAILED');
    if (step.attempts >= step.maxAttempts) throw new Error('WORKFLOW_STEP_RETRY_EXHAUSTED');

    this.#requireSteps(input.workflowId).set(input.stepId, {
      ...step,
      status: 'READY',
      output: null,
      claimedBy: null,
      claimExecutionId: null,
      claimedAt: null,
      startedAt: null,
      completedAt: null,
      errorCode: null,
      evidence: mergeEvidence(step.evidence, evidence),
      version: step.version + 1,
    });
    this.#appendEvent(
      input.workflowId,
      input.stepId,
      'STEP_RETRIED',
      { nextAttempt: step.attempts + 1 },
      evidence,
      input.now,
    );
    this.#appendEvent(input.workflowId, input.stepId, 'STEP_READY', {}, evidence, input.now);
    this.#updateInstanceStatus(input.workflowId, 'RUNNING', input.now);
    return this.#snapshot(input.workflowId);
  }

  async openHumanTask(input: {
    readonly taskId: string;
    readonly workflowId: string;
    readonly stepId: string;
    readonly executionId: string;
    readonly requiredRole?: string | null;
    readonly payload?: unknown;
    readonly dueAt?: string | null;
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<WorkflowSnapshot> {
    await Promise.resolve();
    requireText(input.taskId, 'WORKFLOW_HUMAN_TASK_ID_REQUIRED');
    if (this.#humanTasks.has(input.taskId)) throw new Error('WORKFLOW_HUMAN_TASK_ALREADY_EXISTS');
    const evidence = requireWorkflowEvidence(input.evidence);
    assertJsonSerializable(input.payload ?? null);
    assertTimestamp(input.now, 'WORKFLOW_NOW_INVALID');
    if (input.dueAt) assertTimestamp(input.dueAt, 'WORKFLOW_HUMAN_TASK_DUE_AT_INVALID');
    const step = this.#requireStep(input.workflowId, input.stepId);
    assertWorkflowStepClaim(step, input.executionId);

    this.#humanTasks.set(input.taskId, {
      taskId: input.taskId,
      workflowId: input.workflowId,
      stepId: input.stepId,
      status: 'OPEN',
      requiredRole: input.requiredRole?.trim() || null,
      assignedPrincipalId: null,
      payload: cloneJson(input.payload ?? null),
      dueAt: input.dueAt ?? null,
      claimedAt: null,
      completedAt: null,
      completion: null,
      evidence,
      version: 1,
    });
    this.#requireSteps(input.workflowId).set(input.stepId, {
      ...step,
      status: 'WAITING_HUMAN',
      claimedBy: null,
      claimExecutionId: null,
      claimedAt: null,
      version: step.version + 1,
    });
    this.#appendEvent(
      input.workflowId,
      input.stepId,
      'HUMAN_TASK_OPENED',
      { taskId: input.taskId, requiredRole: input.requiredRole ?? null },
      evidence,
      input.now,
    );
    this.#recomputeInstanceStatus(input.workflowId, input.now);
    return this.#snapshot(input.workflowId);
  }

  async claimHumanTask(input: {
    readonly taskId: string;
    readonly principalId: string;
    readonly principalRoles?: readonly string[];
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<WorkflowSnapshot> {
    await Promise.resolve();
    requireText(input.principalId, 'WORKFLOW_HUMAN_TASK_PRINCIPAL_REQUIRED');
    const evidence = requireWorkflowEvidence(input.evidence);
    assertTimestamp(input.now, 'WORKFLOW_NOW_INVALID');
    const task = this.#requireHumanTask(input.taskId);
    if (task.status !== 'OPEN') throw new Error('WORKFLOW_HUMAN_TASK_NOT_OPEN');
    if (task.requiredRole && !new Set(input.principalRoles ?? []).has(task.requiredRole))
      throw new Error('WORKFLOW_HUMAN_TASK_ROLE_REQUIRED');

    this.#humanTasks.set(input.taskId, {
      ...task,
      status: 'CLAIMED',
      assignedPrincipalId: input.principalId,
      claimedAt: input.now,
      evidence: mergeEvidence(task.evidence, evidence),
      version: task.version + 1,
    });
    this.#appendEvent(
      task.workflowId,
      task.stepId,
      'HUMAN_TASK_CLAIMED',
      { taskId: task.taskId, principalId: input.principalId },
      evidence,
      input.now,
    );
    return this.#snapshot(task.workflowId);
  }

  async completeHumanTask(input: {
    readonly taskId: string;
    readonly principalId: string;
    readonly completion?: unknown;
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<WorkflowSnapshot> {
    await Promise.resolve();
    requireText(input.principalId, 'WORKFLOW_HUMAN_TASK_PRINCIPAL_REQUIRED');
    const evidence = requireWorkflowEvidence(input.evidence);
    assertJsonSerializable(input.completion ?? null);
    assertTimestamp(input.now, 'WORKFLOW_NOW_INVALID');
    const task = this.#requireHumanTask(input.taskId);
    if (task.status !== 'CLAIMED') throw new Error('WORKFLOW_HUMAN_TASK_NOT_CLAIMED');
    if (task.assignedPrincipalId !== input.principalId)
      throw new Error('WORKFLOW_HUMAN_TASK_PRINCIPAL_MISMATCH');
    const step = this.#requireStep(task.workflowId, task.stepId);
    if (step.status !== 'WAITING_HUMAN') throw new Error('WORKFLOW_STEP_NOT_WAITING_HUMAN');

    this.#humanTasks.set(input.taskId, {
      ...task,
      status: 'COMPLETED',
      completedAt: input.now,
      completion: cloneJson(input.completion ?? null),
      evidence: mergeEvidence(task.evidence, evidence),
      version: task.version + 1,
    });
    this.#requireSteps(task.workflowId).set(task.stepId, {
      ...step,
      status: 'READY',
      version: step.version + 1,
    });
    this.#appendEvent(
      task.workflowId,
      task.stepId,
      'HUMAN_TASK_COMPLETED',
      { taskId: task.taskId, principalId: input.principalId },
      evidence,
      input.now,
    );
    this.#appendEvent(
      task.workflowId,
      task.stepId,
      'STEP_READY',
      { resumedBy: 'HUMAN_TASK' },
      evidence,
      input.now,
    );
    this.#updateInstanceStatus(task.workflowId, 'RUNNING', input.now);
    return this.#snapshot(task.workflowId);
  }

  async scheduleTimer(input: {
    readonly timerId: string;
    readonly workflowId: string;
    readonly stepId: string;
    readonly executionId: string;
    readonly fireAt: string;
    readonly payload?: unknown;
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<WorkflowSnapshot> {
    await Promise.resolve();
    requireText(input.timerId, 'WORKFLOW_TIMER_ID_REQUIRED');
    if (this.#timers.has(input.timerId)) throw new Error('WORKFLOW_TIMER_ALREADY_EXISTS');
    const evidence = requireWorkflowEvidence(input.evidence);
    assertJsonSerializable(input.payload ?? null);
    assertTimestamp(input.now, 'WORKFLOW_NOW_INVALID');
    assertTimestamp(input.fireAt, 'WORKFLOW_TIMER_FIRE_AT_INVALID');
    if (Date.parse(input.fireAt) < Date.parse(input.now)) throw new Error('WORKFLOW_TIMER_IN_PAST');
    const step = this.#requireStep(input.workflowId, input.stepId);
    assertWorkflowStepClaim(step, input.executionId);

    this.#timers.set(input.timerId, {
      timerId: input.timerId,
      workflowId: input.workflowId,
      stepId: input.stepId,
      status: 'SCHEDULED',
      fireAt: input.fireAt,
      firedAt: null,
      payload: cloneJson(input.payload ?? null),
      version: 1,
    });
    this.#requireSteps(input.workflowId).set(input.stepId, {
      ...step,
      status: 'WAITING_TIMER',
      claimedBy: null,
      claimExecutionId: null,
      claimedAt: null,
      version: step.version + 1,
    });
    this.#appendEvent(
      input.workflowId,
      input.stepId,
      'TIMER_SCHEDULED',
      { timerId: input.timerId, fireAt: input.fireAt },
      evidence,
      input.now,
    );
    this.#recomputeInstanceStatus(input.workflowId, input.now);
    return this.#snapshot(input.workflowId);
  }

  fireDueTimers(input: {
    readonly now: string;
    readonly limit: number;
  }): Promise<readonly string[]> {
    assertTimestamp(input.now, 'WORKFLOW_NOW_INVALID');
    assertLimit(input.limit);
    const due = [...this.#timers.values()]
      .filter(
        (timer) =>
          timer.status === 'SCHEDULED' && Date.parse(timer.fireAt) <= Date.parse(input.now),
      )
      .sort((a, b) => a.fireAt.localeCompare(b.fireAt) || a.timerId.localeCompare(b.timerId))
      .slice(0, input.limit);
    const fired: string[] = [];
    for (const timer of due) {
      const step = this.#requireStep(timer.workflowId, timer.stepId);
      if (step.status !== 'WAITING_TIMER') throw new Error('WORKFLOW_STEP_NOT_WAITING_TIMER');
      this.#timers.set(timer.timerId, {
        ...timer,
        status: 'FIRED',
        firedAt: input.now,
        version: timer.version + 1,
      });
      this.#requireSteps(timer.workflowId).set(timer.stepId, {
        ...step,
        status: 'READY',
        version: step.version + 1,
      });
      this.#appendEvent(
        timer.workflowId,
        timer.stepId,
        'TIMER_FIRED',
        { timerId: timer.timerId },
        [`timer:fired:${timer.timerId}`],
        input.now,
      );
      this.#appendEvent(
        timer.workflowId,
        timer.stepId,
        'STEP_READY',
        { resumedBy: 'TIMER' },
        [],
        input.now,
      );
      this.#updateInstanceStatus(timer.workflowId, 'RUNNING', input.now);
      fired.push(timer.timerId);
    }
    return Promise.resolve(fired);
  }

  async registerCompensation(input: {
    readonly compensationId: string;
    readonly workflowId: string;
    readonly stepId: string;
    readonly orderIndex: number;
    readonly capabilityId?: string | null;
    readonly payload?: unknown;
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<WorkflowSnapshot> {
    await Promise.resolve();
    requireText(input.compensationId, 'WORKFLOW_COMPENSATION_ID_REQUIRED');
    if (this.#compensations.has(input.compensationId))
      throw new Error('WORKFLOW_COMPENSATION_ALREADY_EXISTS');
    if (!Number.isInteger(input.orderIndex) || input.orderIndex < 0)
      throw new Error('WORKFLOW_COMPENSATION_ORDER_INVALID');
    const evidence = requireWorkflowEvidence(input.evidence);
    assertJsonSerializable(input.payload ?? null);
    assertTimestamp(input.now, 'WORKFLOW_NOW_INVALID');
    const step = this.#requireStep(input.workflowId, input.stepId);
    if (step.status !== 'SUCCEEDED') throw new Error('WORKFLOW_COMPENSATION_STEP_NOT_SUCCEEDED');
    if (
      this.#workflowCompensations(input.workflowId).some(
        (compensation) => compensation.orderIndex === input.orderIndex,
      )
    )
      throw new Error('WORKFLOW_COMPENSATION_ORDER_CONFLICT');

    this.#compensations.set(input.compensationId, {
      compensationId: input.compensationId,
      workflowId: input.workflowId,
      stepId: input.stepId,
      orderIndex: input.orderIndex,
      capabilityId: input.capabilityId ?? null,
      status: 'PENDING',
      input: cloneJson(input.payload ?? null),
      output: null,
      claimedBy: null,
      claimExecutionId: null,
      claimedAt: null,
      completedAt: null,
      errorCode: null,
      evidence,
      version: 1,
    });
    this.#appendEvent(
      input.workflowId,
      input.stepId,
      'COMPENSATION_REGISTERED',
      { compensationId: input.compensationId, orderIndex: input.orderIndex },
      evidence,
      input.now,
    );
    return this.#snapshot(input.workflowId);
  }

  async activateCompensations(input: {
    readonly workflowId: string;
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<WorkflowSnapshot> {
    await Promise.resolve();
    const evidence = requireWorkflowEvidence(input.evidence);
    assertTimestamp(input.now, 'WORKFLOW_NOW_INVALID');
    const instance = this.#requireInstance(input.workflowId);
    if (!['BLOCKED', 'FAILED', 'CANCELED'].includes(instance.status))
      throw new Error('WORKFLOW_COMPENSATION_ACTIVATION_INVALID');
    const compensations = this.#workflowCompensations(input.workflowId).filter(
      (compensation) => compensation.status === 'PENDING',
    );
    if (compensations.length === 0) throw new Error('WORKFLOW_COMPENSATION_NONE_PENDING');

    for (const compensation of compensations) {
      this.#compensations.set(compensation.compensationId, {
        ...compensation,
        status: 'READY',
        evidence: mergeEvidence(compensation.evidence, evidence),
        version: compensation.version + 1,
      });
      this.#appendEvent(
        input.workflowId,
        compensation.stepId,
        'COMPENSATION_READY',
        { compensationId: compensation.compensationId, orderIndex: compensation.orderIndex },
        evidence,
        input.now,
      );
    }
    return this.#snapshot(input.workflowId);
  }

  #requireInstance(workflowId: string): WorkflowInstance {
    const instance = this.#instances.get(workflowId);
    if (!instance) throw new Error('WORKFLOW_NOT_FOUND');
    return instance;
  }

  #requireSteps(workflowId: string): Map<string, WorkflowStep> {
    const steps = this.#steps.get(workflowId);
    if (!steps) throw new Error('WORKFLOW_NOT_FOUND');
    return steps;
  }

  #requireStep(workflowId: string, stepId: string): WorkflowStep {
    const step = this.#requireSteps(workflowId).get(stepId);
    if (!step) throw new Error('WORKFLOW_STEP_NOT_FOUND');
    return step;
  }

  #requireHumanTask(taskId: string): WorkflowHumanTask {
    const task = this.#humanTasks.get(taskId);
    if (!task) throw new Error('WORKFLOW_HUMAN_TASK_NOT_FOUND');
    return task;
  }

  #workflowCompensations(workflowId: string): WorkflowCompensation[] {
    return [...this.#compensations.values()]
      .filter((compensation) => compensation.workflowId === workflowId)
      .sort(
        (a, b) => b.orderIndex - a.orderIndex || a.compensationId.localeCompare(b.compensationId),
      );
  }

  #unlockDependents(workflowId: string, completedStepId: string, now: string): void {
    const dependencies = this.#dependencies.get(workflowId) ?? [];
    const dependentIds = new Set(
      dependencies
        .filter((dependency) => dependency.dependsOnStepId === completedStepId)
        .map((dependency) => dependency.stepId),
    );
    for (const stepId of dependentIds) {
      const step = this.#requireStep(workflowId, stepId);
      if (step.status !== 'PENDING') continue;
      const required = dependencies
        .filter((dependency) => dependency.stepId === stepId)
        .map((dependency) => dependency.dependsOnStepId);
      if (
        required.every((dependencyId) =>
          ['SUCCEEDED', 'SKIPPED'].includes(this.#requireStep(workflowId, dependencyId).status),
        )
      ) {
        this.#requireSteps(workflowId).set(stepId, {
          ...step,
          status: 'READY',
          version: step.version + 1,
        });
        this.#appendEvent(workflowId, stepId, 'STEP_READY', {}, [], now);
      }
    }
  }

  #recomputeInstanceStatus(workflowId: string, now: string): void {
    const steps = [...this.#requireSteps(workflowId).values()];
    if (steps.every((step) => ['SUCCEEDED', 'SKIPPED'].includes(step.status))) {
      this.#updateInstanceStatus(workflowId, 'SUCCEEDED', now);
      return;
    }
    if (steps.some((step) => step.status === 'FAILED' && step.attempts >= step.maxAttempts)) {
      const errorCode =
        steps.find((step) => step.status === 'FAILED')?.errorCode ?? 'WORKFLOW_STEP_FAILED';
      this.#updateInstanceStatus(workflowId, 'FAILED', now, errorCode);
      return;
    }
    if (steps.some((step) => ['FAILED', 'BLOCKED'].includes(step.status))) {
      this.#updateInstanceStatus(workflowId, 'BLOCKED', now);
      return;
    }
    if (steps.some((step) => ['READY', 'RUNNING'].includes(step.status))) {
      this.#updateInstanceStatus(workflowId, 'RUNNING', now);
      return;
    }
    if (steps.some((step) => ['WAITING_HUMAN', 'WAITING_TIMER'].includes(step.status))) {
      this.#updateInstanceStatus(workflowId, 'WAITING', now);
    }
  }

  #updateInstanceStatus(
    workflowId: string,
    status: WorkflowInstance['status'],
    now: string,
    errorCode: string | null = null,
  ): void {
    const current = this.#requireInstance(workflowId);
    const completedAt = ['SUCCEEDED', 'FAILED', 'CANCELED'].includes(status) ? now : null;
    if (
      current.status === status &&
      current.errorCode === errorCode &&
      current.completedAt === completedAt
    )
      return;
    this.#instances.set(workflowId, {
      ...current,
      status,
      errorCode,
      updatedAt: now,
      completedAt,
      version: current.version + 1,
    });
    this.#appendEvent(
      workflowId,
      null,
      'WORKFLOW_STATUS_CHANGED',
      { from: current.status, to: status, errorCode },
      [],
      now,
    );
  }

  #appendEvent(
    workflowId: string,
    stepId: string | null,
    eventType: WorkflowEventType,
    payload: unknown,
    evidence: readonly string[],
    occurredAt: string,
  ): void {
    assertJsonSerializable(payload);
    const instance = this.#requireInstance(workflowId);
    const event: WorkflowEvent = {
      eventId: this.#createId(),
      workflowId,
      stepId,
      eventType,
      correlationId: instance.correlationId,
      payload: cloneJson(payload),
      evidence: [...evidence],
      occurredAt,
    };
    this.#events.set(workflowId, [...(this.#events.get(workflowId) ?? []), event]);
  }

  #snapshot(workflowId: string): WorkflowSnapshot {
    const instance = this.#requireInstance(workflowId);
    return {
      instance: cloneRecord(instance),
      steps: [...this.#requireSteps(workflowId).values()]
        .sort((a, b) => a.stepId.localeCompare(b.stepId))
        .map(cloneRecord),
      dependencies: [...(this.#dependencies.get(workflowId) ?? [])]
        .sort(
          (a, b) =>
            a.stepId.localeCompare(b.stepId) || a.dependsOnStepId.localeCompare(b.dependsOnStepId),
        )
        .map(cloneRecord),
      events: [...(this.#events.get(workflowId) ?? [])].map(cloneRecord),
      humanTasks: [...this.#humanTasks.values()]
        .filter((task) => task.workflowId === workflowId)
        .sort((a, b) => a.taskId.localeCompare(b.taskId))
        .map(cloneRecord),
      timers: [...this.#timers.values()]
        .filter((timer) => timer.workflowId === workflowId)
        .sort((a, b) => a.timerId.localeCompare(b.timerId))
        .map(cloneRecord),
      compensations: this.#workflowCompensations(workflowId).map(cloneRecord),
    };
  }

  #nextUniqueExecutionId(): string {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const executionId = this.#createId();
      if (!this.#claimedExecutionIds.has(executionId)) {
        this.#claimedExecutionIds.add(executionId);
        return executionId;
      }
    }
    throw new Error('WORKFLOW_EXECUTION_ID_COLLISION');
  }
}

function scopedIdempotencyKey(blueprint: WorkflowBlueprint): string {
  return [
    blueprint.tenantId,
    blueprint.workspaceId,
    blueprint.definitionId,
    blueprint.idempotencyKey,
  ].join(':');
}

function mergeEvidence(current: readonly string[], next: readonly string[]): readonly string[] {
  return [...new Set([...current, ...next].map((item) => item.trim()).filter(Boolean))].sort();
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneRecord<T extends object>(value: T): T {
  return cloneJson(value);
}

function requireText(value: string, errorCode: string): void {
  if (!value.trim()) throw new Error(errorCode);
}

function assertTimestamp(value: string, errorCode: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(errorCode);
}

function assertLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error('WORKFLOW_LIMIT_INVALID');
}
