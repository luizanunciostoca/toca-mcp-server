import { describe, expect, it } from 'vitest';
import {
  applyHumanAutonomyDecision,
  assessAutonomyRollout,
  type ShadowDecisionRecord,
} from '../src/governance/autonomy-rollout.js';

const descriptorSha256 = 'a'.repeat(64);
const shadow = (count = 10): readonly ShadowDecisionRecord[] =>
  Array.from({ length: count }, (_, index) => ({
    decisionId: `shadow-${index + 1}`,
    capabilityId: 'instagram.publish.image',
    tenantId: 'toca',
    provider: 'Meta/Instagram',
    proposedDecision: 'REQUIRE_APPROVAL' as const,
    approvedDecision: 'REQUIRE_APPROVAL' as const,
    executed: false,
    divergence: 'NONE' as const,
    proposedDescriptorSha256: descriptorSha256,
    approvedDescriptorSha256: descriptorSha256,
    decidedAt: `2026-08-26T21:${String(index).padStart(2, '0')}:00Z`,
    evidence: [`shadow:decision:${index + 1}`],
  }));
const healthyOperational = {
  supervisedExternalActions: 5,
  verifiedExternalActions: 5,
  sloHealthy: true,
  providerCircuitClosed: true,
  readinessGreen: true,
  criticalIncidents: 0,
  evidence: ['canary:window:verified'],
};

describe('autonomy rollout', () => {
  it('recommends the next mode only after exact shadow agreement and verified canary actions', () => {
    const assessment = assessAutonomyRollout('SUPERVISED_AUTO', shadow(), healthyOperational);
    expect(assessment.promotable).toBe(true);
    expect(assessment.rollbackRequired).toBe(false);
    expect(assessment.recommendedMode).toBe('PREAPPROVED_AUTO');
    expect(assessment.shadowAgreementRatio).toBe(1);
  });

  it('holds when the sample is insufficient', () => {
    const assessment = assessAutonomyRollout('ASSISTED', shadow(9), healthyOperational);
    expect(assessment.promotable).toBe(false);
    expect(assessment.rollbackRequired).toBe(false);
    expect(assessment.recommendedMode).toBe('ASSISTED');
    expect(assessment.reasonCodes).toContain('SHADOW_SAMPLE_INSUFFICIENT');
  });

  it('requires automatic rollback on divergence, readback gap or unhealthy SLO', () => {
    const divergent = shadow().map((record, index) =>
      index === 0 ? { ...record, divergence: 'PAYLOAD' as const } : record,
    );
    const assessment = assessAutonomyRollout('PREAPPROVED_AUTO', divergent, {
      ...healthyOperational,
      verifiedExternalActions: 4,
      sloHealthy: false,
    });
    expect(assessment.rollbackRequired).toBe(true);
    expect(assessment.recommendedMode).toBe('SUPERVISED_AUTO');
    expect(assessment.reasonCodes).toEqual(
      expect.arrayContaining([
        'SHADOW_DIVERGENCE_DETECTED',
        'EXTERNAL_READBACK_GAP',
        'SLO_UNHEALTHY',
      ]),
    );
  });

  it('applies promotion only through an evidence-bearing human decision', () => {
    const assessment = assessAutonomyRollout('SUPERVISED_AUTO', shadow(), healthyOperational);
    expect(
      applyHumanAutonomyDecision(assessment, {
        actorId: 'operator:autonomy-owner',
        actorType: 'HUMAN',
        decision: 'PROMOTE',
        targetMode: 'PREAPPROVED_AUTO',
        decidedAt: '2026-08-26T22:00:00Z',
        evidence: ['drive://autonomy-decision/2026-08-26'],
      }),
    ).toBe('PREAPPROVED_AUTO');
  });

  it('rejects system-authored promotion and promotion during rollback conditions', () => {
    const promotable = assessAutonomyRollout('SUPERVISED_AUTO', shadow(), healthyOperational);
    expect(() =>
      applyHumanAutonomyDecision(promotable, {
        actorId: 'system:r31',
        actorType: 'SYSTEM' as never,
        decision: 'PROMOTE',
        targetMode: 'PREAPPROVED_AUTO',
        decidedAt: '2026-08-26T22:00:00Z',
        evidence: ['r31:recommendation'],
      }),
    ).toThrow('AUTONOMY_SELF_PROMOTION_FORBIDDEN');

    const rollback = assessAutonomyRollout('PREAPPROVED_AUTO', shadow(), {
      ...healthyOperational,
      providerCircuitClosed: false,
    });
    expect(() =>
      applyHumanAutonomyDecision(rollback, {
        actorId: 'operator:autonomy-owner',
        actorType: 'HUMAN',
        decision: 'PROMOTE',
        targetMode: 'PREAPPROVED_AUTO',
        decidedAt: '2026-08-26T22:00:00Z',
        evidence: ['operator:override-attempt'],
      }),
    ).toThrow('AUTONOMY_PROMOTION_NOT_READY');
  });
});
