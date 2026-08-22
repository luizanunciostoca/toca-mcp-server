import type pg from 'pg';
import type { ScheduledJob } from '../scheduler/scheduler-contracts.js';
import type { DeadLetterRecord, DeadLetterSink } from './worker.js';

export type DeadLetterStatus = 'OPEN' | 'REPLAYING' | 'RESOLVED';

export interface DurableDeadLetterRecord extends DeadLetterRecord {
  readonly tenantId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly evidence: readonly string[];
  readonly status: DeadLetterStatus;
  readonly replayCount: number;
  readonly replayExecutionId: string | null;
  readonly replayStartedAt: string | null;
  readonly lastReplayError: string | null;
  readonly resolvedAt: string | null;
  readonly resolution: string | null;
}

export interface DeadLetterRecoveryStore extends DeadLetterSink {
  get(id: string): Promise<DurableDeadLetterRecord | undefined>;
  claimReplay(input: {
    readonly id: string;
    readonly tenantId: string;
    readonly replayExecutionId: string;
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<DurableDeadLetterRecord>;
  releaseReplay(input: {
    readonly id: string;
    readonly tenantId: string;
    readonly replayExecutionId: string;
    readonly error: string;
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<DurableDeadLetterRecord>;
  completeReplay(input: {
    readonly id: string;
    readonly tenantId: string;
    readonly replayExecutionId: string;
    readonly resolution: string;
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<DurableDeadLetterRecord>;
  resolve(input: {
    readonly id: string;
    readonly tenantId: string;
    readonly resolution: string;
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<DurableDeadLetterRecord>;
}

interface DeadLetterRow {
  readonly id: string;
  readonly original_job_id: string;
  readonly tool_name: string;
  readonly payload: unknown;
  readonly attempts: number;
  readonly last_error: string;
  readonly failed_at: Date | string;
  readonly tenant_id: string;
  readonly workspace_id: string | null;
  readonly organization_id: string | null;
  readonly correlation_id: string;
  readonly idempotency_key: string;
  readonly status: DeadLetterStatus;
  readonly replay_count: number;
  readonly replay_execution_id: string | null;
  readonly replay_started_at: Date | string | null;
  readonly last_replay_error: string | null;
  readonly resolved_at: Date | string | null;
  readonly resolution: string | null;
  readonly evidence: unknown;
}

interface NormalizedDeadLetterRecord {
  readonly id: string;
  readonly originalJobId: string;
  readonly toolName: string;
  readonly payload: unknown;
  readonly attempts: number;
  readonly lastError: string;
  readonly failedAt: string;
  readonly tenantId: string;
  readonly workspaceId: string | null;
  readonly organizationId: string | null;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly evidence: readonly string[];
}

const COMPATIBILITY_TENANT = 'toca';

export class PostgresDeadLetterSink implements DeadLetterRecoveryStore {
  constructor(private readonly pool: pg.Pool) {}

  async put(record: DeadLetterRecord): Promise<void> {
    const normalized = normalizeRecord(record);
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await this.#insertOrVerify(client, normalized);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async finalize(job: ScheduledJob, record: DeadLetterRecord): Promise<void> {
    if (record.originalJobId !== job.id || record.toolName !== job.toolName) {
      throw new Error('DEAD_LETTER_SOURCE_MISMATCH');
    }
    const normalized = normalizeRecord({
      ...record,
      ...(record.tenantId || !job.tenantId ? {} : { tenantId: job.tenantId }),
      idempotencyKey: record.idempotencyKey ?? job.idempotencyKey,
    });

    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const source = await client.query<{ status: ScheduledJob['status']; tenant_id: string }>(
        'select status, tenant_id from scheduled_jobs where id = $1 for update',
        [job.id],
      );
      const sourceRow = source.rows[0];
      if (!sourceRow) throw new Error(`DEAD_LETTER_SOURCE_NOT_FOUND:${job.id}`);
      if (sourceRow.tenant_id !== normalized.tenantId) {
        throw new Error('DEAD_LETTER_TENANT_MISMATCH');
      }

      const existing = await this.#findByOriginalJob(client, job.id);
      if (sourceRow.status === 'FAILED' && existing) {
        assertEquivalent(existing, normalized);
        await client.query('commit');
        return;
      }
      if (sourceRow.status !== 'RUNNING') {
        throw new Error(`DEAD_LETTER_SOURCE_STATE_CONFLICT:${job.id}:${sourceRow.status}`);
      }

      await this.#insertOrVerify(client, normalized);
      const transitioned = await client.query(
        `update scheduled_jobs
         set status = 'FAILED', last_error = $2, updated_at = now()
         where id = $1 and status = 'RUNNING'`,
        [job.id, normalized.lastError],
      );
      if (transitioned.rowCount !== 1) {
        throw new Error(`DEAD_LETTER_SOURCE_TRANSITION_CONFLICT:${job.id}`);
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async get(id: string): Promise<DurableDeadLetterRecord | undefined> {
    requireText(id, 'DEAD_LETTER_ID_REQUIRED');
    const result = await this.pool.query<DeadLetterRow>(
      'select * from dead_letter_jobs where id = $1',
      [id],
    );
    return result.rows[0] ? fromRow(result.rows[0]) : undefined;
  }

  async claimReplay(input: {
    readonly id: string;
    readonly tenantId: string;
    readonly replayExecutionId: string;
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<DurableDeadLetterRecord> {
    const evidence = normalizeEvidence(input.evidence);
    assertTimestamp(input.now, 'DEAD_LETTER_REPLAY_TIME_INVALID');
    requireText(input.replayExecutionId, 'DEAD_LETTER_REPLAY_EXECUTION_ID_REQUIRED');
    return this.#withLockedRecord(input.id, input.tenantId, async (client, row) => {
      if (row.status === 'RESOLVED') return fromRow(row);
      if (row.status === 'REPLAYING') {
        if (row.replay_execution_id !== input.replayExecutionId) {
          throw new Error('DEAD_LETTER_REPLAY_IN_PROGRESS');
        }
        return fromRow(row);
      }
      const updated = await client.query<DeadLetterRow>(
        `update dead_letter_jobs set
           status = 'REPLAYING', replay_count = replay_count + 1,
           replay_execution_id = $2, replay_started_at = $3::timestamptz,
           last_replay_error = null, evidence = evidence || $4::jsonb
         where id = $1 and status = 'OPEN'
         returning *`,
        [input.id, input.replayExecutionId, input.now, JSON.stringify(evidence)],
      );
      const next = updated.rows[0];
      if (!next) throw new Error('DEAD_LETTER_REPLAY_CLAIM_CONFLICT');
      return fromRow(next);
    });
  }

  async releaseReplay(input: {
    readonly id: string;
    readonly tenantId: string;
    readonly replayExecutionId: string;
    readonly error: string;
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<DurableDeadLetterRecord> {
    const evidence = normalizeEvidence(input.evidence);
    requireText(input.error, 'DEAD_LETTER_REPLAY_ERROR_REQUIRED');
    assertTimestamp(input.now, 'DEAD_LETTER_REPLAY_TIME_INVALID');
    return this.#withLockedRecord(input.id, input.tenantId, async (client, row) => {
      if (row.status !== 'REPLAYING' || row.replay_execution_id !== input.replayExecutionId) {
        throw new Error('DEAD_LETTER_REPLAY_RELEASE_CONFLICT');
      }
      const updated = await client.query<DeadLetterRow>(
        `update dead_letter_jobs set
           status = 'OPEN', replay_execution_id = null, replay_started_at = null,
           last_replay_error = $2, evidence = evidence || $3::jsonb
         where id = $1 and status = 'REPLAYING' and replay_execution_id = $4
         returning *`,
        [input.id, input.error, JSON.stringify(evidence), input.replayExecutionId],
      );
      const next = updated.rows[0];
      if (!next) throw new Error('DEAD_LETTER_REPLAY_RELEASE_CONFLICT');
      return fromRow(next);
    });
  }

  async completeReplay(input: {
    readonly id: string;
    readonly tenantId: string;
    readonly replayExecutionId: string;
    readonly resolution: string;
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<DurableDeadLetterRecord> {
    const evidence = normalizeEvidence(input.evidence);
    const resolution = requireText(input.resolution, 'DEAD_LETTER_RESOLUTION_REQUIRED');
    assertTimestamp(input.now, 'DEAD_LETTER_RESOLUTION_TIME_INVALID');
    return this.#withLockedRecord(input.id, input.tenantId, async (client, row) => {
      if (row.status === 'RESOLVED') return fromRow(row);
      if (row.status !== 'REPLAYING' || row.replay_execution_id !== input.replayExecutionId) {
        throw new Error('DEAD_LETTER_REPLAY_RESOLUTION_CONFLICT');
      }
      const updated = await client.query<DeadLetterRow>(
        `update dead_letter_jobs set
           status = 'RESOLVED', resolved_at = $2::timestamptz, resolution = $3,
           last_replay_error = null, evidence = evidence || $4::jsonb
         where id = $1 and status = 'REPLAYING' and replay_execution_id = $5
         returning *`,
        [input.id, input.now, resolution, JSON.stringify(evidence), input.replayExecutionId],
      );
      const next = updated.rows[0];
      if (!next) throw new Error('DEAD_LETTER_REPLAY_RESOLUTION_CONFLICT');
      return fromRow(next);
    });
  }

  async resolve(input: {
    readonly id: string;
    readonly tenantId: string;
    readonly resolution: string;
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<DurableDeadLetterRecord> {
    const evidence = normalizeEvidence(input.evidence);
    const resolution = requireText(input.resolution, 'DEAD_LETTER_RESOLUTION_REQUIRED');
    assertTimestamp(input.now, 'DEAD_LETTER_RESOLUTION_TIME_INVALID');
    return this.#withLockedRecord(input.id, input.tenantId, async (client, row) => {
      if (row.status === 'RESOLVED') return fromRow(row);
      if (row.status === 'REPLAYING') throw new Error('DEAD_LETTER_REPLAY_IN_PROGRESS');
      const updated = await client.query<DeadLetterRow>(
        `update dead_letter_jobs set
           status = 'RESOLVED', resolved_at = $2::timestamptz, resolution = $3,
           evidence = evidence || $4::jsonb
         where id = $1 and status = 'OPEN'
         returning *`,
        [input.id, input.now, resolution, JSON.stringify(evidence)],
      );
      const next = updated.rows[0];
      if (!next) throw new Error('DEAD_LETTER_RESOLUTION_CONFLICT');
      return fromRow(next);
    });
  }

  async #insertOrVerify(
    client: pg.PoolClient,
    record: NormalizedDeadLetterRecord,
  ): Promise<DurableDeadLetterRecord> {
    const inserted = await client.query<DeadLetterRow>(
      `insert into dead_letter_jobs
        (id, original_job_id, tool_name, payload, attempts, last_error, failed_at,
         tenant_id, workspace_id, organization_id, correlation_id, idempotency_key,
         status, replay_count, evidence)
       values ($1, $2, $3, $4::jsonb, $5, $6, $7::timestamptz,
               $8, $9, $10, $11, $12, 'OPEN', 0, $13::jsonb)
       on conflict (original_job_id) do nothing
       returning *`,
      [
        record.id,
        record.originalJobId,
        record.toolName,
        JSON.stringify(record.payload),
        record.attempts,
        record.lastError,
        record.failedAt,
        record.tenantId,
        record.workspaceId,
        record.organizationId,
        record.correlationId,
        record.idempotencyKey,
        JSON.stringify(record.evidence),
      ],
    );
    if (inserted.rows[0]) return fromRow(inserted.rows[0]);
    const existing = await this.#findByOriginalJob(client, record.originalJobId);
    if (!existing) throw new Error('DEAD_LETTER_CONFLICT_ROW_MISSING');
    assertEquivalent(existing, record);
    return fromRow(existing);
  }

  async #findByOriginalJob(
    client: pg.PoolClient,
    originalJobId: string,
  ): Promise<DeadLetterRow | undefined> {
    const result = await client.query<DeadLetterRow>(
      'select * from dead_letter_jobs where original_job_id = $1 for update',
      [originalJobId],
    );
    return result.rows[0];
  }

  async #withLockedRecord(
    id: string,
    tenantId: string,
    action: (client: pg.PoolClient, row: DeadLetterRow) => Promise<DurableDeadLetterRecord>,
  ): Promise<DurableDeadLetterRecord> {
    requireText(id, 'DEAD_LETTER_ID_REQUIRED');
    requireText(tenantId, 'DEAD_LETTER_TENANT_ID_REQUIRED');
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await client.query<DeadLetterRow>(
        'select * from dead_letter_jobs where id = $1 for update',
        [id],
      );
      const row = result.rows[0];
      if (!row) throw new Error('DEAD_LETTER_NOT_FOUND');
      if (row.tenant_id !== tenantId) throw new Error('DEAD_LETTER_TENANT_MISMATCH');
      const value = await action(client, row);
      await client.query('commit');
      return value;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}

function normalizeRecord(record: DeadLetterRecord): NormalizedDeadLetterRecord {
  requireText(record.id, 'DEAD_LETTER_ID_REQUIRED');
  requireText(record.originalJobId, 'DEAD_LETTER_ORIGINAL_JOB_ID_REQUIRED');
  requireText(record.toolName, 'DEAD_LETTER_TOOL_NAME_REQUIRED');
  requireText(record.lastError, 'DEAD_LETTER_LAST_ERROR_REQUIRED');
  if (!Number.isInteger(record.attempts) || record.attempts < 1) {
    throw new Error('DEAD_LETTER_ATTEMPTS_INVALID');
  }
  assertTimestamp(record.failedAt, 'DEAD_LETTER_FAILED_AT_INVALID');
  assertJsonSerializable(record.payload);
  const tenantId =
    normalizedOptional(record.tenantId) ??
    payloadText(record.payload, 'tenantId', 'tenant_id') ??
    COMPATIBILITY_TENANT;
  const correlationId =
    normalizedOptional(record.correlationId) ??
    payloadText(record.payload, 'correlationId', 'correlation_id') ??
    `dead-letter:${record.id}`;
  const idempotencyKey =
    normalizedOptional(record.idempotencyKey) ??
    payloadText(record.payload, 'idempotencyKey', 'idempotency_key') ??
    `dead-letter-source:${record.originalJobId}`;
  const workspaceId =
    normalizedOptional(record.workspaceId) ?? payloadText(record.payload, 'workspaceId', 'workspace_id');
  const organizationId =
    normalizedOptional(record.organizationId) ??
    payloadText(record.payload, 'organizationId', 'organization_id');
  return {
    id: record.id,
    originalJobId: record.originalJobId,
    toolName: record.toolName,
    payload: record.payload,
    attempts: record.attempts,
    lastError: record.lastError,
    failedAt: record.failedAt,
    tenantId,
    workspaceId: workspaceId ?? null,
    organizationId: organizationId ?? null,
    correlationId,
    idempotencyKey,
    evidence: normalizeEvidence([
      ...(record.evidence ?? []),
      `dead-letter:source-job:${record.originalJobId}`,
      ...(record.correlationId || payloadText(record.payload, 'correlationId', 'correlation_id')
        ? []
        : ['dead-letter:source-correlation-unavailable']),
    ]),
  };
}

function assertEquivalent(row: DeadLetterRow, record: NormalizedDeadLetterRecord): void {
  const same =
    row.original_job_id === record.originalJobId &&
    row.tool_name === record.toolName &&
    row.attempts === record.attempts &&
    row.last_error === record.lastError &&
    iso(row.failed_at) === record.failedAt &&
    row.tenant_id === record.tenantId &&
    row.workspace_id === record.workspaceId &&
    row.organization_id === record.organizationId &&
    row.correlation_id === record.correlationId &&
    row.idempotency_key === record.idempotencyKey &&
    stableJson(row.payload) === stableJson(record.payload);
  if (!same) throw new Error('DEAD_LETTER_SOURCE_CONFLICT');
}

function fromRow(row: DeadLetterRow): DurableDeadLetterRecord {
  return {
    id: row.id,
    originalJobId: row.original_job_id,
    toolName: row.tool_name,
    payload: row.payload,
    attempts: row.attempts,
    lastError: row.last_error,
    failedAt: iso(row.failed_at),
    tenantId: row.tenant_id,
    ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}),
    ...(row.organization_id ? { organizationId: row.organization_id } : {}),
    correlationId: row.correlation_id,
    idempotencyKey: row.idempotency_key,
    evidence: asStringArray(row.evidence),
    status: row.status,
    replayCount: row.replay_count,
    replayExecutionId: row.replay_execution_id,
    replayStartedAt: row.replay_started_at ? iso(row.replay_started_at) : null,
    lastReplayError: row.last_replay_error,
    resolvedAt: row.resolved_at ? iso(row.resolved_at) : null,
    resolution: row.resolution,
  };
}

function payloadText(payload: unknown, ...keys: readonly string[]): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const value = payload as Readonly<Record<string, unknown>>;
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

function normalizedOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function normalizeEvidence(evidence: readonly string[]): readonly string[] {
  const normalized = [...new Set(evidence.map((item) => item.trim()).filter(Boolean))].sort();
  if (normalized.length === 0) throw new Error('DEAD_LETTER_EVIDENCE_REQUIRED');
  return normalized;
}

function asStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error('DEAD_LETTER_EVIDENCE_INVALID');
  }
  return value as string[];
}

function assertTimestamp(value: string, code: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(code);
}

function requireText(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function assertJsonSerializable(value: unknown): void {
  try {
    if (JSON.stringify(value) === undefined) throw new Error('undefined');
  } catch {
    throw new Error('DEAD_LETTER_PAYLOAD_NOT_JSON_SERIALIZABLE');
  }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('DEAD_LETTER_PAYLOAD_NOT_JSON_SERIALIZABLE');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  throw new Error('DEAD_LETTER_PAYLOAD_NOT_JSON_SERIALIZABLE');
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
