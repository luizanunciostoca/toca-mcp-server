import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { createDomainEvent } from '../events/domain-events.js';
import { PostgresTransactionalOutbox } from '../events/postgres-transactional-outbox.js';
import type { TransactionalOutboxWriter } from '../events/transactional-outbox.js';
import {
  assertJsonSerializable,
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
} from '../workflow/workflow-contracts.js';
import { isRouteId } from '../governance/types.js';

interface WorkflowInstanceRow {
  readonly workflow_id: string;
  readonly route_id: string;
  readonly definition_id: string;
  readonly definition_version: string;
  readonly idempotency_key: string;
  readonly correlation_id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly requester_principal_id: string;
  readonly status: WorkflowInstance['status'];
  readonly input: unknown;
  readonly output: unknown;
  readonly error_code: string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly completed_at: Date | string | null;
  readonly version: number;
}

interface WorkflowStepRow {
  readonly workflow_id: string;
  readonly step_id: string;
  readonly name: string;
  readonly capability_id: string | null;
  readonly status: WorkflowStep['status'];
  readonly input: unknown;
  readonly output: unknown;
  readonly attempts: number;
  readonly max_attempts: number;
  readonly claimed_by: string | null;
  readonly claim_execution_id: string | null;
  readonly claimed_at: Date | string | null;
  readonly started_at: Date | string | null;
  readonly completed_at: Date | string | null;
  readonly error_code: string | null;
  readonly evidence: unknown;
  readonly version: number;
}

interface WorkflowDependencyRow {
  readonly workflow_id: string;
  readonly step_id: string;
  readonly depends_on_step_id: string;
}

interface WorkflowEventRow {
  readonly event_id: string;
  readonly workflow_id: string;
  readonly step_id: string | null;
  readonly event_type: WorkflowEventType;
  readonly correlation_id: string;
  readonly payload: unknown;
  readonly evidence: unknown;
  readonly occurred_at: Date | string;
}

interface WorkflowHumanTaskRow {
  readonly task_id: string;
  readonly workflow_id: string;
  readonly step_id: string;
  readonly status: WorkflowHumanTask['status'];
  readonly required_role: string | null;
  readonly assigned_principal_id: string | null;
  readonly payload: unknown;
  readonly due_at: Date | string | null;
  readonly claimed_at: Date | string | null;
  readonly completed_at: Date | string | null;
  readonly completion: unknown;
  readonly evidence: unknown;
  readonly version: number;
}

interface WorkflowTimerRow {
  readonly timer_id: string;
  readonly workflow_id: string;
  readonly step_id: string;
  readonly status: WorkflowTimer['status'];
  readonly fire_at: Date | string;
  readonly fired_at: Date | string | null;
  readonly payload: unknown;
  readonly version: number;
}

interface WorkflowCompensationRow {
  readonly compensation_id: string;
  readonly workflow_id: string;
  readonly step_id: string;
  readonly order_index: number;
  readonly capability_id: string | null;
  readonly status: WorkflowCompensation['status'];
  readonly input: unknown;
  readonly output: unknown;
  readonly claimed_by: string | null;
  readonly claim_execution_id: string | null;
  readonly claimed_at: Date | string | null;
  readonly completed_at: Date | string | null;
  readonly error_code: string | null;
  readonly evidence: unknown;
  readonly version: number;
}

export interface PostgresWorkflowStoreOptions {
  readonly createId?: () => string;
  readonly outbox?: TransactionalOutboxWriter;
}

export class PostgresWorkflowStore implements WorkflowStore {
  readonly #createId: () => string;
  readonly #outbox: TransactionalOutboxWriter;

  constructor(
    private readonly pool: pg.Pool,
    options: PostgresWorkflowStoreOptions = {},
  ) {
    this.#createId = options.createId ?? randomUUID;
    this.#outbox = options.outbox ?? new PostgresTransactionalOutbox(pool);
  }

  async create(
    blueprint: WorkflowBlueprint,
    now = new Date().toISOString(),
  ): Promise<WorkflowSnapshot> {
    validateWorkflowBlueprint(blueprint);
    assertTimestamp(now, 'WORKFLOW_NOW_INVALID');
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const inserted = await client.query<{ workflow_id: string }>(
        `insert into workflow_instances (
           workflow_id, route_id, definition_id, definition_version, idempotency_key,
           correlation_id, tenant_id, workspace_id, organization_id,
           requester_principal_id, status, input, output, error_code,
           created_at, updated_at, completed_at, version
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
           'RUNNING', $11::jsonb, null, null, $12::timestamptz, $12::timestamptz, null, 1
         )
         on conflict (tenant_id, idempotency_key) do nothing
         returning workflow_id`,
        [
          blueprint.workflowId,
          blueprint.routeId,
          blueprint.definitionId,
          blueprint.definitionVersion,
          blueprint.idempotencyKey,
          blueprint.correlationId,
          blueprint.tenantId,
          blueprint.workspaceId,
          blueprint.organizationId,
          blueprint.requesterPrincipalId,
          json(blueprint.input ?? null),
          now,
        ],
      );

      if (inserted.rowCount === 0) {
        const existing = await client.query<{ workflow_id: string }>(
          `select workflow_id from workflow_instances
           where tenant_id = $1 and idempotency_key = $2`,
          [blueprint.tenantId, blueprint.idempotencyKey],
        );
        const existingWorkflowId = existing.rows[0]?.workflow_id;
        if (!existingWorkflowId) throw new Error('WORKFLOW_IDEMPOTENCY_STATE_INVALID');
        if (existingWorkflowId !== blueprint.workflowId)
          throw new Error('WORKFLOW_IDEMPOTENCY_CONFLICT');
        await client.query('commit');
        return this.#requireSnapshot(blueprint.workflowId);
      }

      const dependencies: WorkflowDependency[] = blueprint.steps.flatMap((step) =>
        (step.dependsOn ?? []).map((dependsOnStepId) => ({
          workflowId: blueprint.workflowId,
          stepId: step.stepId,
          dependsOnStepId,
        })),
      );

      for (const step of blueprint.steps) {
        const status = dependencies.some((dependency) => dependency.stepId === step.stepId)
          ? 'PENDING'
          : 'READY';
        await client.query(
          `insert into workflow_steps (
             workflow_id, step_id, name, capability_id, status, input, output,
             attempts, max_attempts, claimed_by, claim_execution_id, claimed_at,
             started_at, completed_at, error_code, evidence, version
           ) values (
             $1, $2, $3, $4, $5, $6::jsonb, null,
             0, $7, null, null, null, null, null, null, '[]'::jsonb, 1
           )`,
          [
            blueprint.workflowId,
            step.stepId,
            step.name,
            step.capabilityId ?? null,
            status,
            json(step.input ?? null),
            step.maxAttempts ?? 1,
          ],
        );
      }

      for (const dependency of dependencies) {
        await client.query(
          `insert into workflow_dependencies (workflow_id, step_id, depends_on_step_id)
           values ($1, $2, $3)`,
          [dependency.workflowId, dependency.stepId, dependency.dependsOnStepId],
        );
      }

      await this.#appendEvent(client, {
        workflowId: blueprint.workflowId,
        stepId: null,
        eventType: 'WORKFLOW_CREATED',
        correlationId: blueprint.correlationId,
        payload: {
          definitionId: blueprint.definitionId,
          definitionVersion: blueprint.definitionVersion,
        },
        evidence: [],
        occurredAt: now,
      });
      for (const step of blueprint.steps) {
        if ((step.dependsOn ?? []).length === 0) {
          await this.#appendEvent(client, {
            workflowId: blueprint.workflowId,
            stepId: step.stepId,
            eventType: 'STEP_READY',
            correlationId: blueprint.correlationId,
            payload: {},
            evidence: [],
            occurredAt: now,
          });
        }
      }

      await client.query('commit');
      return this.#requireSnapshot(blueprint.workflowId);
    } catch (error) {
      await client.query('rollback');
      if (isUniqueViolation(error)) throw new Error('WORKFLOW_ALREADY_EXISTS');
      throw error;
    } finally {
      client.release();
    }
  }

  get(workflowId: string): Promise<WorkflowSnapshot | undefined> {
    return this.#readSnapshot(workflowId, true);
  }

  async claimReadySteps(input: {
    readonly workerId: string;
    readonly now: string;
    readonly limit: number;
    readonly workflowId?: string;
  }): Promise<readonly WorkflowStepClaim[]> {
    requireText(input.workerId, 'WORKFLOW_WORKER_ID_REQUIRED');
    if (input.workflowId !== undefined) requireText(input.workflowId, 'WORKFLOW_ID_REQUIRED');
    assertTimestamp(input.now, 'WORKFLOW_NOW_INVALID');
    assertLimit(input.limit);
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const candidates = await client.query<Pick<WorkflowStepRow, 'workflow_id' | 'step_id'>>(
        `select s.workflow_id, s.step_id
         from workflow_steps s
         join workflow_instances w on w.workflow_id = s.workflow_id
         where s.status = 'READY'
           and (s.started_at is not null or s.attempts < s.max_attempts)
           and w.status in ('RUNNING', 'WAITING')
           and ($2::text is null or s.workflow_id = $2)
         order by w.updated_at asc, s.workflow_id asc, s.step_id asc
         limit $1`,
        [input.limit, input.workflowId ?? null],
      );
      const claims: WorkflowStepClaim[] = [];
      for (const candidate of candidates.rows) {
        const instanceLock = await client.query<WorkflowInstanceRow>(
          `select * from workflow_instances
           where workflow_id = $1 and status in ('RUNNING', 'WAITING')
           for update skip locked`,
          [candidate.workflow_id],
        );
        if (!instanceLock.rows[0]) continue;

        const stepLock = await client.query<WorkflowStepRow>(
          `select * from workflow_steps
           where workflow_id = $1 and step_id = $2 and status = 'READY'
             and (started_at is not null or attempts < max_attempts)
           for update skip locked`,
          [candidate.workflow_id, candidate.step_id],
        );
        const row = stepLock.rows[0];
        if (!row) continue;

        const executionId = this.#createId();
        await this.#claimExecution(client, {
          executionId,
          workflowId: row.workflow_id,
          stepId: row.step_id,
          compensationId: null,
          workerId: input.workerId,
          claimedAt: input.now,
        });
        await client.query(
          `update workflow_steps set
             status = 'RUNNING',
             attempts = attempts + case when started_at is null then 1 else 0 end,
             claimed_by = $3,
             claim_execution_id = $4, claimed_at = $5::timestamptz,
             started_at = coalesce(started_at, $5::timestamptz),
             completed_at = null, error_code = null, version = version + 1
           where workflow_id = $1 and step_id = $2 and version = $6`,
          [row.workflow_id, row.step_id, input.workerId, executionId, input.now, row.version],
        );
        await this.#setInstanceStatus(client, row.workflow_id, 'RUNNING', input.now, null);
        await this.#appendWorkflowEvent(
          client,
          row.workflow_id,
          row.step_id,
          'STEP_CLAIMED',
          {
            workerId: input.workerId,
            executionId,
            attempt: row.started_at === null ? row.attempts + 1 : row.attempts,
          },
          [],
          input.now,
        );
        claims.push({
          workflowId: row.workflow_id,
          stepId: row.step_id,
          workerId: input.workerId,
          executionId,
          claimedAt: input.now,
        });
      }
      await client.query('commit');
      return claims;
    } catch (error) {
      await client.query('rollback');
      if (isUniqueViolation(error)) throw new Error('WORKFLOW_EXECUTION_ID_ALREADY_CLAIMED');
      throw error;
    } finally {
      client.release();
    }
  }

  async completeStep(input: {
    readonly workflowId: string;
    readonly stepId: string;
    readonly executionId: string;
    readonly output?: unknown;
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<WorkflowSnapshot> {
    const evidence = requireWorkflowEvidence(input.evidence);
    assertJsonSerializable(input.output ?? null);
    assertTimestamp(input.now, 'WORKFLOW_NOW_INVALID');
    await this.#withWorkflowTransaction(input.workflowId, async (client, instance) => {
      const step = await this.#lockStep(client, input.workflowId, input.stepId);
      assertClaimRow(step, input.executionId);
      await client.query(
        `update workflow_steps set
           status = 'SUCCEEDED', output = $4::jsonb, claimed_by = null,
           claim_execution_id = null, claimed_at = null, completed_at = $5::timestamptz,
           error_code = null, evidence = $6::jsonb, version = version + 1
         where workflow_id = $1 and step_id = $2 and version = $3`,
        [
          input.workflowId,
          input.stepId,
          step.version,
          json(input.output ?? null),
          input.now,
          json(mergeEvidence(asStringArray(step.evidence), evidence)),
        ],
      );
      await this.#appendEvent(client, {
        workflowId: input.workflowId,
        stepId: input.stepId,
        eventType: 'STEP_SUCCEEDED',
        correlationId: instance.correlation_id,
        payload: { executionId: input.executionId },
        evidence,
        occurredAt: input.now,
      });
      await this.#unlockDependents(client, input.workflowId, instance.correlation_id, input.now);
      await this.#recomputeInstanceStatus(client, input.workflowId, input.now);
    });
    return this.#requireSnapshot(input.workflowId);
  }

  async failStep(input: {
    readonly workflowId: string;
    readonly stepId: string;
    readonly executionId: string;
    readonly errorCode: string;
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<WorkflowSnapshot> {
    const evidence = requireWorkflowEvidence(input.evidence);
    requireText(input.errorCode, 'WORKFLOW_STEP_ERROR_CODE_REQUIRED');
    assertTimestamp(input.now, 'WORKFLOW_NOW_INVALID');
    await this.#withWorkflowTransaction(input.workflowId, async (client, instance) => {
      const step = await this.#lockStep(client, input.workflowId, input.stepId);
      assertClaimRow(step, input.executionId);
      await client.query(
        `update workflow_steps set
           status = 'FAILED', claimed_by = null, claim_execution_id = null,
           claimed_at = null, completed_at = $4::timestamptz, error_code = $5,
           evidence = $6::jsonb, version = version + 1
         where workflow_id = $1 and step_id = $2 and version = $3`,
        [
          input.workflowId,
          input.stepId,
          step.version,
          input.now,
          input.errorCode,
          json(mergeEvidence(asStringArray(step.evidence), evidence)),
        ],
      );
      await this.#appendEvent(client, {
        workflowId: input.workflowId,
        stepId: input.stepId,
        eventType: 'STEP_FAILED',
        correlationId: instance.correlation_id,
        payload: { executionId: input.executionId, errorCode: input.errorCode },
        evidence,
        occurredAt: input.now,
      });
      await this.#setInstanceStatus(
        client,
        input.workflowId,
        'BLOCKED',
        input.now,
        input.errorCode,
      );
    });
    return this.#requireSnapshot(input.workflowId);
  }

  async retryStep(input: {
    readonly workflowId: string;
    readonly stepId: string;
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<WorkflowSnapshot> {
    const evidence = requireWorkflowEvidence(input.evidence);
    assertTimestamp(input.now, 'WORKFLOW_NOW_INVALID');
    await this.#withWorkflowTransaction(input.workflowId, async (client, instance) => {
      const step = await this.#lockStep(client, input.workflowId, input.stepId);
      if (step.status !== 'FAILED') throw new Error('WORKFLOW_STEP_NOT_FAILED');
      if (step.attempts >= step.max_attempts) throw new Error('WORKFLOW_STEP_RETRY_EXHAUSTED');
      await client.query(
        `update workflow_steps set
           status = 'READY', output = null, started_at = null,
           completed_at = null, error_code = null,
           evidence = $4::jsonb, version = version + 1
         where workflow_id = $1 and step_id = $2 and version = $3`,
        [
          input.workflowId,
          input.stepId,
          step.version,
          json(mergeEvidence(asStringArray(step.evidence), evidence)),
        ],
      );
      await this.#appendEvent(client, {
        workflowId: input.workflowId,
        stepId: input.stepId,
        eventType: 'STEP_RETRIED',
        correlationId: instance.correlation_id,
        payload: { nextAttempt: step.attempts + 1 },
        evidence,
        occurredAt: input.now,
      });
      await this.#setInstanceStatus(client, input.workflowId, 'RUNNING', input.now, null);
    });
    return this.#requireSnapshot(input.workflowId);
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
    requireText(input.taskId, 'WORKFLOW_HUMAN_TASK_ID_REQUIRED');
    const evidence = requireWorkflowEvidence(input.evidence);
    assertJsonSerializable(input.payload ?? null);
    assertTimestamp(input.now, 'WORKFLOW_NOW_INVALID');
    if (input.dueAt) assertTimestamp(input.dueAt, 'WORKFLOW_HUMAN_TASK_DUE_AT_INVALID');
    await this.#withWorkflowTransaction(input.workflowId, async (client, instance) => {
      const step = await this.#lockStep(client, input.workflowId, input.stepId);
      assertClaimRow(step, input.executionId);
      await client.query(
        `insert into workflow_human_tasks (
           task_id, workflow_id, step_id, status, required_role,
           assigned_principal_id, payload, due_at, claimed_at, completed_at,
           completion, evidence, version
         ) values (
           $1, $2, $3, 'OPEN', $4, null, $5::jsonb, $6::timestamptz,
           null, null, null, $7::jsonb, 1
         )`,
        [
          input.taskId,
          input.workflowId,
          input.stepId,
          input.requiredRole?.trim() || null,
          json(input.payload ?? null),
          input.dueAt ?? null,
          json(evidence),
        ],
      );
      await client.query(
        `update workflow_steps set
           status = 'WAITING_HUMAN', claimed_by = null, claim_execution_id = null,
           claimed_at = null, version = version + 1
         where workflow_id = $1 and step_id = $2 and version = $3`,
        [input.workflowId, input.stepId, step.version],
      );
      await this.#appendEvent(client, {
        workflowId: input.workflowId,
        stepId: input.stepId,
        eventType: 'HUMAN_TASK_OPENED',
        correlationId: instance.correlation_id,
        payload: { taskId: input.taskId, requiredRole: input.requiredRole ?? null },
        evidence,
        occurredAt: input.now,
      });
      await this.#recomputeInstanceStatus(client, input.workflowId, input.now);
    });
    return this.#requireSnapshot(input.workflowId);
  }

  async claimHumanTask(input: {
    readonly taskId: string;
    readonly principalId: string;
    readonly principalRoles?: readonly string[];
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<WorkflowSnapshot> {
    requireText(input.principalId, 'WORKFLOW_HUMAN_TASK_PRINCIPAL_REQUIRED');
    const evidence = requireWorkflowEvidence(input.evidence);
    assertTimestamp(input.now, 'WORKFLOW_NOW_INVALID');
    const client = await this.pool.connect();
    let workflowId = '';
    try {
      await client.query('begin');
      const taskResult = await client.query<WorkflowHumanTaskRow>(
        'select * from workflow_human_tasks where task_id = $1 for update',
        [input.taskId],
      );
      const task = taskResult.rows[0];
      if (!task) throw new Error('WORKFLOW_HUMAN_TASK_NOT_FOUND');
      workflowId = task.workflow_id;
      if (task.status !== 'OPEN') throw new Error('WORKFLOW_HUMAN_TASK_NOT_OPEN');
      if (task.required_role && !new Set(input.principalRoles ?? []).has(task.required_role))
        throw new Error('WORKFLOW_HUMAN_TASK_ROLE_REQUIRED');
      const instance = await this.#lockInstance(client, workflowId);
      await client.query(
        `update workflow_human_tasks set
           status = 'CLAIMED', assigned_principal_id = $2,
           claimed_at = $3::timestamptz, evidence = $4::jsonb, version = version + 1
         where task_id = $1 and version = $5`,
        [
          input.taskId,
          input.principalId,
          input.now,
          json(mergeEvidence(asStringArray(task.evidence), evidence)),
          task.version,
        ],
      );
      await this.#appendEvent(client, {
        workflowId,
        stepId: task.step_id,
        eventType: 'HUMAN_TASK_CLAIMED',
        correlationId: instance.correlation_id,
        payload: { taskId: input.taskId, principalId: input.principalId },
        evidence,
        occurredAt: input.now,
      });
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    return this.#requireSnapshot(workflowId);
  }

  async completeHumanTask(input: {
    readonly taskId: string;
    readonly principalId: string;
    readonly completion?: unknown;
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<WorkflowSnapshot> {
    requireText(input.principalId, 'WORKFLOW_HUMAN_TASK_PRINCIPAL_REQUIRED');
    const evidence = requireWorkflowEvidence(input.evidence);
    assertJsonSerializable(input.completion ?? null);
    assertTimestamp(input.now, 'WORKFLOW_NOW_INVALID');
    const client = await this.pool.connect();
    let workflowId = '';
    try {
      await client.query('begin');
      const taskResult = await client.query<WorkflowHumanTaskRow>(
        'select * from workflow_human_tasks where task_id = $1 for update',
        [input.taskId],
      );
      const task = taskResult.rows[0];
      if (!task) throw new Error('WORKFLOW_HUMAN_TASK_NOT_FOUND');
      workflowId = task.workflow_id;
      if (task.status !== 'CLAIMED') throw new Error('WORKFLOW_HUMAN_TASK_NOT_CLAIMED');
      if (task.assigned_principal_id !== input.principalId)
        throw new Error('WORKFLOW_HUMAN_TASK_PRINCIPAL_MISMATCH');
      const instance = await this.#lockInstance(client, workflowId);
      const step = await this.#lockStep(client, workflowId, task.step_id);
      if (step.status !== 'WAITING_HUMAN') throw new Error('WORKFLOW_STEP_NOT_WAITING_HUMAN');
      await client.query(
        `update workflow_human_tasks set
           status = 'COMPLETED', completed_at = $2::timestamptz,
           completion = $3::jsonb, evidence = $4::jsonb, version = version + 1
         where task_id = $1 and version = $5`,
        [
          input.taskId,
          input.now,
          json(input.completion ?? null),
          json(mergeEvidence(asStringArray(task.evidence), evidence)),
          task.version,
        ],
      );
      await client.query(
        `update workflow_steps set status = 'READY', version = version + 1
         where workflow_id = $1 and step_id = $2 and version = $3`,
        [workflowId, task.step_id, step.version],
      );
      await this.#appendEvent(client, {
        workflowId,
        stepId: task.step_id,
        eventType: 'HUMAN_TASK_COMPLETED',
        correlationId: instance.correlation_id,
        payload: { taskId: input.taskId, principalId: input.principalId },
        evidence,
        occurredAt: input.now,
      });
      await this.#setInstanceStatus(client, workflowId, 'RUNNING', input.now, null);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    return this.#requireSnapshot(workflowId);
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
    requireText(input.timerId, 'WORKFLOW_TIMER_ID_REQUIRED');
    const evidence = requireWorkflowEvidence(input.evidence);
    assertJsonSerializable(input.payload ?? null);
    assertTimestamp(input.now, 'WORKFLOW_NOW_INVALID');
    assertTimestamp(input.fireAt, 'WORKFLOW_TIMER_FIRE_AT_INVALID');
    if (Date.parse(input.fireAt) < Date.parse(input.now)) throw new Error('WORKFLOW_TIMER_IN_PAST');
    await this.#withWorkflowTransaction(input.workflowId, async (client, instance) => {
      const step = await this.#lockStep(client, input.workflowId, input.stepId);
      assertClaimRow(step, input.executionId);
      await client.query(
        `insert into workflow_timers (
           timer_id, workflow_id, step_id, status, fire_at, fired_at, payload, version
         ) values ($1, $2, $3, 'SCHEDULED', $4::timestamptz, null, $5::jsonb, 1)`,
        [input.timerId, input.workflowId, input.stepId, input.fireAt, json(input.payload ?? null)],
      );
      await client.query(
        `update workflow_steps set
           status = 'WAITING_TIMER', claimed_by = null, claim_execution_id = null,
           claimed_at = null, version = version + 1
         where workflow_id = $1 and step_id = $2 and version = $3`,
        [input.workflowId, input.stepId, step.version],
      );
      await this.#appendEvent(client, {
        workflowId: input.workflowId,
        stepId: input.stepId,
        eventType: 'TIMER_SCHEDULED',
        correlationId: instance.correlation_id,
        payload: { timerId: input.timerId, fireAt: input.fireAt },
        evidence,
        occurredAt: input.now,
      });
      await this.#recomputeInstanceStatus(client, input.workflowId, input.now);
    });
    return this.#requireSnapshot(input.workflowId);
  }

  async rescheduleTimer(input: {
    readonly timerId: string;
    readonly workflowId: string;
    readonly stepId: string;
    readonly fireAt: string;
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<WorkflowSnapshot> {
    requireText(input.timerId, 'WORKFLOW_TIMER_ID_REQUIRED');
    const evidence = requireWorkflowEvidence(input.evidence);
    assertTimestamp(input.now, 'WORKFLOW_NOW_INVALID');
    assertTimestamp(input.fireAt, 'WORKFLOW_TIMER_FIRE_AT_INVALID');
    if (Date.parse(input.fireAt) < Date.parse(input.now)) throw new Error('WORKFLOW_TIMER_IN_PAST');
    await this.#withWorkflowTransaction(input.workflowId, async (client, instance) => {
      const timerResult = await client.query<WorkflowTimerRow>(
        'select * from workflow_timers where timer_id = $1 for update',
        [input.timerId],
      );
      const timer = timerResult.rows[0];
      if (!timer) throw new Error('WORKFLOW_TIMER_NOT_FOUND');
      if (timer.workflow_id !== input.workflowId || timer.step_id !== input.stepId)
        throw new Error('WORKFLOW_TIMER_SCOPE_MISMATCH');
      if (timer.status !== 'SCHEDULED') throw new Error('WORKFLOW_TIMER_NOT_SCHEDULED');
      const step = await this.#lockStep(client, input.workflowId, input.stepId);
      if (step.status !== 'WAITING_TIMER') throw new Error('WORKFLOW_STEP_NOT_WAITING_TIMER');
      await client.query(
        `update workflow_timers set fire_at = $2::timestamptz, version = version + 1
         where timer_id = $1 and version = $3`,
        [input.timerId, input.fireAt, timer.version],
      );
      await this.#appendEvent(client, {
        workflowId: input.workflowId,
        stepId: input.stepId,
        eventType: 'TIMER_SCHEDULED',
        correlationId: instance.correlation_id,
        payload: { timerId: input.timerId, fireAt: input.fireAt, rescheduled: true },
        evidence,
        occurredAt: input.now,
      });
    });
    return this.#requireSnapshot(input.workflowId);
  }

  async fireDueTimers(input: {
    readonly now: string;
    readonly limit: number;
  }): Promise<readonly string[]> {
    assertTimestamp(input.now, 'WORKFLOW_NOW_INVALID');
    assertLimit(input.limit);
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const timers = await client.query<WorkflowTimerRow>(
        `select t.*
         from workflow_timers t
         join workflow_steps s
           on s.workflow_id = t.workflow_id and s.step_id = t.step_id
         where (t.status = 'SCHEDULED' and t.fire_at <= $1::timestamptz)
            or (t.status = 'FIRED' and s.status = 'READY')
         order by t.fire_at asc, t.timer_id asc
         for update of t skip locked
         limit $2`,
        [input.now, input.limit],
      );
      const fired: string[] = [];
      for (const timer of timers.rows) {
        if (timer.status === 'FIRED') {
          fired.push(timer.timer_id);
          continue;
        }
        const instance = await this.#lockInstance(client, timer.workflow_id);
        const step = await this.#lockStep(client, timer.workflow_id, timer.step_id);
        if (step.status !== 'WAITING_TIMER') throw new Error('WORKFLOW_STEP_NOT_WAITING_TIMER');
        await client.query(
          `update workflow_timers set
             status = 'FIRED', fired_at = $2::timestamptz, version = version + 1
           where timer_id = $1 and version = $3`,
          [timer.timer_id, input.now, timer.version],
        );
        await client.query(
          `update workflow_steps set status = 'READY', version = version + 1
           where workflow_id = $1 and step_id = $2 and version = $3`,
          [timer.workflow_id, timer.step_id, step.version],
        );
        await this.#appendEvent(client, {
          workflowId: timer.workflow_id,
          stepId: timer.step_id,
          eventType: 'TIMER_FIRED',
          correlationId: instance.correlation_id,
          payload: { timerId: timer.timer_id },
          evidence: [`timer:fired:${timer.timer_id}`],
          occurredAt: input.now,
        });
        await this.#setInstanceStatus(client, timer.workflow_id, 'RUNNING', input.now, null);
        fired.push(timer.timer_id);
      }
      await client.query('commit');
      return fired;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
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
    requireText(input.compensationId, 'WORKFLOW_COMPENSATION_ID_REQUIRED');
    if (!Number.isInteger(input.orderIndex) || input.orderIndex < 0)
      throw new Error('WORKFLOW_COMPENSATION_ORDER_INVALID');
    const evidence = requireWorkflowEvidence(input.evidence);
    assertJsonSerializable(input.payload ?? null);
    assertTimestamp(input.now, 'WORKFLOW_NOW_INVALID');
    await this.#withWorkflowTransaction(input.workflowId, async (client, instance) => {
      const step = await this.#lockStep(client, input.workflowId, input.stepId);
      if (step.status !== 'SUCCEEDED') throw new Error('WORKFLOW_COMPENSATION_STEP_NOT_SUCCEEDED');
      await client.query(
        `insert into workflow_compensations (
           compensation_id, workflow_id, step_id, order_index, capability_id,
           status, input, output, claimed_by, claim_execution_id, claimed_at,
           completed_at, error_code, evidence, version
         ) values (
           $1, $2, $3, $4, $5, 'PENDING', $6::jsonb, null,
           null, null, null, null, null, $7::jsonb, 1
         )`,
        [
          input.compensationId,
          input.workflowId,
          input.stepId,
          input.orderIndex,
          input.capabilityId ?? null,
          json(input.payload ?? null),
          json(evidence),
        ],
      );
      await this.#appendEvent(client, {
        workflowId: input.workflowId,
        stepId: input.stepId,
        eventType: 'COMPENSATION_REGISTERED',
        correlationId: instance.correlation_id,
        payload: { compensationId: input.compensationId, orderIndex: input.orderIndex },
        evidence,
        occurredAt: input.now,
      });
    });
    return this.#requireSnapshot(input.workflowId);
  }

  async activateCompensations(input: {
    readonly workflowId: string;
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<WorkflowSnapshot> {
    const evidence = requireWorkflowEvidence(input.evidence);
    assertTimestamp(input.now, 'WORKFLOW_NOW_INVALID');
    await this.#withWorkflowTransaction(input.workflowId, async (client, instance) => {
      if (!['BLOCKED', 'FAILED'].includes(instance.status))
        throw new Error('WORKFLOW_COMPENSATION_ACTIVATION_INVALID');
      const activated = await client.query<{
        compensation_id: string;
        step_id: string;
        order_index: number;
      }>(
        `update workflow_compensations set
           status = 'READY', evidence = evidence || $2::jsonb, version = version + 1
         where workflow_id = $1 and status = 'PENDING'
         returning compensation_id, step_id, order_index`,
        [input.workflowId, json(evidence)],
      );
      if (activated.rowCount === 0) throw new Error('WORKFLOW_COMPENSATION_NONE_PENDING');
      for (const compensation of activated.rows) {
        await this.#appendEvent(client, {
          workflowId: input.workflowId,
          stepId: compensation.step_id,
          eventType: 'COMPENSATION_READY',
          correlationId: instance.correlation_id,
          payload: {
            compensationId: compensation.compensation_id,
            orderIndex: compensation.order_index,
          },
          evidence,
          occurredAt: input.now,
        });
      }
    });
    return this.#requireSnapshot(input.workflowId);
  }

  async #requireSnapshot(workflowId: string): Promise<WorkflowSnapshot> {
    const snapshot = await this.#readSnapshot(workflowId, true);
    if (!snapshot) throw new Error('WORKFLOW_NOT_FOUND');
    return snapshot;
  }

  async #readSnapshot(
    workflowId: string,
    allowMissing = false,
  ): Promise<WorkflowSnapshot | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query('begin isolation level repeatable read read only');
      const instanceResult = await client.query<WorkflowInstanceRow>(
        'select * from workflow_instances where workflow_id = $1',
        [workflowId],
      );
      const instanceRow = instanceResult.rows[0];
      if (!instanceRow) {
        await client.query('commit');
        if (allowMissing) return undefined;
        throw new Error('WORKFLOW_NOT_FOUND');
      }
      const [steps, dependencies, events, humanTasks, timers, compensations] = await Promise.all([
        client.query<WorkflowStepRow>(
          'select * from workflow_steps where workflow_id = $1 order by step_id asc',
          [workflowId],
        ),
        client.query<WorkflowDependencyRow>(
          `select * from workflow_dependencies
           where workflow_id = $1 order by step_id asc, depends_on_step_id asc`,
          [workflowId],
        ),
        client.query<WorkflowEventRow>(
          `select * from workflow_events
           where workflow_id = $1 order by occurred_at asc, event_id asc`,
          [workflowId],
        ),
        client.query<WorkflowHumanTaskRow>(
          'select * from workflow_human_tasks where workflow_id = $1 order by task_id asc',
          [workflowId],
        ),
        client.query<WorkflowTimerRow>(
          'select * from workflow_timers where workflow_id = $1 order by timer_id asc',
          [workflowId],
        ),
        client.query<WorkflowCompensationRow>(
          `select * from workflow_compensations
           where workflow_id = $1 order by order_index desc, compensation_id asc`,
          [workflowId],
        ),
      ]);
      await client.query('commit');
      return {
        instance: instanceFromRow(instanceRow),
        steps: steps.rows.map(stepFromRow),
        dependencies: dependencies.rows.map(dependencyFromRow),
        events: events.rows.map(eventFromRow),
        humanTasks: humanTasks.rows.map(humanTaskFromRow),
        timers: timers.rows.map(timerFromRow),
        compensations: compensations.rows.map(compensationFromRow),
      };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async #withWorkflowTransaction(
    workflowId: string,
    action: (client: pg.PoolClient, instance: WorkflowInstanceRow) => Promise<void>,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const instance = await this.#lockInstance(client, workflowId);
      if (['SUCCEEDED', 'FAILED', 'CANCELED'].includes(instance.status))
        throw new Error(`WORKFLOW_TERMINAL:${instance.status}`);
      await action(client, instance);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async #lockInstance(client: pg.PoolClient, workflowId: string): Promise<WorkflowInstanceRow> {
    const result = await client.query<WorkflowInstanceRow>(
      'select * from workflow_instances where workflow_id = $1 for update',
      [workflowId],
    );
    const instance = result.rows[0];
    if (!instance) throw new Error('WORKFLOW_NOT_FOUND');
    return instance;
  }

  async #lockStep(
    client: pg.PoolClient,
    workflowId: string,
    stepId: string,
  ): Promise<WorkflowStepRow> {
    const result = await client.query<WorkflowStepRow>(
      `select * from workflow_steps
       where workflow_id = $1 and step_id = $2 for update`,
      [workflowId, stepId],
    );
    const step = result.rows[0];
    if (!step) throw new Error('WORKFLOW_STEP_NOT_FOUND');
    return step;
  }

  async #unlockDependents(
    client: pg.PoolClient,
    workflowId: string,
    correlationId: string,
    now: string,
  ): Promise<void> {
    const unlocked = await client.query<{ step_id: string }>(
      `update workflow_steps candidate set
         status = 'READY', version = version + 1
       where candidate.workflow_id = $1
         and candidate.status = 'PENDING'
         and exists (
           select 1 from workflow_dependencies d
           where d.workflow_id = candidate.workflow_id
             and d.step_id = candidate.step_id
         )
         and not exists (
           select 1
           from workflow_dependencies d
           join workflow_steps dependency
             on dependency.workflow_id = d.workflow_id
            and dependency.step_id = d.depends_on_step_id
           where d.workflow_id = candidate.workflow_id
             and d.step_id = candidate.step_id
             and dependency.status <> 'SUCCEEDED'
         )
       returning candidate.step_id`,
      [workflowId],
    );
    for (const row of unlocked.rows) {
      await this.#appendEvent(client, {
        workflowId,
        stepId: row.step_id,
        eventType: 'STEP_READY',
        correlationId,
        payload: {},
        evidence: [],
        occurredAt: now,
      });
    }
  }

  async #recomputeInstanceStatus(
    client: pg.PoolClient,
    workflowId: string,
    now: string,
  ): Promise<void> {
    const result = await client.query<{ status: WorkflowStep['status'] }>(
      'select status from workflow_steps where workflow_id = $1',
      [workflowId],
    );
    const statuses = result.rows.map((row) => row.status);
    if (statuses.every((status) => ['SUCCEEDED', 'SKIPPED'].includes(status))) {
      await this.#setInstanceStatus(client, workflowId, 'SUCCEEDED', now, null);
      return;
    }
    if (statuses.some((status) => ['FAILED', 'BLOCKED'].includes(status))) {
      await this.#setInstanceStatus(client, workflowId, 'BLOCKED', now, null);
      return;
    }
    if (statuses.some((status) => ['READY', 'RUNNING'].includes(status))) {
      await this.#setInstanceStatus(client, workflowId, 'RUNNING', now, null);
      return;
    }
    if (statuses.some((status) => ['WAITING_HUMAN', 'WAITING_TIMER'].includes(status))) {
      await this.#setInstanceStatus(client, workflowId, 'WAITING', now, null);
    }
  }

  async #setInstanceStatus(
    client: pg.PoolClient,
    workflowId: string,
    status: WorkflowInstance['status'],
    now: string,
    errorCode: string | null,
  ): Promise<void> {
    const current = await this.#lockInstance(client, workflowId);
    const completedAt = ['SUCCEEDED', 'FAILED', 'CANCELED'].includes(status) ? now : null;
    if (
      current.status === status &&
      current.error_code === errorCode &&
      (current.completed_at ? iso(current.completed_at) : null) === completedAt
    )
      return;
    await client.query(
      `update workflow_instances set
         status = $2, error_code = $3, updated_at = $4::timestamptz,
         completed_at = $5::timestamptz, version = version + 1
       where workflow_id = $1 and version = $6`,
      [workflowId, status, errorCode, now, completedAt, current.version],
    );
    await this.#appendEvent(client, {
      workflowId,
      stepId: null,
      eventType: 'WORKFLOW_STATUS_CHANGED',
      correlationId: current.correlation_id,
      payload: { from: current.status, to: status, errorCode },
      evidence: [],
      occurredAt: now,
    });
  }

  async #appendWorkflowEvent(
    client: pg.PoolClient,
    workflowId: string,
    stepId: string | null,
    eventType: WorkflowEventType,
    payload: unknown,
    evidence: readonly string[],
    occurredAt: string,
  ): Promise<void> {
    const instance = await this.#lockInstance(client, workflowId);
    await this.#appendEvent(client, {
      workflowId,
      stepId,
      eventType,
      correlationId: instance.correlation_id,
      payload,
      evidence,
      occurredAt,
    });
  }

  async #appendEvent(client: pg.PoolClient, input: Omit<WorkflowEvent, 'eventId'>): Promise<void> {
    assertJsonSerializable(input.payload);
    const eventId = this.#createId();
    await client.query(
      `insert into workflow_events (
         event_id, workflow_id, step_id, event_type, correlation_id,
         payload, evidence, occurred_at
       ) values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::timestamptz)`,
      [
        eventId,
        input.workflowId,
        input.stepId,
        input.eventType,
        input.correlationId,
        json(input.payload),
        json(input.evidence),
        input.occurredAt,
      ],
    );

    const context = await client.query<
      Pick<WorkflowInstanceRow, 'tenant_id' | 'workspace_id' | 'organization_id' | 'version'>
    >(
      `select tenant_id, workspace_id, organization_id, version
       from workflow_instances where workflow_id = $1`,
      [input.workflowId],
    );
    const instance = context.rows[0];
    if (!instance) throw new Error('WORKFLOW_NOT_FOUND');
    const domainEvent = createDomainEvent({
      eventKey: eventId,
      eventType: `workflow.${input.eventType.toLowerCase()}`,
      aggregateType: 'workflow',
      aggregateId: input.workflowId,
      aggregateVersion: instance.version,
      tenantId: instance.tenant_id,
      workspaceId: instance.workspace_id,
      organizationId: instance.organization_id,
      correlationId: input.correlationId,
      causationId: null,
      occurredAt: input.occurredAt,
      payload: {
        workflowEventId: eventId,
        workflowEventType: input.eventType,
        stepId: input.stepId,
        payload: input.payload,
      },
      evidence: [...input.evidence, `workflow-event:${eventId}`],
    });
    await this.#outbox.enqueue(client, domainEvent);
  }

  async #claimExecution(
    client: pg.PoolClient,
    input: {
      readonly executionId: string;
      readonly workflowId: string;
      readonly stepId: string | null;
      readonly compensationId: string | null;
      readonly workerId: string;
      readonly claimedAt: string;
    },
  ): Promise<void> {
    await client.query(
      `insert into workflow_execution_claims (
         execution_id, workflow_id, step_id, compensation_id, worker_id, claimed_at
       ) values ($1, $2, $3, $4, $5, $6::timestamptz)`,
      [
        input.executionId,
        input.workflowId,
        input.stepId,
        input.compensationId,
        input.workerId,
        input.claimedAt,
      ],
    );
  }
}

function instanceFromRow(row: WorkflowInstanceRow): WorkflowInstance {
  if (!isRouteId(row.route_id)) throw new Error('WORKFLOW_ROUTE_INVALID');
  return {
    workflowId: row.workflow_id,
    routeId: row.route_id,
    definitionId: row.definition_id,
    definitionVersion: row.definition_version,
    idempotencyKey: row.idempotency_key,
    correlationId: row.correlation_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    requesterPrincipalId: row.requester_principal_id,
    status: row.status,
    input: row.input,
    output: row.output,
    errorCode: row.error_code,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    completedAt: row.completed_at ? iso(row.completed_at) : null,
    version: row.version,
  };
}

function stepFromRow(row: WorkflowStepRow): WorkflowStep {
  return {
    workflowId: row.workflow_id,
    stepId: row.step_id,
    name: row.name,
    capabilityId: row.capability_id,
    status: row.status,
    input: row.input,
    output: row.output,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    claimedBy: row.claimed_by,
    claimExecutionId: row.claim_execution_id,
    claimedAt: row.claimed_at ? iso(row.claimed_at) : null,
    startedAt: row.started_at ? iso(row.started_at) : null,
    completedAt: row.completed_at ? iso(row.completed_at) : null,
    errorCode: row.error_code,
    evidence: asStringArray(row.evidence),
    version: row.version,
  };
}

function dependencyFromRow(row: WorkflowDependencyRow): WorkflowDependency {
  return {
    workflowId: row.workflow_id,
    stepId: row.step_id,
    dependsOnStepId: row.depends_on_step_id,
  };
}

function eventFromRow(row: WorkflowEventRow): WorkflowEvent {
  return {
    eventId: row.event_id,
    workflowId: row.workflow_id,
    stepId: row.step_id,
    eventType: row.event_type,
    correlationId: row.correlation_id,
    payload: row.payload,
    evidence: asStringArray(row.evidence),
    occurredAt: iso(row.occurred_at),
  };
}

function humanTaskFromRow(row: WorkflowHumanTaskRow): WorkflowHumanTask {
  return {
    taskId: row.task_id,
    workflowId: row.workflow_id,
    stepId: row.step_id,
    status: row.status,
    requiredRole: row.required_role,
    assignedPrincipalId: row.assigned_principal_id,
    payload: row.payload,
    dueAt: row.due_at ? iso(row.due_at) : null,
    claimedAt: row.claimed_at ? iso(row.claimed_at) : null,
    completedAt: row.completed_at ? iso(row.completed_at) : null,
    completion: row.completion,
    evidence: asStringArray(row.evidence),
    version: row.version,
  };
}

function timerFromRow(row: WorkflowTimerRow): WorkflowTimer {
  return {
    timerId: row.timer_id,
    workflowId: row.workflow_id,
    stepId: row.step_id,
    status: row.status,
    fireAt: iso(row.fire_at),
    firedAt: row.fired_at ? iso(row.fired_at) : null,
    payload: row.payload,
    version: row.version,
  };
}

function compensationFromRow(row: WorkflowCompensationRow): WorkflowCompensation {
  return {
    compensationId: row.compensation_id,
    workflowId: row.workflow_id,
    stepId: row.step_id,
    orderIndex: row.order_index,
    capabilityId: row.capability_id,
    status: row.status,
    input: row.input,
    output: row.output,
    claimedBy: row.claimed_by,
    claimExecutionId: row.claim_execution_id,
    claimedAt: row.claimed_at ? iso(row.claimed_at) : null,
    completedAt: row.completed_at ? iso(row.completed_at) : null,
    errorCode: row.error_code,
    evidence: asStringArray(row.evidence),
    version: row.version,
  };
}

function assertClaimRow(step: WorkflowStepRow, executionId: string): void {
  if (step.status !== 'RUNNING')
    throw new Error(`WORKFLOW_STEP_NOT_RUNNING:${step.workflow_id}:${step.step_id}`);
  if (!executionId.trim() || step.claim_execution_id !== executionId)
    throw new Error(`WORKFLOW_STEP_CLAIM_MISMATCH:${step.workflow_id}:${step.step_id}`);
}

function asStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
    throw new Error('WORKFLOW_EVIDENCE_INVALID');
  return value as string[];
}

function mergeEvidence(current: readonly string[], next: readonly string[]): readonly string[] {
  return [...new Set([...current, ...next])].sort();
}

function json(value: unknown): string {
  assertJsonSerializable(value);
  return JSON.stringify(value);
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
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

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505');
}
