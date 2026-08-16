import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { RuntimeTelemetry } from '../src/core/observability.js';
import {
  classifyFoundationDailyControl,
  runFoundationDailyControl,
  foundationDailyControlDayKey,
  type FoundationDailyControlSnapshot,
} from '../src/operations/foundation-daily-control.js';

function snapshot(
  overrides: Partial<FoundationDailyControlSnapshot> = {},
): FoundationDailyControlSnapshot {
  return {
    dayKey: '2026-08-15',
    checkedAt: '2026-08-15T11:00:00.000Z',
    outboxPending: 0,
    oldestOutboxAgeSeconds: 0,
    staleRunningJobs: 0,
    auditExecutionsChecked: 12,
    invalidAuditExecutions: 0,
    ...overrides,
  };
}

describe('Foundation daily control', () => {
  it('uses the America/Bahia calendar day', () => {
    expect(foundationDailyControlDayKey(new Date('2026-08-16T01:30:00.000Z'))).toBe('2026-08-15');
    expect(foundationDailyControlDayKey(new Date('2026-08-16T03:30:00.000Z'))).toBe('2026-08-16');
  });

  it('logs and rethrows an initial completion-read persistence failure', async () => {
    const databaseError = new Error('relation operational_signals does not exist');
    const pool = { query: vi.fn().mockRejectedValue(databaseError) } as unknown as pg.Pool;
    const logger = { info: vi.fn(), error: vi.fn() };
    const telemetry = new RuntimeTelemetry(logger);

    await expect(
      runFoundationDailyControl({
        pool,
        telemetry,
        logger,
        now: new Date('2026-08-15T12:00:00.000Z'),
      }),
    ).rejects.toThrow('relation operational_signals does not exist');

    expect(logger.error).toHaveBeenCalledWith(
      'foundation.daily_control.failed',
      expect.objectContaining({
        dayKey: '2026-08-15',
        phase: 'COMPLETION_READ',
        error: 'relation operational_signals does not exist',
      }),
    );
    expect(
      telemetry.snapshot().counters[JSON.stringify(['foundation.daily_control.failed', []])],
    ).toBe(1);
  });

  it('is healthy when outbox, scheduler and recent audit integrity are healthy', () => {
    expect(classifyFoundationDailyControl(snapshot())).toEqual([]);
  });

  it('raises P1 for a stalled Transactional Outbox', () => {
    expect(
      classifyFoundationDailyControl(snapshot({ outboxPending: 3, oldestOutboxAgeSeconds: 301 })),
    ).toContainEqual(expect.objectContaining({ code: 'OUTBOX_STALLED', severity: 'P1' }));
  });

  it('raises P1 for stale scheduler claims', () => {
    expect(classifyFoundationDailyControl(snapshot({ staleRunningJobs: 1 }))).toContainEqual(
      expect.objectContaining({ code: 'STALE_SCHEDULER_JOBS', severity: 'P1' }),
    );
  });

  it('raises P0 when any recent Audit Ledger execution fails integrity verification', () => {
    expect(
      classifyFoundationDailyControl(
        snapshot({ auditExecutionsChecked: 20, invalidAuditExecutions: 1 }),
      ),
    ).toContainEqual(
      expect.objectContaining({ code: 'AUDIT_LEDGER_INTEGRITY_FAILED', severity: 'P0' }),
    );
  });
});
