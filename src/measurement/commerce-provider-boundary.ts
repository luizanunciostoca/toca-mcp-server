import { createHash } from 'node:crypto';
import type { CrmCoreStore, CrmScope, OpportunityRecord } from '../crm/crm-records.js';
import type {
  CommerceProviderAttributionContext,
  CommerceProviderReadback,
  CommerceProviderReadbackAdapter,
  CommerceProviderWebhookEnvelope,
} from './adapters.js';
import type {
  MarketingSalesFeedbackSnapshot,
  RevenueEvidenceRecord,
  RevenueEvidenceStatus,
} from './attribution-revenue.js';
import { AttributionRevenueService } from './attribution-revenue-service.js';
import type { MeasurementOperationContext } from './service.js';

export type CommerceOpportunityResolution =
  | {
      readonly status: 'MATCHED';
      readonly opportunity: OpportunityRecord;
      readonly matchedBy: 'OPPORTUNITY_ID' | 'CONTACT_CHANNEL';
    }
  | {
      readonly status: 'UNMATCHED';
      readonly reason:
        | 'UNKNOWN_OPPORTUNITY'
        | 'UNKNOWN_CONTACT'
        | 'AMBIGUOUS_CONTACT'
        | 'NO_ELIGIBLE_OPPORTUNITY'
        | 'AMBIGUOUS_OPPORTUNITY'
        | 'CONTACT_OPPORTUNITY_MISMATCH';
      readonly contactId: string | null;
    };

export type CommerceRevenueIngestionResult =
  | {
      readonly status: 'PENDING_NO_REVENUE';
      readonly readback: CommerceProviderReadback;
      readonly resolution: CommerceOpportunityResolution;
    }
  | {
      readonly status: 'UNMATCHED_NO_REVENUE';
      readonly readback: CommerceProviderReadback;
      readonly resolution: Extract<CommerceOpportunityResolution, { readonly status: 'UNMATCHED' }>;
    }
  | {
      readonly status: 'REVENUE_RECORDED';
      readonly readback: CommerceProviderReadback;
      readonly resolution: Extract<CommerceOpportunityResolution, { readonly status: 'MATCHED' }>;
      readonly revenueEvidence: RevenueEvidenceRecord;
      readonly attributionTouchpointId: string | null;
    };

export interface CommerceConfirmedLearningFeedback {
  readonly outcome: 'WON';
  readonly opportunityId: string;
  readonly revenueMinor: number;
  readonly currency: string | null;
  readonly campaign: string | null;
  readonly content: string | null;
  readonly confidence: 1;
  readonly providerEvidenceRefs: readonly string[];
  readonly feedback: MarketingSalesFeedbackSnapshot;
}

/**
 * Provider-neutral closed-loop coordinator. It never treats the webhook payload as revenue.
 * The sequence is signature verification -> parse -> provider readback -> canonical CRM match ->
 * optional attribution touchpoint -> existing AttributionRevenueService evidence.
 *
 * No provider adapter is registered here. Until a real provider and credentials are selected,
 * this boundary is inert and cannot manufacture production evidence.
 */
export class CommerceProviderRevenueCoordinator {
  constructor(
    private readonly adapter: CommerceProviderReadbackAdapter,
    private readonly crm: CrmCoreStore,
    private readonly attributionRevenue: AttributionRevenueService,
  ) {}

  async ingestWebhook(
    context: MeasurementOperationContext,
    envelope: CommerceProviderWebhookEnvelope,
  ): Promise<CommerceRevenueIngestionResult> {
    const verification = await this.adapter.verifyWebhookSignature(envelope);
    if (!verification.verified) throw new Error('COMMERCE_WEBHOOK_SIGNATURE_INVALID');
    requireText(verification.providerDeliveryId, 'COMMERCE_PROVIDER_DELIVERY_ID_REQUIRED');
    requireEvidence(verification.evidence, 'COMMERCE_WEBHOOK_SIGNATURE_EVIDENCE_REQUIRED');

    const providerEvent = await this.adapter.parseWebhook(envelope, verification);
    if (providerEvent.provider !== this.adapter.provider) {
      throw new Error('COMMERCE_PROVIDER_EVENT_PROVIDER_MISMATCH');
    }
    if (providerEvent.providerDeliveryId !== verification.providerDeliveryId) {
      throw new Error('COMMERCE_PROVIDER_DELIVERY_ID_MISMATCH');
    }

    const readback = await this.adapter.readback(providerEvent);
    validateProviderReadback(this.adapter.provider, providerEvent, readback);
    const resolution = await resolveCommerceOpportunity(
      this.crm,
      scopeFromContext(context),
      readback,
    );

    if (readback.status === 'PENDING') {
      return { status: 'PENDING_NO_REVENUE', readback, resolution };
    }
    if (resolution.status === 'UNMATCHED') {
      return { status: 'UNMATCHED_NO_REVENUE', readback, resolution };
    }

    const evidenceContext = extendEvidence(context, [
      ...verification.evidence,
      ...providerEvent.evidence,
      ...readback.evidence,
      readback.providerEvidenceRef,
      `commerce-provider:${this.adapter.provider}`,
    ]);
    const attributionTouchpointId = await this.captureAttributionIfPresent(
      evidenceContext,
      resolution.opportunity,
      readback,
    );
    const revenueEvidence = await this.attributionRevenue.recordRevenueEvidence(evidenceContext, {
      opportunityId: resolution.opportunity.opportunityId,
      source: readback.source,
      provider: readback.provider,
      providerEventId: readback.providerEventId,
      providerEvidenceRef: readback.providerEvidenceRef,
      externalReference: readback.externalReference,
      status: revenueEvidenceStatus(readback),
      providerReadbackAt: readback.providerReadbackAt,
      occurredAt: readback.occurredAt,
      currency: readback.currency,
      grossRevenueMinor: readback.grossRevenueMinor,
      netRevenueMinor: readback.netRevenueMinor,
      refundMinor: readback.refundMinor,
      costMinor: readback.costMinor,
      ticketReference: readback.ticketReference,
      orderReference: readback.orderReference,
      paymentReference: readback.paymentReference,
      checkoutReference: readback.checkoutReference,
      conversationId: readback.attribution.conversationId,
      idempotencyKey: commerceIdempotencyKey('revenue', readback, resolution.opportunity.opportunityId),
    });
    return {
      status: 'REVENUE_RECORDED',
      readback,
      resolution,
      revenueEvidence,
      attributionTouchpointId,
    };
  }

  async confirmWonFromRecordedRevenue(
    context: MeasurementOperationContext,
    ingestion: Extract<CommerceRevenueIngestionResult, { readonly status: 'REVENUE_RECORDED' }>,
    input: { readonly attributionPolicyKey: string },
  ): Promise<CommerceConfirmedLearningFeedback> {
    if (ingestion.readback.status !== 'PAID') {
      throw new Error('COMMERCE_WON_REQUIRES_PAID_READBACK');
    }
    const opportunity = await this.crm.getOpportunity({
      ...scopeFromContext(context),
      opportunityId: ingestion.resolution.opportunity.opportunityId,
    });
    if (!opportunity) throw new Error('COMMERCE_OPPORTUNITY_NOT_FOUND');

    const providerEvidenceRef = requireText(
      ingestion.revenueEvidence.providerEvidenceRef,
      'COMMERCE_PROVIDER_EVIDENCE_REF_REQUIRED',
    );
    const result = await this.attributionRevenue.confirmOpportunityWon(
      extendEvidence(context, [providerEvidenceRef]),
      {
        opportunityId: opportunity.opportunityId,
        expectedVersion: opportunity.version,
        idempotencyKey: commerceIdempotencyKey('won', ingestion.readback, opportunity.opportunityId),
        feedbackIdempotencyKey: commerceIdempotencyKey(
          'feedback',
          ingestion.readback,
          opportunity.opportunityId,
        ),
        attributionPolicyKey: requireText(
          input.attributionPolicyKey,
          'ATTRIBUTION_POLICY_KEY_REQUIRED',
        ),
      },
    );

    return {
      outcome: 'WON',
      opportunityId: result.opportunity.opportunityId,
      revenueMinor: result.feedback.marketing.revenueMinor,
      currency: result.feedback.marketing.currency,
      campaign: result.feedback.sales.campaign,
      content: result.feedback.sales.creative ?? result.feedback.sales.message,
      confidence: 1,
      providerEvidenceRefs: [providerEvidenceRef],
      feedback: result.feedback,
    };
  }

  async captureAttributionIfPresent(
    context: MeasurementOperationContext,
    opportunity: OpportunityRecord,
    readback: CommerceProviderReadback,
  ): Promise<string | null> {
    if (!hasAttributionSignal(readback.attribution)) return null;
    const touchpoint = await this.attributionRevenue.captureTouchpoint(context, {
      sourceEventId: readback.providerEventId,
      contactId: opportunity.contactId,
      leadId: opportunity.leadId,
      opportunityId: opportunity.opportunityId,
      conversationId: readback.attribution.conversationId,
      channel: 'COMMERCE',
      source: readback.attribution.utmSource ?? readback.attribution.source,
      medium: readback.attribution.utmMedium,
      campaign: readback.attribution.utmCampaign ?? readback.attribution.campaign,
      content: readback.attribution.utmContent ?? readback.attribution.content,
      term: readback.attribution.utmTerm,
      ticketReference: readback.ticketReference,
      orderReference: readback.orderReference,
      paymentReference: readback.paymentReference,
      checkoutReference: readback.checkoutReference,
      messageRef: readback.attribution.ad,
      attributionSource: `provider:${readback.provider}`,
      occurredAt: readback.occurredAt,
      idempotencyKey: commerceIdempotencyKey('touchpoint', readback, opportunity.opportunityId),
    });
    return touchpoint.touchpointId;
  }
}

export async function resolveCommerceOpportunity(
  crm: CrmCoreStore,
  scope: CrmScope,
  readback: CommerceProviderReadback,
): Promise<CommerceOpportunityResolution> {
  const explicitOpportunityId = nullableText(readback.attribution.opportunityId);
  if (explicitOpportunityId) {
    const opportunity = await crm.getOpportunity({ ...scope, opportunityId: explicitOpportunityId });
    if (!opportunity) {
      return { status: 'UNMATCHED', reason: 'UNKNOWN_OPPORTUNITY', contactId: null };
    }
    const explicitContactId = nullableText(readback.attribution.contactId);
    if (explicitContactId && explicitContactId !== opportunity.contactId) {
      return {
        status: 'UNMATCHED',
        reason: 'CONTACT_OPPORTUNITY_MISMATCH',
        contactId: explicitContactId,
      };
    }
    return { status: 'MATCHED', opportunity, matchedBy: 'OPPORTUNITY_ID' };
  }

  const candidateContactIds = new Set<string>();
  const explicitContactId = nullableText(readback.attribution.contactId);
  if (explicitContactId) {
    const contact = await crm.getContact({ ...scope, contactId: explicitContactId });
    if (contact) candidateContactIds.add(contact.contactId);
  }
  const email = nullableText(readback.customer.email);
  if (email) {
    const contact = await crm.findContactByChannel({ ...scope, channelType: 'EMAIL', value: email });
    if (contact) candidateContactIds.add(contact.contactId);
  }
  const phone = nullableText(readback.customer.phone);
  if (phone) {
    const contact = await crm.findContactByChannel({ ...scope, channelType: 'PHONE', value: phone });
    if (contact) candidateContactIds.add(contact.contactId);
  }

  if (candidateContactIds.size === 0) {
    return { status: 'UNMATCHED', reason: 'UNKNOWN_CONTACT', contactId: null };
  }
  if (candidateContactIds.size > 1) {
    return { status: 'UNMATCHED', reason: 'AMBIGUOUS_CONTACT', contactId: null };
  }

  const contactId = [...candidateContactIds][0];
  if (!contactId) return { status: 'UNMATCHED', reason: 'UNKNOWN_CONTACT', contactId: null };
  const opportunities = await crm.listOpportunitiesForContact({ ...scope, contactId, limit: 100 });
  const eventId = nullableText(readback.attribution.eventId);
  const eligible = opportunities.filter((opportunity) => {
    if (eventId && opportunity.eventId !== eventId) return false;
    if (readback.status === 'PAID' || readback.status === 'PENDING') {
      return opportunity.status === 'OPEN' || opportunity.status === 'WON';
    }
    return (
      opportunity.status === 'OPEN' ||
      opportunity.status === 'WON' ||
      opportunity.status === 'CANCELED'
    );
  });
  if (eligible.length === 0) {
    return { status: 'UNMATCHED', reason: 'NO_ELIGIBLE_OPPORTUNITY', contactId };
  }
  if (eligible.length > 1) {
    return { status: 'UNMATCHED', reason: 'AMBIGUOUS_OPPORTUNITY', contactId };
  }
  const opportunity = eligible[0];
  if (!opportunity) {
    return { status: 'UNMATCHED', reason: 'NO_ELIGIBLE_OPPORTUNITY', contactId };
  }
  return { status: 'MATCHED', opportunity, matchedBy: 'CONTACT_CHANNEL' };
}

export function commerceIdempotencyKey(
  purpose: 'revenue' | 'touchpoint' | 'won' | 'feedback',
  readback: Pick<
    CommerceProviderReadback,
    'provider' | 'providerEventId' | 'source' | 'externalReference' | 'status'
  >,
  opportunityId: string,
): string {
  const digest = createHash('sha256')
    .update(
      [
        purpose,
        readback.provider,
        readback.providerEventId,
        readback.source,
        readback.externalReference,
        readback.status,
        opportunityId,
      ].join('\u001f'),
    )
    .digest('hex');
  return `commerce:${purpose}:${digest}`;
}

function revenueEvidenceStatus(readback: CommerceProviderReadback): RevenueEvidenceStatus {
  if (readback.status === 'PAID') return 'CONFIRMED';
  if (readback.status === 'CANCELED') return 'CANCELED';
  if (readback.status === 'REFUNDED' || readback.status === 'CHARGEBACK') return 'REFUNDED';
  throw new Error('COMMERCE_PENDING_IS_NOT_REVENUE_EVIDENCE');
}

function validateProviderReadback(
  provider: string,
  event: { readonly providerEventId: string; readonly source: string; readonly externalReference: string },
  readback: CommerceProviderReadback,
): void {
  if (readback.provider !== provider) throw new Error('COMMERCE_PROVIDER_READBACK_PROVIDER_MISMATCH');
  if (readback.providerEventId !== event.providerEventId) {
    throw new Error('COMMERCE_PROVIDER_READBACK_EVENT_MISMATCH');
  }
  if (readback.source !== event.source) throw new Error('COMMERCE_PROVIDER_READBACK_SOURCE_MISMATCH');
  if (readback.externalReference !== event.externalReference) {
    throw new Error('COMMERCE_PROVIDER_READBACK_REFERENCE_MISMATCH');
  }
  requireText(readback.providerEvidenceRef, 'COMMERCE_PROVIDER_EVIDENCE_REF_REQUIRED');
  requireEvidence(readback.evidence, 'COMMERCE_PROVIDER_READBACK_EVIDENCE_REQUIRED');
  const occurredAt = Date.parse(readback.occurredAt);
  const readbackAt = Date.parse(readback.providerReadbackAt);
  if (!Number.isFinite(occurredAt)) throw new Error('COMMERCE_OCCURRED_AT_INVALID');
  if (!Number.isFinite(readbackAt)) throw new Error('COMMERCE_PROVIDER_READBACK_AT_INVALID');
  if (readbackAt < occurredAt) throw new Error('COMMERCE_PROVIDER_READBACK_BEFORE_EVENT');
  if (readback.status === 'REFUNDED' || readback.status === 'CHARGEBACK') {
    if (!readback.refundMinor || readback.refundMinor <= 0) {
      throw new Error('COMMERCE_REFUND_AMOUNT_REQUIRED');
    }
  }
}

function hasAttributionSignal(attribution: CommerceProviderAttributionContext): boolean {
  return [
    attribution.source,
    attribution.campaign,
    attribution.ad,
    attribution.content,
    attribution.utmSource,
    attribution.utmMedium,
    attribution.utmCampaign,
    attribution.utmContent,
    attribution.utmTerm,
    attribution.conversationId,
    attribution.leadId,
  ].some((value) => Boolean(nullableText(value)));
}

function scopeFromContext(context: MeasurementOperationContext): CrmScope {
  const principal = context.identity.principal;
  return {
    tenantId: principal.tenantId,
    workspaceId: principal.workspaceId,
    organizationId: principal.organizationId,
  };
}

function extendEvidence(
  context: MeasurementOperationContext,
  evidence: readonly string[],
): MeasurementOperationContext {
  return {
    ...context,
    evidence: [...new Set([...context.evidence, ...evidence].map((value) => value.trim()).filter(Boolean))],
  };
}

function requireEvidence(evidence: readonly string[], errorCode: string): void {
  if (!evidence.some((value) => value.trim())) throw new Error(errorCode);
}

function nullableText(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized || null;
}

function requireText(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}
