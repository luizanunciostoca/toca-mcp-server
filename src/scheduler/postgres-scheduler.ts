import type pg from 'pg';
import {
  SCHEDULER_STALE_RECOVERY_MARKER,
  SCHEDULER_STALE_RUNNING_AFTER_MS,
  type ScheduledJob,
  type Scheduler,
} from './scheduler-contracts.js';

const DEAD_LETTER_RECOVERY_MARKER = 'WORKER_DEAD_LETTER_RECOVERED';

type Row = {
  id: string;
  tool_name: string;
  payload: unknown;
  run_at: Date;
  timezone: string;
  idempotency_key: string;
  status: ScheduledJob['status'];
  attempts: number;
  last_error: string | null;
};

function mapRow<TPayload = unknown>(row: Row): ScheduledJob<TPayload> {
  return {
    id: row.id,
    toolName: row.tool_name,
    payload: row.payload as TPayload,
    runAt: row.run_at.toISOString(),
    timezone: row.timezone,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    attempts: row.attempts,
    ...(row.last_error ? { lastError: row.last_error } : {}),
  };
}

function staleBefore(nowIso: string): string {
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now)) throw new Error('SCHEDULER_CLAIM_TIME_INVALID');
  return new Date(now - SCHEDULER_STALE_RUNNING_AFTER_MS).toISOString();
}

function assertSingleTransition(rowCount: number | null, code: string, id: string): void {
  if (rowCount !== 1) throw new Error(`${code}:${id}`);
}

export class PostgresScheduler implements Scheduler {
  constructor(private readonly pool: pg.Pool) {}

  async schedule<TPayload>(
    job: Omit<ScheduledJob<TPayload>, 'status' | 'attempts'>,
  ): Promise<ScheduledJob<TPayload>> {
    const result = await this.pool.query<Row>(
      `insert into scheduled_jobs (id, tool_name, payload, run_at, timezone, idempotency_key)
       values ($1, $2, $3::jsonb, $4::timestamptz, $5, $6)
       on conflict (idempotency_key) do update set idempotency_key = excluded.idempotency_key
       returning *`,
      [
        job.id,
        job.toolName,
        JSON.stringify(job.payload),
        job.runAt,
        job.timezone,
        job.idempotencyKey,
      ],
    );
    return mapRow<TPayload>(result.rows[0]!);
  }

  async get<TPayload = unknown>(id: string): Promise<ScheduledJob<TPayload> | undefined> {
    const result = await this.pool.query<Row>('select * from scheduled_jobs where id = $1', [id]);
    return result.rows[0] ? mapRow<TPayload>(result.rows[0]) : undefined;
  }

  async reschedule(id: string, runAt: string, timezone: string): Promise<ScheduledJob | undefined> {
    const result = await this.pool.query<Row>(
      `update scheduled_jobs
       set run_at = $2::timestamptz, timezone = $3, updated_at = now()
       where id = $1 and status = 'SCHEDULED'
       returning *`,
      [id, runAt, timezone],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : this.get(id);
  }

  async cancel(id: string): Promise<ScheduledJob | undefined> {
    const result = await this.pool.query<Row>(
      `update scheduled_jobs set status = 'CANCELED', updated_at = now()
       where id = $1 and status not in ('SUCCEEDED', 'CANCELED') returning *`,
      [id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : this.get(id);
  }

  async list(toolName?: string): Promise<readonly ScheduledJob[]> {
    const result = toolName
      ? await this.pool.query<Row>(
          'select * from scheduled_jobs where tool_name = $1 order by run_at asc, id asc',
          [toolName],
        )
      : await this.pool.query<Row>('select * from scheduled_jobs order by run_at asc, id asc');
    return result.rows.map((row) => mapRow(row));
  }

  async claimDue(
    nowIso: string,
    limit: number,
    toolName?: string,
  ): Promise<readonly ScheduledJob[]> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const staleBeforeIso = staleBefore(nowIso);
      const deadLetterParams = toolName
        ? [nowIso, staleBeforeIso, DEAD_LETTER_RECOVERY_MARKER, toolName]
        : [nowIso, staleBeforeIso, DEAD_LETTER_RECOVERY_MARKER];
      await client.query(
        `update scheduled_jobs as job
         set status = 'FAILED',
             last_error = coalesce(job.last_error, $3),
             updated_at = $1::timestamptz
         where job.status = 'RUNNING'
           and job.updated_at <= $2::timestamptz
           ${toolName ? 'and job.tool_name = $4' : ''}
           and exists (
             select 1 from dead_letter_jobs as dead_letter
             where dead_letter.original_job_id = job.id
           )`,
        deadLetterParams,
      );

      const recoveryParams = toolName
        ? [nowIso, staleBeforeIso, SCHEDULER_STALE_RECOVERY_MARKER, toolName]
        : [nowIso, staleBeforeIso, SCHEDULER_STALE_RECOVERY_MARKER];
      await client.query(
        `update scheduled_jobs as job
         set status = 'SCHEDULED',
             last_error = case
               when job.last_error is null then $3
               when job.last_error like $3 || '%' then job.last_error
               else $3 || ' | previous=' || job.last_error
             end,
             updated_at = $1::timestamptz
         where job.status = 'RUNNING'
           and job.updated_at <= $2::timestamptz
           ${toolName ? 'and job.tool_name = $4' : ''}
           and not exists (
             select 1 from dead_letter_jobs as dead_letter
             where dead_letter.original_job_id = job.id
           )`,
        recoveryParams,
      );

      const selected = toolName
        ? await client.query<Row>(
            `select * from scheduled_jobs
             where status = 'SCHEDULED' and run_at <= $1::timestamptz and tool_name = $3
             order by run_at asc
             for update skip locked
             limit $2`,
            [nowIso, limit, toolName],
          )
        : await client.query<Row>(
            `select * from scheduled_jobs
             where status = 'SCHEDULED' and run_at <= $1::timestamptz
             order by run_at asc
             for update skip locked
             limit $2`,
            [nowIso, limit],
          );
      const claimed: ScheduledJob[] = [];
      for (const row of selected.rows) {
        const updated = await client.query<Row>(
          `update scheduled_jobs set status = 'RUNNING', attempts = attempts + 1, updated_at = $2::timestamptz
           where id = $1 and status = 'SCHEDULED' returning *`,
          [row.id, nowIso],
        );
        if (!updated.rows[0]) throw new Error(`SCHEDULER_CLAIM_TRANSITION_CONFLICT:${row.id}`);
        claimed.push(mapRow(updated.rows[0]));
      }
      await client.query('commit');
      return claimed;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async markSucceeded(id: string): Promise<void> {
    const result = await this.pool.query(
      `update scheduled_jobs
       set status = 'SUCCEEDED', last_error = null, updated_at = now()
       where id = $1 and status = 'RUNNING'`,
      [id],
    );
    assertSingleTransition(result.rowCount, 'SCHEDULER_SUCCESS_TRANSITION_CONFLICT', id);
  }

  async markFailed(id: string, normalizedError: string): Promise<void> {
    const result = await this.pool.query(
      `update scheduled_jobs
       set status = 'FAILED', last_error = $2, updated_at = now()
       where id = $1 and status = 'RUNNING'`,
      [id, normalizedError],
    );
    assertSingleTransition(result.rowCount, 'SCHEDULER_FAILURE_TRANSITION_CONFLICT', id);
  }

  async retryAfterFailure(id: string, normalizedError: string, retryAt: string): Promise<void> {
    const result = await this.pool.query(
      `update scheduled_jobs
       set status = 'SCHEDULED', run_at = $3::timestamptz, last_error = $2, updated_at = now()
       where id = $1 and status = 'RUNNING'`,
      [id, normalizedError, retryAt],
    );
    assertSingleTransition(result.rowCount, 'SCHEDULER_RETRY_TRANSITION_CONFLICT', id);
  }
}
