import { describe, expect, it } from 'vitest';
import {
  applyPaidMediaCapacityGuardrail,
  assessOperationalCapacity,
  type CapacityPolicy,
} from '../src/measurement/capacity-intelligence.js';

const policy: CapacityPolicy = {
  watchOccupancyRatio: 0.75,
  nearCapacityRatio: 0.9,
  maxIncreaseAtWatchPercent: 10,
};

function assess(sold: number, capacity: number | null) {
  return assessOperationalCapacity(
    {
      eventId: 'event-1',
      capacity,
      sold,
      available: capacity === null ? null : Math.max(0, capacity - sold),
      held: 0,
      asOf: '2026-08-20T12:00:00-03:00',
      constraints: [],
      evidence: ['ticketing:snapshot-1'],
    },
    policy,
  );
}

describe('Operational capacity intelligence', () => {
  it('classifies open, watch, near-capacity and sold-out states with explicit policy thresholds', () => {
    expect(assess(50, 100).status).toBe('OPEN');
    expect(assess(80, 100).status).toBe('WATCH');
    expect(assess(95, 100).status).toBe('NEAR_CAPACITY');
    expect(assess(100, 100).status).toBe('SOLD_OUT');
  });

  it('fails positive media growth closed when capacity is unknown', () => {
    const decision = applyPaidMediaCapacityGuardrail({
      desiredChangePercent: 20,
      capacity: assess(20, null),
      policy,
    });

    expect(decision.allowedChangePercent).toBe(0);
    expect(decision.blocked).toBe(true);
    expect(decision.reason).toBe('CAPACITY_UNKNOWN_FAIL_CLOSED');
  });

  it('blocks positive growth near capacity while preserving safe decreases', () => {
    const capacity = assess(95, 100);
    const increase = applyPaidMediaCapacityGuardrail({
      desiredChangePercent: 20,
      capacity,
      policy,
    });
    const decrease = applyPaidMediaCapacityGuardrail({
      desiredChangePercent: -15,
      capacity,
      policy,
    });

    expect(increase.allowedChangePercent).toBe(0);
    expect(increase.blocked).toBe(true);
    expect(decrease.allowedChangePercent).toBe(-15);
    expect(decrease.blocked).toBe(false);
  });

  it('clamps positive growth in watch state to the configured maximum', () => {
    const decision = applyPaidMediaCapacityGuardrail({
      desiredChangePercent: 20,
      capacity: assess(80, 100),
      policy,
    });

    expect(decision.allowedChangePercent).toBe(10);
    expect(decision.blocked).toBe(true);
    expect(decision.reason).toBe('CAPACITY_WATCH_CLAMPS_GROWTH');
  });

  it('lets explicit operational constraints block growth even when ticket capacity is open', () => {
    const capacity = assessOperationalCapacity(
      {
        eventId: 'event-1',
        capacity: 100,
        sold: 20,
        available: 80,
        held: 0,
        asOf: '2026-08-20T12:00:00-03:00',
        constraints: [
          {
            constraintId: 'constraint-staffing',
            type: 'STAFFING',
            severity: 'CRITICAL',
            blocksGrowth: true,
            reason: 'Critical staffing limitation for this event window.',
            evidence: ['operations:constraint-staffing'],
          },
        ],
        evidence: ['ticketing:snapshot-1'],
      },
      policy,
    );

    expect(capacity.status).toBe('BLOCKED');
    expect(capacity.allowDemandGrowth).toBe(false);
    expect(
      applyPaidMediaCapacityGuardrail({ desiredChangePercent: 20, capacity, policy })
        .allowedChangePercent,
    ).toBe(0);
  });
});
