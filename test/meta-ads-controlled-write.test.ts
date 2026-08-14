import { describe, expect, it, vi } from 'vitest';
import {
  MetaAdsControlledWriteService,
  requestSha256,
  type ControlledCreatePausedPlan,
  type MetaAdsWriteGuardrails,
} from '../src/providers/meta-ads/meta-ads-controlled-write.js';
import type { MetaAdsProvider } from '../src/providers/meta-ads/meta-ads-contracts.js';

const MORRO_LOCATION = {
  latitude: -13.3833,
  longitude: -38.9167,
  radius: 15,
  distance_unit: 'kilometer',
} as const;

const plan: ControlledCreatePausedPlan = {
  account: { adAccountId: '311793958882290', currency: 'BRL' },
  campaign: {
    name: 'TOCA | THE PARTY | 2026-08-15',
    objective: 'OUTCOME_SALES',
    specialAdCategories: [],
  },
  adSet: {
    name: 'Morro locality | Purchase',
    dailyBudgetMinor: 17_000,
    billingEvent: 'IMPRESSIONS',
    optimizationGoal: 'OFFSITE_CONVERSIONS',
    targeting: {
      geo_locations: {
        custom_locations: [MORRO_LOCATION],
      },
    },
    promotedObject: {
      pixel_id: '461233076843065',
      custom_event_type: 'PURCHASE',
    },
    startTime: '2026-08-14T00:00:00-03:00',
    endTime: '2026-08-16T06:00:00-03:00',
  },
  creatives: [
    {
      name: 'The Party 15-08 | Bar dobrado',
      pageId: '306103746115875',
      instagramActorId: '17841402033495654',
      objectStorySpec: { page_id: '306103746115875' },
    },
    {
      name: 'The Party 15-08 | Festa da ilha',
      pageId: '306103746115875',
      instagramActorId: '17841402033495654',
      objectStorySpec: { page_id: '306103746115875' },
    },
  ],
  ads: [
    { name: 'The Party 15-08 | Creative 01', creativeIndex: 0 },
    { name: 'The Party 15-08 | Creative 02', creativeIndex: 1 },
  ],
};

function guardrails(overrides: Partial<MetaAdsWriteGuardrails> = {}): MetaAdsWriteGuardrails {
  return {
    allowedAccountId: '311793958882290',
    allowedCurrency: 'BRL',
    maxDailyBudgetMinor: 100_000,
    allowedCustomLocations: [
      {
        latitude: -13.3833,
        longitude: -38.9167,
        maxRadius: 15,
        distanceUnit: 'kilometer',
      },
    ],
    allowedPixelId: '461233076843065',
    allowedPageId: '306103746115875',
    allowedInstagramActorId: '17841402033495654',
    approvedRequestSha256: '0'.repeat(64),
    ...overrides,
  };
}

function createProvider(existingCampaigns: readonly Readonly<Record<string, unknown>>[] = []) {
  const provider = {
    listCampaigns: vi.fn().mockResolvedValue(existingCampaigns),
    getInsights: vi.fn().mockResolvedValue([]),
    createCampaign: vi.fn().mockResolvedValue({ id: 'campaign-1' }),
    createAdSet: vi.fn().mockResolvedValue({ id: 'adset-1' }),
    createCreative: vi
      .fn()
      .mockResolvedValueOnce({ id: 'creative-1' })
      .mockResolvedValueOnce({ id: 'creative-2' }),
    createAd: vi.fn().mockResolvedValueOnce({ id: 'ad-1' }).mockResolvedValueOnce({ id: 'ad-2' }),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    updateBudget: vi.fn().mockResolvedValue(undefined),
  } satisfies MetaAdsProvider;
  return provider;
}

function withDailyBudget(dailyBudgetMinor: number): ControlledCreatePausedPlan {
  return { ...plan, adSet: { ...plan.adSet, dailyBudgetMinor } };
}

function withCustomLocation(overrides: Partial<typeof MORRO_LOCATION>): ControlledCreatePausedPlan {
  return {
    ...plan,
    adSet: {
      ...plan.adSet,
      targeting: {
        geo_locations: {
          custom_locations: [{ ...MORRO_LOCATION, ...overrides }],
        },
      },
    },
  };
}

function withPixel(pixelId: string): ControlledCreatePausedPlan {
  return {
    ...plan,
    adSet: {
      ...plan.adSet,
      promotedObject: { ...plan.adSet.promotedObject, pixel_id: pixelId },
    },
  };
}

describe('Meta Ads controlled create-paused service', () => {
  it('generates a stable deterministic approval hash without provider writes', () => {
    const provider = createProvider();
    const service = new MetaAdsControlledWriteService(provider, guardrails());
    const first = service.prepare(plan);
    const second = service.prepare(plan);
    expect(first.requestSha256).toBe(second.requestSha256);
    expect(first.requestSha256).toBe(requestSha256(plan));
    expect(first.status).toBe('VALIDATED_PAUSED_ONLY');
    expect(provider.createCampaign).not.toHaveBeenCalled();
  });

  it('fails closed for an unauthorized account', () => {
    const service = new MetaAdsControlledWriteService(createProvider(), guardrails());
    expect(() =>
      service.prepare({ ...plan, account: { ...plan.account, adAccountId: 'other-account' } }),
    ).toThrow('META_ADS_ACCOUNT_NOT_ALLOWED');
  });

  it('blocks daily budget above the hard account ceiling', () => {
    const service = new MetaAdsControlledWriteService(createProvider(), guardrails());
    expect(() => service.prepare(withDailyBudget(100_001))).toThrow(
      'META_ADS_DAILY_BUDGET_EXCEEDS_GUARDRAIL',
    );
  });

  it('accepts only the approved Morro custom-location center within the maximum radius', () => {
    const service = new MetaAdsControlledWriteService(createProvider(), guardrails());
    expect(() => service.prepare(plan)).not.toThrow();
    expect(() => service.prepare(withCustomLocation({ radius: 16 }))).toThrow(
      'META_ADS_CUSTOM_LOCATION_NOT_ALLOWED',
    );
    expect(() => service.prepare(withCustomLocation({ latitude: -13.3 }))).toThrow(
      'META_ADS_CUSTOM_LOCATION_NOT_ALLOWED',
    );
  });

  it('blocks broader country or region targeting', () => {
    const service = new MetaAdsControlledWriteService(createProvider(), guardrails());
    expect(() =>
      service.prepare({
        ...plan,
        adSet: {
          ...plan.adSet,
          targeting: { geo_locations: { countries: ['BR'] } },
        },
      }),
    ).toThrow('META_ADS_GEO_SCOPE_NOT_ALLOWED');
    expect(() =>
      service.prepare({
        ...plan,
        adSet: {
          ...plan.adSet,
          targeting: { geo_locations: { regions: [{ key: 'BA' }] } },
        },
      }),
    ).toThrow('META_ADS_GEO_SCOPE_NOT_ALLOWED');
  });

  it('keeps explicit allowlisted city-key support without allowing mixed geo modes', () => {
    const cityPlan: ControlledCreatePausedPlan = {
      ...plan,
      adSet: {
        ...plan.adSet,
        targeting: { geo_locations: { cities: [{ key: 'APPROVED_CITY' }] } },
      },
    };
    const service = new MetaAdsControlledWriteService(
      createProvider(),
      guardrails({ allowedGeoKeys: ['APPROVED_CITY'] }),
    );
    expect(() => service.prepare(cityPlan)).not.toThrow();
    expect(() =>
      service.prepare({
        ...cityPlan,
        adSet: {
          ...cityPlan.adSet,
          targeting: {
            geo_locations: {
              cities: [{ key: 'APPROVED_CITY' }],
              custom_locations: [MORRO_LOCATION],
            },
          },
        },
      }),
    ).toThrow('META_ADS_GEO_SCOPE_NOT_ALLOWED');
  });

  it('blocks a pixel other than the approved ticketing pixel', () => {
    const service = new MetaAdsControlledWriteService(createProvider(), guardrails());
    expect(() => service.prepare(withPixel('999'))).toThrow('META_ADS_PIXEL_NOT_ALLOWED');
  });

  it('rejects creation when the explicit approval hash does not match', async () => {
    const provider = createProvider();
    const service = new MetaAdsControlledWriteService(provider, guardrails());
    await expect(service.createPaused(plan, 'f'.repeat(64))).rejects.toThrow(
      'META_ADS_APPROVAL_SHA256_MISMATCH',
    );
    expect(provider.createCampaign).not.toHaveBeenCalled();
  });

  it('rejects a duplicate campaign name before creating anything', async () => {
    const approval = requestSha256(plan);
    const provider = createProvider([{ name: plan.campaign.name }]);
    const service = new MetaAdsControlledWriteService(
      provider,
      guardrails({ approvedRequestSha256: approval }),
    );
    await expect(service.createPaused(plan, approval)).rejects.toThrow(
      'META_ADS_DUPLICATE_CAMPAIGN_NAME',
    );
    expect(provider.createCampaign).not.toHaveBeenCalled();
  });

  it('creates campaign, ad set, creatives and ads only as PAUSED', async () => {
    const approval = requestSha256(plan);
    const provider = createProvider();
    const service = new MetaAdsControlledWriteService(
      provider,
      guardrails({ approvedRequestSha256: approval }),
    );
    const result = await service.createPaused(plan, approval);
    expect(result).toEqual({
      requestSha256: approval,
      campaignId: 'campaign-1',
      adSetId: 'adset-1',
      creativeIds: ['creative-1', 'creative-2'],
      adIds: ['ad-1', 'ad-2'],
      status: 'PAUSED',
    });
    expect(provider.createCampaign).toHaveBeenCalledWith(
      plan.account,
      expect.objectContaining({ status: 'PAUSED' }),
    );
    expect(provider.createAdSet).toHaveBeenCalledWith(
      plan.account,
      expect.objectContaining({
        status: 'PAUSED',
        dailyBudgetMinor: 17_000,
        promotedObject: {
          pixel_id: '461233076843065',
          custom_event_type: 'PURCHASE',
        },
      }),
    );
    expect(provider.createAd).toHaveBeenCalledTimes(2);
    expect(provider.createAd).toHaveBeenNthCalledWith(
      1,
      plan.account,
      expect.objectContaining({ status: 'PAUSED' }),
    );
    expect(provider.createAd).toHaveBeenNthCalledWith(
      2,
      plan.account,
      expect.objectContaining({ status: 'PAUSED' }),
    );
    expect(provider.updateStatus).not.toHaveBeenCalled();
    expect(provider.updateBudget).not.toHaveBeenCalled();
  });
});
