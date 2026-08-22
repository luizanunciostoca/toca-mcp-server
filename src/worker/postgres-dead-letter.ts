import type pg from 'pg';
import type { ScheduledJob } from '../scheduler/scheduler-contracts.js';
import type { DeadLetterRecord, DeadLetterSink } from './worker.js';

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
    if (job.tenantId && job.tenantId !== this.tenantId) {
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
      if (!sourceRow) throw new Error(`DEAD_LETTER_TENANT_OWNERSHIP_MISMATCH:${job.id}`);
      if (sourceRow.tenant_id !== this.tenantId) {
        throw new Error(`DEAD_LETTER_TENANT_OWNERSHIP_MISMATCH:${job.id}`);
      }
      const status = sourceRow.status;

      const existing = await client.query<{ id: string }>(
        `select id from dead_letter_jobs
         where original_job_id = $1
         order by created_at asc, id asc
         limit 1`,
        [job.id],
      );
      if (status === 'FAILED' && existing.rows[0]) {
        await client.query('commit');
        return;
      }
      if (status !== 'RUNNING') {
        throw new Error(`DEAD_LETTER_SOURCE_STATE_CONFLICT:${job.id}:${status}`);
      }

      if (!existing.rows[0]) {
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

      const transitioned = await client.query(
        `update scheduled_jobs
         set status = 'FAILED', last_error = $2, updated_at = now()
         where id = $1 and tenant_id = $3 and status = 'RUNNING'`,
        [job.id, record.lastError, this.tenantId],
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
