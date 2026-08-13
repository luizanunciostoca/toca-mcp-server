import { z } from 'zod/v4';
import type { MetaApiClient } from '../meta/meta-api-client.js';

const dataResponseSchema = z.object({
  data: z.array(z.record(z.string(), z.unknown())).default([]),
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
}
