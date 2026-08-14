import { createHash } from 'node:crypto';
import type {
  MetaAdAccountRef,
  MetaAdDraft,
  MetaAdSetDraft,
  MetaAdsProvider,
  MetaCampaignDraft,
  MetaCreativeDraft,
} from './meta-ads-contracts.js';

export interface MetaAdsCustomLocationGuardrail {
  readonly latitude: number;
  readonly longitude: number;
  readonly maxRadius: number;
  readonly distanceUnit: 'kilometer' | 'mile';
}

export interface MetaAdsWriteGuardrails {
  readonly allowedAccountId: string;
  readonly allowedCurrency: string;
  readonly maxDailyBudgetMinor: number;
  readonly allowedGeoKeys?: readonly string[];
  readonly allowedCustomLocations?: readonly MetaAdsCustomLocationGuardrail[];
  readonly allowedPixelId: string;
  readonly allowedPageId: string;
  readonly allowedInstagramActorId?: string;
  readonly approvedRequestSha256: string;
  readonly allowedObjectives?: readonly string[];
  readonly allowedOptimizationGoals?: readonly string[];
}

export interface ControlledCreativePlan {
  readonly name: string;
  readonly pageId: string;
  readonly instagramActorId?: string;
  readonly objectStorySpec: Readonly<Record<string, unknown>>;
}

export interface ControlledAdPlan {
  readonly name: string;
  readonly creativeIndex: number;
}

export interface ControlledCreatePausedPlan {
  readonly account: MetaAdAccountRef;
  readonly campaign: {
    readonly name: string;
    readonly objective: string;
    readonly specialAdCategories: readonly string[];
  };
  readonly adSet: {
    readonly name: string;
    readonly dailyBudgetMinor: number;
    readonly billingEvent: string;
    readonly optimizationGoal: string;
    readonly targeting: Readonly<Record<string, unknown>>;
    readonly promotedObject: Readonly<Record<string, unknown>>;
    readonly startTime?: string;
    readonly endTime?: string;
  };
  readonly creatives: readonly ControlledCreativePlan[];
  readonly ads: readonly ControlledAdPlan[];
}

export interface ControlledCreatePausedResult {
  readonly requestSha256: string;
  readonly campaignId: string;
  readonly adSetId: string;
  readonly creativeIds: readonly string[];
  readonly adIds: readonly string[];
  readonly status: 'PAUSED';
}

// External provider-access changes must be revalidated through a fresh CREATE_PAUSED smoke before activation.
export class MetaAdsControlledWriteService {
  constructor(
    private readonly provider: MetaAdsProvider,
    private readonly guardrails: MetaAdsWriteGuardrails,
  ) {}

  prepare(plan: ControlledCreatePausedPlan) {
    this.assertPlan(plan);
    return {
      requestSha256: requestSha256(plan),
      status: 'VALIDATED_PAUSED_ONLY' as const,
      campaignName: plan.campaign.name,
      dailyBudgetMinor: plan.adSet.dailyBudgetMinor,
      creativeCount: plan.creatives.length,
      adCount: plan.ads.length,
    };
  }

  async createPaused(
    plan: ControlledCreatePausedPlan,
    approvalSha256: string,
  ): Promise<ControlledCreatePausedResult> {
    this.assertPlan(plan);
    const computed = requestSha256(plan);
    if (approvalSha256 !== computed || this.guardrails.approvedRequestSha256 !== computed) {
      throw new Error('META_ADS_APPROVAL_SHA256_MISMATCH');
    }

    const existing = await this.provider.listCampaigns(plan.account);
    if (
      existing.some((campaign) => {
        const name = campaign.name;
        return typeof name === 'string' && name === plan.campaign.name;
      })
    ) {
      throw new Error('META_ADS_DUPLICATE_CAMPAIGN_NAME');
    }

    const campaignDraft: MetaCampaignDraft = {
      name: plan.campaign.name,
      objective: plan.campaign.objective,
      specialAdCategories: plan.campaign.specialAdCategories,
      status: 'PAUSED',
    };
    const campaign = await this.provider.createCampaign(plan.account, campaignDraft);

    const adSetDraft: MetaAdSetDraft = {
      campaignId: campaign.id,
      name: plan.adSet.name,
      dailyBudgetMinor: plan.adSet.dailyBudgetMinor,
      billingEvent: plan.adSet.billingEvent,
      optimizationGoal: plan.adSet.optimizationGoal,
      targeting: plan.adSet.targeting,
      promotedObject: plan.adSet.promotedObject,
      ...(plan.adSet.startTime ? { startTime: plan.adSet.startTime } : {}),
      ...(plan.adSet.endTime ? { endTime: plan.adSet.endTime } : {}),
      status: 'PAUSED',
    };
    const adSet = await this.provider.createAdSet(plan.account, adSetDraft);

    const creativeIds: string[] = [];
    for (const creativePlan of plan.creatives) {
      const creativeDraft: MetaCreativeDraft = { ...creativePlan };
      const creative = await this.provider.createCreative(plan.account, creativeDraft);
      creativeIds.push(creative.id);
    }

    const adIds: string[] = [];
    for (const adPlan of plan.ads) {
      const creativeId = creativeIds[adPlan.creativeIndex];
      if (!creativeId) throw new Error('META_ADS_CREATIVE_INDEX_INVALID');
      const adDraft: MetaAdDraft = {
        name: adPlan.name,
        adSetId: adSet.id,
        creativeId,
        status: 'PAUSED',
      };
      const ad = await this.provider.createAd(plan.account, adDraft);
      adIds.push(ad.id);
    }

    return {
      requestSha256: computed,
      campaignId: campaign.id,
      adSetId: adSet.id,
      creativeIds,
      adIds,
      status: 'PAUSED',
    };
  }

  private assertPlan(plan: ControlledCreatePausedPlan): void {
    const allowedObjectives = this.guardrails.allowedObjectives ?? ['OUTCOME_SALES'];
    const allowedOptimizationGoals = this.guardrails.allowedOptimizationGoals ?? [
      'OFFSITE_CONVERSIONS',
    ];

    if (plan.account.adAccountId !== this.guardrails.allowedAccountId)
      throw new Error('META_ADS_ACCOUNT_NOT_ALLOWED');
    if (plan.account.currency !== this.guardrails.allowedCurrency)
      throw new Error('META_ADS_CURRENCY_NOT_ALLOWED');
    if (!allowedObjectives.includes(plan.campaign.objective))
      throw new Error('META_ADS_OBJECTIVE_NOT_ALLOWED');
    if (!Number.isInteger(plan.adSet.dailyBudgetMinor) || plan.adSet.dailyBudgetMinor <= 0)
      throw new Error('META_ADS_DAILY_BUDGET_INVALID');
    if (plan.adSet.dailyBudgetMinor > this.guardrails.maxDailyBudgetMinor)
      throw new Error('META_ADS_DAILY_BUDGET_EXCEEDS_GUARDRAIL');
    if (!allowedOptimizationGoals.includes(plan.adSet.optimizationGoal))
      throw new Error('META_ADS_OPTIMIZATION_GOAL_NOT_ALLOWED');
    if (plan.creatives.length < 1 || plan.creatives.length > 10)
      throw new Error('META_ADS_CREATIVE_COUNT_INVALID');
    if (plan.ads.length < 1 || plan.ads.length > 10) throw new Error('META_ADS_AD_COUNT_INVALID');

    this.assertGeo(plan.adSet.targeting);
    this.assertPromotedObject(plan.adSet.promotedObject);

    for (const creative of plan.creatives) {
      if (creative.pageId !== this.guardrails.allowedPageId)
        throw new Error('META_ADS_PAGE_NOT_ALLOWED');
      if (
        this.guardrails.allowedInstagramActorId &&
        creative.instagramActorId !== this.guardrails.allowedInstagramActorId
      )
        throw new Error('META_ADS_INSTAGRAM_ACTOR_NOT_ALLOWED');
    }
    for (const ad of plan.ads) {
      if (
        !Number.isInteger(ad.creativeIndex) ||
        ad.creativeIndex < 0 ||
        ad.creativeIndex >= plan.creatives.length
      )
        throw new Error('META_ADS_CREATIVE_INDEX_INVALID');
    }
  }

  private assertGeo(targeting: Readonly<Record<string, unknown>>): void {
    const geo = asRecord(targeting.geo_locations);
    const cities = Array.isArray(geo.cities) ? geo.cities : [];
    const customLocations = Array.isArray(geo.custom_locations) ? geo.custom_locations : [];

    const alwaysDisallowedGeoFields = [
      'countries',
      'regions',
      'zips',
      'geo_markets',
      'location_types',
    ];
    if (alwaysDisallowedGeoFields.some((field) => geo[field] !== undefined))
      throw new Error('META_ADS_GEO_SCOPE_NOT_ALLOWED');
    if (cities.length > 0 && customLocations.length > 0)
      throw new Error('META_ADS_GEO_SCOPE_NOT_ALLOWED');

    if (cities.length > 0) {
      const allowedKeys = new Set(this.guardrails.allowedGeoKeys ?? []);
      if (allowedKeys.size === 0) throw new Error('META_ADS_ALLOWED_GEO_KEYS_REQUIRED');
      for (const cityValue of cities) {
        const city = asRecord(cityValue);
        if (Object.keys(city).some((key) => key !== 'key'))
          throw new Error('META_ADS_GEO_SCOPE_NOT_ALLOWED');
        const key = scalarString(city.key);
        if (!allowedKeys.has(key)) throw new Error('META_ADS_GEO_KEY_NOT_ALLOWED');
      }
      return;
    }

    if (customLocations.length > 0) {
      const allowedLocations = this.guardrails.allowedCustomLocations ?? [];
      if (allowedLocations.length === 0)
        throw new Error('META_ADS_ALLOWED_CUSTOM_LOCATIONS_REQUIRED');

      for (const customValue of customLocations) {
        const custom = asRecord(customValue);
        const allowedFields = new Set(['latitude', 'longitude', 'radius', 'distance_unit']);
        if (Object.keys(custom).some((key) => !allowedFields.has(key)))
          throw new Error('META_ADS_GEO_SCOPE_NOT_ALLOWED');

        const latitude = finiteNumber(custom.latitude);
        const longitude = finiteNumber(custom.longitude);
        const radius = finiteNumber(custom.radius);
        const distanceUnit = scalarString(custom.distance_unit);
        if (
          latitude === undefined ||
          longitude === undefined ||
          radius === undefined ||
          radius <= 0 ||
          (distanceUnit !== 'kilometer' && distanceUnit !== 'mile')
        ) {
          throw new Error('META_ADS_CUSTOM_LOCATION_INVALID');
        }

        const allowed = allowedLocations.find(
          (candidate) =>
            approximatelyEqual(candidate.latitude, latitude) &&
            approximatelyEqual(candidate.longitude, longitude) &&
            candidate.distanceUnit === distanceUnit &&
            radius <= candidate.maxRadius,
        );
        if (!allowed) throw new Error('META_ADS_CUSTOM_LOCATION_NOT_ALLOWED');
      }
      return;
    }

    throw new Error('META_ADS_GEO_TARGETING_REQUIRED');
  }

  private assertPromotedObject(promotedObject: Readonly<Record<string, unknown>>): void {
    if (scalarString(promotedObject.pixel_id) !== this.guardrails.allowedPixelId)
      throw new Error('META_ADS_PIXEL_NOT_ALLOWED');
    if (scalarString(promotedObject.custom_event_type) !== 'PURCHASE')
      throw new Error('META_ADS_PURCHASE_EVENT_REQUIRED');
  }
}

export function requestSha256(plan: ControlledCreatePausedPlan): string {
  return createHash('sha256').update(stableStringify(plan)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function scalarString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value.toString();
  return '';
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 0.000001;
}
