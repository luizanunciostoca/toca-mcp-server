import { describe, expect, it } from 'vitest';
import { PostgresWorkflowStore } from '../src/persistence/postgres-workflow-store.js';
import { createPostgresPool } from '../src/persistence/postgres.js';

const DATABASE_URL = process.env.DATABASE_URL;
const postgresDescribe = DATABASE_URL ? describe : describe.skip;

function databaseUrl(): string {
  if (!DATABASE_URL) throw new Error('WORKFLOW_TIMER_RECOVERY_DATABASE_URL_REQUIRED');
  return DATABASE_URL;
}

function blueprint(suffix: string) {
  return {
    workflowId: `timer-recovery-${suffix}`,
    routeId: 'R10' as const,
    definitionId: 'timer-recovery-postgres-e2e',
    definitionVersion: '1.0.0',
    idempotencyKey: `timer-recovery-idem-${suffix}`,
    correlationId: `timer-recovery-corr-${suffix}`,
    tenantId: `timer-recovery-tenant-${suffix}`,
    workspaceId: `timer-recovery-workspace-${suffix}`,
    organizationId: `timer-recovery-org-${suffix}`,
    requesterPrincipalId: 'timer-recovery:e2e',
    steps: [{ stepId: 'wake', name: 'Wake after timer', maxAttempts: 2 }],
  };
}

postgresDescribe('Workflow timer PostgreSQL restart recovery', () => {
  it('redelivers FIRED+READY after restart and stops after one claim', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const definition = blueprint(suffix);
    const timerId = `timer-recovery-fired-${suffix}`;
    const scheduledAt = '2030-01-01T10:00:00.000Z';
    const fireAt = '2030-01-01T10:10:00.000Z';

    const pool1 = createPostgresPool({ connectionString: databaseUrl(), max: 4 });
    const store1 = new PostgresWorkflowStore(pool1);
    await store1.create(definition, scheduledAt);
    const [claim] = await store1.claimReadySteps({
      workerId: 'timer-recovery-arm-worker',
      now: '2030-01-01T10:01:00.000Z',
      limit: 1,
      workflowId: definition.workflowId,
    });
    if (!claim) throw new Error('WORKFLOW_TIMER_RECOVERY_ARM_CLAIM_REQUIRED');
    await store1.scheduleTimer({
      timerId,
      workflowId: definition.workflowId,
      stepId: 'wake',
      executionId: claim.executionId,
      fireAt,
      evidence: ['test:timer-recovery:scheduled'],
      now: '2030-01-01T10:02:00.000Z',
    });
    const firstFire = await store1.fireDueTimers({ now: fireAt, limit: 100 });
    expect(firstFire).toContain(timerId);
    const fired = await store1.get(definition.workflowId);
    expect(fired?.steps[0]?.status).toBe('READY');
    expect(fired?.timers[0]).toMatchObject({ timerId, status: 'FIRED', fireAt });
    await pool1.end();

    const pool2 = createPostgresPool({ connectionString: databaseUrl(), max: 4 });
    const store2 = new PostgresWorkflowStore(pool2);
    try {
      const redelivered = await store2.fireDueTimers({
        now: '2030-01-01T10:11:00.000Z',
        limit: 100,
      });
      expect(redelivered).toContain(timerId);

      const [recoveredClaim] = await store2.claimReadySteps({
        workerId: 'timer-recovery-resume-worker',
        now: '2030-01-01T10:11:01.000Z',
        limit: 1,
        workflowId: definition.workflowId,
      });
      expect(recoveredClaim).toBeDefined();

      const afterClaim = await store2.fireDueTimers({
        now: '2030-01-01T10:11:02.000Z',
        limit: 100,
      });
      expect(afterClaim).not.toContain(timerId);

      if (!recoveredClaim) {
        throw new Error('WORKFLOW_TIMER_RECOVERY_RESUME_CLAIM_REQUIRED');
      }
      const completed = await store2.completeStep({
        workflowId: definition.workflowId,
        stepId: 'wake',
        executionId: recoveredClaim.executionId,
        output: { recovered: true },
        evidence: ['test:timer-recovery:completed'],
        now: '2030-01-01T10:12:00.000Z',
      });
      expect(completed.instance.status).toBe('SUCCEEDED');
      expect(completed.steps[0]?.attempts).toBe(1);
      const timerFiredEvents = completed.events.filter((event) => event.eventType === 'TIMER_FIRED');
      expect(timerFiredEvents).toHaveLength(1);
    } finally {
      await pool2.end();
    }
  });

  it('persists reschedule across restart and honors reconciled due time', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const definition = blueprint(`reschedule-${suffix}`);
    const timerId = `timer-recovery-reschedule-${suffix}`;

    const pool1 = createPostgresPool({ connectionString: databaseUrl(), max: 4 });
    const store1 = new PostgresWorkflowStore(pool1);
    await store1.create(definition, '2030-01-02T10:00:00.000Z');
    const [claim] = await store1.claimReadySteps({
      workerId: 'timer-reschedule-arm-worker',
      now: '2030-01-02T10:01:00.000Z',
      limit: 1,
      workflowId: definition.workflowId,
    });
    if (!claim) throw new Error('WORKFLOW_TIMER_RESCHEDULE_ARM_CLAIM_REQUIRED');
    await store1.scheduleTimer({
      timerId,
      workflowId: definition.workflowId,
      stepId: 'wake',
      executionId: claim.executionId,
      fireAt: '2030-01-02T10:30:00.000Z',
      evidence: ['test:timer-reschedule:scheduled'],
      now: '2030-01-02T10:02:00.000Z',
    });
    const rescheduled = await store1.rescheduleTimer({
      timerId,
      workflowId: definition.workflowId,
      stepId: 'wake',
      fireAt: '2030-01-02T10:10:00.000Z',
      evidence: ['test:timer-reschedule:reconciled'],
      now: '2030-01-02T10:05:00.000Z',
    });
    expect(rescheduled.timers[0]).toMatchObject({
      timerId,
      status: 'SCHEDULED',
      fireAt: '2030-01-02T10:10:00.000Z',
    });
    await pool1.end();

    const pool2 = createPostgresPool({ connectionString: databaseUrl(), max: 4 });
    const store2 = new PostgresWorkflowStore(pool2);
    try {
      expect(
        await store2.fireDueTimers({ now: '2030-01-02T10:09:59.000Z', limit: 100 }),
      ).not.toContain(timerId);
      expect(
        await store2.fireDueTimers({ now: '2030-01-02T10:10:00.000Z', limit: 100 }),
      ).toContain(timerId);
      const snapshot = await store2.get(definition.workflowId);
      expect(snapshot?.timers[0]?.status).toBe('FIRED');
      const timerFiredEvents = snapshot?.events.filter((event) => event.eventType === 'TIMER_FIRED');
      expect(timerFiredEvents).toHaveLength(1);
    } finally {
      await pool2.end();
    }
  });
});
