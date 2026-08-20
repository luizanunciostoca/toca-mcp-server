import { describe, expect, it } from 'vitest';
import {
  allocateBudget,
  assessPaidMediaPerformance,
  buildPaidMediaName,
  googleAdsAutopilotReadiness,
  planCreativeRotation,
  planExperiment,
} from '../src/paid-media/decision-engine.js';

describe('paid media decision engine', () => {
  it('plans experiments without side effects and preserves exact budget', () => {
    const plan = planExperiment({
      experimentId: 'exp-creative-01',
      hypothesisId: 'hyp-01',
      hypothesis: 'A fresh creative improves CPA without changing audience.',
      primaryMetric: 'CPA',
      controlId: 'control',
      variantIds: ['v1', 'v2'],
      totalBudgetMinor: 10_001,
      minimumBudgetPerArmMinor: 1_000,
      immutableDimension: 'CREATIVE',
    });

    expect(plan.sideEffects).toBe(false);
    expect(plan.approvalRequiredForActivation).toBe(true);
    expect(plan.arms.reduce((sum, arm) => sum + arm.allocationMinor, 0)).toBe(10_001);
  });

  it('builds deterministic provider-aware names', () => {
    expect(
      buildPaidMediaName({
        provider: 'META_ADS',
        brand: 'Toca do Morcego',
        objective: 'Vendas',
        audience: 'Turistas Bahia',
        geo: 'Morro de São Paulo',
        dateKey: '2026-08-20',
        experimentId: 'exp 01',
        variant: 'A',
      }),
    ).toBe(
      'META__TOCA-DO-MORCEGO__VENDAS__TURISTAS-BAHIA__MORRO-DE-SAO-PAULO__2026-08-20__EXP-EXP-01__VAR-A',
    );
  });

  it('detects comparable fatigue from frequency plus deteriorating CTR', () => {
    const assessment = assessPaidMediaPerformance({
      current: {
        window: 'last-7d',
        impressions: 6_000,
        reach: 1_500,
        clicks: 120,
        spendMinor: 120_000,
        conversions: 20,
        leads: 30,
        revenueMinor: 240_000,
      },
      baseline: {
        window: 'previous-7d',
        impressions: 6_000,
        reach: 3_000,
        clicks: 240,
        spendMinor: 100_000,
        conversions: 25,
        leads: 40,
        revenueMinor: 300_000,
      },
      targets: {
        maxCpaMinor: 6_500,
        maxCplMinor: 4_500,
        minRoas: 1.5,
        maxFrequency: 3,
        minimumImpressions: 1_000,
      },
      capacity: {
        providerBacked: true,
        capacity: 500,
        sold: 100,
        evidence: ['ticketing:inventory:req-1'],
      },
    });

    expect(assessment.fatigue.fatigued).toBe(true);
    expect(assessment.recommendation).toBe('ROTATE_CREATIVE');
    expect(assessment.anomalies.some((item) => item.metric === 'CTR')).toBe(true);
  });

  it('never scales without provider-backed attribution and capacity', () => {
    const assessment = assessPaidMediaPerformance({
      current: {
        window: 'last-7d',
        impressions: 10_000,
        reach: 5_000,
        clicks: 500,
        spendMinor: 100_000,
        conversions: 100,
        leads: 120,
        revenueMinor: 500_000,
      },
      targets: { maxCpaMinor: 2_000, maxCplMinor: 1_500, minRoas: 3 },
      attribution: { providerBacked: false, evidence: ['attribution:derived-only'] },
      capacity: {
        providerBacked: true,
        capacity: 500,
        sold: 100,
        evidence: ['ticketing:inventory:req-2'],
      },
    });

    expect(assessment.recommendation).not.toBe('SCALE_RECOMMENDED');
    expect(assessment.reasons).toContain('ATTRIBUTION_NOT_PROVIDER_BACKED');
  });

  it('allocates budgets deterministically and blocks exhausted capacity', () => {
    const allocations = allocateBudget({
      totalBudgetMinor: 10_000,
      minimumAllocationMinor: 1_000,
      candidates: [
        {
          id: 'sunset',
          weight: 1,
          demand: { providerBacked: true, demandScore: 0.8, evidence: ['demand:req-1'] },
          capacity: {
            providerBacked: true,
            capacity: 500,
            sold: 100,
            evidence: ['capacity:req-1'],
          },
        },
        {
          id: 'party',
          weight: 2,
          capacity: {
            providerBacked: true,
            capacity: 100,
            sold: 100,
            evidence: ['capacity:req-2'],
          },
        },
      ],
    });

    expect(allocations.reduce((sum, item) => sum + item.allocationMinor, 0)).toBe(10_000);
    expect(allocations.find((item) => item.id === 'party')?.allocationMinor).toBe(0);
    expect(allocations.find((item) => item.id === 'party')?.blockers).toContain(
      'CAPACITY_EXHAUSTED',
    );
  });

  it('requires a hypothesis before rotating a fatigued creative', () => {
    const result = planCreativeRotation([
      {
        creativeId: 'creative-1',
        fatigue: {
          fatigued: true,
          comparableEvidence: true,
          reasons: ['FREQUENCY_ABOVE_GUARD', 'CTR_DETERIORATION'],
        },
      },
    ]);

    expect(result.rotate).toHaveLength(0);
    expect(result.blocked).toEqual(['creative-1:HYPOTHESIS_REQUIRED']);
  });

  it('fails closed for Google Ads autopilot until CRM and attribution are provider-backed', () => {
    expect(
      googleAdsAutopilotReadiness({
        accountVerified: true,
        crmProviderBacked: false,
        attributionProviderBacked: false,
        evidence: ['google-ads:account:verified'],
      }),
    ).toEqual({
      eligible: false,
      blockers: ['CRM_NOT_PROVIDER_BACKED', 'ATTRIBUTION_NOT_PROVIDER_BACKED'],
      evidence: ['google-ads:account:verified'],
    });
  });
});
