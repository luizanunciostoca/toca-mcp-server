import { describe, expect, it } from 'vitest';
import { createPostgresPool } from '../src/persistence/postgres.js';
import { PostgresScheduler } from '../src/scheduler/postgres-scheduler.js';
import { PostgresDeadLetterSink } from '../src/worker/postgres-dead-letter.js';

const DATABASE_URL = process.env.DATABASE_URL;
const postgresDescribe = DATABASE_URL ? describe : describe.skip;
const TOOL = 'foundation.runtime.restart_safety';

function databaseUrl(): string {
  if (!DATABASE_URL) throw new Error('DLQ_RECOVERY_DATABASE_URL_REQUIRED');
  return DATABASE_URL;
}

postgresDescribe('DLQ recovery PostgreSQL E2E', () => {
  it('preserves scope/correlation/idempotency and makes concurrent finalize one logical DLQ entry', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const jobId = `dlq-scope-job-${suffix}`;
    const deadLetterId = `dlq-scope-${suffix}`;
    const tenantId = `tenant-${suffix}`;
    const workspaceId = `workspace-${suffix}`;
    const organizationId = `organization-${suffix}`;
    const correlationId = `correlation-${suffix}`;
    const idempotencyKey = `idempotency-${suffix}`;
    const pool = createPostgresPool({ connectionString: databaseUrl(), max: 4 });

    try {
      const scheduler = new PostgresScheduler(pool);
      const deadLetters = new PostgresDeadLetterSink(pool);
      const scheduled = await scheduler.schedule({
        id: jobId,
        toolName: TOOL,
        payload: {
          tenantId,
          workspaceId,
          organizationId,
          correlationId,
          idempotencyKey,
          proof: 'dlq-scope-preserved',
        },
        runAt: '2026-08-22T18:20:00.000Z',
        timezone: 'America/Bahia',
        idempotencyKey,
      });
      expect(scheduled.tenantId).toBe(tenantId);

      const claimed = await scheduler.claimDue('2026-08-22T18:20:01.000Z', 1, TOOL);
      expect(claimed).toHaveLength(1);
      const job = claimed[0]!;
      expect(job.tenantId).toBe(tenantId);

      const record = {
        id: deadLetterId,
        originalJobId: jobId,
        toolName: TOOL,
        payload: job.payload,
        attempts: job.attempts,
        lastError: 'Error: permanent failure',
        failedAt: '2026-08-22T18:20:02.000Z',
        tenantId,
        workspaceId,
        organizationId,
        correlationId,
        idempotencyKey,
        evidence: ['acceptance:dlq-finalize'],
      } as const;

      await Promise.all([deadLetters.finalize(job, record), deadLetters.finalize(job, record)]);

      expect(await scheduler.get(jobId)).toMatchObject({
        status: 'FAILED',
        tenantId,
        idempotencyKey,
      });
      const rows = await pool.query<{ count: string }>(
        'select count(*)::text as count from dead_letter_jobs where original_job_id = $1',
        [jobId],
      );
      expect(rows.rows[0]?.count).toBe('1');

      const persisted = await deadLetters.get(deadLetterId);
      expect(persisted).toMatchObject({
        originalJobId: jobId,
        toolName: TOOL,
        tenantId,
        workspaceId,
        organizationId,
        correlationId,
        idempotencyKey,
        status: 'OPEN',
        replayCount: 0,
        attempts: 1,
        lastError: record.lastError,
      });
      expect(persisted?.payload).toEqual(record.payload);
      expect(persisted?.evidence).toContain('acceptance:dlq-finalize');
    } finally {
      await pool.query('delete from dead_letter_jobs where original_job_id = $1', [jobId]);
      await pool.query('delete from scheduled_jobs where id = $1', [jobId]);
      await pool.end();
    }
  });

  it('claims, releases and resolves replay with tenant isolation and idempotent completion', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const id = `dlq-replay-${suffix}`;
    const originalJobId = `dlq-replay-source-${suffix}`;
    const tenantId = `tenant-replay-${suffix}`;
    const pool = createPostgresPool({ connectionString: databaseUrl(), max: 4 });

    try {
      const deadLetters = new PostgresDeadLetterSink(pool);
      await deadLetters.put({
        id,
        originalJobId,
        toolName: 'whatsapp.message.send',
        payload: {
          tenant_id: tenantId,
          workspace_id: 'workspace-replay',
          organization_id: 'organization-replay',
          correlation_id: `corr-${suffix}`,
          idempotency_key: `idem-${suffix}`,
        },
        attempts: 3,
        lastError: 'Error: provider unavailable',
        failedAt: '2026-08-22T18:30:00.000Z',
        tenantId,
        workspaceId: 'workspace-replay',
        organizationId: 'organization-replay',
        correlationId: `corr-${suffix}`,
        idempotencyKey: `idem-${suffix}`,
        evidence: ['acceptance:dlq-created'],
      });

      await expect(
        deadLetters.claimReplay({
          id,
          tenantId: 'other-tenant',
          replayExecutionId: `wrong-${suffix}`,
          evidence: ['acceptance:cross-tenant'],
          now: '2026-08-22T18:30:01.000Z',
        }),
      ).rejects.toThrow('DEAD_LETTER_TENANT_MISMATCH');

      const claimed = await deadLetters.claimReplay({
        id,
        tenantId,
        replayExecutionId: `replay-1-${suffix}`,
        evidence: ['acceptance:replay-claimed'],
        now: '2026-08-22T18:30:02.000Z',
      });
      expect(claimed).toMatchObject({ status: 'REPLAYING', replayCount: 1 });

      const sameClaim = await deadLetters.claimReplay({
        id,
        tenantId,
        replayExecutionId: `replay-1-${suffix}`,
        evidence: ['acceptance:duplicate-claim'],
        now: '2026-08-22T18:30:03.000Z',
      });
      expect(sameClaim.replayCount).toBe(1);

      const released = await deadLetters.releaseReplay({
        id,
        tenantId,
        replayExecutionId: `replay-1-${suffix}`,
        error: 'TRANSIENT_REPLAY_FAILURE',
        evidence: ['acceptance:replay-released'],
        now: '2026-08-22T18:30:04.000Z',
      });
      expect(released).toMatchObject({
        status: 'OPEN',
        replayCount: 1,
        lastReplayError: 'TRANSIENT_REPLAY_FAILURE',
      });

      const secondClaim = await deadLetters.claimReplay({
        id,
        tenantId,
        replayExecutionId: `replay-2-${suffix}`,
        evidence: ['acceptance:replay-second-claim'],
        now: '2026-08-22T18:30:05.000Z',
      });
      expect(secondClaim).toMatchObject({ status: 'REPLAYING', replayCount: 2 });

      const resolved = await deadLetters.completeReplay({
        id,
        tenantId,
        replayExecutionId: `replay-2-${suffix}`,
        resolution: 'REPLAY_SUCCEEDED:fake-core-execution',
        evidence: ['acceptance:replay-resolved'],
        now: '2026-08-22T18:30:06.000Z',
      });
      expect(resolved).toMatchObject({
        status: 'RESOLVED',
        replayCount: 2,
        resolution: 'REPLAY_SUCCEEDED:fake-core-execution',
      });

      const duplicateCompletion = await deadLetters.completeReplay({
        id,
        tenantId,
        replayExecutionId: `replay-2-${suffix}`,
        resolution: 'REPLAY_SUCCEEDED:fake-core-execution',
        evidence: ['acceptance:duplicate-completion'],
        now: '2026-08-22T18:30:07.000Z',
      });
      expect(duplicateCompletion.status).toBe('RESOLVED');
      expect(duplicateCompletion.replayCount).toBe(2);
    } finally {
      await pool.query('delete from dead_letter_jobs where original_job_id = $1', [originalJobId]);
      await pool.end();
    }
  });
});
