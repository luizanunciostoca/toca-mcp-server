import type { LeadRecord, OpportunityRecord } from '../crm/crm-records.js';
import type {
  MeasurementCapabilityContract,
  MeasurementPrimitive,
  MeasurementScope,
  UtmDimensions,
} from './contracts.js';

export const ATTRIBUTION_TOUCH_ROLES = ['FIRST_TOUCH', 'LAST_TOUCH', 'ASSISTED'] as const;
export type AttributionTouchRole = (typeof ATTRIBUTION_TOUCH_ROLES)[number];

export const REVENUE_EVIDENCE_SOURCES = ['TICKETING', 'CHECKOUT', 'PAYMENT', 'ORDER'] as const;
export type RevenueEvidenceSource = (typeof REVENUE_EVIDENCE_SOURCES)[number];

export const REVENUE_EVIDENCE_STATUSES = ['CONFIRMED', 'REFUNDED', 'CANCELED'] as const;
export type RevenueEvidenceStatus = (typeof REVENUE_EVIDENCE_STATUSES)[number];

export type DemandContext = Readonly<Record<string, MeasurementPrimitive>>;

export const ATTRIBUTION_REVENUE_CAPABILITY_CONTRACTS = [
  attributionCapability(
    'performance.attribution.window.configure',
    'WRITE_REVERSIBLE',
    'Persist a versioned attribution-window policy for first, last and assisted touch.',
  ),
  attributionCapability(
    'measurement.attribution.touchpoint.record',
    'WRITE_REVERSIBLE',
    'Persist a deduplicated CRM-linked attribution touchpoint with marketing lineage.',
  ),
  attributionCapability(
    'revenue.evidence.record',
    'WRITE_REVERSIBLE',
    'Persist provider-readback revenue evidence from ticketing, checkout, payment or order.',
  ),
  attributionCapability(
    'revenue.opportunity.confirm_won',
    'WRITE_REVERSIBLE',
    'Confirm an opportunity as WON only after reliable persisted conversion evidence.',
  ),
  attributionCapability(
    'performance.marketing_sales.feedback.record',
    'WRITE_REVERSIBLE',
    'Materialize the governed Marketing-to-Sales and Sales-to-Marketing feedback snapshot.',
  ),
] as const satisfies readonly MeasurementCapabilityContract[];

function attributionCapability(
  capabilityId: string,
  riskClass: 'READ' | 'WRITE_REVERSIBLE',
  description: string,
): MeasurementCapabilityContract {
  return {
    capabilityId,
    routeId: 'R31',
    riskClass,
    providerBoundary: 'INTERNAL',
    lifecycleStatus: 'IMPLEMENTED',
    sideEffects: riskClass !== 'READ',
    providerWritesAllowed: false,
    requiresEventRecord: false,
    description,
  };
}

export interface AttributionMutationMetadata {
  readonly idempotencyKey: string;
  readonly executionId: string;
  readonly correlationId: string;
  readonly actorPrincipalId: string;
  readonly evidence: readonly string[];
  readonly createdAt: string;
}

export interface AttributionWindowPolicy extends MeasurementScope, AttributionMutationMetadata {
  readonly policyId: string;
  readonly policyKey: string;
  readonly version: number;
  readonly firstTouchLookbackDays: number;
  readonly lastTouchLookbackDays: number;
  readonly assistedLookbackDays: number;
}

export interface AttributionTouchpointRecord extends MeasurementScope, AttributionMutationMetadata {
  readonly touchpointId: string;
  readonly dedupeKey: string;
  readonly contactId: string | null;
  readonly leadId: string | null;
  readonly opportunityId: string | null;
  readonly conversationId: string | null;
  readonly messageId: string | null;
  readonly channel: string;
  readonly utm: UtmDimensions;
  readonly metaCampaignId: string | null;
  readonly metaAdsetId: string | null;
  readonly metaAdId: string | null;
  readonly metaCreativeId: string | null;
  readonly googleCampaignId: string | null;
  readonly googleAdGroupId: string | null;
  readonly googleAdId: string | null;
  readonly googleCreativeId: string | null;
  readonly clickId: string | null;
  readonly fbclid: string | null;
  readonly gclid: string | null;
  readonly gbraid: string | null;
  readonly wbraid: string | null;
  readonly landingUrl: string | null;
  readonly sessionId: string | null;
  readonly leadSource: string | null;
  readonly ticketReference: string | null;
  readonly orderReference: string | null;
  readonly paymentReference: string | null;
  readonly checkoutReference: string | null;
  readonly messageRef: string | null;
  readonly intent: string | null;
  readonly demandContext: DemandContext;
  readonly attributionSource: string;
  readonly occurredAt: string;
}

export interface ResolvedAttributionTouchpoint extends AttributionTouchpointRecord {
  readonly roles: readonly AttributionTouchRole[];
}

export interface RevenueEvidenceRecord extends MeasurementScope, AttributionMutationMetadata {
  readonly revenueEvidenceId: string;
  readonly dedupeKey: string;
  readonly opportunityId: string;
  readonly contactId: string;
  readonly leadId: string | null;
  readonly conversationId: string | null;
  readonly eventId: string | null;
  readonly source: RevenueEvidenceSource;
  readonly provider: string;
  readonly providerEventId: string;
  readonly providerEvidenceRef: string;
  readonly externalReference: string;
  readonly status: RevenueEvidenceStatus;
  readonly providerReadbackAt: string;
  readonly occurredAt: string;
  readonly currency: string | null;
  readonly grossRevenueMinor: number | null;
  readonly netRevenueMinor: number | null;
  readonly refundMinor: number | null;
  readonly costMinor: number | null;
  readonly ticketReference: string | null;
  readonly orderReference: string | null;
  readonly paymentReference: string | null;
  readonly checkoutReference: string | null;
}

export interface RevenueIntelligenceResult {
  readonly currency: string | null;
  readonly grossRevenueMinor: number;
  readonly refundMinor: number;
  readonly realizedRevenueMinor: number;
  readonly contributionMarginMinor: number | null;
  readonly confirmedReferences: number;
  readonly refundedReferences: number;
  readonly canceledReferences: number;
  readonly evidenceRecordIds: readonly string[];
}

export interface MarketingFeedbackView {
  readonly leadId: string | null;
  readonly opportunityId: string;
  readonly leadQuality: number | null;
  readonly qualification: LeadRecord['qualification'] | null;
  readonly outcome: OpportunityRecord['status'];
  readonly reasonLost: string | null;
  readonly revenueMinor: number;
  readonly contributionMarginMinor: number | null;
  readonly currency: string | null;
  readonly salesCycleDays: number | null;
}

export interface SalesDemandContextView {
  readonly opportunityId: string;
  readonly campaign: string | null;
  readonly creative: string | null;
  readonly message: string | null;
  readonly source: string | null;
  readonly intent: string | null;
  readonly demandContext: DemandContext;
  readonly touchpointId: string | null;
  readonly roles: readonly AttributionTouchRole[];
}

export interface MarketingSalesFeedbackSnapshot
  extends MeasurementScope, AttributionMutationMetadata {
  readonly feedbackId: string;
  readonly opportunityId: string;
  readonly marketing: MarketingFeedbackView;
  readonly sales: SalesDemandContextView;
}

export function validateAttributionWindowPolicy(policy: AttributionWindowPolicy): void {
  requireScope(policy);
  requireText(policy.policyId, 'ATTRIBUTION_POLICY_ID_REQUIRED');
  requireText(policy.policyKey, 'ATTRIBUTION_POLICY_KEY_REQUIRED');
  requirePositiveInteger(policy.version, 'ATTRIBUTION_POLICY_VERSION_INVALID', 10_000);
  requireLookback(policy.firstTouchLookbackDays, 'ATTRIBUTION_FIRST_TOUCH_WINDOW_INVALID');
  requireLookback(policy.lastTouchLookbackDays, 'ATTRIBUTION_LAST_TOUCH_WINDOW_INVALID');
  requireLookback(policy.assistedLookbackDays, 'ATTRIBUTION_ASSISTED_WINDOW_INVALID');
  requireMetadata(policy);
}

export function validateAttributionTouchpoint(record: AttributionTouchpointRecord): void {
  requireScope(record);
  requireText(record.touchpointId, 'ATTRIBUTION_TOUCHPOINT_ID_REQUIRED');
  requireText(record.dedupeKey, 'ATTRIBUTION_TOUCHPOINT_DEDUPE_KEY_REQUIRED');
  requireText(record.channel, 'ATTRIBUTION_TOUCHPOINT_CHANNEL_REQUIRED');
  requireText(record.attributionSource, 'ATTRIBUTION_TOUCHPOINT_SOURCE_REQUIRED');
  timestamp(record.occurredAt, 'ATTRIBUTION_TOUCHPOINT_TIME_INVALID');
  validateUtm(record.utm);
  validateDemandContext(record.demandContext);
  requireAtLeastOneIdentity(record);
  requireMetadata(record);
}

export function validateRevenueEvidence(record: RevenueEvidenceRecord): void {
  requireScope(record);
  requireText(record.revenueEvidenceId, 'REVENUE_EVIDENCE_ID_REQUIRED');
  requireText(record.dedupeKey, 'REVENUE_EVIDENCE_DEDUPE_KEY_REQUIRED');
  requireText(record.opportunityId, 'REVENUE_OPPORTUNITY_ID_REQUIRED');
  requireText(record.contactId, 'REVENUE_CONTACT_ID_REQUIRED');
  if (!REVENUE_EVIDENCE_SOURCES.includes(record.source)) throw new Error('REVENUE_SOURCE_INVALID');
  if (!REVENUE_EVIDENCE_STATUSES.includes(record.status)) throw new Error('REVENUE_STATUS_INVALID');
  requireText(record.provider, 'REVENUE_PROVIDER_REQUIRED');
  requireText(record.providerEventId, 'REVENUE_PROVIDER_EVENT_ID_REQUIRED');
  requireText(record.providerEvidenceRef, 'REVENUE_PROVIDER_EVIDENCE_REF_REQUIRED');
  requireText(record.externalReference, 'REVENUE_EXTERNAL_REFERENCE_REQUIRED');
  timestamp(record.providerReadbackAt, 'REVENUE_PROVIDER_READBACK_TIME_INVALID');
  timestamp(record.occurredAt, 'REVENUE_OCCURRED_AT_INVALID');
  if (Date.parse(record.providerReadbackAt) < Date.parse(record.occurredAt)) {
    throw new Error('REVENUE_PROVIDER_READBACK_BEFORE_EVENT');
  }
  validateMoney(record);
  validateSourceReference(record);
  requireMetadata(record);
}

function validateMoney(record: RevenueEvidenceRecord): void {
  const amounts = [
    record.grossRevenueMinor,
    record.netRevenueMinor,
    record.refundMinor,
    record.costMinor,
  ];
  for (const amount of amounts) {
    if (amount !== null && (!Number.isSafeInteger(amount) || amount < 0)) {
      throw new Error('REVENUE_AMOUNT_INVALID');
    }
  }
  if (
    record.netRevenueMinor !== null &&
    record.grossRevenueMinor !== null &&
    record.netRevenueMinor > record.grossRevenueMinor
  ) {
    throw new Error('REVENUE_NET_EXCEEDS_GROSS');
  }
  const hasAmount = amounts.some((amount) => amount !== null);
  if (hasAmount && record.currency === null) throw new Error('REVENUE_CURRENCY_REQUIRED');
  if (record.currency !== null && !/^[A-Z]{3}$/.test(record.currency)) {
    throw new Error('REVENUE_CURRENCY_INVALID');
  }
  if (record.status === 'REFUNDED' && (!record.refundMinor || record.refundMinor <= 0)) {
    throw new Error('REVENUE_REFUND_AMOUNT_REQUIRED');
  }
}

function validateSourceReference(record: RevenueEvidenceRecord): void {
  const reference =
    record.source === 'TICKETING'
      ? record.ticketReference
      : record.source === 'CHECKOUT'
        ? record.checkoutReference
        : record.source === 'PAYMENT'
          ? record.paymentReference
          : record.orderReference;
  if (reference === null || !reference.trim()) {
    throw new Error(`REVENUE_${record.source}_REFERENCE_REQUIRED`);
  }
}

function validateUtm(utm: UtmDimensions): void {
  for (const value of [utm.source, utm.medium, utm.campaign, utm.content, utm.term]) {
    if (value !== null && !value.trim()) throw new Error('ATTRIBUTION_UTM_VALUE_INVALID');
  }
}

function validateDemandContext(context: DemandContext): void {
  for (const [key, value] of Object.entries(context)) {
    requireText(key, 'ATTRIBUTION_DEMAND_CONTEXT_KEY_REQUIRED');
    if (!['string', 'number', 'boolean'].includes(typeof value) && value !== null) {
      throw new Error('ATTRIBUTION_DEMAND_CONTEXT_VALUE_INVALID');
    }
  }
}

function requireAtLeastOneIdentity(record: AttributionTouchpointRecord): void {
  if (
    !record.contactId &&
    !record.leadId &&
    !record.opportunityId &&
    !record.conversationId &&
    !record.sessionId
  ) {
    throw new Error('ATTRIBUTION_IDENTITY_LINK_REQUIRED');
  }
}

function requireScope(scope: MeasurementScope): void {
  requireText(scope.tenantId, 'ATTRIBUTION_TENANT_ID_REQUIRED');
  requireText(scope.workspaceId, 'ATTRIBUTION_WORKSPACE_ID_REQUIRED');
  requireText(scope.organizationId, 'ATTRIBUTION_ORGANIZATION_ID_REQUIRED');
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

function requireLookback(value: number, errorCode: string): void {
  requirePositiveInteger(value, errorCode, 3650);
}

function requirePositiveInteger(value: number, errorCode: string, max: number): void {
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(errorCode);
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
