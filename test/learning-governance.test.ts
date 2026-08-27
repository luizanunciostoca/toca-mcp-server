import { describe, expect, it } from 'vitest';
import {
  assertRecommendationCannotGrantAuthority,
  createLearningRecommendation,
  decideLearningRecommendation,
  deriveLearningAdoptionMetrics,
} from '../src/governance/learning-governance.js';

const recommendation = () =>
  createLearningRecommendation(
    {
      tenantId: 'toca',
      targetType: 'PREAPPROVED_CLASS',
      targetKey: 'autonomy.preapproved.instagram-low-risk',
      currentValue: { status: 'DISABLED' },
      proposedValue: { status: 'ACTIVE', maxPostsPerDay: 1 },
      authorityImpact: 'INCREASE',
      hypothesis: 'A classe pode reduzir tempo de resposta mantendo escopo e volume estritos.',
      evidence: ['r31:window:2026-08-19/2026-08-26', 'shadow:agreement:1.0'],
      expiresAt: '2026-09-02T22:00:00Z',
    },
    { now: '2026-08-26T22:00:00Z', createId: () => 'rec-1' },
  );

describe('learning governance', () => {
  it('creates an evidence-bearing recommendation without mutating authority', () => {
    const value = recommendation();
    expect(value.status).toBe('RECOMMENDED');
    expect(value.authorityImpact).toBe('INCREASE');
    expect(value.decidedBy).toBeNull();
    expect(() => assertRecommendationCannotGrantAuthority(value)).toThrow(
      'LEARNING_AUTHORITY_INCREASE_REQUIRES_HUMAN_ADOPTION',
    );
  });

  it('allows adoption only by an evidence-bearing human decision', () => {
    const adopted = decideLearningRecommendation(recommendation(), {
      actorId: 'operator:governance-owner',
      actorType: 'HUMAN',
      decision: 'ADOPT',
      evidence: ['drive://decision/r31-rec-1'],
      decidedAt: '2026-08-27T10:00:00Z',
    });
    expect(adopted.status).toBe('ADOPTED');
    expect(adopted.decidedBy).toBe('operator:governance-owner');
    expect(() => assertRecommendationCannotGrantAuthority(adopted)).not.toThrow();
  });

  it('rejects system-authored decisions', () => {
    expect(() =>
      decideLearningRecommendation(recommendation(), {
        actorId: 'system:r31',
        actorType: 'SYSTEM' as never,
        decision: 'ADOPT',
        evidence: ['r31:auto-adopt'],
        decidedAt: '2026-08-27T10:00:00Z',
      }),
    ).toThrow('LEARNING_SELF_PROMOTION_FORBIDDEN');
  });

  it('calculates recommendation adoption rate only from decided recommendations', () => {
    const adopted = decideLearningRecommendation(recommendation(), {
      actorId: 'operator:one',
      actorType: 'HUMAN',
      decision: 'ADOPT',
      evidence: ['decision:adopt'],
      decidedAt: '2026-08-27T10:00:00Z',
    });
    const rejected = decideLearningRecommendation(
      { ...recommendation(), recommendationId: 'rec-2' },
      {
        actorId: 'operator:two',
        actorType: 'HUMAN',
        decision: 'REJECT',
        evidence: ['decision:reject'],
        decidedAt: '2026-08-27T10:00:00Z',
      },
    );
    expect(deriveLearningAdoptionMetrics([adopted, rejected, recommendation()])).toEqual({
      totalDecided: 2,
      adopted: 1,
      rejected: 1,
      adoptionRate: 0.5,
    });
  });
});
