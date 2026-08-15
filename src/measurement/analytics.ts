import type { EventRecord } from '../events/event-record.js';
import {
  type AttributionConfidence,
  type AttributionModel,
  type AttributionResult,
  type AttributionTouchpoint,
  type DataQualityIssue,
  type DataQualityReport,
  type EventSalesPacing,
  type FunnelResult,
  type FunnelStage,
} from './contracts.js';
import { nonNegativeInteger, timestamp } from './normalization.js';

export function calculateFunnel(stages: readonly FunnelStage[]): FunnelResult {
  if (stages.length < 2) throw new Error('FUNNEL_MINIMUM_STAGES_REQUIRED');
  const normalized = stages.map((stage) => ({
    name: requireText(stage.name, 'FUNNEL_STAGE_NAME_REQUIRED'),
    count: nonNegativeInteger(stage.count, 'FUNNEL_STAGE_COUNT_INVALID'),
  }));
  const issues: DataQualityIssue[] = [];
  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1]!;
    const current = normalized[index]!;
    if (current.count > previous.count) {
      issues.push({
        code: 'FUNNEL_STAGE_INCREASE',
        severity: 'WARNING',
        field: current.name,
        message: `Stage ${current.name} exceeds prior stage ${previous.name}.`,
      });
    }
  }
  const first = normalized[0]!.count;
  const last = normalized.at(-1)?.count ?? 0;
  const dropOffs = normalized.slice(1).map((stage, offset) => {
    const previous = normalized[offset]!;
    const dropped = Math.max(0, previous.count - stage.count);
    return {
      from: previous.name,
      to: stage.name,
      count: dropped,
      rate: previous.count === 0 ? null : dropped / previous.count,
    };
  });
  const dataQuality: DataQualityReport = {
    valid: true,
    score: Math.max(0, Math.min(1, 1 - issues.length * 0.15)),
    issues,
  };
  return {
    stages: normalized,
    conversionRate: first === 0 ? null : last / first,
    dropOffs,
    dataQuality,
  };
}

export function calculateAttribution(input: {
  readonly model: AttributionModel;
  readonly touchpoints: readonly AttributionTouchpoint[];
  readonly conversionOccurredAt: string;
  readonly sourceQualityScore: number;
  readonly identityContinuityScore: number;
  readonly reconciliationScore: number;
}): AttributionResult {
  if (input.touchpoints.length === 0) throw new Error('ATTRIBUTION_TOUCHPOINT_REQUIRED');
  const conversionTime = Date.parse(
    timestamp(input.conversionOccurredAt, 'ATTRIBUTION_CONVERSION_TIME_INVALID'),
  );
  const touchpoints = [...input.touchpoints]
    .map((touchpoint) => ({
      ...touchpoint,
      touchpointId: requireText(touchpoint.touchpointId, 'ATTRIBUTION_TOUCHPOINT_ID_REQUIRED'),
      occurredAt: timestamp(touchpoint.occurredAt, 'ATTRIBUTION_TOUCHPOINT_TIME_INVALID'),
    }))
    .filter((touchpoint) => Date.parse(touchpoint.occurredAt) <= conversionTime)
    .sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt));
  if (touchpoints.length === 0)
    throw new Error('ATTRIBUTION_TOUCHPOINT_BEFORE_CONVERSION_REQUIRED');

  const linearCredit = 1 / touchpoints.length;
  const credits = touchpoints.map((touchpoint, index) => ({
    ...touchpoint,
    credit:
      input.model === 'FIRST_TOUCH'
        ? index === 0
          ? 1
          : 0
        : input.model === 'LAST_TOUCH'
          ? index === touchpoints.length - 1
            ? 1
            : 0
          : linearCredit,
  }));
  const hasCampaignIdentity = touchpoints.some(
    (touchpoint) =>
      touchpoint.campaignId || touchpoint.campaign || touchpoint.contentId || touchpoint.content,
  );
  return {
    model: input.model,
    credits,
    confidence: calculateAttributionConfidence({
      sourceQualityScore: input.sourceQualityScore,
      identityContinuityScore: input.identityContinuityScore,
      reconciliationScore: input.reconciliationScore,
      hasCampaignIdentity,
      touchpointCount: touchpoints.length,
    }),
  };
}

export function calculateAttributionConfidence(input: {
  readonly sourceQualityScore: number;
  readonly identityContinuityScore: number;
  readonly reconciliationScore: number;
  readonly hasCampaignIdentity: boolean;
  readonly touchpointCount: number;
}): AttributionConfidence {
  const sourceQuality = score(input.sourceQualityScore, 'ATTRIBUTION_SOURCE_QUALITY_INVALID');
  const identityContinuity = score(
    input.identityContinuityScore,
    'ATTRIBUTION_IDENTITY_CONTINUITY_INVALID',
  );
  const reconciliation = score(
    input.reconciliationScore,
    'ATTRIBUTION_RECONCILIATION_SCORE_INVALID',
  );
  if (!Number.isInteger(input.touchpointCount) || input.touchpointCount < 1) {
    throw new Error('ATTRIBUTION_TOUCHPOINT_COUNT_INVALID');
  }
  const campaignIdentity = input.hasCampaignIdentity ? 1 : 0.5;
  const sample = Math.min(1, input.touchpointCount / 3);
  const result =
    sourceQuality * 0.3 +
    identityContinuity * 0.3 +
    reconciliation * 0.25 +
    campaignIdentity * 0.1 +
    sample * 0.05;
  const normalized = Math.max(0, Math.min(1, result));
  const reasons: string[] = [];
  if (sourceQuality < 0.7) reasons.push('SOURCE_QUALITY_WEAK');
  if (identityContinuity < 0.7) reasons.push('IDENTITY_CONTINUITY_WEAK');
  if (reconciliation < 0.7) reasons.push('CONVERSION_RECONCILIATION_WEAK');
  if (!input.hasCampaignIdentity) reasons.push('CAMPAIGN_IDENTITY_MISSING');
  if (input.touchpointCount < 2) reasons.push('TOUCHPOINT_SAMPLE_SMALL');
  return {
    score: normalized,
    level:
      normalized < 0.35
        ? 'UNUSABLE'
        : normalized < 0.6
          ? 'LOW'
          : normalized < 0.8
            ? 'MEDIUM'
            : 'HIGH',
    reasons,
  };
}

export function assertAttributionUsable(confidence: AttributionConfidence): void {
  if (confidence.level === 'UNUSABLE') {
    throw new Error(`ATTRIBUTION_UNCERTAIN:${confidence.reasons.join(',')}`);
  }
}

export function calculateSalesPacing(input: {
  readonly event: EventRecord;
  readonly salesStartedAt: string;
  readonly asOf: string;
  readonly sold: number;
  readonly capacity: number | null;
  readonly dataQualityScore: number;
}): EventSalesPacing {
  const salesStartedAt = Date.parse(timestamp(input.salesStartedAt, 'SALES_PACING_START_INVALID'));
  const asOfIso = timestamp(input.asOf, 'SALES_PACING_AS_OF_INVALID');
  const asOf = Date.parse(asOfIso);
  const eventStartsAt = Date.parse(
    timestamp(input.event.startsAt, 'SALES_PACING_EVENT_START_INVALID'),
  );
  if (asOf < salesStartedAt) throw new Error('SALES_PACING_AS_OF_BEFORE_SALES_START');
  if (eventStartsAt <= salesStartedAt) throw new Error('SALES_PACING_EVENT_WINDOW_INVALID');

  const sold = nonNegativeInteger(input.sold, 'SALES_PACING_SOLD_INVALID');
  const capacity =
    input.capacity === null
      ? null
      : nonNegativeInteger(input.capacity, 'SALES_PACING_CAPACITY_INVALID');
  if (capacity !== null && sold > capacity) throw new Error('SALES_PACING_SOLD_EXCEEDS_CAPACITY');

  const elapsedMs = Math.max(0, Math.min(asOf, eventStartsAt) - salesStartedAt);
  const totalMs = eventStartsAt - salesStartedAt;
  const elapsedSalesWindowRatio = totalMs === 0 ? 1 : elapsedMs / totalMs;
  const sellThroughRate = capacity && capacity > 0 ? sold / capacity : null;
  const paceRatio =
    sellThroughRate === null || elapsedSalesWindowRatio <= 0
      ? null
      : sellThroughRate / elapsedSalesWindowRatio;
  const elapsedDays = elapsedMs / 86_400_000;
  const ticketsPerDay = elapsedDays <= 0 ? 0 : sold / elapsedDays;
  const remaining = capacity === null ? null : Math.max(0, capacity - sold);
  const projectedSelloutAt =
    remaining === null || remaining === 0 || ticketsPerDay <= 0
      ? remaining === 0
        ? asOfIso
        : null
      : new Date(asOf + (remaining / ticketsPerDay) * 86_400_000).toISOString();
  const quality = score(input.dataQualityScore, 'SALES_PACING_DATA_QUALITY_INVALID');
  const baseConfidence = calculateAttributionConfidence({
    sourceQualityScore: quality,
    identityContinuityScore: 1,
    reconciliationScore: quality,
    hasCampaignIdentity: true,
    touchpointCount: capacity === null ? 1 : 3,
  });
  const confidence: AttributionConfidence =
    capacity === null
      ? {
          ...baseConfidence,
          reasons: [...baseConfidence.reasons, 'EVENT_CAPACITY_UNKNOWN'],
        }
      : baseConfidence;

  return {
    eventId: input.event.eventId,
    asOf: asOfIso,
    sold,
    capacity,
    sellThroughRate,
    elapsedSalesWindowRatio,
    paceRatio,
    ticketsPerDay,
    projectedSelloutAt,
    confidence,
  };
}

export function reconciliationConfidence(input: {
  readonly measuredConversions: number;
  readonly ticketConversions: number;
  readonly matchedConversions: number;
  readonly sourceQualityScore: number;
}): AttributionConfidence {
  const measured = nonNegativeInteger(input.measuredConversions, 'RECONCILIATION_MEASURED_INVALID');
  const ticket = nonNegativeInteger(input.ticketConversions, 'RECONCILIATION_TICKET_INVALID');
  const matched = nonNegativeInteger(input.matchedConversions, 'RECONCILIATION_MATCHED_INVALID');
  if (matched > measured || matched > ticket) {
    throw new Error('RECONCILIATION_MATCHED_EXCEEDS_TOTAL');
  }
  const denominator = Math.max(measured, ticket, 1);
  const reconciliationScore = matched / denominator;
  return calculateAttributionConfidence({
    sourceQualityScore: input.sourceQualityScore,
    identityContinuityScore: reconciliationScore,
    reconciliationScore,
    hasCampaignIdentity: true,
    touchpointCount: denominator >= 3 ? 3 : denominator,
  });
}

function score(value: number, errorCode: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(errorCode);
  return value;
}

function requireText(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}
