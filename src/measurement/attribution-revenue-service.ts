import type { CrmCoreStore, OpportunityRecord } from '../crm/crm-records.js';
import {
  assertReliableWonEvidence,
  buildMarketingSalesFeedback,
  resolveAttributionRoles,
  validateAttributionTouchpoint,
  validateAttributionWindowPolicy,
  validateRevenueEvidence,
  type AttributionTouchpointRecord,
  type AttributionWindowPolicy,
  type DemandContext,
  type MarketingSalesFeedbackSnapshot,
  type RevenueEvidenceRecord,
  type RevenueEvidenceSource,
  type RevenueEvidenceStatus,
} from './attribution-revenue.js';
import type { AttributionRevenueStore } from './attribution-revenue-store.js';
import type { MeasurementOperationContext } from './service.js';
import {
  normalizeEvidence,
  normalizeUtm,
  nullableText,
  requireText,
  timestamp,
} from './normalization.js';
import {
  assertAttributionAuthorized,
  attributionHashKey,
  attributionMetadata,
  attributionRecordId,
  normalizeRevenueCurrency,
  requireRevenueOpportunity,
  resolveCrmAttributionLineage,
} from './attribution-revenue-service-support.js';

export interface AttributionRevenueServiceOptions {
  readonly createId?: () => string;
}

export class AttributionRevenueService {
  readonly #createId: (() => string) | undefined;

  constructor(
    private readonly store: AttributionRevenueStore,
    private readonly crm: CrmCoreStore,
    options: AttributionRevenueServiceOptions = {},
  ) {
    this.#createId = options.createId;
  }

  async recordWindowPolicy(
    context: MeasurementOperationContext,
    input: {
      readonly policyId?: string;
      readonly policyKey: string;
      readonly version: number;
      readonly firstTouchLookbackDays: number;
      readonly lastTouchLookbackDays: number;
      readonly assistedLookbackDays: number;
      readonly idempotencyKey: string;
    },
  ): Promise<AttributionWindowPolicy> {
    assertAttributionAuthorized(
      context.identity,
      'performance.attribution.window.configure',
      'WRITE_REVERSIBLE',
    );
    const principal = context.identity.principal;
    const policy: AttributionWindowPolicy = {
      policyId: attributionRecordId({
        explicit: input.policyId,
        prefix: 'attr_policy',
        context,
        idempotencyKey: input.idempotencyKey,
        createId: this.#createId,
      }),
      policyKey: requireText(input.policyKey, 'ATTRIBUTION_POLICY_KEY_REQUIRED'),
      version: input.version,
      firstTouchLookbackDays: input.firstTouchLookbackDays,
      lastTouchLookbackDays: input.lastTouchLookbackDays,
      assistedLookbackDays: input.assistedLookbackDays,
      tenantId: principal.tenantId,
      workspaceId: principal.workspaceId,
      organizationId: principal.organizationId,
      ...attributionMetadata(context, input.idempotencyKey),
    };
    validateAttributionWindowPolicy(policy);
    return this.store.recordWindowPolicy(policy);
  }

  async captureTouchpoint(
    context: MeasurementOperationContext,
    input: {
      readonly touchpointId?: string;
      readonly sourceEventId: string;
      readonly contactId?: string | null;
      readonly leadId?: string | null;
      readonly opportunityId?: string | null;
      readonly conversationId?: string | null;
      readonly messageId?: string | null;
      readonly channel: string;
      readonly source?: string | null;
      readonly medium?: string | null;
      readonly campaign?: string | null;
      readonly content?: string | null;
      readonly term?: string | null;
      readonly metaCampaignId?: string | null;
      readonly metaAdsetId?: string | null;
      readonly metaAdId?: string | null;
      readonly metaCreativeId?: string | null;
      readonly googleCampaignId?: string | null;
      readonly googleAdGroupId?: string | null;
      readonly googleAdId?: string | null;
      readonly googleCreativeId?: string | null;
      readonly clickId?: string | null;
      readonly fbclid?: string | null;
      readonly gclid?: string | null;
      readonly gbraid?: string | null;
      readonly wbraid?: string | null;
      readonly landingUrl?: string | null;
      readonly sessionId?: string | null;
      readonly leadSource?: string | null;
      readonly ticketReference?: string | null;
      readonly orderReference?: string | null;
      readonly paymentReference?: string | null;
      readonly checkoutReference?: string | null;
      readonly messageRef?: string | null;
      readonly intent?: string | null;
      readonly demandContext?: DemandContext;
      readonly attributionSource: string;
      readonly occurredAt: string;
      readonly idempotencyKey: string;
    },
  ): Promise<AttributionTouchpointRecord> {
    assertAttributionAuthorized(
      context.identity,
      'measurement.attribution.touchpoint.record',
      'WRITE_REVERSIBLE',
    );
    const lineage = await resolveCrmAttributionLineage(this.crm, context.identity, input);
    const principal = context.identity.principal;
    const sourceEventId = requireText(input.sourceEventId, 'ATTRIBUTION_SOURCE_EVENT_ID_REQUIRED');
    const record: AttributionTouchpointRecord = {
      touchpointId: attributionRecordId({
        explicit: input.touchpointId,
        prefix: 'attr_touch',
        context,
        idempotencyKey: input.idempotencyKey,
        createId: this.#createId,
      }),
      dedupeKey: attributionHashKey([
        principal.tenantId,
        'touchpoint',
        requireText(input.attributionSource, 'ATTRIBUTION_TOUCHPOINT_SOURCE_REQUIRED'),
        sourceEventId,
      ]),
      tenantId: principal.tenantId,
      workspaceId: principal.workspaceId,
      organizationId: principal.organizationId,
      contactId: lineage.contactId,
      leadId: lineage.leadId,
      opportunityId: lineage.opportunityId,
      conversationId: nullableText(input.conversationId),
      messageId: nullableText(input.messageId),
      channel: requireText(input.channel, 'ATTRIBUTION_TOUCHPOINT_CHANNEL_REQUIRED'),
      utm: normalizeUtm(input),
      metaCampaignId: nullableText(input.metaCampaignId),
      metaAdsetId: nullableText(input.metaAdsetId),
      metaAdId: nullableText(input.metaAdId),
      metaCreativeId: nullableText(input.metaCreativeId),
      googleCampaignId: nullableText(input.googleCampaignId),
      googleAdGroupId: nullableText(input.googleAdGroupId),
      googleAdId: nullableText(input.googleAdId),
      googleCreativeId: nullableText(input.googleCreativeId),
      clickId: nullableText(input.clickId),
      fbclid: nullableText(input.fbclid),
      gclid: nullableText(input.gclid),
      gbraid: nullableText(input.gbraid),
      wbraid: nullableText(input.wbraid),
      landingUrl: nullableText(input.landingUrl),
      sessionId: nullableText(input.sessionId),
      leadSource: nullableText(input.leadSource) ?? lineage.lead?.sourceType ?? null,
      ticketReference: nullableText(input.ticketReference),
      orderReference: nullableText(input.orderReference),
      paymentReference: nullableText(input.paymentReference),
      checkoutReference: nullableText(input.checkoutReference),
      messageRef: nullableText(input.messageRef),
      intent: nullableText(input.intent),
      demandContext: input.demandContext ?? {},
      attributionSource: requireText(
        input.attributionSource,
        'ATTRIBUTION_TOUCHPOINT_SOURCE_REQUIRED',
      ),
      occurredAt: timestamp(input.occurredAt, 'ATTRIBUTION_TOUCHPOINT_TIME_INVALID'),
      ...attributionMetadata(context, input.idempotencyKey),
    };
    validateAttributionTouchpoint(record);
    return this.store.recordTouchpoint(record);
  }

  async recordRevenueEvidence(
    context: MeasurementOperationContext,
    input: {
      readonly revenueEvidenceId?: string;
      readonly opportunityId: string;
      readonly source: RevenueEvidenceSource;
      readonly provider: string;
      readonly providerEventId: string;
      readonly providerEvidenceRef: string;
      readonly externalReference: string;
      readonly status: RevenueEvidenceStatus;
      readonly providerReadbackAt: string;
      readonly occurredAt: string;
      readonly currency?: string | null;
      readonly grossRevenueMinor?: number | null;
      readonly netRevenueMinor?: number | null;
      readonly refundMinor?: number | null;
      readonly costMinor?: number | null;
      readonly ticketReference?: string | null;
      readonly orderReference?: string | null;
      readonly paymentReference?: string | null;
      readonly checkoutReference?: string | null;
      readonly conversationId?: string | null;
      readonly idempotencyKey: string;
    },
  ): Promise<RevenueEvidenceRecord> {
    assertAttributionAuthorized(context.identity, 'revenue.evidence.record', 'WRITE_REVERSIBLE');
    const opportunity = await requireRevenueOpportunity(
      this.crm,
      context.identity,
      input.opportunityId,
    );
    const provider = requireText(input.provider, 'REVENUE_PROVIDER_REQUIRED');
    const providerEventId = requireText(
      input.providerEventId,
      'REVENUE_PROVIDER_EVENT_ID_REQUIRED',
    );
    const externalReference = requireText(
      input.externalReference,
      'REVENUE_EXTERNAL_REFERENCE_REQUIRED',
    );
    const providerEvidenceRef = requireText(
      input.providerEvidenceRef,
      'REVENUE_PROVIDER_EVIDENCE_REF_REQUIRED',
    );
    const record: RevenueEvidenceRecord = {
      revenueEvidenceId: attributionRecordId({
        explicit: input.revenueEvidenceId,
        prefix: 'revenue_evidence',
        context,
        idempotencyKey: input.idempotencyKey,
        createId: this.#createId,
      }),
      dedupeKey: attributionHashKey([
        opportunity.tenantId,
        'revenue',
        input.source,
        provider,
        externalReference,
        providerEventId,
      ]),
      tenantId: opportunity.tenantId,
      workspaceId: opportunity.workspaceId,
      organizationId: opportunity.organizationId,
      opportunityId: opportunity.opportunityId,
      contactId: opportunity.contactId,
      leadId: opportunity.leadId,
      conversationId: nullableText(input.conversationId),
      eventId: opportunity.eventId,
      source: input.source,
      provider,
      providerEventId,
      providerEvidenceRef,
      externalReference,
      status: input.status,
      providerReadbackAt: timestamp(
        input.providerReadbackAt,
        'REVENUE_PROVIDER_READBACK_TIME_INVALID',
      ),
      occurredAt: timestamp(input.occurredAt, 'REVENUE_OCCURRED_AT_INVALID'),
      currency: normalizeRevenueCurrency(input.currency),
      grossRevenueMinor: input.grossRevenueMinor ?? null,
      netRevenueMinor: input.netRevenueMinor ?? null,
      refundMinor: input.refundMinor ?? null,
      costMinor: input.costMinor ?? null,
      ticketReference: nullableText(input.ticketReference),
      orderReference: nullableText(input.orderReference),
      paymentReference: nullableText(input.paymentReference),
      checkoutReference: nullableText(input.checkoutReference),
      ...attributionMetadata(context, input.idempotencyKey, [providerEvidenceRef]),
    };
    validateRevenueEvidence(record);
    return this.store.recordRevenueEvidence(record);
  }

  async confirmOpportunityWon(
    context: MeasurementOperationContext,
    input: {
      readonly opportunityId: string;
      readonly expectedVersion: number;
      readonly idempotencyKey: string;
      readonly feedbackIdempotencyKey: string;
      readonly attributionPolicyKey: string;
    },
  ): Promise<{
    readonly opportunity: OpportunityRecord;
    readonly feedback: MarketingSalesFeedbackSnapshot;
  }> {
    assertAttributionAuthorized(
      context.identity,
      'revenue.opportunity.confirm_won',
      'WRITE_REVERSIBLE',
    );
    const opportunity = await requireRevenueOpportunity(
      this.crm,
      context.identity,
      input.opportunityId,
    );
    const revenueEvidence = await this.store.listRevenueEvidence({
      tenantId: opportunity.tenantId,
      workspaceId: opportunity.workspaceId,
      organizationId: opportunity.organizationId,
      opportunityId: opportunity.opportunityId,
      limit: 1000,
    });
    assertReliableWonEvidence(revenueEvidence);
    const transitioned = await this.crm.transitionOpportunity({
      tenantId: opportunity.tenantId,
      workspaceId: opportunity.workspaceId,
      organizationId: opportunity.organizationId,
      opportunityId: opportunity.opportunityId,
      expectedVersion: input.expectedVersion,
      status: 'WON',
      idempotencyKey: requireText(input.idempotencyKey, 'CRM_IDEMPOTENCY_KEY_REQUIRED'),
      executionId: context.executionId,
      correlationId: context.correlationId,
      actorPrincipalId: context.identity.principal.principalId,
      evidence: normalizeEvidence([
        ...context.evidence,
        ...revenueEvidence.map((record) => `revenue-evidence:${record.revenueEvidenceId}`),
      ]),
      ...(context.now ? { now: context.now } : {}),
    });
    const feedback = await this.materializeFeedback(context, {
      opportunityId: transitioned.opportunityId,
      feedbackIdempotencyKey: input.feedbackIdempotencyKey,
      attributionPolicyKey: input.attributionPolicyKey,
    });
    return { opportunity: transitioned, feedback };
  }

  async materializeFeedback(
    context: MeasurementOperationContext,
    input: {
      readonly opportunityId: string;
      readonly feedbackId?: string;
      readonly feedbackIdempotencyKey: string;
      readonly attributionPolicyKey: string;
    },
  ): Promise<MarketingSalesFeedbackSnapshot> {
    assertAttributionAuthorized(
      context.identity,
      'performance.marketing_sales.feedback.record',
      'WRITE_REVERSIBLE',
    );
    const opportunity = await requireRevenueOpportunity(
      this.crm,
      context.identity,
      input.opportunityId,
    );
    const lead = opportunity.leadId
      ? ((await this.crm.getLead({
          tenantId: opportunity.tenantId,
          workspaceId: opportunity.workspaceId,
          organizationId: opportunity.organizationId,
          leadId: opportunity.leadId,
        })) ?? null)
      : null;
    const policy = await this.store.latestWindowPolicy({
      tenantId: opportunity.tenantId,
      workspaceId: opportunity.workspaceId,
      organizationId: opportunity.organizationId,
      policyKey: requireText(input.attributionPolicyKey, 'ATTRIBUTION_POLICY_KEY_REQUIRED'),
    });
    if (!policy) throw new Error('ATTRIBUTION_WINDOW_POLICY_NOT_FOUND');
    const touchpoints = await this.store.listTouchpoints({
      tenantId: opportunity.tenantId,
      workspaceId: opportunity.workspaceId,
      organizationId: opportunity.organizationId,
      opportunityId: opportunity.opportunityId,
      limit: 1000,
    });
    const conversionOccurredAt = opportunity.closedAt ?? context.now ?? new Date().toISOString();
    const resolved = resolveAttributionRoles({ touchpoints, policy, conversionOccurredAt });
    const revenueEvidence = await this.store.listRevenueEvidence({
      tenantId: opportunity.tenantId,
      workspaceId: opportunity.workspaceId,
      organizationId: opportunity.organizationId,
      opportunityId: opportunity.opportunityId,
      limit: 1000,
    });
    const snapshot = buildMarketingSalesFeedback({
      feedbackId: attributionRecordId({
        explicit: input.feedbackId,
        prefix: 'feedback',
        context,
        idempotencyKey: input.feedbackIdempotencyKey,
        createId: this.#createId,
      }),
      opportunity,
      lead,
      touchpoints: resolved,
      revenueEvidence,
      metadata: attributionMetadata(context, input.feedbackIdempotencyKey),
    });
    return this.store.recordFeedbackSnapshot(snapshot);
  }
}
