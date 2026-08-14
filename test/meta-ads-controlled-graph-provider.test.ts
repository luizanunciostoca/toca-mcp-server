import { describe, expect, it, vi } from 'vitest';
import type { MetaApiClient } from '../src/providers/meta/meta-api-client.js';
import { MetaAdsControlledGraphProvider } from '../src/providers/meta-ads/meta-ads-controlled-graph-provider.js';

function createApiMock() {
  const post = vi.fn().mockResolvedValue({ id: 'campaign-1' });
  const api = {
    get: vi.fn(),
    post,
    postJson: vi.fn(),
    postJsonWithAccessToken: vi.fn(),
  } as unknown as MetaApiClient;
  return { api, post };
}

describe('MetaAdsControlledGraphProvider campaign guardrails', () => {
  it('creates campaigns PAUSED with ad set budget sharing explicitly disabled', async () => {
    const { api, post } = createApiMock();
    const provider = new MetaAdsControlledGraphProvider(api);

    await expect(
      provider.createCampaign(
        { adAccountId: '311793958882290', currency: 'BRL' },
        {
          name: 'TOCA | provider contract',
          objective: 'OUTCOME_SALES',
          specialAdCategories: [],
          status: 'PAUSED',
        },
      ),
    ).resolves.toEqual({ id: 'campaign-1' });

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('act_311793958882290/campaigns', {
      name: 'TOCA | provider contract',
      objective: 'OUTCOME_SALES',
      status: 'PAUSED',
      special_ad_categories: '[]',
      is_adset_budget_sharing_enabled: 'false',
    });
  });

  it('does not expose status or budget mutation through the controlled provider', async () => {
    const { api } = createApiMock();
    const provider = new MetaAdsControlledGraphProvider(api);
    const account = { adAccountId: '311793958882290', currency: 'BRL' } as const;

    await expect(provider.updateStatus(account, 'campaign-1', 'PAUSED')).rejects.toThrow(
      'META_ADS_STATUS_MUTATION_NOT_ALLOWED',
    );
    await expect(provider.updateBudget(account, 'adset-1', 17_000, 'DAILY')).rejects.toThrow(
      'META_ADS_BUDGET_MUTATION_NOT_ALLOWED',
    );
  });
});
