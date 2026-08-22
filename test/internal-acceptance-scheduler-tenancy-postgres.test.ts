import { describe, expect, it } from 'vitest';
import { createPostgresPool } from '../src/persistence/postgres.js';
import { PostgresScheduler } from '../src/scheduler/postgres-scheduler.js';
import { PostgresDeadLetterSink } from '../src/worker/postgres-dead-letter.js';

const DATABASE_URL = process.env.DATABASE_URL;
const postgresDescribe = DATABASE_URL ? describe : describe.skip;

function databaseUrl(): string {
  if (!DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');
  return DATABASE_URL;
}

postgresDescribe('INTERNAL ACCEPTANCE scheduler/DLQ tenant boundary', () => {
  it('fails closed when a tenant-A caller knows tenant-B scheduled-job identifiers', async () => {
    const pool = createPostgresPool({ connectionString: databaseUrl(), max: 6 });
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const tenantA = `accept-a-${suffix}`;
    const tenantB = `accept-b-${suffix}`;
    const tenantC = `accept-c-${suffix}`;

    for (const tenantId of [tenantA, tenantB, tenantC]) {
      await pool.query(
        `insert into tenants (tenant_id, status, display_name, evidence)
         values ($1, 'ACTIVE', $2, '["internal-acceptance"]'::jsonb)`,
        [tenantId, tenantId],
      );
    }

    const now = new Date(Date.now() - 60_000).toISOString();
    const jobs = [tenantA, tenantB, tenantC].map((tenantId) => ({
      id: `${tenantId}:job`,
      toolName: 'internal.acceptance',
      payload: { tenantId },
      runAt: now,
      timezone: 'UTC',
      idempotencyKey: `${tenantId}:idem`,
      status: 'SCHEDULED' as const,
      attempts: 0,
    }));

    for (const [index, tenantId] of [tenantA, tenantB, tenantC].entries()) {
      const job = jobs[index]!;
      await pool.query(
        `insert into scheduled_jobs
          (id, tool_name, payload, run_at, timezone, idempotency_key, tenant_id)
         values ($1, $2, $3::jsonb, $4::timestamptz, $5, $6, $7)`,
        [job.id, job.toolName, JSON.stringify(job.payload), job.runAt, job.timezone, job.idempotencyKey, tenantId],
      );
    }

    // The canonical Scheduler API has no tenant/identity parameter. Treat this instance as the
    // persistence authority reached while servicing tenant A and probe known sibling identifiers.
    const scheduler = new PostgresScheduler(pool);
    const siblingKnownId = await scheduler.get(jobs[1]!.id);
    const omittedTenantFilter = await scheduler.list('internal.acceptance');
    const siblingRescheduled = await scheduler.reschedule(
      jobs[1]!.id,
      new Date(Date.now() + 3_600_000).toISOString(),
      'UTC',
    );
    const siblingCanceled = await scheduler.cancel(jobs[2]!.id);

    // A tenant-safe scheduler must not disclose or mutate sibling jobs through an A-scoped call.
    expect(siblingKnownId, 'CROSS_TENANT_LEAK:scheduler.get known tenant-B id').toBeUndefined();
    expect(
      omittedTenantFilter.filter((job) => job.id !== jobs[0]!.id),
      'CROSS_TENANT_LEAK:scheduler.list omitted tenant filter',
    ).toHaveLength(0);
    expect(siblingRescheduled, 'CROSS_TENANT_LEAK:scheduler.reschedule tenant-B').toBeUndefined();
    expect(siblingCanceled, 'CROSS_TENANT_LEAK:scheduler.cancel tenant-C').toBeUndefined();

    await pool.end();
  });

  it('keeps dead-letter finalization in the source tenant', async () => {
    const pool = createPostgresPool({ connectionString: databaseUrl(), max: 6 });
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const tenantA = `dlq-a-${suffix}`;
    const tenantB = `dlq-b-${suffix}`;
    for (const tenantId of [tenantA, tenantB]) {
      await pool.query(
        `insert into tenants (tenant_id, status, display_name, evidence)
         values ($1, 'ACTIVE', $2, '["internal-acceptance"]'::jsonb)`,
        [tenantId, tenantId],
      );
    }

    const job = {
      id: `${tenantB}:job`,
      toolName: 'internal.acceptance',
      payload: { tenantId: tenantB },
      runAt: new Date(Date.now() - 60_000).toISOString(),
      timezone: 'UTC',
      idempotencyKey: `${tenantB}:idem`,
      status: 'RUNNING' as const,
      attempts: 1,
    };
    await pool.query(
      `insert into scheduled_jobs
        (id, tool_name, payload, run_at, timezone, idempotency_key, status, attempts, tenant_id)
       values ($1, $2, $3::jsonb, $4::timestamptz, $5, $6, 'RUNNING', 1, $7)`,
      [job.id, job.toolName, JSON.stringify(job.payload), job.runAt, job.timezone, job.idempotencyKey, tenantB],
    );

    // PostgresDeadLetterSink likewise receives no caller tenant. A tenant-A execution can therefore
    // present a known tenant-B job object. This must fail closed; mutation proves the isolation gap.
    const sink = new PostgresDeadLetterSink(pool);
    let rejected = false;
    try {
      await sink.finalize(job, {
        id: `${tenantA}:attempt-on-b`,
        originalJobId: job.id,
        toolName: job.toolName,
        payload: { attemptedByTenant: tenantA },
        attempts: 1,
        lastError: 'INTERNAL_ACCEPTANCE_CROSS_TENANT',
        failedAt: new Date().toISOString(),
      });
    } catch {
      rejected = true;
    }

    const source = await pool.query<{ status: string }>(
      'select status from scheduled_jobs where id = $1 and tenant_id = $2',
      [job.id, tenantB],
    );
    const dlq = await pool.query<{ id: string }>(
      'select id from dead_letter_jobs where original_job_id = $1',
      [job.id],
    );

    expect(rejected, 'CROSS_TENANT_LEAK:DLQ finalize accepted sibling tenant job').toBe(true);
    expect(source.rows[0]?.status).toBe('RUNNING');
    expect(dlq.rowCount).toBe(0);
    await pool.end();
  });
});
