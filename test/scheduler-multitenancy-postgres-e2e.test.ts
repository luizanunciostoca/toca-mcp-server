import { describe, expect, it } from 'vitest';
import { createPostgresPool } from '../src/persistence/postgres.js';
import { PostgresScheduler } from '../src/scheduler/postgres-scheduler.js';
import { PostgresDeadLetterSink } from '../src/worker/postgres-dead-letter.js';

const DATABASE_URL = process.env.DATABASE_URL;
const postgresDescribe = DATABASE_URL ? describe : describe.skip;
const TOOL = 'internal.acceptance.scheduler.tenant';

function databaseUrl(): string {
  if (!DATABASE_URL) throw new Error('SCHEDULER_TENANCY_DATABASE_URL_REQUIRED');
  return DATABASE_URL;
}

postgresDescribe('Scheduler/DLQ PostgreSQL tenant isolation without schema mutation', () => {
  it('fails closed for 5/5 cross-tenant attempts and preserves scoped transitions', async () => {
    const pool = createPostgresPool({ connectionString: databaseUrl(), max: 12 });
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const tenantA = `tenant-a-${suffix}`;
    const tenantB = `tenant-b-${suffix}`;
    const schedulerA = new PostgresScheduler(pool, tenantA);
    const schedulerB = new PostgresScheduler(pool, tenantB);
    const sinkA = new PostgresDeadLetterSink(pool, tenantA);
    const sinkB = new PostgresDeadLetterSink(pool, tenantB);
    const ids: string[] = [];

    try {
      for (const tenantId of [tenantA, tenantB]) {
        await pool.query(
          `insert into tenants (tenant_id, status, display_name, evidence)
           values ($1, 'ACTIVE', $2, '["test:scheduler-multitenancy"]'::jsonb)`,
          [tenantId, tenantId],
        );
      }

      const aFutureId = `a-future-${suffix}`;
      const bFutureId = `b-future-${suffix}`;
      ids.push(aFutureId, bFutureId);
      const aFuture = await schedulerA.schedule({
        id: aFutureId,
        toolName: TOOL,
        payload: { owner: tenantA },
        runAt: '2099-01-01T00:00:00.000Z',
        timezone: 'UTC',
        idempotencyKey: `a-future-key-${suffix}`,
      });
      const aDuplicate = await schedulerA.schedule({
        id: `a-duplicate-${suffix}`,
        toolName: TOOL,
        payload: { ignored: true },
        runAt: '2099-01-02T00:00:00.000Z',
        timezone: 'UTC',
        idempotencyKey: `a-future-key-${suffix}`,
      });
      expect(aDuplicate.id).toBe(aFuture.id);
      await expect(
        schedulerB.schedule({
          id: `b-idempotency-conflict-${suffix}`,
          toolName: TOOL,
          payload: { owner: tenantB },
          runAt: '2099-01-01T00:00:00.000Z',
          timezone: 'UTC',
          idempotencyKey: `a-future-key-${suffix}`,
        }),
      ).rejects.toThrow(`SCHEDULER_IDEMPOTENCY_TENANT_CONFLICT:a-future-key-${suffix}`);
      await schedulerB.schedule({
        id: bFutureId,
        toolName: TOOL,
        payload: { owner: tenantB },
        runAt: '2099-01-01T00:00:00.000Z',
        timezone: 'UTC',
        idempotencyKey: `b-future-key-${suffix}`,
      });

      // Adversarial attempt 1: cross-tenant get.
      expect(await schedulerA.get(bFutureId)).toBeUndefined();
      // Adversarial attempt 2: cross-tenant list.
      expect((await schedulerA.list(TOOL)).map((job) => job.id)).toEqual([aFutureId]);
      // Adversarial attempt 3: cross-tenant reschedule.
      expect(await schedulerA.reschedule(bFutureId, '2099-02-01T00:00:00.000Z', 'UTC')).toBeUndefined();
      expect(await schedulerB.get(bFutureId)).toMatchObject({ runAt: '2099-01-01T00:00:00.000Z' });
      // Adversarial attempt 4: cross-tenant cancel.
      expect(await schedulerA.cancel(bFutureId)).toBeUndefined();
      expect(await schedulerB.get(bFutureId)).toMatchObject({ status: 'SCHEDULED' });

      const aDueId = `a-due-${suffix}`;
      const bDueId = `b-due-${suffix}`;
      ids.push(aDueId, bDueId);
      await schedulerA.schedule({
        id: aDueId,
        toolName: TOOL,
        payload: { owner: tenantA },
        runAt: '2026-08-22T00:00:00.000Z',
        timezone: 'UTC',
        idempotencyKey: `a-due-key-${suffix}`,
      });
      await schedulerB.schedule({
        id: bDueId,
        toolName: TOOL,
        payload: { owner: tenantB },
        runAt: '2026-08-22T00:00:00.000Z',
        timezone: 'UTC',
        idempotencyKey: `b-due-key-${suffix}`,
      });
      const [claimedA, claimedB] = await Promise.all([
        schedulerA.claimDue('2026-08-22T00:00:01.000Z', 10, TOOL),
        schedulerB.claimDue('2026-08-22T00:00:01.000Z', 10, TOOL),
      ]);
      expect(claimedA.map((job) => job.id)).toEqual([aDueId]);
      expect(claimedB.map((job) => job.id)).toEqual([bDueId]);
      const bRunning = claimedB[0]!;

      await expect(schedulerA.markFailed(bDueId, 'CROSS_TENANT')).rejects.toThrow(
        `SCHEDULER_FAILURE_TRANSITION_CONFLICT:${bDueId}`,
      );
      await expect(schedulerA.markSucceeded(bDueId)).rejects.toThrow(
        `SCHEDULER_SUCCESS_TRANSITION_CONFLICT:${bDueId}`,
      );
      expect(await schedulerB.get(bDueId)).toMatchObject({ status: 'RUNNING' });
      await schedulerB.retryAfterFailure(bDueId, 'EXPECTED_RETRY', '2026-08-22T00:00:02.000Z');
      const retried = await schedulerB.claimDue('2026-08-22T00:00:03.000Z', 1, TOOL);
      expect(retried[0]).toMatchObject({ id: bDueId, status: 'RUNNING', attempts: 2 });
      await schedulerB.markSucceeded(bDueId);
      expect(await schedulerB.get(bDueId)).toMatchObject({ status: 'SUCCEEDED' });

      // Adversarial attempt 5: cross-tenant DLQ finalize must be atomic and fail closed.
      const crossRecord = {
        id: `dlq-cross-${suffix}`,
        originalJobId: aDueId,
        toolName: TOOL,
        payload: { attemptedBy: tenantB },
        attempts: claimedA[0]!.attempts,
        lastError: 'CROSS_TENANT_FINALIZE',
        failedAt: '2026-08-22T00:00:04.000Z',
      } as const;
      await expect(sinkB.finalize(claimedA[0]!, crossRecord)).rejects.toThrow(
        `DEAD_LETTER_TENANT_OWNERSHIP_MISMATCH:${aDueId}`,
      );
      expect(await schedulerA.get(aDueId)).toMatchObject({ status: 'RUNNING' });
      expect(
        (await pool.query<{ count: string }>(
          'select count(*)::text as count from dead_letter_jobs where original_job_id = $1',
          [aDueId],
        )).rows[0]?.count,
      ).toBe('0');

      const ownRecord = {
        ...crossRecord,
        id: `dlq-own-${suffix}`,
        payload: { owner: tenantA },
        lastError: 'EXPECTED_TERMINAL_FAILURE',
      } as const;
      await sinkA.finalize(claimedA[0]!, ownRecord);
      await sinkA.finalize(claimedA[0]!, ownRecord);
      expect(await schedulerA.get(aDueId)).toMatchObject({
        status: 'FAILED',
        lastError: ownRecord.lastError,
      });

      const concurrencyId = `b-concurrency-${suffix}`;
      ids.push(concurrencyId);
      await schedulerB.schedule({
        id: concurrencyId,
        toolName: TOOL,
        payload: { concurrent: true },
        runAt: '2026-08-22T00:01:00.000Z',
        timezone: 'UTC',
        idempotencyKey: `b-concurrency-key-${suffix}`,
      });
      const restartedB = new PostgresScheduler(pool, tenantB);
      expect(await restartedB.get(bFutureId)).toMatchObject({ tenantId: tenantB });
      const concurrentClaims = await Promise.all([
        schedulerB.claimDue('2026-08-22T00:01:01.000Z', 1, TOOL),
        restartedB.claimDue('2026-08-22T00:01:01.000Z', 1, TOOL),
      ]);
      expect(concurrentClaims.flat().map((job) => job.id)).toEqual([concurrencyId]);
      expect(bRunning.tenantId).toBe(tenantB);
    } finally {
      await pool.query('delete from dead_letter_jobs where original_job_id = any($1::text[])', [ids]);
      await pool.query('delete from scheduled_jobs where id = any($1::text[])', [ids]);
      await pool.query('delete from tenants where tenant_id = any($1::text[])', [
        [tenantA, tenantB],
      ]);
      await pool.end();
    }
  });
});
