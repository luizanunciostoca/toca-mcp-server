import type { BudgetDecision, BudgetGuardrailPolicy } from './budget-guardrail.js';
import { evaluateBudgetChange } from './budget-guardrail.js';
import type {
  MetaAdsGeoAudienceEstimate,
  MetaAdsReadAccountRef,
  MetaAdsReadProvider,
} from './meta-ads-read-provider.js';

export const MORRO_DE_SAO_PAULO_GEO_KEY = 'morro-de-sao-paulo-15km';
export const MORRO_DE_SAO_PAULO_TARGETING_SPEC = {
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
} as const;

export interface MetaAdsGeoAudienceSample {
  readonly tenantId: string;
  readonly adAccountId: string;
  readonly geoKey: string;
  readonly lowerBound: number;
  readonly upperBound: number;
  readonly midpoint: number;
  readonly estimateReady: boolean;
  readonly optimizationGoal: string;
  readonly targetingSpec: Readonly<Record<string, unknown>>;
  readonly observedAt: string;
}

export interface MetaAdsGeoAudienceHistoryQuery {
  readonly tenantId: string;
  readonly adAccountId: string;
  readonly geoKey: string;
  readonly since: string;
  readonly limit?: number;
}

export interface MetaAdsGeoAudienceHistoryStore {
  append(sample: MetaAdsGeoAudienceSample): Promise<void>;
  listSince(query: MetaAdsGeoAudienceHistoryQuery): Promise<readonly MetaAdsGeoAudienceSample[]>;
}

export interface MorroDemandContext {
  readonly performanceScore?: number;
  readonly calendarEventScore?: number;
  readonly seasonalityScore?: number;
  readonly capacityScore?: number;
}

export interface MorroAudienceSignal {
  readonly geoKey: typeof MORRO_DE_SAO_PAULO_GEO_KEY;
  readonly estimate: MetaAdsGeoAudienceEstimate;
  readonly midpoint: number;
  readonly sevenDayMedianMidpoint?: number;
  readonly trend24hPercent?: number;
  readonly trend7dPercent?: number;
  readonly historySampleCount: number;
  readonly confidence: number;
  readonly observedAt: string;
}

export interface MorroDemandIndexComponents {
  readonly audienceLevel: number;
  readonly trend24h: number;
  readonly trend7d: number;
  readonly performance: number;
  readonly calendarEvent: number;
  readonly seasonality: number;
  readonly capacity: number;
}

export interface MorroDemandIndexResult {
  readonly score: number;
  readonly band: 'LOW' | 'GUARDED' | 'NORMAL' | 'HIGH' | 'PEAK';
  readonly confidence: number;
  readonly components: MorroDemandIndexComponents;
  readonly audience: MorroAudienceSignal;
}

export type DemandBudgetGuardrailDecision =
  | BudgetDecision
  | { readonly decision: 'REQUIRE_APPROVAL'; readonly reason: 'budget_policy_unavailable' };

export interface MorroBudgetRecommendation {
  readonly currentBudgetMinor: number;
  readonly requestedBudgetMinor: number;
  readonly currency: string;
  readonly recommendedChangePercent: number;
  readonly action: 'DECREASE' | 'HOLD' | 'INCREASE';
  readonly guardrail: DemandBudgetGuardrailDecision;
  readonly demandIndex: MorroDemandIndexResult;
  readonly rationale: readonly string[];
  readonly writeExecuted: false;
}

export interface MetaAdsDemandIntelligenceConfig {
  readonly tenantId: string;
  readonly budgetPolicy?: BudgetGuardrailPolicy;
  readonly maxRecommendationChangePercent?: number;
}

export interface MorroAudienceInspectInput {
  readonly account: MetaAdsReadAccountRef;
  readonly optimizationGoal?: string;
  readonly observedAt?: string;
}

export interface MorroDemandEvaluateInput extends MorroAudienceInspectInput, MorroDemandContext {}

export interface MorroBudgetRecommendInput extends MorroDemandEvaluateInput {
  readonly currentBudgetMinor: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CONTEXT_SCORE = 50;

export class MetaAdsDemandIntelligenceService {
  readonly #maxRecommendationChangePercent: number;

  constructor(
    private readonly provider: MetaAdsReadProvider,
    private readonly history: MetaAdsGeoAudienceHistoryStore | undefined,
    private readonly config: MetaAdsDemandIntelligenceConfig,
  ) {
    this.#maxRecommendationChangePercent = clamp(
      config.maxRecommendationChangePercent ?? 20,
      1,
      20,
    );
  }

  async inspectMorroAudience(input: MorroAudienceInspectInput): Promise<MorroAudienceSignal> {
    const observedAt = normalizeTimestamp(input.observedAt ?? new Date().toISOString());
    const estimate = await this.provider.getDeliveryEstimate(input.account, {
      optimizationGoal: input.optimizationGoal ?? 'REACH',
      targetingSpec: MORRO_DE_SAO_PAULO_TARGETING_SPEC,
    });
    const midpoint = midpointOf(estimate.lowerBound, estimate.upperBound);
    const sample: MetaAdsGeoAudienceSample = {
      tenantId: this.config.tenantId,
      adAccountId: input.account.adAccountId,
      geoKey: MORRO_DE_SAO_PAULO_GEO_KEY,
      lowerBound: estimate.lowerBound,
      upperBound: estimate.upperBound,
      midpoint,
      estimateReady: estimate.estimateReady,
      optimizationGoal: estimate.optimizationGoal,
      targetingSpec: MORRO_DE_SAO_PAULO_TARGETING_SPEC,
      observedAt,
    };

    if (this.history && estimate.estimateReady) await this.history.append(sample);

    const history = this.history
      ? await this.history.listSince({
          tenantId: this.config.tenantId,
          adAccountId: input.account.adAccountId,
          geoKey: MORRO_DE_SAO_PAULO_GEO_KEY,
          since: new Date(Date.parse(observedAt) - 8 * DAY_MS).toISOString(),
          limit: 1000,
        })
      : [];
    const prior = history.filter((item) => Date.parse(item.observedAt) < Date.parse(observedAt));
    const baseline24h = nearestTo(prior, Date.parse(observedAt) - DAY_MS, 18 * 60 * 60 * 1000);
    const baseline7d = nearestTo(prior, Date.parse(observedAt) - 7 * DAY_MS, 2 * DAY_MS);
    const recentSevenDayMidpoints = prior
      .filter((item) => Date.parse(item.observedAt) >= Date.parse(observedAt) - 7 * DAY_MS)
      .map((item) => item.midpoint)
      .filter(Number.isFinite);
    const sevenDayMedianMidpoint = median(recentSevenDayMidpoints);
    const confidence = confidenceScore({
      estimateReady: estimate.estimateReady,
      historyCount: prior.length,
      has24h: Boolean(baseline24h),
      has7d: Boolean(baseline7d),
    });

    return {
      geoKey: MORRO_DE_SAO_PAULO_GEO_KEY,
      estimate,
      midpoint,
      ...(sevenDayMedianMidpoint !== undefined ? { sevenDayMedianMidpoint } : {}),
      ...(baseline24h
        ? { trend24hPercent: percentChange(midpoint, baseline24h.midpoint) }
        : {}),
      ...(baseline7d ? { trend7dPercent: percentChange(midpoint, baseline7d.midpoint) } : {}),
      historySampleCount: prior.length,
      confidence,
      observedAt,
    };
  }

  async evaluateMorroDemand(input: MorroDemandEvaluateInput): Promise<MorroDemandIndexResult> {
    const audience = await this.inspectMorroAudience(input);
    return calculateMorroDemandIndex(audience, input);
  }

  async recommendMorroBudget(input: MorroBudgetRecommendInput): Promise<MorroBudgetRecommendation> {
    if (!Number.isSafeInteger(input.currentBudgetMinor) || input.currentBudgetMinor <= 0) {
      throw new Error('META_ADS_DEMAND_CURRENT_BUDGET_INVALID');
    }
    const demandIndex = await this.evaluateMorroDemand(input);
    let changePercent = changePercentForDemand(demandIndex.score);
    const performance = demandIndex.components.performance;
    const capacity = demandIndex.components.capacity;
    const rationale: string[] = [
      `demand_index=${demandIndex.score}`,
      `band=${demandIndex.band}`,
      `confidence=${demandIndex.confidence.toFixed(2)}`,
    ];

    if (changePercent > 0 && performance < 40) {
      changePercent = 0;
      rationale.push('increase_blocked_by_weak_performance');
    }
    if (changePercent > 0 && capacity < 20) {
      changePercent = 0;
      rationale.push('increase_blocked_by_low_capacity');
    }
    if (demandIndex.confidence < 0.6) {
      changePercent = clamp(changePercent, -10, 10);
      rationale.push('change_capped_by_low_signal_confidence');
    }
    changePercent = clamp(
      changePercent,
      -this.#maxRecommendationChangePercent,
      this.#maxRecommendationChangePercent,
    );

    const requestedBudgetMinor = Math.max(
      1,
      Math.round(input.currentBudgetMinor * (1 + changePercent / 100)),
    );
    const currency = input.account.currency.toUpperCase();
    const guardrail: DemandBudgetGuardrailDecision = this.config.budgetPolicy
      ? evaluateBudgetChange(this.config.budgetPolicy, {
          currency,
          type: 'DAILY',
          currentBudgetMinor: input.currentBudgetMinor,
          requestedBudgetMinor,
        })
      : { decision: 'REQUIRE_APPROVAL', reason: 'budget_policy_unavailable' };

    if (guardrail.decision !== 'ALLOW') rationale.push(`guardrail=${guardrail.reason}`);
    if (changePercent === 0) rationale.push('budget_hold');

    return {
      currentBudgetMinor: input.currentBudgetMinor,
      requestedBudgetMinor,
      currency,
      recommendedChangePercent: changePercent,
      action: changePercent > 0 ? 'INCREASE' : changePercent < 0 ? 'DECREASE' : 'HOLD',
      guardrail,
      demandIndex,
      rationale,
      writeExecuted: false,
    };
  }
}

export function calculateMorroDemandIndex(
  audience: MorroAudienceSignal,
  context: MorroDemandContext = {},
): MorroDemandIndexResult {
  const performance = score(context.performanceScore);
  const calendarEvent = score(context.calendarEventScore);
  const seasonality = score(context.seasonalityScore);
  const capacity = score(context.capacityScore);
  const audienceLevel = audience.sevenDayMedianMidpoint
    ? scoreFromRatio(audience.midpoint, audience.sevenDayMedianMidpoint)
    : DEFAULT_CONTEXT_SCORE;
  const trend24h = scoreFromDelta(audience.trend24hPercent);
  const trend7d = scoreFromDelta(audience.trend7dPercent);
  const components: MorroDemandIndexComponents = {
    audienceLevel,
    trend24h,
    trend7d,
    performance,
    calendarEvent,
    seasonality,
    capacity,
  };
  const weighted =
    audienceLevel * 0.25 +
    trend24h * 0.15 +
    trend7d * 0.1 +
    performance * 0.25 +
    calendarEvent * 0.1 +
    seasonality * 0.1 +
    capacity * 0.05;
  const result = Math.round(clamp(weighted, 0, 100));

  return {
    score: result,
    band: bandForScore(result),
    confidence: audience.confidence,
    components,
    audience,
  };
}

function score(value: number | undefined): number {
  return value === undefined ? DEFAULT_CONTEXT_SCORE : clamp(value, 0, 100);
}

function scoreFromRatio(current: number, baseline: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(baseline) || baseline <= 0) {
    return DEFAULT_CONTEXT_SCORE;
  }
  return clamp(50 + ((current - baseline) / baseline) * 125, 0, 100);
}

function scoreFromDelta(deltaPercent: number | undefined): number {
  if (deltaPercent === undefined || !Number.isFinite(deltaPercent)) return DEFAULT_CONTEXT_SCORE;
  return clamp(50 + deltaPercent * 1.25, 0, 100);
}

function changePercentForDemand(index: number): number {
  if (index < 30) return -20;
  if (index < 45) return -10;
  if (index < 60) return 0;
  if (index < 75) return 10;
  if (index < 90) return 15;
  return 20;
}

function bandForScore(index: number): MorroDemandIndexResult['band'] {
  if (index < 30) return 'LOW';
  if (index < 45) return 'GUARDED';
  if (index < 60) return 'NORMAL';
  if (index < 90) return 'HIGH';
  return 'PEAK';
}

function confidenceScore(input: {
  readonly estimateReady: boolean;
  readonly historyCount: number;
  readonly has24h: boolean;
  readonly has7d: boolean;
}): number {
  if (!input.estimateReady) return 0;
  let value = 0.4;
  if (input.historyCount >= 3) value += 0.2;
  if (input.has24h) value += 0.2;
  if (input.has7d) value += 0.2;
  return clamp(value, 0, 1);
}

function nearestTo(
  samples: readonly MetaAdsGeoAudienceSample[],
  targetMs: number,
  toleranceMs: number,
): MetaAdsGeoAudienceSample | undefined {
  let best: MetaAdsGeoAudienceSample | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const sample of samples) {
    const distance = Math.abs(Date.parse(sample.observedAt) - targetMs);
    if (distance <= toleranceMs && distance < bestDistance) {
      best = sample;
      bestDistance = distance;
    }
  }
  return best;
}

function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const middleValue = sorted[middle];
  if (middleValue === undefined) return undefined;
  if (sorted.length % 2 === 1) return middleValue;
  const previous = sorted[middle - 1];
  return previous === undefined ? middleValue : (previous + middleValue) / 2;
}

function midpointOf(lowerBound: number, upperBound: number): number {
  if (!Number.isFinite(lowerBound) || !Number.isFinite(upperBound)) {
    throw new Error('META_ADS_DEMAND_AUDIENCE_BOUNDS_INVALID');
  }
  if (lowerBound < 0 || upperBound < lowerBound) {
    throw new Error('META_ADS_DEMAND_AUDIENCE_BOUNDS_INVALID');
  }
  return (lowerBound + upperBound) / 2;
}

function percentChange(current: number, baseline: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(baseline) || baseline <= 0) return 0;
  return ((current - baseline) / baseline) * 100;
}

function normalizeTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error('META_ADS_DEMAND_OBSERVED_AT_INVALID');
  return new Date(parsed).toISOString();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
