import type { LeadRecord, OpportunityRecord } from '../crm/crm-records.js';
import {
  validateAttributionTouchpoint,
  validateAttributionWindowPolicy,
  validateRevenueEvidence,
  type AttributionMutationMetadata,
  type AttributionTouchpointRecord,
  type AttributionWindowPolicy,
  type MarketingSalesFeedbackSnapshot,
  type ResolvedAttributionTouchpoint,
  type RevenueEvidenceRecord,
  type RevenueIntelligenceResult,
} from './attribution-revenue-contracts.js';

export function resolveAttributionRoles(input: {
  readonly touchpoints: readonly AttributionTouchpointRecord[];
  readonly policy: AttributionWindowPolicy;
  readonly conversionOccurredAt: string;
}): readonly ResolvedAttributionTouchpoint[] {
  validateAttributionWindowPolicy(input.policy);
  const conversionMs = Date.parse(
    timestamp(input.conversionOccurredAt, 'ATTRIBUTION_CONVERSION_TIME_INVALID'),
  );
  const eligible = input.touchpoints
    .map((touchpoint) => {
      validateAttributionTouchpoint(touchpoint);
      return touchpoint;
    })
    .filter((touchpoint) => Date.parse(touchpoint.occurredAt) <= conversionMs)
    .sort(compareTouchpoints);
  if (eligible.length === 0) return [];

  const firstWindow = withinDays(eligible, conversionMs, input.policy.firstTouchLookbackDays);
  const lastWindow = withinDays(eligible, conversionMs, input.policy.lastTouchLookbackDays);
  const assistedWindow = withinDays(eligible, conversionMs, input.policy.assistedLookbackDays);
  const firstId = firstWindow[0]?.touchpointId ?? null;
  const lastId = lastWindow.at(-1)?.touchpointId ?? null;
  const assistedIds = new Set(
    assistedWindow
      .map((touchpoint) => touchpoint.touchpointId)
      .filter((touchpointId) => touchpointId !== firstId && touchpointId !== lastId),
  );
  const includedIds = new Set([
    ...firstWindow.map((touchpoint) => touchpoint.touchpointId),
    ...lastWindow.map((touchpoint) => touchpoint.touchpointId),
    ...assistedWindow.map((touchpoint) => touchpoint.touchpointId),
  ]);

  return eligible
    .filter((touchpoint) => includedIds.has(touchpoint.touchpointId))
    .map((touchpoint) => ({
      ...touchpoint,
      roles: [
        ...(touchpoint.touchpointId === firstId ? (['FIRST_TOUCH'] as const) : []),
        ...(touchpoint.touchpointId === lastId ? (['LAST_TOUCH'] as const) : []),
        ...(assistedIds.has(touchpoint.touchpointId) ? (['ASSISTED'] as const) : []),
      ],
    }));
}

export function calculateRevenueIntelligence(
  records: readonly RevenueEvidenceRecord[],
): RevenueIntelligenceResult {
  if (records.length === 0) throw new Error('REVENUE_EVIDENCE_REQUIRED');
  const byDedupe = new Map<string, RevenueEvidenceRecord>();
  for (const record of records) {
    validateRevenueEvidence(record);
    const existing = byDedupe.get(record.dedupeKey);
    if (existing && !equivalentRevenueEvidence(existing, record)) {
      throw new Error('REVENUE_DEDUPE_CONFLICT');
    }
    byDedupe.set(record.dedupeKey, record);
  }
  const uniqueRecords = [...byDedupe.values()].sort((left, right) => {
    const time = Date.parse(left.occurredAt) - Date.parse(right.occurredAt);
    return time !== 0 ? time : left.revenueEvidenceId.localeCompare(right.revenueEvidenceId);
  });
  const currencies = new Set(
    uniqueRecords
      .map((record) => record.currency)
      .filter((value): value is string => value !== null),
  );
  if (currencies.size > 1) throw new Error('REVENUE_CURRENCY_MISMATCH');
  const currency = [...currencies][0] ?? null;

  const groups = new Map<string, RevenueEvidenceRecord[]>();
  for (const record of uniqueRecords) {
    const key = `${record.source}|${record.provider}|${record.externalReference}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }

  let grossRevenueMinor = 0;
  let refundMinor = 0;
  let realizedRevenueMinor = 0;
  let knownCostMinor = 0;
  let hasKnownCost = false;
  let confirmedReferences = 0;
  let refundedReferences = 0;
  let canceledReferences = 0;

  for (const group of groups.values()) {
    const confirmed = group.filter((record) => record.status === 'CONFIRMED');
    if (confirmed.length === 0) continue;
    const base = confirmed.at(-1)!;
    const baseRevenue = base.netRevenueMinor ?? base.grossRevenueMinor ?? 0;
    grossRevenueMinor += base.grossRevenueMinor ?? baseRevenue;
    confirmedReferences += 1;

    const canceled = group.some(
      (record) =>
        record.status === 'CANCELED' &&
        Date.parse(record.occurredAt) >= Date.parse(base.occurredAt),
    );
    const groupRefund = group
      .filter((record) => record.status === 'REFUNDED')
      .reduce((sum, record) => sum + (record.refundMinor ?? 0), 0);
    if (groupRefund > 0) refundedReferences += 1;
    if (canceled) canceledReferences += 1;
    refundMinor += Math.min(baseRevenue, groupRefund);
    const realized = canceled ? 0 : Math.max(0, baseRevenue - groupRefund);
    realizedRevenueMinor += realized;

    if (base.costMinor !== null) {
      hasKnownCost = true;
      knownCostMinor += canceled ? 0 : Math.min(base.costMinor, realized);
    }
  }

  return {
    currency,
    grossRevenueMinor,
    refundMinor,
    realizedRevenueMinor,
    contributionMarginMinor: hasKnownCost ? realizedRevenueMinor - knownCostMinor : null,
    confirmedReferences,
    refundedReferences,
    canceledReferences,
    evidenceRecordIds: uniqueRecords.map((record) => record.revenueEvidenceId),
  };
}

export function assertReliableWonEvidence(records: readonly RevenueEvidenceRecord[]): void {
  const revenue = calculateRevenueIntelligence(records);
  if (revenue.confirmedReferences < 1)
    throw new Error('CRM_WON_REQUIRES_VERIFIED_CONVERSION_EVIDENCE');
  const activeConfirmedReference = records.some((record) => {
    if (record.status !== 'CONFIRMED') return false;
    const laterRelated = records.filter(
      (candidate) =>
        candidate.source === record.source &&
        candidate.provider === record.provider &&
        candidate.externalReference === record.externalReference &&
        Date.parse(candidate.occurredAt) >= Date.parse(record.occurredAt),
    );
    if (laterRelated.some((candidate) => candidate.status === 'CANCELED')) return false;
    const refunds = laterRelated
      .filter((candidate) => candidate.status === 'REFUNDED')
      .reduce((sum, candidate) => sum + (candidate.refundMinor ?? 0), 0);
    const confirmedRevenue = record.netRevenueMinor ?? record.grossRevenueMinor;
    if (refunds === 0) return true;
    return confirmedRevenue !== null && refunds < confirmedRevenue;
  });
  if (!activeConfirmedReference) throw new Error('CRM_WON_REQUIRES_ACTIVE_CONVERSION_EVIDENCE');
}

export function buildMarketingSalesFeedback(input: {
  readonly feedbackId: string;
  readonly opportunity: OpportunityRecord;
  readonly lead: LeadRecord | null;
  readonly touchpoints: readonly ResolvedAttributionTouchpoint[];
  readonly revenueEvidence: readonly RevenueEvidenceRecord[];
  readonly metadata: AttributionMutationMetadata;
}): MarketingSalesFeedbackSnapshot {
  const opportunity = input.opportunity;
  if (opportunity.status === 'WON') assertReliableWonEvidence(input.revenueEvidence);
  const revenue =
    input.revenueEvidence.length > 0
      ? calculateRevenueIntelligence(input.revenueEvidence)
      : emptyRevenue();
  const primaryTouchpoint = chooseSalesTouchpoint(input.touchpoints);
  const salesCycleDays =
    opportunity.closedAt === null
      ? null
      : Math.max(
          0,
          (Date.parse(opportunity.closedAt) - Date.parse(opportunity.createdAt)) / 86_400_000,
        );
  const snapshot: MarketingSalesFeedbackSnapshot = {
    feedbackId: requireText(input.feedbackId, 'FEEDBACK_ID_REQUIRED'),
    opportunityId: opportunity.opportunityId,
    tenantId: opportunity.tenantId,
    workspaceId: opportunity.workspaceId,
    organizationId: opportunity.organizationId,
    marketing: {
      leadId: input.lead?.leadId ?? opportunity.leadId,
      opportunityId: opportunity.opportunityId,
      leadQuality: input.lead?.score ?? null,
      qualification: input.lead?.qualification ?? null,
      outcome: opportunity.status,
      reasonLost: opportunity.status === 'LOST' ? opportunity.lossReason : null,
      revenueMinor: revenue.realizedRevenueMinor,
      contributionMarginMinor: revenue.contributionMarginMinor,
      currency: revenue.currency,
      salesCycleDays,
    },
    sales: {
      opportunityId: opportunity.opportunityId,
      campaign: primaryTouchpoint?.utm.campaign ?? null,
      creative:
        primaryTouchpoint?.metaCreativeId ??
        primaryTouchpoint?.googleCreativeId ??
        primaryTouchpoint?.utm.content ??
        null,
      message: primaryTouchpoint?.messageRef ?? primaryTouchpoint?.messageId ?? null,
      source: primaryTouchpoint?.utm.source ?? primaryTouchpoint?.leadSource ?? null,
      intent: primaryTouchpoint?.intent ?? null,
      demandContext: primaryTouchpoint?.demandContext ?? {},
      touchpointId: primaryTouchpoint?.touchpointId ?? null,
      roles: primaryTouchpoint?.roles ?? [],
    },
    ...input.metadata,
  };
  requireMetadata(snapshot);
  return snapshot;
}

function chooseSalesTouchpoint(
  touchpoints: readonly ResolvedAttributionTouchpoint[],
): ResolvedAttributionTouchpoint | undefined {
  const lastTouch = touchpoints.find((touchpoint) => touchpoint.roles.includes('LAST_TOUCH'));
  return lastTouch ?? touchpoints.at(-1);
}

function emptyRevenue(): RevenueIntelligenceResult {
  return {
    currency: null,
    grossRevenueMinor: 0,
    refundMinor: 0,
    realizedRevenueMinor: 0,
    contributionMarginMinor: null,
    confirmedReferences: 0,
    refundedReferences: 0,
    canceledReferences: 0,
    evidenceRecordIds: [],
  };
}

function withinDays(
  touchpoints: readonly AttributionTouchpointRecord[],
  conversionMs: number,
  lookbackDays: number,
): AttributionTouchpointRecord[] {
  const threshold = conversionMs - lookbackDays * 86_400_000;
  return touchpoints.filter((touchpoint) => Date.parse(touchpoint.occurredAt) >= threshold);
}

function compareTouchpoints(
  left: AttributionTouchpointRecord,
  right: AttributionTouchpointRecord,
): number {
  const time = Date.parse(left.occurredAt) - Date.parse(right.occurredAt);
  return time !== 0 ? time : left.touchpointId.localeCompare(right.touchpointId);
}

function equivalentRevenueEvidence(
  left: RevenueEvidenceRecord,
  right: RevenueEvidenceRecord,
): boolean {
  return (
    JSON.stringify(canonicalRevenueEvidence(left)) ===
    JSON.stringify(canonicalRevenueEvidence(right))
  );
}

function canonicalRevenueEvidence(
  record: RevenueEvidenceRecord,
): Readonly<Record<string, unknown>> {
  return {
    source: record.source,
    provider: record.provider,
    providerEventId: record.providerEventId,
    providerEvidenceRef: record.providerEvidenceRef,
    externalReference: record.externalReference,
    status: record.status,
    occurredAt: record.occurredAt,
    currency: record.currency,
    grossRevenueMinor: record.grossRevenueMinor,
    netRevenueMinor: record.netRevenueMinor,
    refundMinor: record.refundMinor,
    costMinor: record.costMinor,
  };
}

function requireMetadata(metadata: AttributionMutationMetadata): void {
  requireText(metadata.idempotencyKey, 'ATTRIBUTION_IDEMPOTENCY_KEY_REQUIRED');
  requireText(metadata.executionId, 'ATTRIBUTION_EXECUTION_ID_REQUIRED');
  requireText(metadata.correlationId, 'ATTRIBUTION_CORRELATION_ID_REQUIRED');
  requireText(metadata.actorPrincipalId, 'ATTRIBUTION_ACTOR_REQUIRED');
  timestamp(metadata.createdAt, 'ATTRIBUTION_CREATED_AT_INVALID');
  const evidence = [...new Set(metadata.evidence.map((value) => value.trim()).filter(Boolean))];
  if (evidence.length === 0) throw new Error('ATTRIBUTION_EVIDENCE_REQUIRED');
}

function requireText(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}

function timestamp(value: string, errorCode: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error(errorCode);
  return new Date(value).toISOString();
}
