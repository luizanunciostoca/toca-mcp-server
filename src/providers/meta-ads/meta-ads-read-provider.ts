import { z } from 'zod/v4';
import type { MetaApiClient } from '../meta/meta-api-client.js';

const dataResponseSchema = z.object({
  data: z.array(z.record(z.string(), z.unknown())).default([]),
});
const deliveryEstimateResponseSchema = z.object({
  data: z
    .array(
      z.object({
        estimate_mau_lower_bound: z.number().int().nonnegative().optional(),
        estimate_mau_upper_bound: z.number().int().nonnegative().optional(),
        estimate_ready: z.boolean().default(false),
      }),
    )
    .default([]),
});

export interface MetaAdsReadAccountRef {
  readonly adAccountId: string;
  readonly currency: string;
}

export interface MetaAdsReadInsightsQuery {
  readonly level: 'account' | 'campaign' | 'adset' | 'ad';
  readonly fields: readonly string[];
  readonly since: string;
  readonly until: string;
}

export interface MetaAdsGeoAudienceQuery {
  readonly optimizationGoal: string;
  readonly targetingSpec: Readonly<Record<string, unknown>>;
}

export interface MetaAdsGeoAudienceEstimate {
  readonly lowerBound: number;
  readonly upperBound: number;
  readonly estimateReady: boolean;
  readonly optimizationGoal: string;
  readonly targetingSpec: Readonly<Record<string, unknown>>;
  readonly source: 'META_DELIVERY_ESTIMATE';
}

export class MetaAdsReadProvider {
  constructor(private readonly api: MetaApiClient) {}

  async listAccounts(): Promise<readonly Readonly<Record<string, unknown>>[]> {
    const result = await this.api.get('me/adaccounts', {
      fields: 'id,account_id,name,currency,account_status,disable_reason',
    });
    return dataResponseSchema.parse(result).data;
  }

  async listCampaigns(
    account: MetaAdsReadAccountRef,
  ): Promise<readonly Readonly<Record<string, unknown>>[]> {
    const result = await this.api.get(`act_${account.adAccountId}/campaigns`, {
      fields: 'id,name,objective,status,effective_status,created_time,updated_time',
    });
    return dataResponseSchema.parse(result).data;
  }

  async listAdSets(
    account: MetaAdsReadAccountRef,
  ): Promise<readonly Readonly<Record<string, unknown>>[]> {
    const result = await this.api.get(`act_${account.adAccountId}/adsets`, {
      fields:
        'id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,budget_remaining,bid_strategy,optimization_goal,billing_event,start_time,end_time,created_time,updated_time,targeting',
    });
    return dataResponseSchema.parse(result).data;
  }

  async listAds(
    account: MetaAdsReadAccountRef,
  ): Promise<readonly Readonly<Record<string, unknown>>[]> {
    const result = await this.api.get(`act_${account.adAccountId}/ads`, {
      fields:
        'id,name,adset_id,campaign_id,status,effective_status,created_time,updated_time,creative{id,name,title,body,object_story_id,thumbnail_url}',
    });
    return dataResponseSchema.parse(result).data;
  }

  async getInsights(
    account: MetaAdsReadAccountRef,
    query: MetaAdsReadInsightsQuery,
  ): Promise<readonly Readonly<Record<string, unknown>>[]> {
    const result = await this.api.get(`act_${account.adAccountId}/insights`, {
      level: query.level,
      fields: query.fields.join(','),
      time_range: JSON.stringify({ since: query.since, until: query.until }),
    });
    return dataResponseSchema.parse(result).data;
  }

  async getDeliveryEstimate(
    account: MetaAdsReadAccountRef,
    query: MetaAdsGeoAudienceQuery,
  ): Promise<MetaAdsGeoAudienceEstimate> {
    const result = deliveryEstimateResponseSchema.parse(
      await this.api.get(`act_${account.adAccountId}/delivery_estimate`, {
        fields: 'estimate_mau_lower_bound,estimate_mau_upper_bound,estimate_ready',
        optimization_goal: query.optimizationGoal,
        targeting_spec: JSON.stringify(query.targetingSpec),
      }),
    );
    const estimate = result.data[0];
    if (!estimate) throw new Error('META_ADS_DELIVERY_ESTIMATE_EMPTY');
    const lowerBound = estimate.estimate_mau_lower_bound ?? 0;
    const upperBound = estimate.estimate_mau_upper_bound ?? 0;
    if (estimate.estimate_ready && upperBound < lowerBound) {
      throw new Error('META_ADS_DELIVERY_ESTIMATE_BOUNDS_INVALID');
    }

    return {
      lowerBound,
      upperBound,
      estimateReady: estimate.estimate_ready,
      optimizationGoal: query.optimizationGoal,
      targetingSpec: query.targetingSpec,
      source: 'META_DELIVERY_ESTIMATE',
    };
  }
}
