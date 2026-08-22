import { describe, expect, it } from 'vitest';
import { createPostgresPool } from '../src/persistence/postgres.js';
import { PostgresScheduler } from '../src/scheduler/postgres-scheduler.js';
import type { DeadLetterRecord } from '../src/worker/worker.js';
import { PostgresDeadLetterSink } from '../src/worker/postgres-dead-letter.js';

const DATABASE_URL = process.env.DATABASE_URL;
const postgresDescribe = DATABASE_URL ? describe : describe.skip;
const TOOL = 'internal.acceptance.dlq.schema033';

function databaseUrl(): string {
  if (!DATABASE_URL) throw new Error('DLQ_SCHEMA033_DATABASE_URL_REQUIRED');
  return DATABASE_URL;
}

postgresDescribe('DLQ schema-033 reconciliation PostgreSQL E2E', () => {
  it('serializes concurrent canonical put calls by logical source inside the owning tenant', async () => {
    const pool = createPostgresPool({ connectionString: databaseUrl(), max: 8 });
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const tenantId = `tenant-dlq-${suffix}`;
    const originalJobId = `dlq-generic-${suffix}`;
    const scheduler = new PostgresScheduler(pool, tenantId);
    const sink = new PostgresDeadLetterSink(pool, tenantId);
    const base = {
      originalJobId,
      toolName: TOOL,
      payload: { proof: 'canonical-advisory-fence', tenantId },
      attempts: 3,
      lastError: 'Error: terminal',
      failedAt: '2026-08-22T18:00:00.000Z',
    } as const;

    try {
      await pool.query(
        `insert into tenants (tenant_id, status, display_name, evidence)
         values ($1, 'ACTIVE', $1, '["test:dlq-schema033"]'::jsonb)`,
        [tenantId],
      );
      await scheduler.schedule({
        id: originalJobId,
        toolName: TOOL,
        payload: { proof: 'source' },
        runAt: '2099-01-01T00:00:00.000Z',
        timezone: 'UTC',
        idempotencyKey: `dlq-generic-key-${suffix}`,
      });

      await Promise.all([
        sink.put({ id: `dlq-a-${suffix}`, ...base }),
        sink.put({ id: `dlq-b-${suffix}`, ...base }),
      ]);

      const rows = await pool.query<{ count: string }>(
        'select count(*)::text as count from dead_letter_jobs where original_job_id = $1',
        [originalJobId],
      );
      expect(rows.rows[0]?.count).toBe('1');

      await expect(
        sink.put({
          id: `dlq-conflict-${suffix}`,
          ...base,
          payload: { proof: 'different-logical-record', tenantId },
        }),
      ).rejects.toThrow('DEAD_LETTER_SOURCE_CONFLICT');
    } finally {
      await pool.query('delete from dead_letter_jobs where original_job_id = $1', [originalJobId]);
      await pool.query('delete from scheduled_jobs where id = $1', [originalJobId]);
      await pool.query('delete from tenants where tenant_id = $1', [tenantId]);
      await pool.end();
    }
  });

  it('fails closed on missing/cross-tenant ownership and finalizes the owner exactly once', async () => {
    const pool = createPostgresPool({ connectionString: databaseUrl(), max: 8 });
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const jobId = `dlq-owner-${suffix}`;
    const ownerTenant = `tenant-owner-${suffix}`;
    const attackerTenant = `tenant-attacker-${suffix}`;
    const scheduler = new PostgresScheduler(pool, ownerTenant);
    const sink = new PostgresDeadLetterSink(pool, ownerTenant);
    const attackerSink = new PostgresDeadLetterSink(pool, attackerTenant);

    try {
      for (const tenantId of [ownerTenant, attackerTenant]) {
        await pool.query(
          `insert into tenants (tenant_id, status, display_name, evidence)
           values ($1, 'ACTIVE', $1, '["test:dlq-schema033"]'::jsonb)`,
          [tenantId],
        );
      }

      await scheduler.schedule({
        id: jobId,
        toolName: TOOL,
        payload: { proof: 'tenant-owned-finalize' },
        runAt: '2026-08-22T18:30:00.000Z',
        timezone: 'UTC',
        idempotencyKey: `dlq-owner-key-${suffix}`,
      });

      const [job] = await scheduler.claimDue('2026-08-22T18:30:01.000Z', 1, TOOL);
      if (!job) throw new Error('DLQ_SCHEMA033_JOB_NOT_CLAIMED');
      expect(job.tenantId).toBe(ownerTenant);

      const record: DeadLetterRecord = {
        id: `dlq-owner-record-${suffix}`,
        originalJobId: job.id,
        toolName: job.toolName,
        payload: job.payload,
        attempts: job.attempts,
        lastError: 'Error: expected terminal failure',
        failedAt: '2026-08-22T18:30:02.000Z',
      };

      const { tenantId: _tenantId, ...withoutTenant } = job;
      void _tenantId;
      await expect(sink.finalize(withoutTenant, record)).rejects.toThrow(
        `DEAD_LETTER_TENANT_OWNERSHIP_MISMATCH:${job.id}`,
      );
      await expect(attackerSink.finalize(job, record)).rejects.toThrow(
        `DEAD_LETTER_TENANT_OWNERSHIP_MISMATCH:${job.id}`,
      );

      const afterDenied = await pool.query<{ status: string; dead_letters: string }>(
        `select job.status,
                (select count(*)::text from dead_letter_jobs where original_job_id = job.id) as dead_letters
         from scheduled_jobs as job where job.id = $1`,
        [jobId],
      );
      expect(afterDenied.rows[0]).toEqual({ status: 'RUNNING', dead_letters: '0' });

      await Promise.all([
        sink.finalize(job, record),
        sink.finalize(job, { ...record, id: `dlq-owner-race-${suffix}` }),
      ]);

      const finalized = await pool.query<{
        status: string;
        last_error: string;
        dead_letters: string;
      }>(
        `select job.status, job.last_error,
                (select count(*)::text from dead_letter_jobs where original_job_id = job.id) as dead_letters
         from scheduled_jobs as job where job.id = $1`,
        [jobId],
      );
      expect(finalized.rows[0]).toEqual({
        status: 'FAILED',
        last_error: record.lastError,
        dead_letters: '1',
      });
    } finally {
      await pool.query('delete from dead_letter_jobs where original_job_id = $1', [jobId]);
      await pool.query('delete from scheduled_jobs where id = $1', [jobId]);
      await pool.query('delete from tenants where tenant_id = any($1::text[])', [
        [ownerTenant, attackerTenant],
      ]);
      await pool.end();
    }
  });
});
