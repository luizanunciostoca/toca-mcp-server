import { describe, expect, it } from 'vitest';
import {
  FOUNDATION_V1_RELIABILITY_OBJECTIVES,
  assessReliability,
  type ReliabilitySnapshot,
} from '../src/core/reliability.js';

function healthySnapshot(overrides: Partial<ReliabilitySnapshot> = {}): ReliabilitySnapshot {
  return {
    windowMinutes: 60,
    coreRequests: 10_000,
    coreFailures: 0,
    schedulerTicks: 60,
    schedulerFailures: 0,
    successfulExternalWrites: 12,
    verifiedExternalWrites: 12,
    outboxPending: 0,
    oldestOutboxAgeSeconds: 0,
    auditLedgerIntegrityValid: true,
    latestBackupAgeHours: 4,
    pointInTimeRecoveryEnabled: true,
    latestRestoreDrillAgeDays: 30,
    ...overrides,
  };
}

describe('Foundation v1 reliability policy', () => {
  it('accepts a healthy snapshot with met SLOs and recovery evidence', () => {
    const assessment = assessReliability(healthySnapshot());

    expect(assessment.healthy).toBe(true);
    expect(assessment.alerts).toEqual([]);
    expect(assessment.slos).toEqual([
      expect.objectContaining({ name: 'core_availability', met: true }),
      expect.objectContaining({ name: 'scheduler_success', met: true }),
    ]);
  });

  it('treats audit corruption and unverified external success as P0', () => {
    const assessment = assessReliability(
      healthySnapshot({
        auditLedgerIntegrityValid: false,
        successfulExternalWrites: 2,
        verifiedExternalWrites: 1,
      }),
    );

    expect(assessment.healthy).toBe(false);
    expect(assessment.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'AUDIT_LEDGER_INTEGRITY_FAILED', severity: 'P0' }),
        expect.objectContaining({ code: 'UNVERIFIED_EXTERNAL_WRITE_SUCCESS', severity: 'P0' }),
      ]),
    );
  });

  it('alerts on stalled outbox, stale backups, disabled PITR and stale restore drills', () => {
    const assessment = assessReliability(
      healthySnapshot({
        outboxPending: 4,
        oldestOutboxAgeSeconds:
          FOUNDATION_V1_RELIABILITY_OBJECTIVES.maximumOldestOutboxAgeSeconds + 1,
        latestBackupAgeHours: FOUNDATION_V1_RELIABILITY_OBJECTIVES.maximumBackupAgeHours + 1,
        pointInTimeRecoveryEnabled: false,
        latestRestoreDrillAgeDays:
          FOUNDATION_V1_RELIABILITY_OBJECTIVES.maximumRestoreDrillAgeDays + 1,
      }),
    );

    expect(assessment.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'OUTBOX_DELIVERY_STALLED', severity: 'P1' }),
        expect.objectContaining({ code: 'BACKUP_TOO_OLD', severity: 'P1' }),
        expect.objectContaining({ code: 'PITR_DISABLED', severity: 'P0' }),
        expect.objectContaining({ code: 'RESTORE_DRILL_STALE', severity: 'P2' }),
      ]),
    );
  });

  it('reports high burn-rate SLO breaches as P0', () => {
    const assessment = assessReliability(
      healthySnapshot({
        coreRequests: 10_000,
        coreFailures: 200,
      }),
    );

    expect(assessment.alerts).toContainEqual(
      expect.objectContaining({ code: 'CORE_AVAILABILITY_SLO_BREACH', severity: 'P0' }),
    );
  });

  it('does not invent an SLO result when there is no traffic in the window', () => {
    const assessment = assessReliability(
      healthySnapshot({
        coreRequests: 0,
        coreFailures: 0,
        schedulerTicks: 0,
        schedulerFailures: 0,
      }),
    );

    expect(assessment.slos).toEqual([
      expect.objectContaining({ name: 'core_availability', achieved: null, met: null }),
      expect.objectContaining({ name: 'scheduler_success', achieved: null, met: null }),
    ]);
  });

  it('rejects contradictory write verification counts', () => {
    expect(() =>
      assessReliability(
        healthySnapshot({
          successfulExternalWrites: 1,
          verifiedExternalWrites: 2,
        }),
      ),
    ).toThrow('RELIABILITY_VERIFIED_WRITES_EXCEED_SUCCESSES');
  });
});
