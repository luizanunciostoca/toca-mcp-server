import { describe, expect, it, vi } from 'vitest';
import type { MetaApiClient } from '../src/providers/meta/meta-api-client.js';
import { MetaAdsControlledGraphProvider } from '../src/providers/meta-ads/meta-ads-controlled-graph-provider.js';

function createApiMock() {
  const post = vi.fn().mockResolvedValue({ id: 'provider-id-1' });
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
    ).resolves.toEqual({ id: 'provider-id-1' });

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('act_311793958882290/campaigns', {
      name: 'TOCA | provider contract',
      objective: 'OUTCOME_SALES',
      status: 'PAUSED',
      special_ad_categories: '[]',
      is_adset_budget_sharing_enabled: 'false',
    });
  });

  it('creates ad sets PAUSED with lowest-cost bidding and no bid cap', async () => {
    const { api, post } = createApiMock();
    const provider = new MetaAdsControlledGraphProvider(api);

    await expect(
      provider.createAdSet(
        { adAccountId: '311793958882290', currency: 'BRL' },
        {
          campaignId: 'campaign-1',
          name: 'P0 Smoke | Morro locality | Purchase',
          dailyBudgetMinor: 17_000,
          billingEvent: 'IMPRESSIONS',
          optimizationGoal: 'OFFSITE_CONVERSIONS',
          targeting: {
            geo_locations: {
              custom_locations: [
                {
                  latitude: -13.3833,
                  longitude: -38.9167,
                  radius: 15,
                  distance_unit: 'kilometer',
                },
              ],
            },
          },
          promotedObject: { pixel_id: '461233076843065', custom_event_type: 'PURCHASE' },
          startTime: '2026-08-14T04:00:00.000Z',
          endTime: '2026-08-15T05:00:00.000Z',
          status: 'PAUSED',
        },
      ),
    ).resolves.toEqual({ id: 'provider-id-1' });

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('act_311793958882290/adsets', {
      campaign_id: 'campaign-1',
      name: 'P0 Smoke | Morro locality | Purchase',
      targeting: JSON.stringify({
        geo_locations: {
          custom_locations: [
            {
              latitude: -13.3833,
              longitude: -38.9167,
              radius: 15,
              distance_unit: 'kilometer',
            },
          ],
        },
      }),
      status: 'PAUSED',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      daily_budget: '17000',
      billing_event: 'IMPRESSIONS',
      optimization_goal: 'OFFSITE_CONVERSIONS',
      promoted_object: JSON.stringify({
        pixel_id: '461233076843065',
        custom_event_type: 'PURCHASE',
      }),
      start_time: '2026-08-14T04:00:00.000Z',
      end_time: '2026-08-15T05:00:00.000Z',
    });
  });

  it('maps Instagram creatives to instagram_user_id and removes redundant video image_url', async () => {
    const { api, post } = createApiMock();
    const provider = new MetaAdsControlledGraphProvider(api);
    const videoData = {
      call_to_action: { type: 'LEARN_MORE', value: { link: 'https://example.com' } },
      image_hash: 'hash-1',
      image_url: 'https://example.com/thumbnail.jpg',
      message: 'Creative message',
      video_id: 'video-1',
    };
    const objectStorySpec = {
      page_id: 'legacy-page',
      instagram_actor_id: 'legacy-actor',
      instagram_user_id: 'legacy-user',
      video_data: videoData,
    };

    await expect(
      provider.createCreative(
        { adAccountId: '311793958882290', currency: 'BRL' },
        {
          name: 'P0 Smoke Creative',
          pageId: '306103746115875',
          instagramActorId: '17841402033495654',
          objectStorySpec,
        },
      ),
    ).resolves.toEqual({ id: 'provider-id-1' });

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('act_311793958882290/adcreatives', {
      name: 'P0 Smoke Creative',
      object_story_spec: JSON.stringify({
        video_data: {
          call_to_action: { type: 'LEARN_MORE', value: { link: 'https://example.com' } },
          image_hash: 'hash-1',
          message: 'Creative message',
          video_id: 'video-1',
        },
        page_id: '306103746115875',
        instagram_user_id: '17841402033495654',
      }),
    });
    expect(objectStorySpec).toEqual({
      page_id: 'legacy-page',
      instagram_actor_id: 'legacy-actor',
      instagram_user_id: 'legacy-user',
      video_data: videoData,
    });
    expect(videoData).toHaveProperty('image_url');
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
