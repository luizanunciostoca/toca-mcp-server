import { describe, expect, it } from 'vitest';
import type { GoogleAdsApiClient } from '../src/providers/google-ads/google-ads-api-client.js';
import {
  GoogleAdsPaidMediaProvider,
  type GoogleAdsCampaignPlan,
} from '../src/providers/google-ads/google-ads-paid-media.js';
import { createToolRegistry } from '../src/registry.js';

const plan: GoogleAdsCampaignPlan = {
  customerId: '1234567890',
  currencyCode: 'BRL',
  campaignName: 'TOCA Search Test',
  budgetName: 'TOCA Search Budget Test',
  dailyBudgetMicros: 50_000_000,
  advertisingChannelType: 'SEARCH',
  targeting: {
    locationCriterionIds: ['2076'],
    languageCriterionIds: ['1014'],
    presenceOnly: true,
  },
};

class FakeGoogleAdsApi implements GoogleAdsApiClient {
  readonly mutations: Array<{ path: string; body: Record<string, unknown> }> = [];

  async listAccessibleCustomers() {
    await Promise.resolve();
    return { body: { resourceNames: ['customers/1234567890'] }, requestId: 'req-access' };
  }

  async search(query: string) {
    await Promise.resolve();
    if (query.includes('customer.id')) {
      return {
        body: {
          results: [
            {
              customer: {
                id: '1234567890',
                descriptiveName: 'TOCA Test',
                currencyCode: 'BRL',
                testAccount: true,
              },
            },
          ],
        },
        requestId: 'req-account',
      };
    }
    return {
      body: {
        results: [
          {
            campaign: {
              id: '456',
              resourceName: 'customers/1234567890/campaigns/456',
              name: 'TOCA Search Test',
              status: 'PAUSED',
              campaignBudget: 'customers/1234567890/campaignBudgets/789',
            },
            campaignBudget: {
              resourceName: 'customers/1234567890/campaignBudgets/789',
              amountMicros: '50000000',
            },
          },
        ],
      },
      requestId: 'req-search',
    };
  }

  async mutate(path: string, body: Record<string, unknown>) {
    await Promise.resolve();
    this.mutations.push({ path, body });
    return {
      body: {
        mutateOperationResponses: [
          {
            campaignBudgetResult: {
              resourceName: 'customers/1234567890/campaignBudgets/789',
            },
          },
          {
            campaignResult: {
              resourceName: 'customers/1234567890/campaigns/456',
            },
          },
        ],
      },
      requestId: 'req-mutate',
    };
  }
}

function createProvider(
  api: GoogleAdsApiClient & {
    mutations: Array<{ path: string; body: Record<string, unknown> }>;
  } = new FakeGoogleAdsApi(),
) {
  return {
    api,
    provider: new GoogleAdsPaidMediaProvider(api, {
      allowedCustomerId: '1234567890',
      allowedCurrency: 'BRL',
      maxDailyBudgetMicros: 100_000_000,
      currencyMinorUnitMicros: 10_000,
      allowedLocationCriterionIds: ['2076'],
      allowedLanguageCriterionIds: ['1014'],
      allowedAdvertisingChannelTypes: ['SEARCH'],
    }),
  };
}

describe('Google Ads R28 paid media provider', () => {
  it('prepares a deterministic PAUSED-only request without calling the provider', () => {
    const { api, provider } = createProvider();

    const first = provider.prepare(plan);
    const second = provider.prepare({ ...plan });

    expect(first.status).toBe('VALIDATED_PAUSED_ONLY');
    expect(first.requestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(second.requestSha256).toBe(first.requestSha256);
    expect(api.mutations).toHaveLength(0);
  });

  it('validates targeting through validateOnly and never creates an enabled campaign', async () => {
    const { api, provider } = createProvider();

    const output = await provider.validateTargeting(plan);

    expect(output).toMatchObject({ valid: true, sideEffects: false });
    expect(api.mutations).toHaveLength(1);
    const request = api.mutations[0];
    expect(request?.path).toBe('/customers/1234567890/googleAds:mutate');
    expect(request?.body.validateOnly).toBe(true);
    const operations = request?.body.mutateOperations as Array<Record<string, unknown>>;
    const campaignOperation = operations[1]?.campaignOperation as Record<string, unknown>;
    expect(campaignOperation.create).toMatchObject({ status: 'PAUSED' });
  });

  it('creates only a PAUSED campaign and exposes the exact target-account resource name for read-back', async () => {
    const { api, provider } = createProvider();

    const output = await provider.createPaused(plan);

    expect(api.mutations).toHaveLength(1);
    expect(api.mutations[0]?.body.validateOnly).toBe(false);
    expect(output).toMatchObject({
      expectedCampaignStatus: 'PAUSED',
      campaignResourceName: 'customers/1234567890/campaigns/456',
    });
  });

  it('rejects a create response whose campaign resource belongs to another customer', async () => {
    class CrossAccountCreateApi extends FakeGoogleAdsApi {
      override async mutate(path: string, body: Record<string, unknown>) {
        await Promise.resolve();
        this.mutations.push({ path, body });
        return {
          body: {
            mutateOperationResponses: [
              {
                campaignResult: {
                  resourceName: 'customers/9999999999/campaigns/456',
                },
              },
            ],
          },
          requestId: 'req-cross-account',
        };
      }
    }
    const { provider } = createProvider(new CrossAccountCreateApi());

    await expect(provider.createPaused(plan)).rejects.toThrow(
      'GOOGLE_ADS_CAMPAIGN_RESOURCE_BOUNDARY_VIOLATION',
    );
  });

  it('rejects provider read-back when the returned campaign is outside the target account', async () => {
    class CrossAccountReadbackApi extends FakeGoogleAdsApi {
      override async search(query: string) {
        await Promise.resolve();
        if (query.includes('customer.id')) return super.search(query);
        return {
          body: {
            results: [
              {
                campaign: {
                  id: '456',
                  resourceName: 'customers/9999999999/campaigns/456',
                  name: 'Cross Account Campaign',
                  status: 'PAUSED',
                  campaignBudget: 'customers/9999999999/campaignBudgets/789',
                },
                campaignBudget: {
                  resourceName: 'customers/9999999999/campaignBudgets/789',
                  amountMicros: '17000000',
                },
              },
            ],
          },
          requestId: 'req-cross-readback',
        };
      }
    }
    const { provider } = createProvider(new CrossAccountReadbackApi());

    await expect(provider.readbackCampaign('456')).rejects.toThrow(
      'GOOGLE_ADS_CAMPAIGN_RESOURCE_BOUNDARY_VIOLATION',
    );
    await expect(provider.readbackCampaign('customers/9999999999/campaigns/456')).rejects.toThrow(
      'GOOGLE_ADS_CAMPAIGN_RESOURCE_BOUNDARY_VIOLATION',
    );
  });

  it('enforces account, currency, location and financial ceilings before any write', () => {
    const { api, provider } = createProvider();

    expect(() => provider.prepare({ ...plan, customerId: '9999999999' })).toThrow(
      'GOOGLE_ADS_CUSTOMER_GUARDRAIL_BLOCKED',
    );
    expect(() => provider.prepare({ ...plan, currencyCode: 'USD' })).toThrow(
      'GOOGLE_ADS_CURRENCY_GUARDRAIL_BLOCKED',
    );
    expect(() =>
      provider.prepare({
        ...plan,
        targeting: { ...plan.targeting, locationCriterionIds: ['9999'] },
      }),
    ).toThrow('GOOGLE_ADS_LOCATION_GUARDRAIL_BLOCKED');
    expect(() => provider.prepare({ ...plan, dailyBudgetMicros: 100_000_001 })).toThrow(
      'GOOGLE_ADS_BUDGET_CEILING_EXCEEDED',
    );
    expect(api.mutations).toHaveLength(0);
  });

  it('converts provider micros to approval minor units and requires a PAUSED readback before activation', async () => {
    const { api, provider } = createProvider();

    expect(provider.minorUnitsForMicros(50_000_000)).toBe(5_000);
    await provider.activateCampaign('456');

    expect(api.mutations).toHaveLength(1);
    expect(api.mutations[0]?.path).toBe('/customers/1234567890/campaigns:mutate');
    const operations = api.mutations[0]?.body.operations as Array<Record<string, unknown>>;
    expect(operations[0]?.update).toMatchObject({ status: 'ENABLED' });
  });

  it('fails closed before activation when readback does not prove the campaign is PAUSED', async () => {
    class EnabledReadbackApi extends FakeGoogleAdsApi {
      override async search(query: string) {
        await Promise.resolve();
        const result = await super.search(query);
        const first = result.body.results?.[0] as Record<string, unknown> | undefined;
        const campaign = first?.campaign as Record<string, unknown> | undefined;
        if (campaign) campaign.status = 'ENABLED';
        return result;
      }
    }
    const api = new EnabledReadbackApi();
    const { provider } = createProvider(api);

    await expect(provider.activateCampaign('456')).rejects.toThrow(
      'GOOGLE_ADS_ACTIVATION_REQUIRES_PAUSED_READBACK',
    );
    expect(api.mutations).toHaveLength(0);
  });

  it('rejects a budget resource returned from another customer before mutating it', async () => {
    class CrossAccountBudgetApi extends FakeGoogleAdsApi {
      override async search(query: string) {
        await Promise.resolve();
        const result = await super.search(query);
        const first = result.body.results?.[0] as Record<string, unknown> | undefined;
        const campaign = first?.campaign as Record<string, unknown> | undefined;
        if (campaign) campaign.campaignBudget = 'customers/9999999999/campaignBudgets/789';
        return result;
      }
    }
    const api = new CrossAccountBudgetApi();
    const { provider } = createProvider(api);

    await expect(provider.updateBudget('456', 50_000_000)).rejects.toThrow(
      'GOOGLE_ADS_BUDGET_RESOURCE_BOUNDARY_VIOLATION',
    );
    expect(api.mutations).toHaveLength(0);
  });
});

describe('Google Ads R28 phase registry', () => {
  it('exposes capabilities only as their rollout phase is reached', () => {
    const readOnly = createToolRegistry({ googleAdsPhase: 'READ_ONLY' });
    expect(readOnly.get('google_ads.account.inspect')).toBeDefined();
    expect(readOnly.get('google_ads.account.verify')).toBeDefined();
    expect(readOnly.get('google_ads.customers.discover')).toBeDefined();
    expect(readOnly.get('google_ads.campaign.prepare')).toBeUndefined();

    const prepare = createToolRegistry({ googleAdsPhase: 'PREPARE' });
    expect(prepare.get('google_ads.campaign.prepare')).toBeDefined();
    expect(prepare.get('google_ads.campaign.create_paused')).toBeUndefined();

    const createPaused = createToolRegistry({ googleAdsPhase: 'CREATE_PAUSED' });
    expect(createPaused.get('google_ads.campaign.create_paused')).toBeDefined();
    expect(createPaused.get('google_ads.campaign.readback')).toBeUndefined();

    const readback = createToolRegistry({ googleAdsPhase: 'READBACK' });
    expect(readback.get('google_ads.campaign.readback')).toBeDefined();
    expect(readback.get('google_ads.campaign.activate')).toBeUndefined();

    const manage = createToolRegistry({
      googleAdsPhase: 'MANAGE',
      googleAdsActivateEnabled: true,
    });
    expect(manage.get('google_ads.campaign.activate')).toMatchObject({
      riskClass: 'FINANCIAL_IMPACT',
      capabilityStatus: 'IMPLEMENTED',
    });
    expect(manage.get('google_ads.campaign.pause')).toMatchObject({
      riskClass: 'WRITE_EXTERNAL',
      capabilityStatus: 'IMPLEMENTED',
    });
    expect(manage.get('google_ads.campaign.update_budget')).toMatchObject({
      riskClass: 'FINANCIAL_IMPACT',
      capabilityStatus: 'IMPLEMENTED',
    });
  });
});
