import { describe, expect, it, vi } from 'vitest';
import type { MetaApiClient } from '../src/providers/meta/meta-api-client.js';
import {
  MORRO_DEMAND_WEIGHTS,
  MORRO_DE_SAO_PAULO_GEO_KEY,
  MORRO_DE_SAO_PAULO_TARGETING_SPEC,
  MetaAdsDemandIntelligenceService,
  calculateMorroDemandIndex,
  type MetaAdsGeoAudienceHistoryQuery,
  type MetaAdsGeoAudienceHistoryStore,
  type MetaAdsGeoAudienceSample,
  type MorroAudienceSignal,
} from '../src/providers/meta-ads/meta-ads-demand-intelligence.js';
import { MetaAdsReadProvider } from '../src/providers/meta-ads/meta-ads-read-provider.js';

class MemoryGeoAudienceHistoryStore implements MetaAdsGeoAudienceHistoryStore {
  readonly samples: MetaAdsGeoAudienceSample[] = [];

  append(sample: MetaAdsGeoAudienceSample): Promise<void> {
    if (
      !this.samples.some(
        (existing) =>
          existing.tenantId === sample.tenantId &&
          existing.adAccountId === sample.adAccountId &&
          existing.geoKey === sample.geoKey &&
          existing.observedAt === sample.observedAt,
      )
    ) {
      this.samples.push(sample);
    }
    return Promise.resolve();
  }

  listSince(query: MetaAdsGeoAudienceHistoryQuery): Promise<readonly MetaAdsGeoAudienceSample[]> {
    return Promise.resolve(
      this.samples
        .filter(
          (sample) =>
            sample.tenantId === query.tenantId &&
            sample.adAccountId === query.adAccountId &&
            sample.geoKey === query.geoKey &&
            Date.parse(sample.observedAt) >= Date.parse(query.since),
        )
        .sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt))
        .slice(0, query.limit ?? 1000),
    );
  }
}

describe('Meta Ads Morro demand intelligence', () => {
  it('reads Meta delivery estimate as audience bounds for the canonical Morro targeting', async () => {
    const get = vi.fn().mockResolvedValue({
      data: [
        {
          estimate_mau_lower_bound: 12_000,
          estimate_mau_upper_bound: 16_000,
          estimate_ready: true,
        },
      ],
    });
    const provider = new MetaAdsReadProvider({ get } as unknown as MetaApiClient);

    await expect(
      provider.getDeliveryEstimate(
        { adAccountId: '123', currency: 'BRL' },
        { optimizationGoal: 'REACH', targetingSpec: MORRO_DE_SAO_PAULO_TARGETING_SPEC },
      ),
    ).resolves.toEqual({
      lowerBound: 12_000,
      upperBound: 16_000,
      estimateReady: true,
      optimizationGoal: 'REACH',
      targetingSpec: MORRO_DE_SAO_PAULO_TARGETING_SPEC,
      source: 'META_DELIVERY_ESTIMATE',
    });
    expect(get).toHaveBeenCalledWith(
      'act_123/delivery_estimate',
      expect.objectContaining({
        fields: 'estimate_mau_lower_bound,estimate_mau_upper_bound,estimate_ready',
        optimization_goal: 'REACH',
        targeting_spec: JSON.stringify(MORRO_DE_SAO_PAULO_TARGETING_SPEC),
      }),
    );
  });

  it('keeps Meta audience estimates secondary and normalizes all demand weights to 100%', () => {
    const metaAudienceWeight =
      MORRO_DEMAND_WEIGHTS.audienceLevel +
      MORRO_DEMAND_WEIGHTS.trend24h +
      MORRO_DEMAND_WEIGHTS.trend7d;
    const totalWeight = Object.values(MORRO_DEMAND_WEIGHTS).reduce(
      (total, weight) => total + weight,
      0,
    );

    expect(totalWeight).toBeCloseTo(1, 10);
    expect(metaAudienceWeight).toBeCloseTo(0.2, 10);
    expect(MORRO_DEMAND_WEIGHTS.performance).toBeGreaterThan(metaAudienceWeight);
  });

  it('calculates a deterministic 0-100 demand index from audience, trends and operating context', () => {
    const audience: MorroAudienceSignal = {
      geoKey: MORRO_DE_SAO_PAULO_GEO_KEY,
      estimate: {
        lowerBound: 14_000,
        upperBound: 16_000,
        estimateReady: true,
        optimizationGoal: 'REACH',
        targetingSpec: MORRO_DE_SAO_PAULO_TARGETING_SPEC,
        source: 'META_DELIVERY_ESTIMATE',
      },
      midpoint: 15_000,
      sevenDayMedianMidpoint: 10_000,
      trend24hPercent: 30,
      trend7dPercent: 50,
      historySampleCount: 20,
      confidence: 1,
      observedAt: '2026-08-18T04:00:00.000Z',
    };

    const result = calculateMorroDemandIndex(audience, {
      performanceScore: 90,
      calendarEventScore: 80,
      seasonalityScore: 75,
      capacityScore: 80,
    });

    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(['HIGH', 'PEAK']).toContain(result.band);
    expect(result.components.performance).toBe(90);
    expect(result.components.audienceLevel).toBeGreaterThan(50);
  });

  it('persists history, derives 24h/7d trends and recommends budget without executing a write', async () => {
    const get = vi.fn().mockResolvedValue({
      data: [
        {
          estimate_mau_lower_bound: 14_000,
          estimate_mau_upper_bound: 16_000,
          estimate_ready: true,
        },
      ],
    });
    const provider = new MetaAdsReadProvider({ get } as unknown as MetaApiClient);
    const history = new MemoryGeoAudienceHistoryStore();
    const observedAt = '2026-08-18T04:00:00.000Z';
    history.samples.push(
      sample('2026-08-11T04:00:00.000Z', 9_000),
      sample('2026-08-14T04:00:00.000Z', 10_000),
      sample('2026-08-17T04:00:00.000Z', 11_000),
      sample('2026-08-17T16:00:00.000Z', 12_000),
    );
    const service = new MetaAdsDemandIntelligenceService(provider, history, {
      tenantId: 'toca-do-morcego',
      budgetPolicy: {
        currency: 'BRL',
        maxDailyBudgetMinor: 100_000,
        maxLifetimeBudgetMinor: 500_000,
        maxSingleIncreasePercent: 20,
      },
      maxRecommendationChangePercent: 20,
    });

    const recommendation = await service.recommendMorroBudget({
      account: { adAccountId: '123', currency: 'BRL' },
      observedAt,
      currentBudgetMinor: 10_000,
      performanceScore: 90,
      calendarEventScore: 85,
      seasonalityScore: 80,
      capacityScore: 90,
    });

    expect(recommendation.demandIndex.audience.trend24hPercent).toBeGreaterThan(0);
    expect(recommendation.demandIndex.audience.trend7dPercent).toBeGreaterThan(0);
    expect(recommendation.recommendedChangePercent).toBeGreaterThan(0);
    expect(recommendation.recommendedChangePercent).toBeLessThanOrEqual(20);
    expect(recommendation.guardrail).toEqual({ decision: 'ALLOW' });
    expect(recommendation.writeExecuted).toBe(false);
    expect(history.samples).toHaveLength(5);
  });

  it('caps budget adaptation at 10% until the audience signal has enough history', async () => {
    const get = vi.fn().mockResolvedValue({
      data: [
        {
          estimate_mau_lower_bound: 19_000,
          estimate_mau_upper_bound: 21_000,
          estimate_ready: true,
        },
      ],
    });
    const provider = new MetaAdsReadProvider({ get } as unknown as MetaApiClient);
    const service = new MetaAdsDemandIntelligenceService(
      provider,
      new MemoryGeoAudienceHistoryStore(),
      {
        tenantId: 'toca-do-morcego',
        budgetPolicy: {
          currency: 'BRL',
          maxDailyBudgetMinor: 100_000,
          maxLifetimeBudgetMinor: 500_000,
          maxSingleIncreasePercent: 20,
        },
      },
    );

    const recommendation = await service.recommendMorroBudget({
      account: { adAccountId: '123', currency: 'BRL' },
      observedAt: '2026-08-18T04:00:00.000Z',
      currentBudgetMinor: 10_000,
      performanceScore: 100,
      calendarEventScore: 100,
      seasonalityScore: 100,
      capacityScore: 100,
    });

    expect(recommendation.demandIndex.confidence).toBeLessThan(0.6);
    expect(recommendation.recommendedChangePercent).toBe(10);
    expect(recommendation.rationale).toContain('change_capped_by_low_signal_confidence');
    expect(recommendation.writeExecuted).toBe(false);
  });

  it('blocks scaling when campaign performance is weak even if demand is high', async () => {
    const get = vi.fn().mockResolvedValue({
      data: [
        {
          estimate_mau_lower_bound: 19_000,
          estimate_mau_upper_bound: 21_000,
          estimate_ready: true,
        },
      ],
    });
    const provider = new MetaAdsReadProvider({ get } as unknown as MetaApiClient);
    const history = new MemoryGeoAudienceHistoryStore();
    history.samples.push(
      sample('2026-08-11T04:00:00.000Z', 8_000),
      sample('2026-08-14T04:00:00.000Z', 9_000),
      sample('2026-08-17T04:00:00.000Z', 10_000),
    );
    const service = new MetaAdsDemandIntelligenceService(provider, history, {
      tenantId: 'toca-do-morcego',
      budgetPolicy: {
        currency: 'BRL',
        maxDailyBudgetMinor: 100_000,
        maxLifetimeBudgetMinor: 500_000,
        maxSingleIncreasePercent: 20,
      },
    });

    const recommendation = await service.recommendMorroBudget({
      account: { adAccountId: '123', currency: 'BRL' },
      observedAt: '2026-08-18T04:00:00.000Z',
      currentBudgetMinor: 10_000,
      performanceScore: 20,
      calendarEventScore: 100,
      seasonalityScore: 100,
      capacityScore: 100,
    });

    expect(recommendation.action).toBe('HOLD');
    expect(recommendation.recommendedChangePercent).toBe(0);
    expect(recommendation.rationale).toContain('increase_blocked_by_weak_performance');
    expect(recommendation.writeExecuted).toBe(false);
  });
});

function sample(observedAt: string, midpoint: number): MetaAdsGeoAudienceSample {
  return {
    tenantId: 'toca-do-morcego',
    adAccountId: '123',
    geoKey: MORRO_DE_SAO_PAULO_GEO_KEY,
    lowerBound: midpoint - 500,
    upperBound: midpoint + 500,
    midpoint,
    estimateReady: true,
    optimizationGoal: 'REACH',
    targetingSpec: MORRO_DE_SAO_PAULO_TARGETING_SPEC,
    observedAt,
  };
}
