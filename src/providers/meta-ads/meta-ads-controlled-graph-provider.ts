import { z } from 'zod/v4';
import type { MetaApiClient } from '../meta/meta-api-client.js';
import type {
  MetaAdAccountRef,
  MetaAdDraft,
  MetaAdEntityStatus,
  MetaAdSetDraft,
  MetaAdsInsightsQuery,
  MetaAdsProvider,
  MetaCampaignDraft,
  MetaCreativeDraft,
} from './meta-ads-contracts.js';

const idResponseSchema = z.object({ id: z.string().min(1) });
const dataResponseSchema = z.object({
  data: z.array(z.record(z.string(), z.unknown())).default([]),
});

export class MetaAdsControlledGraphProvider implements MetaAdsProvider {
  constructor(private readonly api: MetaApiClient) {}

  async listCampaigns(
    account: MetaAdAccountRef,
  ): Promise<readonly Readonly<Record<string, unknown>>[]> {
    const result = await this.api.get(`act_${account.adAccountId}/campaigns`, {
      fields: 'id,name,objective,status,effective_status',
    });
    return dataResponseSchema.parse(result).data;
  }

  async getInsights(
    account: MetaAdAccountRef,
    query: MetaAdsInsightsQuery,
  ): Promise<readonly Readonly<Record<string, unknown>>[]> {
    const result = await this.api.get(`act_${account.adAccountId}/insights`, {
      level: query.level,
      fields: query.fields.join(','),
      time_range: JSON.stringify({ since: query.since, until: query.until }),
    });
    return dataResponseSchema.parse(result).data;
  }

  async createCampaign(
    account: MetaAdAccountRef,
    draft: MetaCampaignDraft,
  ): Promise<{ readonly id: string }> {
    const result = await this.api.post(`act_${account.adAccountId}/campaigns`, {
      name: draft.name,
      objective: draft.objective,
      status: 'PAUSED',
      special_ad_categories: JSON.stringify(draft.specialAdCategories),
      is_adset_budget_sharing_enabled: 'false',
    });
    return idResponseSchema.parse(result);
  }

  async createAdSet(
    account: MetaAdAccountRef,
    draft: MetaAdSetDraft,
  ): Promise<{ readonly id: string }> {
    const values: Record<string, string> = {
      campaign_id: draft.campaignId,
      name: draft.name,
      targeting: JSON.stringify(draft.targeting),
      status: 'PAUSED',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    };
    if (draft.dailyBudgetMinor !== undefined) values.daily_budget = String(draft.dailyBudgetMinor);
    if (draft.lifetimeBudgetMinor !== undefined)
      values.lifetime_budget = String(draft.lifetimeBudgetMinor);
    if (draft.billingEvent) values.billing_event = draft.billingEvent;
    if (draft.optimizationGoal) values.optimization_goal = draft.optimizationGoal;
    if (draft.promotedObject) values.promoted_object = JSON.stringify(draft.promotedObject);
    if (draft.startTime) values.start_time = draft.startTime;
    if (draft.endTime) values.end_time = draft.endTime;
    const result = await this.api.post(`act_${account.adAccountId}/adsets`, values);
    return idResponseSchema.parse(result);
  }

  async createCreative(
    account: MetaAdAccountRef,
    draft: MetaCreativeDraft,
  ): Promise<{ readonly id: string }> {
    const objectStorySpec: Record<string, unknown> = { ...draft.objectStorySpec };
    delete objectStorySpec.page_id;
    delete objectStorySpec.instagram_actor_id;
    delete objectStorySpec.instagram_user_id;
    objectStorySpec.page_id = draft.pageId;
    if (draft.instagramActorId) objectStorySpec.instagram_user_id = draft.instagramActorId;

    const videoData = objectStorySpec.video_data;
    if (videoData && typeof videoData === 'object' && !Array.isArray(videoData)) {
      const normalizedVideoData = { ...(videoData as Record<string, unknown>) };
      if (normalizedVideoData.image_hash && normalizedVideoData.image_url) {
        delete normalizedVideoData.image_url;
      }
      objectStorySpec.video_data = normalizedVideoData;
    }

    const result = await this.api.post(`act_${account.adAccountId}/adcreatives`, {
      name: draft.name,
      object_story_spec: JSON.stringify(objectStorySpec),
    });
    return idResponseSchema.parse(result);
  }

  async createAd(account: MetaAdAccountRef, draft: MetaAdDraft): Promise<{ readonly id: string }> {
    const result = await this.api.post(`act_${account.adAccountId}/ads`, {
      name: draft.name,
      adset_id: draft.adSetId,
      creative: JSON.stringify({ creative_id: draft.creativeId }),
      status: 'PAUSED',
      fields: 'id',
    });
    return idResponseSchema.parse(result);
  }

  updateStatus(
    account: MetaAdAccountRef,
    entityId: string,
    status: MetaAdEntityStatus,
  ): Promise<void> {
    void account;
    void entityId;
    void status;
    return Promise.reject(new Error('META_ADS_STATUS_MUTATION_NOT_ALLOWED'));
  }

  updateBudget(
    account: MetaAdAccountRef,
    adSetId: string,
    budgetMinor: number,
    budgetType: 'DAILY' | 'LIFETIME',
  ): Promise<void> {
    void account;
    void adSetId;
    void budgetMinor;
    void budgetType;
    return Promise.reject(new Error('META_ADS_BUDGET_MUTATION_NOT_ALLOWED'));
  }
}
