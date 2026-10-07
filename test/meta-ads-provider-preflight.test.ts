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
    const { api, get, post } = apiMock({});

    await expect(
      validateMetaAdsAdWriteReadiness(api, {
        accountId: '311793958882290',
        creativeId: 'creative-1',
        validationId: 'validation-1',
      }),
    ).resolves.toEqual({ validated: true, adSetId: 'adset-1', creativeId: 'creative-1' });

    expect(get).toHaveBeenCalledWith('act_311793958882290/adsets', {
      fields: 'id,name,status,effective_status,issues_info,end_time',
      limit: '200',
    });
    expect(post).toHaveBeenCalledWith('act_311793958882290/ads', {
      name: 'TOCA | P0 VALIDATE_ONLY | validation-1',
      adset_id: 'adset-1',
      creative: JSON.stringify({ creative_id: 'creative-1' }),
      status: 'PAUSED',
      execution_options: JSON.stringify(['validate_only']),
    });
  });

  it('tries another usable Ad Set when the provider rejects the first combination', async () => {
    const { api, post } = apiMock({
      adSets: [
        {
          id: 'adset-incompatible',
          status: 'PAUSED',
          effective_status: 'CAMPAIGN_PAUSED',
          issues_info: [],
        },
        {
          id: 'adset-compatible',
          status: 'PAUSED',
          effective_status: 'CAMPAIGN_PAUSED',
          issues_info: [],
        },
      ],
    });
    post
      .mockRejectedValueOnce(new Error('META_HTTP_400|META_CODE_100|META_SUBCODE_1860014'))
      .mockResolvedValueOnce({ success: true });

    await expect(
      validateMetaAdsAdWriteReadiness(api, {
        accountId: '311793958882290',
        creativeId: 'creative-1',
        validationId: 'validation-1',
      }),
    ).resolves.toEqual({
      validated: true,
      adSetId: 'adset-compatible',
      creativeId: 'creative-1',
    });

    expect(post).toHaveBeenCalledTimes(2);
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

  it('fails closed instead of validating against an expired Ad Set', async () => {
    const { api, post } = apiMock({
      adSets: [
        {
          id: 'expired-adset',
          status: 'PAUSED',
          effective_status: 'CAMPAIGN_PAUSED',
          end_time: '2000-01-01T00:00:00.000Z',
        },
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
