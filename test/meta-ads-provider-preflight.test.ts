import { describe, expect, it, vi } from 'vitest';
import type { MetaApiClient } from '../src/providers/meta/meta-api-client.js';
import { validateMetaAdsAdWriteReadiness } from '../src/providers/meta-ads/meta-ads-provider-preflight.js';

function apiMock(options: {
  adSets?: readonly Readonly<Record<string, unknown>>[];
  postResult?: unknown;
}) {
  const get = vi.fn().mockResolvedValue({
    data: options.adSets ?? [
      {
        id: 'adset-1',
        status: 'PAUSED',
        effective_status: 'CAMPAIGN_PAUSED',
        issues_info: [],
      },
    ],
  });
  const post = vi.fn().mockResolvedValue(options.postResult ?? { success: true });
  return {
    api: { get, post } as unknown as MetaApiClient,
    get,
    post,
  };
}

describe('Meta Ads no-side-effect provider preflight', () => {
  it('validates the final Ad payload without creating an Ad', async () => {
    const { api, post } = apiMock({});

    await expect(
      validateMetaAdsAdWriteReadiness(api, {
        accountId: '311793958882290',
        creativeId: 'creative-1',
        validationId: 'validation-1',
      }),
    ).resolves.toEqual({ validated: true, adSetId: 'adset-1', creativeId: 'creative-1' });

    expect(post).toHaveBeenCalledWith('act_311793958882290/ads', {
      name: 'TOCA | P0 VALIDATE_ONLY | validation-1',
      adset_id: 'adset-1',
      creative: JSON.stringify({ creative_id: 'creative-1' }),
      status: 'PAUSED',
      execution_options: JSON.stringify(['validate_only']),
    });
  });

  it('fails closed when no usable existing Ad Set is available', async () => {
    const { api, post } = apiMock({
      adSets: [
        { id: 'broken-1', status: 'PAUSED', effective_status: 'WITH_ISSUES' },
        { id: 'archived-1', status: 'ARCHIVED' },
      ],
    });

    await expect(
      validateMetaAdsAdWriteReadiness(api, {
        accountId: '311793958882290',
        creativeId: 'creative-1',
        validationId: 'validation-1',
      }),
    ).rejects.toThrow('META_ADS_SMOKE_VALIDATE_ONLY_ADSET_NOT_FOUND');
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects a validate-only response that unexpectedly returns an Ad id', async () => {
    const { api } = apiMock({ postResult: { id: 'unexpected-ad-id' } });

    await expect(
      validateMetaAdsAdWriteReadiness(api, {
        accountId: '311793958882290',
        creativeId: 'creative-1',
        validationId: 'validation-1',
      }),
    ).rejects.toThrow('META_ADS_SMOKE_VALIDATE_ONLY_UNEXPECTED_ID');
  });
});
