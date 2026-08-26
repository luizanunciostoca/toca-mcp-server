import { describe, expect, it } from 'vitest';
import { InMemoryScheduler } from '../src/scheduler/in-memory-scheduler.js';
import {
  SchedulerReconciler,
  planSchedulerReconciliation,
  type SchedulerSafeRepairCommand,
} from '../src/scheduler/scheduler-reconciler.js';
import type { ScheduledJob } from '../src/scheduler/scheduler-contracts.js';
import { SchedulerWatchdog } from '../src/scheduler/scheduler-watchdog.js';

const now = '2026-08-26T22:00:00Z';
const job = (overrides: Partial<ScheduledJob> = {}): ScheduledJob => ({
  id: 'job-1',
  tenantId: 'toca',
  toolName: 'internal.instagram.publication.toca-managed.execute',
  payload: {},
  runAt: '2026-08-26T21:55:00Z',
  timezone: 'America/Bahia',
  idempotencyKey: 'publication:item-1:v1',
  status: 'SCHEDULED',
  attempts: 0,
  updatedAt: '2026-08-26T21:55:00Z',
  ...overrides,
});
const observation = (
  jobId: string,
  state: 'PUBLISHED' | 'PROCESSING' | 'NOT_FOUND' | 'UNAVAILABLE' | 'NOT_APPLICABLE',
) => ({
  jobId,
  state,
  ...(state === 'PUBLISHED' ? { externalResourceId: `ig_${jobId}` } : {}),
  evidence: [`provider:${jobId}:${state.toLowerCase()}`],
  observedAt: '2026-08-26T21:59:00Z',
});

describe('scheduler reconciler', () => {
  it('blocks duplicate idempotency keys instead of choosing a winner', () => {
    const jobs = [job(), job({ id: 'job-2' })];
    const report = planSchedulerReconciliation(
      jobs,
      jobs.map((item) => observation(item.id, 'PROCESSING')),
      { now, staleRunningAfterMs: 10 * 60_000 },
    );
    expect(report.healthy).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: 'DUPLICATE_IDEMPOTENCY_KEY',
        severity: 'CRITICAL',
        jobIds: ['job-1', 'job-2'],
        safeRepairAvailable: false,
      }),
    );
    expect(report.blockedJobIds).toEqual(['job-1', 'job-2']);
  });

  it('creates a safe repair only when provider readback proves publication', () => {
    const failed = job({ status: 'FAILED', lastError: 'provider timeout' });
    const report = planSchedulerReconciliation([failed], [observation(failed.id, 'PUBLISHED')], {
      now,
      staleRunningAfterMs: 10 * 60_000,
    });
    expect(report.safeRepairs).toEqual([
      expect.objectContaining({
        type: 'PROMOTE_LOCAL_SUCCEEDED_AFTER_PROVIDER_READBACK',
        jobId: failed.id,
        externalResourceId: `ig_${failed.id}`,
      }),
    ]);
    expect(report.blockedJobIds).toEqual([]);
  });

  it('blocks local success when provider state cannot be verified', () => {
    const succeeded = job({ status: 'SUCCEEDED' });
    const report = planSchedulerReconciliation(
      [succeeded],
      [observation(succeeded.id, 'NOT_FOUND')],
      { now, staleRunningAfterMs: 10 * 60_000 },
    );
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: 'LOCAL_SUCCEEDED_PROVIDER_NOT_VERIFIED',
        severity: 'CRITICAL',
        safeRepairAvailable: false,
      }),
    );
    expect(report.blockedJobIds).toEqual([succeeded.id]);
  });

  it('detects stale RUNNING without retrying an unknown provider outcome', () => {
    const running = job({
      status: 'RUNNING',
      updatedAt: '2026-08-26T21:30:00Z',
    });
    const report = planSchedulerReconciliation([running], [observation(running.id, 'PROCESSING')], {
      now,
      staleRunningAfterMs: 10 * 60_000,
    });
    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: 'RUNNING_STALE', safeRepairAvailable: false }),
    );
    expect(report.safeRepairs).toEqual([]);
    expect(report.blockedJobIds).toEqual([running.id]);
  });

  it('runs as an independent periodic process, applies only planned safe repairs and updates watchdog', async () => {
    const scheduler = new InMemoryScheduler();
    await scheduler.schedule({
      id: 'job-periodic',
      tenantId: 'toca',
      toolName: 'internal.instagram.publication.toca-managed.execute',
      payload: {},
      runAt: '2026-08-26T22:30:00Z',
      timezone: 'America/Bahia',
      idempotencyKey: 'publication:periodic:v1',
    });
    const applied: SchedulerSafeRepairCommand[] = [];
    const watchdog = new SchedulerWatchdog(undefined, () => new Date(now));
    const reconciler = new SchedulerReconciler({
      scheduler,
      providerProbe: {
        observe: (scheduled) => Promise.resolve(observation(scheduled.id, 'PUBLISHED')),
      },
      repairer: {
        apply: (command) => {
          applied.push(command);
          return Promise.resolve();
        },
      },
      watchdog,
      now: () => new Date(now),
    });

    const report = await reconciler.runOnce();
    expect(report.appliedRepairJobIds).toEqual(['job-periodic']);
    expect(applied).toHaveLength(1);
    expect(watchdog.state().lastReconciliationAt).toBe(new Date(now).toISOString());
  });
});
