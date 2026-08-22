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

postgresDescribe('Scheduler/DLQ PostgreSQL tenant isolation', () => {
  it('isolates read, list, reschedule, cancel, claim, idempotency and payload spoofing across A/B/C', async () => {
    const pool = createPostgresPool({ connectionString: databaseUrl(), max: 12 });
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const tenants = [`tenant-a-${suffix}`, `tenant-b-${suffix}`, `tenant-c-${suffix}`] as const;
    const [tenantA, tenantB, tenantC] = tenants;
    const schedulerA = new PostgresScheduler(pool, tenantA);
    const schedulerB = new PostgresScheduler(pool, tenantB);
    const schedulerC = new PostgresScheduler(pool, tenantC);
    const schedulers = [schedulerA, schedulerB, schedulerC] as const;
    const createdIds: string[] = [];

    try {
      for (const tenantId of tenants) {
        await pool.query(
          `insert into tenants (tenant_id, status, display_name, evidence)
           values ($1, 'ACTIVE', $2, '["test:scheduler-multitenancy"]'::jsonb)`,
          [tenantId, tenantId],
        );
      }

      const sharedIdempotencyKey = `same-logical-key-${suffix}`;
      const scheduledFor = '2099-01-01T00:00:00.000Z';
      const jobs = await Promise.all(
        schedulers.map((scheduler, index) => {
          const tenantId = tenants[index]!;
          const id = `${tenantId}:same-logical-operation`;
          createdIds.push(id);
          return scheduler.schedule({
            id,
            toolName: TOOL,
            payload: { logicalOperation: 'equivalent', claimedTenant: tenantId },
            runAt: scheduledFor,
            timezone: 'UTC',
            idempotencyKey: sharedIdempotencyKey,
          });
        }),
      );

      expect(jobs.map((job) => job.tenantId)).toEqual([tenantA, tenantB, tenantC]);
      expect(jobs.map((job) => job.idempotencyKey)).toEqual([
        sharedIdempotencyKey,
        sharedIdempotencyKey,
        sharedIdempotencyKey,
      ]);

      expect(await schedulerA.get(jobs[1]!.id)).toBeUndefined();
      expect(await schedulerB.get(jobs[0]!.id)).toBeUndefined();
      expect(await schedulerA.get(`random-${suffix}`)).toBeUndefined();
      expect((await schedulerA.list(TOOL)).map((job) => job.id)).toEqual([jobs[0]!.id]);
      expect((await schedulerB.list(TOOL)).map((job) => job.id)).toEqual([jobs[1]!.id]);
      expect(
        await schedulerA.reschedule(jobs[1]!.id, '2099-02-01T00:00:00.000Z', 'UTC'),
      ).toBeUndefined();
      expect(await schedulerA.cancel(jobs[2]!.id)).toBeUndefined();
      expect(await schedulerB.get(jobs[1]!.id)).toMatchObject({
        status: 'SCHEDULED',
        tenantId: tenantB,
      });
      expect(await schedulerC.get(jobs[2]!.id)).toMatchObject({
        status: 'SCHEDULED',
        tenantId: tenantC,
      });

      const spoofId = `${tenantA}:spoof-payload`;
      createdIds.push(spoofId);
      await schedulerA.schedule({
        id: spoofId,
        toolName: TOOL,
        payload: { tenantId: tenantB, actorTenantId: tenantB, attemptedSpoof: true },
        runAt: scheduledFor,
        timezone: 'UTC',
        idempotencyKey: `spoof-${suffix}`,
      });
      const spoofRow = await pool.query<{ tenant_id: string }>(
        'select tenant_id from scheduled_jobs where id = $1',
        [spoofId],
      );
      expect(spoofRow.rows[0]?.tenant_id).toBe(tenantA);
      expect(await schedulerB.get(spoofId)).toBeUndefined();

      const dueIds = tenants.map((tenantId) => `${tenantId}:due`);
      for (const [index, scheduler] of schedulers.entries()) {
        const id = dueIds[index]!;
        createdIds.push(id);
        await scheduler.schedule({
          id,
          toolName: TOOL,
          payload: { tenantId: tenants[index], concurrent: true },
          runAt: '2026-08-22T00:00:00.000Z',
          timezone: 'UTC',
          idempotencyKey: `due-${tenants[index]}-${suffix}`,
        });
      }
      const claims = await Promise.all(
        schedulers.map((scheduler) => scheduler.claimDue('2026-08-22T00:00:01.000Z', 10, TOOL)),
      );
      for (const [index, claim] of claims.entries()) {
        expect(claim.map((job) => job.id)).toEqual([dueIds[index]!]);
        expect(claim.every((job) => job.tenantId === tenants[index])).toBe(true);
      }
    } finally {
      await pool.query('delete from dead_letter_jobs where original_job_id = any($1::text[])', [
        createdIds,
      ]);
      await pool.query('delete from scheduled_jobs where id = any($1::text[])', [createdIds]);
      await pool.query('delete from tenants where tenant_id = any($1::text[])', [
        Array.from(tenants),
      ]);
      await pool.end();
    }
  });

  it('rejects cross-tenant DLQ finalization atomically and accepts the owning tenant', async () => {
    const pool = createPostgresPool({ connectionString: databaseUrl(), max: 8 });
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const tenantA = `dlq-a-${suffix}`;
    const tenantB = `dlq-b-${suffix}`;
    const jobId = `${tenantB}:job`;

    try {
      for (const tenantId of [tenantA, tenantB]) {
        await pool.query(
          `insert into tenants (tenant_id, status, display_name, evidence)
           values ($1, 'ACTIVE', $2, '["test:dlq-multitenancy"]'::jsonb)`,
          [tenantId, tenantId],
        );
      }

      const schedulerB = new PostgresScheduler(pool, tenantB);
      const sinkA = new PostgresDeadLetterSink(pool, tenantA);
      const sinkB = new PostgresDeadLetterSink(pool, tenantB);
      await schedulerB.schedule({
        id: jobId,
        toolName: TOOL,
        payload: { tenantId: tenantB },
        runAt: '2026-08-22T01:00:00.000Z',
        timezone: 'UTC',
        idempotencyKey: `dlq-${suffix}`,
      });
      const [job] = await schedulerB.claimDue('2026-08-22T01:00:01.000Z', 1, TOOL);
      if (!job) throw new Error('DLQ_TEST_JOB_NOT_CLAIMED');

      const crossTenantRecord = {
        id: `${tenantA}:attempt`,
        originalJobId: job.id,
        toolName: job.toolName,
        payload: { attemptedByTenant: tenantA },
        attempts: job.attempts,
        lastError: 'CROSS_TENANT_ATTEMPT',
        failedAt: '2026-08-22T01:00:02.000Z',
      } as const;
      await expect(sinkA.finalize(job, crossTenantRecord)).rejects.toThrow(
        `DEAD_LETTER_SOURCE_NOT_FOUND:${job.id}`,
      );
      expect(await schedulerB.get(job.id)).toMatchObject({ status: 'RUNNING', tenantId: tenantB });
      const afterRejected = await pool.query<{ count: string }>(
        'select count(*)::text as count from dead_letter_jobs where original_job_id = $1',
        [job.id],
      );
      expect(afterRejected.rows[0]?.count).toBe('0');

      await expect(
        pool.query(
          `insert into dead_letter_jobs
            (id, original_job_id, tool_name, payload, attempts, last_error, failed_at, tenant_id)
           values ($1, $2, $3, '{}'::jsonb, 1, 'DIRECT_MISMATCH', now(), $4)`,
          [`${tenantA}:direct`, job.id, TOOL, tenantA],
        ),
      ).rejects.toMatchObject({ code: '23503' });

      const owningRecord = {
        ...crossTenantRecord,
        id: `${tenantB}:dead-letter`,
        payload: { ownedByTenant: tenantB },
        lastError: 'EXPECTED_TERMINAL_FAILURE',
      } as const;
      await sinkB.finalize(job, owningRecord);
      expect(await schedulerB.get(job.id)).toMatchObject({
        status: 'FAILED',
        lastError: owningRecord.lastError,
        tenantId: tenantB,
      });
      const stored = await pool.query<{ tenant_id: string }>(
        'select tenant_id from dead_letter_jobs where original_job_id = $1',
        [job.id],
      );
      expect(stored.rows).toEqual([{ tenant_id: tenantB }]);
    } finally {
      await pool.query('delete from dead_letter_jobs where original_job_id = $1', [jobId]);
      await pool.query('delete from scheduled_jobs where id = $1', [jobId]);
      await pool.query('delete from tenants where tenant_id = any($1::text[])', [
        [tenantA, tenantB],
      ]);
      await pool.end();
    }
  });
});
