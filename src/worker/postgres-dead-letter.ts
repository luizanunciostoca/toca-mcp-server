import type pg from 'pg';
import type { ScheduledJob } from '../scheduler/scheduler-contracts.js';
import type { DeadLetterRecord, DeadLetterSink } from './worker.js';

interface DeadLetterRow {
  readonly id: string;
  readonly original_job_id: string;
  readonly tool_name: string;
  readonly payload: unknown;
  readonly attempts: number;
  readonly last_error: string;
  readonly failed_at: Date | string;
}

export class PostgresDeadLetterSink implements DeadLetterSink {
  private readonly tenantId: string;

  constructor(
    private readonly pool: pg.Pool,
    tenantId: string,
  ) {
    const normalizedTenantId = tenantId.trim();
    if (!normalizedTenantId) throw new Error('DEAD_LETTER_TENANT_ID_REQUIRED');
    this.tenantId = normalizedTenantId;
  }

  async put(record: DeadLetterRecord): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const source = await client.query<{ id: string }>(
        `select id from scheduled_jobs
         where id = $1 and tenant_id = $2
         for update`,
        [record.originalJobId, this.tenantId],
      );
      if (!source.rows[0]) {
        throw new Error(`DEAD_LETTER_TENANT_OWNERSHIP_MISMATCH:${record.originalJobId}`);
      }

      await lockLogicalSource(client, record.originalJobId);
      const existing = await findByOriginalJob(client, record.originalJobId);
      if (existing) {
        assertEquivalent(existing, record);
        await client.query('commit');
        return;
      }

      await insertDeadLetter(client, record);
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
    if (!job.tenantId || job.tenantId !== this.tenantId) {
      throw new Error(`DEAD_LETTER_TENANT_OWNERSHIP_MISMATCH:${job.id}`);
    }

    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const source = await client.query<{ status: ScheduledJob['status']; tenant_id: string }>(
        `select status, tenant_id from scheduled_jobs
         where id = $1 and tenant_id = $2
         for update`,
        [job.id, this.tenantId],
      );
      const sourceRow = source.rows[0];
      if (!sourceRow || sourceRow.tenant_id !== this.tenantId) {
        throw new Error(`DEAD_LETTER_TENANT_OWNERSHIP_MISMATCH:${job.id}`);
      }

      await lockLogicalSource(client, record.originalJobId);
      const existing = await findByOriginalJob(client, job.id);
      if (sourceRow.status === 'FAILED' && existing) {
        assertEquivalent(existing, record);
        await client.query('commit');
        return;
      }
      if (sourceRow.status !== 'RUNNING') {
        throw new Error(`DEAD_LETTER_SOURCE_STATE_CONFLICT:${job.id}:${sourceRow.status}`);
      }

      if (existing) {
        assertEquivalent(existing, record);
      } else {
        await insertDeadLetter(client, record);
      }

      const transitioned = await client.query(
        `update scheduled_jobs
         set status = 'FAILED', last_error = $3, updated_at = now()
         where id = $1 and tenant_id = $2 and status = 'RUNNING'`,
        [job.id, this.tenantId, record.lastError],
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
}

async function lockLogicalSource(client: pg.PoolClient, originalJobId: string): Promise<void> {
  if (!originalJobId.trim()) throw new Error('DEAD_LETTER_ORIGINAL_JOB_ID_REQUIRED');
  await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [originalJobId]);
}

async function findByOriginalJob(
  client: pg.PoolClient,
  originalJobId: string,
): Promise<DeadLetterRow | undefined> {
  const existing = await client.query<DeadLetterRow>(
    `select id, original_job_id, tool_name, payload, attempts, last_error, failed_at
     from dead_letter_jobs
     where original_job_id = $1
     order by created_at asc, id asc
     limit 1`,
    [originalJobId],
  );
  return existing.rows[0];
}

async function insertDeadLetter(client: pg.PoolClient, record: DeadLetterRecord): Promise<void> {
  await client.query(
    `insert into dead_letter_jobs
      (id, original_job_id, tool_name, payload, attempts, last_error, failed_at)
     values ($1, $2, $3, $4::jsonb, $5, $6, $7::timestamptz)`,
    [
      record.id,
      record.originalJobId,
      record.toolName,
      JSON.stringify(record.payload),
      record.attempts,
      record.lastError,
      record.failedAt,
    ],
  );
}

function assertEquivalent(row: DeadLetterRow, record: DeadLetterRecord): void {
  const equivalent =
    row.original_job_id === record.originalJobId &&
    row.tool_name === record.toolName &&
    row.attempts === record.attempts &&
    row.last_error === record.lastError &&
    stableJson(row.payload) === stableJson(record.payload);
  if (!equivalent) throw new Error('DEAD_LETTER_SOURCE_CONFLICT');
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
