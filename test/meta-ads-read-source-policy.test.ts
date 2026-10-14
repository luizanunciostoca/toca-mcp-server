import { describe, expect, it, vi } from 'vitest';
import type { MetaApiClient } from '../src/providers/meta/meta-api-client.js';
import { MetaAdsReadProvider } from '../src/providers/meta-ads/meta-ads-read-provider.js';

const account = { adAccountId: '123456', currency: 'BRL' };
const query = {
  level: 'campaign' as const,
  fields: ['campaign_id', 'spend', 'actions'],
  since: '2026-10-13',
  until: '2026-10-14',
};

function mockProvider(reply: unknown) {
  const get = vi.fn().mockResolvedValue(reply);
  const provider = new MetaAdsReadProvider({ get } as unknown as MetaApiClient);
  return { provider, get };
}

describe('canonical Meta Marketing API Insights — read-only source contract', () => {
  it('requests the exact account and date window through the native Graph client', async () => {
    const { provider, get } = mockProvider({
      data: [{ campaign_id: 'campaign-1', spend: '12.50', actions: [] }],
    });

    await expect(provider.getInsights(account, query)).resolves.toEqual([
      { campaign_id: 'campaign-1', spend: '12.50', actions: [] },
    ]);
    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith('act_123456/insights', {
      level: 'campaign',
      fields: 'campaign_id,spend,actions',
      time_range: '{"since":"2026-10-13","until":"2026-10-14"}',
    });
  });

  it('distinguishes a legitimate empty Meta data array from a missing envelope', async () => {
    const { provider: emptyProvider } = mockProvider({ data: [] });
    await expect(emptyProvider.getInsights(account, query)).resolves.toEqual([]);

    for (const malformedResponse of [{}, { data: null }, { data: 'unavailable' }]) {
      const { provider } = mockProvider(malformedResponse);
      await expect(provider.getInsights(account, query)).rejects.toThrow();
    }
  });

  it('propagates provider errors instead of fabricating zeros or falling back to other vendors', async () => {
    const get = vi.fn().mockRejectedValue(new Error('META_GRAPH_UNAVAILABLE'));
    const provider = new MetaAdsReadProvider({ get } as unknown as MetaApiClient);
    await expect(provider.getInsights(account, query)).rejects.toThrow('META_GRAPH_UNAVAILABLE');
    expect(get).toHaveBeenCalledOnce();
  });
});
