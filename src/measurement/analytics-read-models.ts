import type { OperationalCapacityAssessment } from './capacity-intelligence.js';

export const ANALYTICS_METRIC_STATES = ['AVAILABLE', 'UNAVAILABLE', 'AMBIGUOUS'] as const;
export type AnalyticsMetricState = (typeof ANALYTICS_METRIC_STATES)[number];

export interface AnalyticsScope {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
}

export interface AnalyticsWindow {
  readonly startsAt: string;
  readonly endsAt: string;
}

export interface MoneyAmount {
  readonly valueMinor: number;
  readonly currency: string;
}

export interface AnalyticsMetric<T> {
  readonly state: AnalyticsMetricState;
  readonly value: T | null;
  readonly reason: string | null;
  readonly evidence: readonly string[];
}

export interface MarketingAggregate {
  readonly reach: number | null;
  readonly engagements: number | null;
  readonly spend: MoneyAmount | null;
  readonly evidence: readonly string[];
}

export interface CrmAggregate {
  readonly leadsCaptured: number;
  readonly qualifiedLeads: number;
  readonly opportunitiesCreated: number;
  readonly opportunitiesWon: number;
  readonly opportunitiesLost: number;
  readonly wonCustomers: number;
  readonly openOpportunities: number;
  readonly openPipelineValue: MoneyAmount | null;
  readonly averageOpenOpportunityAgeDays: number | null;
  readonly evidence: readonly string[];
}

export interface ReliabilityAggregate {
  readonly total: number;
  readonly successful: number;
  readonly failed: number;
  readonly evidence: readonly string[];
}

export interface ResponseSlaAggregate {
  readonly eligible: number;
  readonly withinSla: number;
  readonly evidence: readonly string[];
}

export interface CreativePerformanceObservation {
  readonly creativeId: string;
  readonly contentId: string | null;
  readonly campaignId: string | null;
  readonly adId: string | null;
  readonly reach: number | null;
  readonly engagements: number | null;
  readonly conversions: number | null;
  readonly spend: MoneyAmount | null;
  readonly attributedRevenue: MoneyAmount | null;
  readonly evidence: readonly string[];
}

export interface CreativePerformanceMetric extends CreativePerformanceObservation {
  readonly engagementRate: number | null;
  readonly conversionRate: number | null;
  readonly roas: number | null;
}

export interface DemandSignalInput {
  readonly index: number;
  readonly confidence: number;
  readonly observedAt: string;
  readonly evidence: readonly string[];
}

export interface AnalyticsReadModelInput {
  readonly scope: AnalyticsScope;
  readonly window: AnalyticsWindow;
  readonly marketing: MarketingAggregate | null;
  readonly crm: CrmAggregate;
  readonly revenue: MoneyAmount | null;
  readonly responseSla: ResponseSlaAggregate | null;
  readonly publicationReliability: ReliabilityAggregate | null;
  readonly providerReliability: ReliabilityAggregate | null;
  readonly creativePerformance: readonly CreativePerformanceObservation[];
  readonly demand: DemandSignalInput | null;
  readonly capacity: OperationalCapacityAssessment | null;
  readonly evidence: readonly string[];
}

export interface ExecutiveAnalyticsSnapshot {
  readonly scope: AnalyticsScope;
  readonly window: AnalyticsWindow;
  readonly reach: AnalyticsMetric<number>;
  readonly engagement: AnalyticsMetric<number>;
  readonly spend: AnalyticsMetric<MoneyAmount>;
  readonly cpl: AnalyticsMetric<MoneyAmount>;
  readonly qualifiedLeadRate: AnalyticsMetric<number>;
  readonly opportunityRate: AnalyticsMetric<number>;
  readonly winRate: AnalyticsMetric<number>;
  readonly cac: AnalyticsMetric<MoneyAmount>;
  readonly revenue: AnalyticsMetric<MoneyAmount>;
  readonly roas: AnalyticsMetric<number>;
  readonly responseSlaComplianceRate: AnalyticsMetric<number>;
  readonly pipelineValue: AnalyticsMetric<MoneyAmount>;
  readonly averageOpenOpportunityAgeDays: AnalyticsMetric<number>;
  readonly creativePerformance: AnalyticsMetric<readonly CreativePerformanceMetric[]>;
  readonly demandIndex: AnalyticsMetric<number>;
  readonly capacity: AnalyticsMetric<OperationalCapacityAssessment>;
  readonly publicationReliabilityRate: AnalyticsMetric<number>;
  readonly providerFailureRate: AnalyticsMetric<number>;
  readonly evidence: readonly string[];
}

export interface AnalyticsDrilldownTouchpoint {
  readonly measurementEventId: string;
  readonly occurredAt: string;
  readonly source: string | null;
  readonly medium: string | null;
  readonly campaign: string | null;
  readonly campaignId: string | null;
  readonly adId: string | null;
  readonly creativeId: string | null;
  readonly contentId: string | null;
  readonly evidence: readonly string[];
}

export interface AnalyticsDrilldown {
  readonly resultKey: string;
  readonly opportunityId: string;
  readonly leadId: string;
  readonly contactId: string;
  readonly touchpoints: readonly AnalyticsDrilldownTouchpoint[];
  readonly campaignIds: readonly string[];
  readonly adIds: readonly string[];
  readonly creativeIds: readonly string[];
  readonly contentIds: readonly string[];
  readonly evidence: readonly string[];
}

export function buildExecutiveAnalyticsSnapshot(
  input: AnalyticsReadModelInput,
): ExecutiveAnalyticsSnapshot {
  validateScope(input.scope);
  validateWindow(input.window);
  validateCrmAggregate(input.crm);
  if (input.marketing !== null) validateMarketingAggregate(input.marketing);
  if (input.revenue !== null) validateMoney(input.revenue, 'ANALYTICS_REVENUE_INVALID');
  if (input.responseSla !== null)
    validateReliabilityPair(
      input.responseSla.eligible,
      input.responseSla.withinSla,
      'ANALYTICS_RESPONSE_SLA_INVALID',
    );
  if (input.publicationReliability !== null) validateReliability(input.publicationReliability);
  if (input.providerReliability !== null) validateReliability(input.providerReliability);
  if (input.demand !== null) validateDemand(input.demand);

  const rootEvidence = normalizeEvidence([
    ...input.evidence,
    ...input.crm.evidence,
    ...(input.marketing?.evidence ?? []),
    ...(input.responseSla?.evidence ?? []),
    ...(input.publicationReliability?.evidence ?? []),
    ...(input.providerReliability?.evidence ?? []),
    ...(input.demand?.evidence ?? []),
    ...(input.capacity?.evidence ?? []),
  ]);

  const spend = input.marketing?.spend ?? null;
  const revenue = input.revenue;
  const closedOpportunities = input.crm.opportunitiesWon + input.crm.opportunitiesLost;

  return {
    scope: input.scope,
    window: input.window,
    reach: numberOrUnavailable(
      input.marketing?.reach ?? null,
      'REACH_SOURCE_UNAVAILABLE',
      input.marketing?.evidence ?? [],
    ),
    engagement: numberOrUnavailable(
      input.marketing?.engagements ?? null,
      'ENGAGEMENT_SOURCE_UNAVAILABLE',
      input.marketing?.evidence ?? [],
    ),
    spend: moneyOrUnavailable(spend, 'SPEND_SOURCE_UNAVAILABLE', input.marketing?.evidence ?? []),
    cpl: calculateUnitCost(
      spend,
      input.crm.leadsCaptured,
      'CPL_DENOMINATOR_UNAVAILABLE',
      rootEvidence,
    ),
    qualifiedLeadRate: calculateRatio(
      input.crm.qualifiedLeads,
      input.crm.leadsCaptured,
      'QUALIFIED_LEAD_DENOMINATOR_UNAVAILABLE',
      input.crm.evidence,
    ),
    opportunityRate: calculateRatio(
      input.crm.opportunitiesCreated,
      input.crm.qualifiedLeads,
      'OPPORTUNITY_DENOMINATOR_UNAVAILABLE',
      input.crm.evidence,
    ),
    winRate: calculateRatio(
      input.crm.opportunitiesWon,
      closedOpportunities,
      'WIN_RATE_DENOMINATOR_UNAVAILABLE',
      input.crm.evidence,
    ),
    cac: calculateUnitCost(
      spend,
      input.crm.wonCustomers,
      'CAC_DENOMINATOR_UNAVAILABLE',
      rootEvidence,
    ),
    revenue: moneyOrUnavailable(revenue, 'REVENUE_SOURCE_UNAVAILABLE', rootEvidence),
    roas: calculateRoas(revenue, spend, rootEvidence),
    responseSlaComplianceRate:
      input.responseSla === null
        ? unavailable('RESPONSE_SLA_SOURCE_UNAVAILABLE', rootEvidence)
        : calculateRatio(
            input.responseSla.withinSla,
            input.responseSla.eligible,
            'RESPONSE_SLA_DENOMINATOR_UNAVAILABLE',
            input.responseSla.evidence,
          ),
    pipelineValue: moneyOrUnavailable(
      input.crm.openPipelineValue,
      'PIPELINE_VALUE_SOURCE_UNAVAILABLE',
      input.crm.evidence,
    ),
    averageOpenOpportunityAgeDays: numberOrUnavailable(
      input.crm.averageOpenOpportunityAgeDays,
      'PIPELINE_AGING_SOURCE_UNAVAILABLE',
      input.crm.evidence,
    ),
    creativePerformance: buildCreativePerformanceMetric(input.creativePerformance),
    demandIndex:
      input.demand === null
        ? unavailable('DEMAND_INDEX_SOURCE_UNAVAILABLE', rootEvidence)
        : available(input.demand.index, input.demand.evidence),
    capacity:
      input.capacity === null
        ? unavailable('CAPACITY_SOURCE_UNAVAILABLE', rootEvidence)
        : available(input.capacity, input.capacity.evidence),
    publicationReliabilityRate:
      input.publicationReliability === null
        ? unavailable('PUBLICATION_RELIABILITY_SOURCE_UNAVAILABLE', rootEvidence)
        : calculateRatio(
            input.publicationReliability.successful,
            input.publicationReliability.total,
            'PUBLICATION_RELIABILITY_DENOMINATOR_UNAVAILABLE',
            input.publicationReliability.evidence,
          ),
    providerFailureRate:
      input.providerReliability === null
        ? unavailable('PROVIDER_RELIABILITY_SOURCE_UNAVAILABLE', rootEvidence)
        : calculateRatio(
            input.providerReliability.failed,
            input.providerReliability.total,
            'PROVIDER_RELIABILITY_DENOMINATOR_UNAVAILABLE',
            input.providerReliability.evidence,
          ),
    evidence: rootEvidence,
  };
}

export function validateAnalyticsDrilldown(drilldown: AnalyticsDrilldown): void {
  requireText(drilldown.resultKey, 'ANALYTICS_DRILLDOWN_RESULT_REQUIRED');
  requireText(drilldown.opportunityId, 'ANALYTICS_DRILLDOWN_OPPORTUNITY_REQUIRED');
  requireText(drilldown.leadId, 'ANALYTICS_DRILLDOWN_LEAD_REQUIRED');
  requireText(drilldown.contactId, 'ANALYTICS_DRILLDOWN_CONTACT_REQUIRED');
  if (normalizeEvidence(drilldown.evidence).length === 0)
    throw new Error('ANALYTICS_DRILLDOWN_EVIDENCE_REQUIRED');
  for (const touchpoint of drilldown.touchpoints) {
    requireText(touchpoint.measurementEventId, 'ANALYTICS_TOUCHPOINT_ID_REQUIRED');
    if (!Number.isFinite(Date.parse(touchpoint.occurredAt)))
      throw new Error('ANALYTICS_TOUCHPOINT_TIME_INVALID');
    if (normalizeEvidence(touchpoint.evidence).length === 0)
      throw new Error('ANALYTICS_TOUCHPOINT_EVIDENCE_REQUIRED');
  }
}

function buildCreativePerformanceMetric(
  observations: readonly CreativePerformanceObservation[],
): AnalyticsMetric<readonly CreativePerformanceMetric[]> {
  if (observations.length === 0) return unavailable('CREATIVE_PERFORMANCE_SOURCE_UNAVAILABLE', []);
  const metrics = observations
    .map((observation) => {
      requireText(observation.creativeId, 'ANALYTICS_CREATIVE_ID_REQUIRED');
      validateOptionalNonNegative(observation.reach, 'ANALYTICS_CREATIVE_REACH_INVALID');
      validateOptionalNonNegative(observation.engagements, 'ANALYTICS_CREATIVE_ENGAGEMENT_INVALID');
      validateOptionalNonNegative(
        observation.conversions,
        'ANALYTICS_CREATIVE_CONVERSIONS_INVALID',
      );
      if (observation.spend !== null)
        validateMoney(observation.spend, 'ANALYTICS_CREATIVE_SPEND_INVALID');
      if (observation.attributedRevenue !== null)
        validateMoney(observation.attributedRevenue, 'ANALYTICS_CREATIVE_REVENUE_INVALID');
      const engagementRate =
        observation.reach !== null && observation.reach > 0 && observation.engagements !== null
          ? observation.engagements / observation.reach
          : null;
      const conversionRate =
        observation.reach !== null && observation.reach > 0 && observation.conversions !== null
          ? observation.conversions / observation.reach
          : null;
      const roas = calculateOptionalRoas(observation.attributedRevenue, observation.spend);
      return { ...observation, engagementRate, conversionRate, roas };
    })
    .sort((left, right) => left.creativeId.localeCompare(right.creativeId));
  return available(metrics, normalizeEvidence(metrics.flatMap((metric) => metric.evidence)));
}

function calculateUnitCost(
  amount: MoneyAmount | null,
  denominator: number,
  noDenominatorReason: string,
  evidence: readonly string[],
): AnalyticsMetric<MoneyAmount> {
  if (amount === null) return unavailable('SPEND_SOURCE_UNAVAILABLE', evidence);
  if (denominator <= 0) return unavailable(noDenominatorReason, evidence);
  return available(
    {
      valueMinor: Math.round(amount.valueMinor / denominator),
      currency: amount.currency,
    },
    evidence,
  );
}

function calculateRoas(
  revenue: MoneyAmount | null,
  spend: MoneyAmount | null,
  evidence: readonly string[],
): AnalyticsMetric<number> {
  if (revenue === null) return unavailable('REVENUE_SOURCE_UNAVAILABLE', evidence);
  if (spend === null) return unavailable('SPEND_SOURCE_UNAVAILABLE', evidence);
  if (revenue.currency !== spend.currency) return ambiguous('ROAS_CURRENCY_MISMATCH', evidence);
  if (spend.valueMinor <= 0) return unavailable('ROAS_SPEND_DENOMINATOR_UNAVAILABLE', evidence);
  return available(revenue.valueMinor / spend.valueMinor, evidence);
}

function calculateOptionalRoas(
  revenue: MoneyAmount | null,
  spend: MoneyAmount | null,
): number | null {
  if (revenue === null || spend === null) return null;
  if (revenue.currency !== spend.currency || spend.valueMinor <= 0) return null;
  return revenue.valueMinor / spend.valueMinor;
}

function calculateRatio(
  numerator: number,
  denominator: number,
  noDenominatorReason: string,
  evidence: readonly string[],
): AnalyticsMetric<number> {
  if (denominator <= 0) return unavailable(noDenominatorReason, evidence);
  return available(numerator / denominator, evidence);
}

function numberOrUnavailable(
  value: number | null,
  reason: string,
  evidence: readonly string[],
): AnalyticsMetric<number> {
  if (value === null) return unavailable(reason, evidence);
  if (!Number.isFinite(value) || value < 0) throw new Error('ANALYTICS_METRIC_NUMBER_INVALID');
  return available(value, evidence);
}

function moneyOrUnavailable(
  value: MoneyAmount | null,
  reason: string,
  evidence: readonly string[],
): AnalyticsMetric<MoneyAmount> {
  if (value === null) return unavailable(reason, evidence);
  validateMoney(value, 'ANALYTICS_MONEY_INVALID');
  return available(value, evidence);
}

function available<T>(value: T, evidence: readonly string[]): AnalyticsMetric<T> {
  return {
    state: 'AVAILABLE',
    value,
    reason: null,
    evidence: normalizeEvidence(evidence),
  };
}

function unavailable<T>(reason: string, evidence: readonly string[]): AnalyticsMetric<T> {
  return {
    state: 'UNAVAILABLE',
    value: null,
    reason,
    evidence: normalizeEvidence(evidence),
  };
}

function ambiguous<T>(reason: string, evidence: readonly string[]): AnalyticsMetric<T> {
  return {
    state: 'AMBIGUOUS',
    value: null,
    reason,
    evidence: normalizeEvidence(evidence),
  };
}

function validateScope(scope: AnalyticsScope): void {
  requireText(scope.tenantId, 'ANALYTICS_TENANT_ID_REQUIRED');
  requireText(scope.workspaceId, 'ANALYTICS_WORKSPACE_ID_REQUIRED');
  requireText(scope.organizationId, 'ANALYTICS_ORGANIZATION_ID_REQUIRED');
}

function validateWindow(window: AnalyticsWindow): void {
  const startsAt = Date.parse(window.startsAt);
  const endsAt = Date.parse(window.endsAt);
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) {
    throw new Error('ANALYTICS_WINDOW_INVALID');
  }
}

function validateCrmAggregate(crm: CrmAggregate): void {
  for (const value of [
    crm.leadsCaptured,
    crm.qualifiedLeads,
    crm.opportunitiesCreated,
    crm.opportunitiesWon,
    crm.opportunitiesLost,
    crm.wonCustomers,
    crm.openOpportunities,
  ]) {
    if (!Number.isInteger(value) || value < 0) throw new Error('ANALYTICS_CRM_COUNT_INVALID');
  }
  if (crm.qualifiedLeads > crm.leadsCaptured) throw new Error('ANALYTICS_QUALIFIED_EXCEEDS_LEADS');
  if (crm.openPipelineValue !== null)
    validateMoney(crm.openPipelineValue, 'ANALYTICS_PIPELINE_VALUE_INVALID');
  validateOptionalNonNegative(
    crm.averageOpenOpportunityAgeDays,
    'ANALYTICS_PIPELINE_AGING_INVALID',
  );
}

function validateMarketingAggregate(marketing: MarketingAggregate): void {
  validateOptionalNonNegative(marketing.reach, 'ANALYTICS_REACH_INVALID');
  validateOptionalNonNegative(marketing.engagements, 'ANALYTICS_ENGAGEMENT_INVALID');
  if (marketing.spend !== null) validateMoney(marketing.spend, 'ANALYTICS_SPEND_INVALID');
}

function validateReliability(aggregate: ReliabilityAggregate): void {
  for (const value of [aggregate.total, aggregate.successful, aggregate.failed]) {
    if (!Number.isInteger(value) || value < 0)
      throw new Error('ANALYTICS_RELIABILITY_COUNT_INVALID');
  }
  if (aggregate.successful + aggregate.failed > aggregate.total) {
    throw new Error('ANALYTICS_RELIABILITY_COUNTS_EXCEED_TOTAL');
  }
}

function validateReliabilityPair(total: number, subset: number, code: string): void {
  if (
    !Number.isInteger(total) ||
    !Number.isInteger(subset) ||
    total < 0 ||
    subset < 0 ||
    subset > total
  ) {
    throw new Error(code);
  }
}

function validateDemand(demand: DemandSignalInput): void {
  if (!Number.isFinite(demand.index) || demand.index < 0 || demand.index > 100) {
    throw new Error('ANALYTICS_DEMAND_INDEX_INVALID');
  }
  if (!Number.isFinite(demand.confidence) || demand.confidence < 0 || demand.confidence > 1) {
    throw new Error('ANALYTICS_DEMAND_CONFIDENCE_INVALID');
  }
  if (!Number.isFinite(Date.parse(demand.observedAt)))
    throw new Error('ANALYTICS_DEMAND_TIME_INVALID');
}

function validateMoney(value: MoneyAmount, code: string): void {
  if (
    !Number.isSafeInteger(value.valueMinor) ||
    value.valueMinor < 0 ||
    !/^[A-Z]{3}$/.test(value.currency)
  ) {
    throw new Error(code);
  }
}

function validateOptionalNonNegative(value: number | null, code: string): void {
  if (value !== null && (!Number.isFinite(value) || value < 0)) throw new Error(code);
}

function requireText(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

export function normalizeAnalyticsEvidence(evidence: readonly string[]): readonly string[] {
  return normalizeEvidence(evidence);
}

function normalizeEvidence(evidence: readonly string[]): readonly string[] {
  return [...new Set(evidence.map((item) => item.trim()).filter(Boolean))].sort();
}
