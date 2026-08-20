import { describe, expect, it, vi } from 'vitest';
import type { CrmCoreStore, OpportunityRecord } from '../src/crm/crm-records.js';
import type {
  AppendLearningRecordInput,
  LearningRecord,
  LearningRecordStore,
} from '../src/learning/store.js';
import type {
  CommerceProviderReadback,
  CommerceProviderReadbackAdapter,
} from '../src/measurement/adapters.js';
import type {
  MarketingSalesFeedbackSnapshot,
  RevenueEvidenceRecord,
} from '../src/measurement/attribution-revenue.js';
import type { AttributionRevenueService } from '../src/measurement/attribution-revenue-service.js';
import {
  CommerceProviderRevenueCoordinator,
  resolveCommerceOpportunity,
  type CommerceRevenueIngestionResult,
} from '../src/measurement/commerce-provider-boundary.js';
import type { MeasurementOperationContext } from '../src/measurement/service.js';

const scope = { tenantId: 'toca', workspaceId: 'toca', organizationId: 'toca' } as const;

const opportunity: OpportunityRecord = {
  ...scope,
  opportunityId: 'opp-1',
  contactId: 'contact-1',
  leadId: 'lead-1',
  eventId: 'event-1',
  name: 'Provider-backed ticket sale',
  pipelineKey: 'tickets',
  stageKey: 'checkout',
  status: 'OPEN',
  currency: 'BRL',
  valueMinor: 10000,
  nextAction: null,
  nextActionAt: null,
  ownerPrincipalId: null,
  expectedCloseAt: null,
  closedAt: null,
  lossReason: null,
  attributes: {},
  version: 1,
  createdAt: '2026-08-20T18:00:00.000Z',
  updatedAt: '2026-08-20T18:00:00.000Z',
};

const paidReadback = {
  provider: 'provider-test',
  providerDeliveryId: 'delivery-1',
  providerEventId: 'provider-event-1',
  source: 'PAYMENT',
  externalReference: 'payment-1',
  providerStatus: 'paid',
  status: 'PAID',
  occurredAt: '2026-08-20T19:00:00.000Z',
  customer: { providerCustomerId: 'buyer-1', email: 'buyer@example.com', phone: null },
  attribution: {
    contactId: 'contact-1',
    leadId: 'lead-1',
    opportunityId: 'opp-1',
    conversationId: 'conversation-1',
    eventId: 'event-1',
    source: 'instagram',
    campaign: 'party-aug',
    ad: 'ad-42',
    content: 'creative-42',
    utmSource: 'instagram',
    utmMedium: 'paid_social',
    utmCampaign: 'party-aug',
    utmContent: 'creative-42',
    utmTerm: null,
  },
  ticketReference: 'ticket-1',
  orderReference: 'order-1',
  paymentReference: 'payment-1',
  checkoutReference: 'checkout-1',
  evidence: ['provider:readback'],
  providerEvidenceRef: 'provider-readback:payment-1',
  providerReadbackAt: '2026-08-20T19:00:04.000Z',
  currency: 'BRL',
  grossRevenueMinor: 10000,
  netRevenueMinor: 9500,
  refundMinor: null,
  costMinor: null,
} as const satisfies CommerceProviderReadback;

const revenueEvidence = {
  ...scope,
  revenueEvidenceId: 'revenue-1',
  dedupeKey: 'a'.repeat(64),
  opportunityId: 'opp-1',
  contactId: 'contact-1',
  leadId: 'lead-1',
  conversationId: 'conversation-1',
  eventId: 'event-1',
  source: 'PAYMENT',
  provider: 'provider-test',
  providerEventId: 'provider-event-1',
  providerEvidenceRef: 'provider-readback:payment-1',
  externalReference: 'payment-1',
  status: 'CONFIRMED',
  providerReadbackAt: '2026-08-20T19:00:04.000Z',
  occurredAt: '2026-08-20T19:00:00.000Z',
  currency: 'BRL',
  grossRevenueMinor: 10000,
  netRevenueMinor: 9500,
  refundMinor: null,
  costMinor: null,
  ticketReference: 'ticket-1',
  orderReference: 'order-1',
  paymentReference: 'payment-1',
  checkoutReference: 'checkout-1',
  idempotencyKey: 'commerce:revenue:test',
  executionId: 'exec-1',
  correlationId: 'corr-1',
  actorPrincipalId: 'agent-1',
  evidence: ['provider-readback:payment-1'],
  createdAt: '2026-08-20T19:00:05.000Z',
} as const satisfies RevenueEvidenceRecord;

const feedback = {
  ...scope,
  feedbackId: 'feedback-1',
  opportunityId: 'opp-1',
  marketing: {
    leadId: 'lead-1',
    opportunityId: 'opp-1',
    leadQuality: 90,
    qualification: 'QUALIFIED',
    outcome: 'WON',
    reasonLost: null,
    revenueMinor: 9500,
    contributionMarginMinor: null,
    currency: 'BRL',
    salesCycleDays: 1,
  },
  sales: {
    opportunityId: 'opp-1',
    campaign: 'party-aug',
    creative: 'creative-42',
    message: null,
    source: 'instagram',
    intent: null,
    demandContext: {},
    touchpointId: 'touch-1',
    roles: ['LAST_TOUCH'],
  },
  idempotencyKey: 'feedback:test',
  executionId: 'exec-1',
  correlationId: 'corr-1',
  actorPrincipalId: 'agent-1',
  evidence: ['provider-readback:payment-1'],
  createdAt: '2026-08-20T19:00:06.000Z',
} as const satisfies MarketingSalesFeedbackSnapshot;

const context = {
  identity: {
    principal: {
      principalId: 'agent-1',
      tenantId: 'toca',
      workspaceId: 'toca',
      organizationId: 'toca',
    },
  },
  executionId: 'exec-1',
  correlationId: 'corr-1',
  evidence: ['commerce:test'],
  now: '2026-08-20T19:00:07.000Z',
} as unknown as MeasurementOperationContext;

const ingestion = {
  status: 'REVENUE_RECORDED',
  readback: paidReadback,
  resolution: { status: 'MATCHED', opportunity, matchedBy: 'OPPORTUNITY_ID' },
  revenueEvidence,
  attributionTouchpointId: 'touch-1',
} as const satisfies Extract<
  CommerceRevenueIngestionResult,
  { readonly status: 'REVENUE_RECORDED' }
>;

function crmWithOpportunity(record: OpportunityRecord = opportunity): CrmCoreStore {
  const getOpportunity = vi.fn(() => Promise.resolve(record));
  return { getOpportunity } as unknown as CrmCoreStore;
}

function confirmedWonResult(): Awaited<
  ReturnType<AttributionRevenueService['confirmOpportunityWon']>
> {
  return {
    opportunity: { ...opportunity, status: 'WON', version: 2 },
    feedback,
  };
}

describe('commerce provider R31 feedback', () => {
  it('persists provider-confirmed WON feedback in the canonical LearningRecordStore', async () => {
    const crm = crmWithOpportunity();
    const confirmed = confirmedWonResult();
    const confirmOpportunityWon = vi.fn(() => Promise.resolve(confirmed));
    const attributionRevenue = {
      confirmOpportunityWon,
    } as unknown as AttributionRevenueService;

    let appendedInput: AppendLearningRecordInput | undefined;
    const append = vi.fn((input: AppendLearningRecordInput): Promise<LearningRecord> => {
      appendedInput = input;
      return Promise.resolve({
        recordId: input.recordId,
        recordType: input.recordType,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        organizationId: input.organizationId,
        experimentId: input.experimentId,
        idempotencyKey: input.idempotencyKey,
        payload: input.payload,
        createdAt: input.createdAt,
      });
    });
    const learning = { append } as unknown as LearningRecordStore;
    const coordinator = new CommerceProviderRevenueCoordinator(
      {} as CommerceProviderReadbackAdapter,
      crm,
      attributionRevenue,
      learning,
    );

    const result = await coordinator.confirmWonFromRecordedRevenue(context, ingestion, {
      attributionPolicyKey: 'default',
    });

    expect(result).toMatchObject({
      outcome: 'WON',
      opportunityId: 'opp-1',
      revenueMinor: 9500,
      campaign: 'party-aug',
      content: 'creative-42',
      confidence: 1,
      attributionKnown: true,
      providerEvidenceRefs: ['provider-readback:payment-1'],
    });
    expect(append).toHaveBeenCalledOnce();
    expect(appendedInput).toBeDefined();
    const persisted = appendedInput as AppendLearningRecordInput;
    expect(persisted.recordType).toBe('OBSERVATION');
    expect(persisted.experimentId).toBeNull();
    expect(persisted.evidence).toContain('provider-readback:payment-1');
    expect(persisted.payload).toEqual({
      outcome: 'WON',
      opportunityId: 'opp-1',
      revenueMinor: 9500,
      currency: 'BRL',
      campaign: 'party-aug',
      content: 'creative-42',
      confidence: 1,
      confidenceScope: 'PROVIDER_CONFIRMED_REVENUE',
      attributionKnown: true,
      providerEvidenceRefs: ['provider-readback:payment-1'],
    });
  });

  it('rejects an explicit Opportunity whose EventRecord lineage conflicts with provider readback', async () => {
    const mismatched = {
      ...paidReadback,
      attribution: { ...paidReadback.attribution, eventId: 'event-other' },
    } satisfies CommerceProviderReadback;

    const resolution = await resolveCommerceOpportunity(
      crmWithOpportunity(),
      scope,
      mismatched,
    );

    expect(resolution).toEqual({
      status: 'UNMATCHED',
      reason: 'EVENT_OPPORTUNITY_MISMATCH',
      contactId: 'contact-1',
    });
  });

  it('cannot confirm WON without the canonical R31 learning store', async () => {
    const confirmed = confirmedWonResult();
    const attributionRevenue = {
      confirmOpportunityWon: vi.fn(() => Promise.resolve(confirmed)),
    } as unknown as AttributionRevenueService;
    const coordinator = new CommerceProviderRevenueCoordinator(
      {} as CommerceProviderReadbackAdapter,
      crmWithOpportunity(),
      attributionRevenue,
    );

    await expect(
      coordinator.confirmWonFromRecordedRevenue(context, ingestion, {
        attributionPolicyKey: 'default',
      }),
    ).rejects.toThrow('COMMERCE_R31_LEARNING_STORE_REQUIRED');
  });
});
