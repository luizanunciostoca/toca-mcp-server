import { describe, expect, it } from 'vitest';
import {
  classifyFoundationDailyControl,
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
