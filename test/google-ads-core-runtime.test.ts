import { describe, expect, it } from 'vitest';
import { createRuntimeCapabilityResolver } from '../src/mcp/runtime-capability-resolver.js';
import type { GoogleAdsApiClient } from '../src/providers/google-ads/google-ads-api-client.js';
import { GoogleAdsPaidMediaProvider } from '../src/providers/google-ads/google-ads-paid-media.js';

const CUSTOMER_ID = '1234567890';
const GOOGLE_ADS_CAPABILITIES = [
  'google_ads.account.inspect',
  'google_ads.campaigns.list',
  'google_ads.insights.get',
  'google_ads.conversion_actions.list',
  'google_ads.campaign.prepare',
  'google_ads.campaign.create_paused',
  'google_ads.campaign.readback',
  'google_ads.campaign.activate',
  'google_ads.campaign.pause',
  'google_ads.campaign.update_budget',
  'google_ads.targeting.validate',
  'google_ads.spend.monitor',
  'google_ads.conversions.monitor',
] as const;

class FakeGoogleAdsApi implements GoogleAdsApiClient {
  mutateCalls = 0;

  async listAccessibleCustomers(): ReturnType<GoogleAdsApiClient['listAccessibleCustomers']> {
    await Promise.resolve();
    return { body: { resourceNames: [`customers/${CUSTOMER_ID}`] } };
  }

  async search(query: string): ReturnType<GoogleAdsApiClient['search']> {
    await Promise.resolve();
    if (query.includes('campaign.campaign_budget')) {
      return {
        body: {
          results: [
            {
              campaign: {
                id: '42',
                resourceName: `customers/${CUSTOMER_ID}/campaigns/42`,
                name: 'R28 test campaign',
                status: 'PAUSED',
                campaignBudget: `customers/${CUSTOMER_ID}/campaignBudgets/84`,
              },
              campaignBudget: { amountMicros: '5000000' },
            },
          ],
        },
      };
    }
    return { body: { results: [] } };
  }

  async mutate(
    path: string,
    body: Record<string, unknown>,
  ): ReturnType<GoogleAdsApiClient['mutate']> {
    await Promise.resolve();
    void path;
    void body;
    this.mutateCalls += 1;
    return { body: {} };
  }
}

function provider(api = new FakeGoogleAdsApi()) {
  return {
    api,
    provider: new GoogleAdsPaidMediaProvider(api, {
      allowedCustomerId: CUSTOMER_ID,
      allowedCurrency: 'BRL',
      maxDailyBudgetMicros: 10_000_000,
      currencyMinorUnitMicros: 10_000,
      allowedLocationCriterionIds: ['2076'],
      allowedLanguageCriterionIds: ['1014'],
      allowedAdvertisingChannelTypes: ['SEARCH'],
    }),
  };
}

describe('R28 Google Ads TOCA Core runtime integration', () => {
  it('resolves all 13 Google Ads capabilities internally against the fixed provider account', () => {
    const { provider: googleAds } = provider();
    const resolver = createRuntimeCapabilityResolver({
      googleAds,
      googleAdsTargetAccount: CUSTOMER_ID,
      googleAdsCurrency: 'BRL',
    });

    for (const capabilityId of GOOGLE_ADS_CAPABILITIES) {
      const binding = resolver(capabilityId);
      expect(binding, capabilityId).toBeDefined();
      expect(binding?.targetAccount?.({}), capabilityId).toBe(CUSTOMER_ID);
    }
  });

  it('fails closed when the provider exists without fixed account/currency runtime binding', () => {
    const { provider: googleAds } = provider();
    const resolverWithoutAccount = createRuntimeCapabilityResolver({
      googleAds,
      googleAdsCurrency: 'BRL',
    });
    const resolverWithoutCurrency = createRuntimeCapabilityResolver({
      googleAds,
      googleAdsTargetAccount: CUSTOMER_ID,
    });

    expect(resolverWithoutAccount('google_ads.account.inspect')).toBeUndefined();
    expect(resolverWithoutCurrency('google_ads.account.inspect')).toBeUndefined();
  });

  it('keeps every Google Ads side effect runtime-unvalidated until provider evidence promotes it', () => {
    const { provider: googleAds } = provider();
    const resolver = createRuntimeCapabilityResolver({
      googleAds,
      googleAdsTargetAccount: CUSTOMER_ID,
      googleAdsCurrency: 'BRL',
    });

    for (const capabilityId of [
      'google_ads.campaign.create_paused',
      'google_ads.campaign.activate',
      'google_ads.campaign.pause',
      'google_ads.campaign.update_budget',
    ]) {
      expect(resolver(capabilityId)?.sideEffectValidated, capabilityId).toBe(false);
    }
  });

  it('rejects activation on budget drift before issuing any provider mutation', async () => {
    const { api, provider: googleAds } = provider();
    const resolver = createRuntimeCapabilityResolver({
      googleAds,
      googleAdsTargetAccount: CUSTOMER_ID,
      googleAdsCurrency: 'BRL',
    });
    const binding = resolver('google_ads.campaign.activate');
    expect(binding).toBeDefined();

    await expect(
      binding!.execute({ campaignId: '42', expectedDailyBudgetMicros: 6_000_000 }),
    ).rejects.toThrow('GOOGLE_ADS_ACTIVATION_BUDGET_DRIFT');
    expect(api.mutateCalls).toBe(0);
  });
});
