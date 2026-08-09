import type pg from 'pg';
import type { ScheduledJob, Scheduler } from './scheduler-contracts.js';

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

export class PostgresScheduler implements Scheduler {
  constructor(private readonly pool: pg.Pool) {}

  async schedule<TPayload>(job: Omit<ScheduledJob<TPayload>, 'status' | 'attempts'>): Promise<ScheduledJob<TPayload>> {
    const result = await this.pool.query<Row>(
      `insert into scheduled_jobs (id, tool_name, payload, run_at, timezone, idempotency_key)
       values ($1, $2, $3::jsonb, $4::timestamptz, $5, $6)
       on conflict (idempotency_key) do update set idempotency_key = excluded.idempotency_key
       returning *`,
      [job.id, job.toolName, JSON.stringify(job.payload), job.runAt, job.timezone, job.idempotencyKey],
    );
    return mapRow<TPayload>(result.rows[0]!);
  }

  async get<TPayload = unknown>(id: string): Promise<ScheduledJob<TPayload> | undefined> {
    const result = await this.pool.query<Row>('select * from scheduled_jobs where id = $1', [id]);
    return result.rows[0] ? mapRow<TPayload>(result.rows[0]) : undefined;
  }

  async cancel(id: string): Promise<ScheduledJob | undefined> {
    const result = await this.pool.query<Row>(
      `update scheduled_jobs set status = 'CANCELED', updated_at = now()
       where id = $1 and status not in ('SUCCEEDED', 'CANCELED') returning *`,
      [id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : this.get(id);
  }

  async claimDue(nowIso: string, limit: number): Promise<readonly ScheduledJob[]> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const selected = await client.query<Row>(
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
          `update scheduled_jobs set status = 'RUNNING', attempts = attempts + 1, updated_at = now()
           where id = $1 returning *`,
          [row.id],
        );
        claimed.push(mapRow(updated.rows[0]!));
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
    await this.pool.query(
      `update scheduled_jobs set status = 'SUCCEEDED', last_error = null, updated_at = now() where id = $1`,
      [id],
    );
  }

  async markFailed(id: string, normalizedError: string): Promise<void> {
    await this.pool.query(
      `update scheduled_jobs set status = 'FAILED', last_error = $2, updated_at = now() where id = $1`,
      [id, normalizedError],
    );
  }
}
