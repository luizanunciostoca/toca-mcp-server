import { describe, expect, it } from 'vitest';
import {
  assertSalesPipelineTransition,
  calculateInitialSla,
  evaluateContactMerge,
  recommendQualification,
  resolveNextBestAction,
  routeLeadDeterministically,
  scoreLeadDeterministically,
} from '../src/crm/sales-engine.js';

describe('CRM Sales Engine deterministic rules', () => {
  it('scores deterministically and limits AI to a complementary weight', () => {
    const deterministic = scoreLeadDeterministically({
      intentStrength: 4,
      urgency: 'IMMEDIATE',
      propensity: 0.9,
      estimatedValueMinor: 500_000,
      visitEventAt: '2026-08-21T18:00:00.000Z',
      now: '2026-08-20T12:00:00.000Z',
      engagementSignals: 5,
    });
    const withLowAi = scoreLeadDeterministically({
      intentStrength: 4,
      urgency: 'IMMEDIATE',
      propensity: 0.9,
      estimatedValueMinor: 500_000,
      visitEventAt: '2026-08-21T18:00:00.000Z',
      now: '2026-08-20T12:00:00.000Z',
      engagementSignals: 5,
      aiScore: 0,
    });

    expect(deterministic.deterministicScore).toBeGreaterThanOrEqual(90);
    expect(deterministic.temperature).toBe('HOT');
    expect(withLowAi.effectiveScore).toBeGreaterThanOrEqual(75);
    expect(withLowAi.effectiveScore).toBeLessThan(deterministic.effectiveScore);
  });

  it('never lets AI alone qualify a weak deterministic lead', () => {
    const scoring = scoreLeadDeterministically({
      intentStrength: 0,
      urgency: 'LOW',
      propensity: 0,
      now: '2026-08-20T12:00:00.000Z',
      aiScore: 100,
    });
    const recommendation = recommendQualification({
      scoring,
      hasVerifiedContactPath: true,
      explicitOptOut: false,
    });

    expect(scoring.deterministicScore).toBeLessThan(35);
    expect(recommendation.outcome).toBe('NURTURE');
    expect(recommendation.authority).toBe('DETERMINISTIC');
  });

  it('fails closed to review without a verified contact path', () => {
    const scoring = scoreLeadDeterministically({
      intentStrength: 4,
      urgency: 'HIGH',
      propensity: 1,
      now: '2026-08-20T12:00:00.000Z',
    });
    expect(
      recommendQualification({
        scoring,
        hasVerifiedContactPath: false,
        explicitOptOut: false,
      }).outcome,
    ).toBe('REVIEW');
  });

  it('enforces the canonical pipeline graph', () => {
    expect(() => assertSalesPipelineTransition('NEW', 'CONTACTED')).not.toThrow();
    expect(() => assertSalesPipelineTransition('CONTACTED', 'QUALIFIED')).not.toThrow();
    expect(() => assertSalesPipelineTransition('QUALIFIED', 'OPPORTUNITY')).not.toThrow();
    expect(() => assertSalesPipelineTransition('OPPORTUNITY', 'WON')).not.toThrow();
    expect(() => assertSalesPipelineTransition('OPPORTUNITY', 'LOST')).not.toThrow();
    expect(() => assertSalesPipelineTransition('NEW', 'WON')).toThrow(
      'CRM_SALES_STAGE_TRANSITION_INVALID:NEW->WON',
    );
  });

  it('routes ownership stably and honors an eligible preferred owner', () => {
    const first = routeLeadDeterministically({
      leadId: 'lead-42',
      eligibleOwnerPrincipalIds: ['agent-b', 'agent-a', 'agent-c'],
    });
    const replay = routeLeadDeterministically({
      leadId: 'lead-42',
      eligibleOwnerPrincipalIds: ['agent-c', 'agent-a', 'agent-b'],
    });
    const preferred = routeLeadDeterministically({
      leadId: 'lead-42',
      eligibleOwnerPrincipalIds: ['agent-a', 'agent-b'],
      preferredOwnerPrincipalId: 'agent-b',
    });

    expect(replay).toEqual(first);
    expect(preferred.ownerPrincipalId).toBe('agent-b');
    expect(preferred.routingRule).toBe('preferred-owner-v1');
  });

  it('requires deterministic identity evidence before auto-merge', () => {
    expect(
      evaluateContactMerge({
        exactNormalizedChannelMatch: true,
        verifiedChannelMatch: false,
        sameScope: true,
        explicitHumanApproval: false,
      }).allowed,
    ).toBe(false);
    expect(
      evaluateContactMerge({
        exactNormalizedChannelMatch: true,
        verifiedChannelMatch: true,
        sameScope: true,
        explicitHumanApproval: false,
      }),
    ).toMatchObject({ allowed: true, confidence: 1 });
    expect(
      evaluateContactMerge({
        exactNormalizedChannelMatch: true,
        verifiedChannelMatch: true,
        sameScope: false,
        explicitHumanApproval: true,
      }).allowed,
    ).toBe(false);
  });

  it('selects governed next-best-actions for handoff, reactivation and post-sale', () => {
    expect(
      resolveNextBestAction({
        stage: 'CONTACTED',
        temperature: 'HOT',
        noResponseCount: 0,
        hasOpenOpportunity: false,
        conversationAbandoned: false,
        humanHandoffRequested: true,
      }).actionType,
    ).toBe('HUMAN_HANDOFF');
    expect(
      resolveNextBestAction({
        stage: 'CONTACTED',
        temperature: 'WARM',
        noResponseCount: 3,
        hasOpenOpportunity: false,
        conversationAbandoned: false,
        humanHandoffRequested: false,
      }).actionType,
    ).toBe('REACTIVATE');
    expect(
      resolveNextBestAction({
        stage: 'WON',
        temperature: 'HOT',
        noResponseCount: 0,
        hasOpenOpportunity: false,
        conversationAbandoned: false,
        humanHandoffRequested: false,
      }).actionType,
    ).toBe('POST_SALE');
  });

  it('derives first-response and reactivation SLA from temperature', () => {
    const hot = calculateInitialSla('2026-08-20T12:00:00.000Z', 'HOT');
    const cold = calculateInitialSla('2026-08-20T12:00:00.000Z', 'COLD');
    expect(hot.firstResponseDueAt).toBe('2026-08-20T12:15:00.000Z');
    expect(cold.firstResponseDueAt).toBe('2026-08-20T16:00:00.000Z');
    expect(hot.reactivationDueAt).toBe('2026-08-27T12:00:00.000Z');
  });
});
