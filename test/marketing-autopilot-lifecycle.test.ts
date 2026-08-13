import { describe, expect, it } from 'vitest';
import {
  assertExternalWriteCapability,
  buildProductionIdempotencyKey,
  deriveCompleteDayCoverage,
  deriveLifecycleStatus,
  deriveSlotWindow,
  isReservationExpired,
} from '../src/marketing-autopilot-lifecycle.js';

describe('Marketing Autopilot lifecycle guards', () => {
  it('marks a slot expired after the 30-minute tolerance and blocks PREPARE', () => {
    const result = deriveSlotWindow({
      scheduledAt: '2026-08-13T09:00:00-03:00',
      now: '2026-08-13T09:30:01-03:00',
    });

    expect(result.state).toBe('EXPIRED');
    expect(result.isPrepareEligible).toBe(false);
    expect(deriveLifecycleStatus('REVIEW', result.state)).toBe('MISSED_WINDOW');
  });

  it('keeps future and active slots eligible for preparation', () => {
    expect(
      deriveSlotWindow({
        scheduledAt: '2026-08-13T15:00:00-03:00',
        now: '2026-08-13T14:00:00-03:00',
      }).state,
    ).toBe('FUTURE');

    const active = deriveSlotWindow({
      scheduledAt: '2026-08-13T15:00:00-03:00',
      now: '2026-08-13T15:10:00-03:00',
    });
    expect(active.state).toBe('ACTIVE');
    expect(active.isPrepareEligible).toBe(true);
  });

  it('fails closed for external writes unless capability is production validated', () => {
    expect(() => assertExternalWriteCapability('IMPLEMENTED')).toThrow(
      'CAPABILITY_NOT_PRODUCTION_VALIDATED',
    );
    expect(() => assertExternalWriteCapability('CONNECTED')).toThrow(
      'CAPABILITY_NOT_PRODUCTION_VALIDATED',
    );
    expect(() => assertExternalWriteCapability('PRODUCTION_VALIDATED')).not.toThrow();
  });

  it('builds a stable production idempotency key', () => {
    expect(buildProductionIdempotencyKey('MKT-20260813-SUNSET-FEED-1500', 'v1')).toBe(
      'PROD:MKT-20260813-SUNSET-FEED-1500:V1',
    );
  });

  it('counts coverage only when every required slot in a day reached the threshold', () => {
    const items = [
      { date: '2026-08-13', required: true, status: 'READY_FOR_SCHEDULING' as const },
      { date: '2026-08-13', required: true, status: 'BRIEFED' as const },
      { date: '2026-08-14', required: true, status: 'BRIEFED' as const },
      { date: '2026-08-14', required: true, status: 'BRIEFED' as const },
      { date: '2026-08-15', required: false, status: 'PLANNED' as const },
    ];

    expect(deriveCompleteDayCoverage(items, 'BRIEFED')).toBe(2);
    expect(deriveCompleteDayCoverage(items, 'PRODUCED')).toBe(0);
    expect(deriveCompleteDayCoverage(items, 'READY_FOR_SCHEDULING')).toBe(0);
  });

  it('detects orphan reservations after their TTL', () => {
    const reservation = {
      reservationId: 'RES-1',
      assetId: 'SUN-0244',
      contentItemId: 'MKT-20260813-SUNSET-FEED-1500',
      reservedAt: '2026-08-13T13:40:00-03:00',
      expiresAt: '2026-08-13T14:10:00-03:00',
    };

    expect(isReservationExpired(reservation, '2026-08-13T14:10:01-03:00')).toBe(true);
    expect(isReservationExpired(reservation, '2026-08-13T14:09:59-03:00')).toBe(false);
  });
});
