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
const dataResponseSchema = z.object({ data: z.array(z.record(z.string(), z.unknown())).default([]) });

export class MetaAdsGraphProvider implements MetaAdsProvider {
  constructor(private readonly api: MetaApiClient) {}

  async listCampaigns(account: MetaAdAccountRef): Promise<readonly Readonly<Record<string, unknown>>[]> {
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

  async createCampaign(account: MetaAdAccountRef, draft: MetaCampaignDraft): Promise<{ readonly id: string }> {
    const result = await this.api.post(`act_${account.adAccountId}/campaigns`, {
      name: draft.name,
      objective: draft.objective,
      status: draft.status,
      special_ad_categories: JSON.stringify(draft.specialAdCategories),
    });
    return idResponseSchema.parse(result);
  }

  async createAdSet(account: MetaAdAccountRef, draft: MetaAdSetDraft): Promise<{ readonly id: string }> {
    const values: Record<string, string> = {
      campaign_id: draft.campaignId,
      name: draft.name,
      targeting: JSON.stringify(draft.targeting),
      status: draft.status,
    };
    if (draft.dailyBudgetMinor !== undefined) values.daily_budget = String(draft.dailyBudgetMinor);
    if (draft.lifetimeBudgetMinor !== undefined) values.lifetime_budget = String(draft.lifetimeBudgetMinor);
    if (draft.billingEvent) values.billing_event = draft.billingEvent;
    if (draft.optimizationGoal) values.optimization_goal = draft.optimizationGoal;
    const result = await this.api.post(`act_${account.adAccountId}/adsets`, values);
    return idResponseSchema.parse(result);
  }

  async createCreative(account: MetaAdAccountRef, draft: MetaCreativeDraft): Promise<{ readonly id: string }> {
    const values: Record<string, string> = {
      name: draft.name,
      object_story_spec: JSON.stringify(draft.objectStorySpec),
    };
    const result = await this.api.post(`act_${account.adAccountId}/adcreatives`, values);
    return idResponseSchema.parse(result);
  }

  async createAd(account: MetaAdAccountRef, draft: MetaAdDraft): Promise<{ readonly id: string }> {
    const result = await this.api.post(`act_${account.adAccountId}/ads`, {
      name: draft.name,
      adset_id: draft.adSetId,
      creative: JSON.stringify({ creative_id: draft.creativeId }),
      status: draft.status,
    });
    return idResponseSchema.parse(result);
  }

  async updateStatus(
    _account: MetaAdAccountRef,
    entityId: string,
    status: MetaAdEntityStatus,
  ): Promise<void> {
    await this.api.post(entityId, { status });
  }

  async updateBudget(
    _account: MetaAdAccountRef,
    adSetId: string,
    budgetMinor: number,
    budgetType: 'DAILY' | 'LIFETIME',
  ): Promise<void> {
    await this.api.post(adSetId, {
      [budgetType === 'DAILY' ? 'daily_budget' : 'lifetime_budget']: String(budgetMinor),
    });
  }
}
