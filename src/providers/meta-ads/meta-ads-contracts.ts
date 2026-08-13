export type MetaAdEntityStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED';

export interface MetaAdAccountRef {
  readonly adAccountId: string;
  readonly currency: string;
}

export interface MetaCampaignDraft {
  readonly name: string;
  readonly objective: string;
  readonly status: 'PAUSED';
  readonly specialAdCategories: readonly string[];
}

export interface MetaAdSetDraft {
  readonly campaignId: string;
  readonly name: string;
  readonly dailyBudgetMinor?: number;
  readonly lifetimeBudgetMinor?: number;
  readonly billingEvent?: string;
  readonly optimizationGoal?: string;
  readonly targeting: Readonly<Record<string, unknown>>;
  readonly status: 'PAUSED';
}

export interface MetaCreativeDraft {
  readonly name: string;
  readonly pageId: string;
  readonly instagramActorId?: string;
  readonly objectStorySpec: Readonly<Record<string, unknown>>;
}

export interface MetaAdDraft {
  readonly name: string;
  readonly adSetId: string;
  readonly creativeId: string;
  readonly status: 'PAUSED';
}

export interface MetaAdsInsightsQuery {
  readonly level: 'account' | 'campaign' | 'adset' | 'ad';
  readonly fields: readonly string[];
  readonly since: string;
  readonly until: string;
}

export interface MetaAdsProvider {
  listAccounts(): Promise<readonly Readonly<Record<string, unknown>>[]>;
  listCampaigns(account: MetaAdAccountRef): Promise<readonly Readonly<Record<string, unknown>>[]>;
  getInsights(
    account: MetaAdAccountRef,
    query: MetaAdsInsightsQuery,
  ): Promise<readonly Readonly<Record<string, unknown>>[]>;
  createCampaign(
    account: MetaAdAccountRef,
    draft: MetaCampaignDraft,
  ): Promise<{ readonly id: string }>;
  createAdSet(account: MetaAdAccountRef, draft: MetaAdSetDraft): Promise<{ readonly id: string }>;
  createCreative(
    account: MetaAdAccountRef,
    draft: MetaCreativeDraft,
  ): Promise<{ readonly id: string }>;
  createAd(account: MetaAdAccountRef, draft: MetaAdDraft): Promise<{ readonly id: string }>;
  updateStatus(
    account: MetaAdAccountRef,
    entityId: string,
    status: MetaAdEntityStatus,
  ): Promise<void>;
  updateBudget(
    account: MetaAdAccountRef,
    adSetId: string,
    budgetMinor: number,
    budgetType: 'DAILY' | 'LIFETIME',
  ): Promise<void>;
}
