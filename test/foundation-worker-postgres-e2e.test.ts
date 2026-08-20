import { describe, expect, it } from 'vitest';
import { createPostgresPool } from '../src/persistence/postgres.js';
import { SCHEDULER_STALE_RECOVERY_MARKER } from '../src/scheduler/scheduler-contracts.js';
import { PostgresScheduler } from '../src/scheduler/postgres-scheduler.js';
import { PostgresDeadLetterSink } from '../src/worker/postgres-dead-letter.js';

const DATABASE_URL = process.env.DATABASE_URL;
const postgresDescribe = DATABASE_URL ? describe : describe.skip;
const TOOL = 'foundation.runtime.restart_safety';

function databaseUrl(): string {
  if (!DATABASE_URL) throw new Error('FOUNDATION_WORKER_DATABASE_URL_REQUIRED');
  return DATABASE_URL;
}

postgresDescribe('Foundation scheduler/worker PostgreSQL restart safety', () => {
  it('recovers a stale RUNNING claim after restart and preserves one logical job', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const jobId = `foundation-restart-${suffix}`;
    const duplicateId = `foundation-duplicate-${suffix}`;
    const idempotencyKey = `foundation-restart-key-${suffix}`;
    const firstPool = createPostgresPool({ connectionString: databaseUrl(), max: 2 });

    try {
      const scheduler = new PostgresScheduler(firstPool);
      const first = await scheduler.schedule({
        id: jobId,
        toolName: TOOL,
        payload: { proof: 'restart-safe' },
        runAt: '2026-08-17T20:00:00.000Z',
        timezone: 'America/Bahia',
        idempotencyKey,
      });
      const duplicate = await scheduler.schedule({
        id: duplicateId,
        toolName: TOOL,
        payload: { proof: 'must-not-replace' },
        runAt: '2026-08-17T20:01:00.000Z',
        timezone: 'America/Bahia',
        idempotencyKey,
      });
      expect(duplicate.id).toBe(first.id);

      const firstClaim = await scheduler.claimDue('2026-08-17T20:00:01.000Z', 1, TOOL);
      expect(firstClaim).toHaveLength(1);
      expect(firstClaim[0]).toMatchObject({ id: jobId, status: 'RUNNING', attempts: 1 });
      await firstPool.query(
        `update scheduled_jobs
         set updated_at = '2026-08-17T19:40:00.000Z'::timestamptz
         where id = $1`,
        [jobId],
      );
    } finally {
      await firstPool.end();
    }

    const secondPool = createPostgresPool({ connectionString: databaseUrl(), max: 2 });
    try {
      const scheduler = new PostgresScheduler(secondPool);
      const recovered = await scheduler.claimDue('2026-08-17T20:00:02.000Z', 1, TOOL);
      expect(recovered).toHaveLength(1);
      expect(recovered[0]).toMatchObject({ id: jobId, status: 'RUNNING', attempts: 2 });
      expect(recovered[0]?.lastError?.startsWith(SCHEDULER_STALE_RECOVERY_MARKER)).toBe(true);

      await scheduler.retryAfterFailure(
        jobId,
        'Error: PROVIDER_TIMEOUT',
        '2026-08-17T20:00:05.000Z',
      );
      expect(await scheduler.get(jobId)).toMatchObject({
        status: 'SCHEDULED',
        attempts: 2,
        idempotencyKey,
        lastError: 'Error: PROVIDER_TIMEOUT',
      });

      const retryClaim = await scheduler.claimDue('2026-08-17T20:00:05.000Z', 1, TOOL);
      expect(retryClaim).toHaveLength(1);
      expect(retryClaim[0]).toMatchObject({ id: jobId, status: 'RUNNING', attempts: 3 });
      const rows = await secondPool.query<{ count: string }>(
        'select count(*)::text as count from scheduled_jobs where idempotency_key = $1',
        [idempotencyKey],
      );
      expect(rows.rows[0]?.count).toBe('1');
    } finally {
      await secondPool.query('delete from dead_letter_jobs where original_job_id = $1', [jobId]);
      await secondPool.query('delete from scheduled_jobs where id = $1', [jobId]);
      await secondPool.end();
    }
  });

  it('commits terminal failure and dead letter together and reconciles a legacy partial terminal state', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const atomicJobId = `foundation-dead-letter-${suffix}`;
    const legacyJobId = `foundation-dead-letter-legacy-${suffix}`;
    const pool = createPostgresPool({ connectionString: databaseUrl(), max: 2 });

    try {
      const scheduler = new PostgresScheduler(pool);
      const deadLetters = new PostgresDeadLetterSink(pool);
      await scheduler.schedule({
        id: atomicJobId,
        toolName: TOOL,
        payload: { proof: 'atomic-dead-letter' },
        runAt: '2026-08-17T21:00:00.000Z',
        timezone: 'America/Bahia',
        idempotencyKey: `foundation-dlq-key-${suffix}`,
      });
      const claimed = await scheduler.claimDue('2026-08-17T21:00:01.000Z', 1, TOOL);
      const job = claimed[0];
      if (!job) throw new Error('FOUNDATION_DEAD_LETTER_CLAIM_MISSING');

      const record = {
        id: `foundation-dlq-${suffix}`,
        originalJobId: atomicJobId,
        toolName: TOOL,
        payload: job.payload,
        attempts: job.attempts,
        lastError: 'Error: retry budget exhausted',
        failedAt: '2026-08-17T21:00:02.000Z',
      } as const;
      await deadLetters.finalize(job, record);
      await deadLetters.finalize(job, record);

      expect(await scheduler.get(atomicJobId)).toMatchObject({
        status: 'FAILED',
        lastError: record.lastError,
      });
      const deadLetterRows = await pool.query<{ count: string }>(
        'select count(*)::text as count from dead_letter_jobs where original_job_id = $1',
        [atomicJobId],
      );
      expect(deadLetterRows.rows[0]?.count).toBe('1');

      await scheduler.schedule({
        id: legacyJobId,
        toolName: TOOL,
        payload: { proof: 'legacy-partial-terminal' },
        runAt: '2026-08-17T21:10:00.000Z',
        timezone: 'America/Bahia',
        idempotencyKey: `foundation-legacy-dlq-key-${suffix}`,
      });
      const legacyClaim = await scheduler.claimDue('2026-08-17T21:10:01.000Z', 1, TOOL);
      const legacyJob = legacyClaim[0];
      if (!legacyJob) throw new Error('FOUNDATION_LEGACY_DEAD_LETTER_CLAIM_MISSING');
      await pool.query(
        `insert into dead_letter_jobs
            (id, original_job_id, tool_name, payload, attempts, last_error, failed_at)
           values ($1, $2, $3, $4::jsonb, $5, $6, $7::timestamptz)`,
        [
          `foundation-legacy-dlq-${suffix}`,
          legacyJobId,
          TOOL,
          JSON.stringify(legacyJob.payload),
          legacyJob.attempts,
          'Error: legacy terminal write completed before source transition',
          '2026-08-17T21:10:02.000Z',
        ],
      );
      await pool.query(
        `update scheduled_jobs
           set updated_at = '2026-08-17T20:50:00.000Z'::timestamptz
           where id = $1`,
        [legacyJobId],
      );

      expect(await scheduler.claimDue('2026-08-17T21:10:03.000Z', 1, TOOL)).toHaveLength(0);
      expect(await scheduler.get(legacyJobId)).toMatchObject({ status: 'FAILED' });
    } finally {
      await pool.query('delete from dead_letter_jobs where original_job_id = any($1::text[])', [
        [atomicJobId, legacyJobId],
      ]);
      await pool.query('delete from scheduled_jobs where id = any($1::text[])', [
        [atomicJobId, legacyJobId],
      ]);
      await pool.end();
    }
  });
});
