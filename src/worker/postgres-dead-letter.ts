import type pg from 'pg';
import type { DeadLetterRecord, DeadLetterSink } from './worker.js';

export class PostgresDeadLetterSink implements DeadLetterSink {
  constructor(private readonly pool: pg.Pool) {}

  async put(record: DeadLetterRecord): Promise<void> {
    await this.pool.query(
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
}
