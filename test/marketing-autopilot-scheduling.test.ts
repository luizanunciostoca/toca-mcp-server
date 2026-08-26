import { describe, expect, it } from 'vitest';
import {
  assertScheduledStateClaim,
  assertSchedulingPolicyAllowsIntent,
  deriveSchedulingDisposition,
} from '../src/marketing-autopilot-scheduling.js';

const managedEvidence = {
  jobId: 'job-123',
  descriptorSha256: 'a'.repeat(64),
  scheduledFor: '2026-08-27T16:30:00-03:00',
  schedulerStatus: 'TOCA_SCHEDULED' as const,
};

const providerEvidence = {
  providerScheduleId: 'provider-123',
  providerScheduledAt: '2026-08-27T16:30:00-03:00',
  providerStatus: 'SCHEDULED',
};

describe('scheduling guards', () => {
  it('reserves SCHEDULED for provider-backed native scheduling', () => {
    expect(() => assertScheduledStateClaim('SCHEDULED')).toThrow(
      'PROVIDER_SCHEDULE_EVIDENCE_REQUIRED',
    );
    expect(() => assertScheduledStateClaim('SCHEDULED', providerEvidence)).not.toThrow();
    expect(() => assertScheduledStateClaim('SCHEDULED', managedEvidence)).toThrow(
      'PROVIDER_SCHEDULE_EVIDENCE_REQUIRED',
    );
  });

  it('requires immutable managed-scheduler evidence for TOCA_SCHEDULED', () => {
    expect(() => assertScheduledStateClaim('TOCA_SCHEDULED')).toThrow(
      'TOCA_SCHEDULE_EVIDENCE_REQUIRED',
    );
    expect(() => assertScheduledStateClaim('TOCA_SCHEDULED', managedEvidence)).not.toThrow();
    expect(() => assertScheduledStateClaim('TOCA_SCHEDULED', providerEvidence)).toThrow(
      'TOCA_SCHEDULE_EVIDENCE_REQUIRED',
    );
  });

  it('routes future organic content through the TOCA managed scheduler', () => {
    expect(
      deriveSchedulingDisposition({
        policy: 'TOCA_MANAGED_SCHEDULING',
        tocaManagedSchedulerAvailable: true,
        providerNativeApiAvailable: false,
      }),
    ).toBe('READY_FOR_SCHEDULING');
    expect(
      deriveSchedulingDisposition({
        policy: 'TOCA_MANAGED_SCHEDULING',
        tocaManagedSchedulerAvailable: true,
        providerNativeApiAvailable: false,
        managedEvidence,
      }),
    ).toBe('TOCA_SCHEDULED');
  });

  it('fails closed when the selected scheduler is unavailable', () => {
    expect(() =>
      deriveSchedulingDisposition({
        policy: 'TOCA_MANAGED_SCHEDULING',
        tocaManagedSchedulerAvailable: false,
        providerNativeApiAvailable: false,
      }),
    ).toThrow('TOCA_MANAGED_SCHEDULER_UNAVAILABLE');
    expect(() =>
      deriveSchedulingDisposition({
        policy: 'NATIVE_PROVIDER_SCHEDULING',
        tocaManagedSchedulerAvailable: true,
        providerNativeApiAvailable: false,
      }),
    ).toThrow('NATIVE_PROVIDER_SCHEDULER_UNAVAILABLE');
  });

  it('accepts only the intent bound to each scheduling policy', () => {
    expect(() =>
      assertSchedulingPolicyAllowsIntent('TOCA_MANAGED_SCHEDULING', 'TOCA_SCHEDULE'),
    ).not.toThrow();
    expect(() =>
      assertSchedulingPolicyAllowsIntent('TOCA_MANAGED_SCHEDULING', 'NATIVE_SCHEDULE'),
    ).toThrow('TOCA_MANAGED_SCHEDULING_POLICY_DENIED');
    expect(() =>
      assertSchedulingPolicyAllowsIntent('NATIVE_PROVIDER_SCHEDULING', 'NATIVE_SCHEDULE'),
    ).not.toThrow();
  });

  it('keeps SHARE_NOW separate and explicit', () => {
    expect(() => assertSchedulingPolicyAllowsIntent('SHARE_NOW', 'SHARE_NOW')).not.toThrow();
    expect(() => assertSchedulingPolicyAllowsIntent('SHARE_NOW', 'TOCA_SCHEDULE')).toThrow(
      'SHARE_NOW_POLICY_DENIED',
    );
  });
});
