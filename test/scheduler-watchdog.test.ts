import { describe, expect, it } from 'vitest';
import type { ScheduledJob } from '../src/scheduler/scheduler-contracts.js';
import {
  SchedulerWatchdog,
  evaluateSchedulerWatchdog,
} from '../src/scheduler/scheduler-watchdog.js';

const now = '2026-08-26T22:00:00Z';
const job = (overrides: Partial<ScheduledJob> = {}): ScheduledJob => ({
  id: 'job-1',
  tenantId: 'toca',
  toolName: 'internal.instagram.publication.toca-managed.execute',
  payload: {},
  runAt: '2026-08-26T22:10:00Z',
  timezone: 'America/Bahia',
  idempotencyKey: 'publication:item-1:v1',
  status: 'SCHEDULED',
  attempts: 0,
  updatedAt: '2026-08-26T21:59:00Z',
  ...overrides,
});
const healthyState = {
  lastPollAt: '2026-08-26T21:59:30Z',
  lastClaimAt: '2026-08-26T21:59:31Z',
  lastSuccessfulExecutionAt: '2026-08-26T21:58:00Z',
  lastReconciliationAt: '2026-08-26T21:55:00Z',
  lastExecutionLatencyMs: 1_000,
  deadLetterBacklog: 0,
};

describe('scheduler watchdog', () => {
  it('reports healthy when polling, claims and reconciliation are fresh with no backlog', () => {
    const result = evaluateSchedulerWatchdog([job()], healthyState, { now });
    expect(result.status).toBe('HEALTHY');
    expect(result.reasonCodes).toEqual([]);
    expect(result.dueBacklog).toBe(0);
  });

  it('reports unhealthy when poll and claim signals go stale', () => {
    const result = evaluateSchedulerWatchdog(
      [job()],
      {
        ...healthyState,
        lastPollAt: '2026-08-26T21:50:00Z',
        lastClaimAt: '2026-08-26T21:50:00Z',
      },
      { now },
    );
    expect(result.status).toBe('UNHEALTHY');
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining(['SCHEDULER_POLL_STALE', 'SCHEDULER_CLAIM_STALE']),
    );
  });

  it('detects overdue scheduled work, stale RUNNING jobs and publication lag', () => {
    const result = evaluateSchedulerWatchdog(
      [
        job({ id: 'due', runAt: '2026-08-26T21:40:00Z' }),
        job({
          id: 'running',
          status: 'RUNNING',
          runAt: '2026-08-26T21:30:00Z',
          updatedAt: '2026-08-26T21:30:00Z',
          idempotencyKey: 'publication:item-2:v1',
        }),
      ],
      healthyState,
      { now },
    );
    expect(result.status).toBe('UNHEALTHY');
    expect(result.dueBacklog).toBe(1);
    expect(result.staleRunningBacklog).toBe(1);
    expect(result.publicationLagMs).toBe(30 * 60_000);
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining([
        'SCHEDULER_DUE_BACKLOG_STALE',
        'SCHEDULER_RUNNING_STALE',
        'SCHEDULER_PUBLICATION_LAG_HIGH',
      ]),
    );
  });

  it('escalates any dead-letter backlog', () => {
    const result = evaluateSchedulerWatchdog(
      [job()],
      { ...healthyState, deadLetterBacklog: 1 },
      { now },
    );
    expect(result.status).toBe('UNHEALTHY');
    expect(result.reasonCodes).toContain('SCHEDULER_DEAD_LETTER_BACKLOG');
  });

  it('tracks monotonic poll, claim, execution and reconciliation signals', () => {
    const timestamps = [
      new Date('2026-08-26T21:59:00Z'),
      new Date('2026-08-26T21:59:01Z'),
      new Date('2026-08-26T21:59:02Z'),
      new Date('2026-08-26T21:59:03Z'),
    ];
    const watchdog = new SchedulerWatchdog(undefined, () => timestamps.shift()!);
    watchdog.recordPoll();
    watchdog.recordClaim();
    watchdog.recordExecution('SUCCEEDED', 250);
    watchdog.recordReconciliation();
    expect(watchdog.state()).toMatchObject({
      lastPollAt: '2026-08-26T21:59:00.000Z',
      lastClaimAt: '2026-08-26T21:59:01.000Z',
      lastSuccessfulExecutionAt: '2026-08-26T21:59:02.000Z',
      lastExecutionLatencyMs: 250,
      lastReconciliationAt: '2026-08-26T21:59:03.000Z',
    });
  });
});
