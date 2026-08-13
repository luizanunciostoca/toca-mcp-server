import { describe, expect, it } from 'vitest';
import {
  assertScheduledStateClaim,
  assertSchedulingPolicyAllowsIntent,
  deriveSchedulingDisposition,
} from '../src/marketing-autopilot-scheduling.js';

describe('scheduling guards', () => {
  it('rejects SCHEDULED without provider evidence', () => {
    expect(() => assertScheduledStateClaim('SCHEDULED')).toThrow(
      'PROVIDER_SCHEDULE_EVIDENCE_REQUIRED',
    );
  });

  it('accepts provider-confirmed scheduling', () => {
    expect(() =>
      assertScheduledStateClaim('SCHEDULED', {
        providerScheduleId: 'provider-123',
        providerScheduledAt: '2026-08-14T16:30:00-03:00',
        providerStatus: 'SCHEDULED',
      }),
    ).not.toThrow();
  });

  it('uses manual handoff when native scheduling automation is unavailable', () => {
    expect(
      deriveSchedulingDisposition({
        requiresProviderNativeScheduling: true,
        providerNativeApiAvailable: false,
      }),
    ).toBe('MANUAL_HANDOFF_REQUIRED');
  });

  it('labels timed api execution as a publish window, not scheduling', () => {
    expect(
      deriveSchedulingDisposition({
        requiresProviderNativeScheduling: false,
        providerNativeApiAvailable: false,
      }),
    ).toBe('READY_TO_PUBLISH_AT_WINDOW');
  });

  it('blocks timed media_publish under native-provider-only policy', () => {
    expect(() =>
      assertSchedulingPolicyAllowsIntent(
        'NATIVE_PROVIDER_SCHEDULING_ONLY',
        'PUBLISH_AT_WINDOW',
      ),
    ).toThrow('NATIVE_PROVIDER_SCHEDULING_ONLY_POLICY_DENIED');
  });

  it('allows only native scheduling under native-provider-only policy', () => {
    expect(() =>
      assertSchedulingPolicyAllowsIntent(
        'NATIVE_PROVIDER_SCHEDULING_ONLY',
        'NATIVE_SCHEDULE',
      ),
    ).not.toThrow();
  });

  it('keeps SHARE_NOW as a separate explicit policy', () => {
    expect(() => assertSchedulingPolicyAllowsIntent('SHARE_NOW', 'SHARE_NOW')).not.toThrow();
    expect(() =>
      assertSchedulingPolicyAllowsIntent('SHARE_NOW', 'PUBLISH_AT_WINDOW'),
    ).toThrow('SHARE_NOW_POLICY_DENIED');
  });
});
