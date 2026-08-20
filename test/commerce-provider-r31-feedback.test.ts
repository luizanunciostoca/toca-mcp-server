import { describe, expect, it, vi } from 'vitest';
import type { CrmCoreStore, OpportunityRecord } from '../src/crm/crm-records.js';
import type { LearningRecordStore } from '../src/learning/store.js';
import type {
  CommerceProviderReadback,
  CommerceProviderReadbackAdapter,
} from '../src/measurement/adapters.js';
import type {
  MarketingSalesFeedbackSnapshot,
  RevenueEvidenceRecord,
} from '../src/measurement/attribution-revenue.js';
import { AttributionRevenueService } from '../src/measurement/attribution-revenue-service.js';
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
} as const satisfies Extract<CommerceRevenueIngestionResult, { readonly status: 'REVENUE_RECORDED' }>;

describe('commerce provider R31 feedback', () => {
  it('persists provider-confirmed WON feedback in the canonical LearningRecordStore', async () => {
    const wonOpportunity = { ...opportunity, status: 'WON' as const, version: 2 };
    const crm = {
      getOpportunity: vi.fn(async () => opportunity),
    } as unknown as CrmCoreStore;
    const confirmOpportunityWon = vi.fn(async () => ({
      opportunity: wonOpportunity,
      revenue: {
        currency: 'BRL',
        grossRevenueMinor: 10000,
        refundMinor: 500,
        realizedRevenueMinor: 9500,
        contributionMarginMinor: null,
        confirmedReferences: 1,
        refundedReferences: 0,
        canceledReferences: 0,
        evidenceRecordIds: ['revenue-1'],
      },
      attribution: [],
      feedback,
    }));
    const attributionRevenue = {
      confirmOpportunityWon,
    } as unknown as AttributionRevenueService;
    const append = vi.fn(async (input: Parameters<LearningRecordStore['append']>[0]) => ({
      recordId: input.recordId,
      recordType: input.recordType,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      organizationId: input.organizationId,
      experimentId: input.experimentId,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload,
      createdAt: input.createdAt,
    }));
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
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        recordType: 'OBSERVATION',
        experimentId: null,
        payload: expect.objectContaining({
          outcome: 'WON',
          opportunityId: 'opp-1',
          revenueMinor: 9500,
          campaign: 'party-aug',
          content: 'creative-42',
          confidence: 1,
          confidenceScope: 'PROVIDER_CONFIRMED_REVENUE',
          attributionKnown: true,
          providerEvidenceRefs: ['provider-readback:payment-1'],
        }),
        evidence: expect.arrayContaining(['provider-readback:payment-1']),
      }),
    );
  });

  it('rejects an explicit Opportunity whose EventRecord lineage conflicts with provider readback', async () => {
    const crm = {
      getOpportunity: vi.fn(async () => opportunity),
    } as unknown as CrmCoreStore;
    const mismatched = {
      ...paidReadback,
      attribution: { ...paidReadback.attribution, eventId: 'event-other' },
    } satisfies CommerceProviderReadback;

    const resolution = await resolveCommerceOpportunity(crm, scope, mismatched);

    expect(resolution).toEqual({
      status: 'UNMATCHED',
      reason: 'EVENT_OPPORTUNITY_MISMATCH',
      contactId: 'contact-1',
    });
  });

  it('cannot confirm WON without the canonical R31 learning store', async () => {
    const crm = {
      getOpportunity: vi.fn(async () => opportunity),
    } as unknown as CrmCoreStore;
    const attributionRevenue = {
      confirmOpportunityWon: vi.fn(async () => ({
        opportunity: { ...opportunity, status: 'WON' as const, version: 2 },
        revenue: {},
        attribution: [],
        feedback,
      })),
    } as unknown as AttributionRevenueService;
    const coordinator = new CommerceProviderRevenueCoordinator(
      {} as CommerceProviderReadbackAdapter,
      crm,
      attributionRevenue,
    );

    await expect(
      coordinator.confirmWonFromRecordedRevenue(context, ingestion, {
        attributionPolicyKey: 'default',
      }),
    ).rejects.toThrow('COMMERCE_R31_LEARNING_STORE_REQUIRED');
  });
});
