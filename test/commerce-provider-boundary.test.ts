import { describe, expect, it, vi } from 'vitest';
import type { CrmCoreStore, OpportunityRecord } from '../src/crm/crm-records.js';
import type {
  CommerceProviderEvent,
  CommerceProviderReadback,
  CommerceProviderReadbackAdapter,
  CommerceProviderStatus,
} from '../src/measurement/adapters.js';
import type { RevenueEvidenceRecord } from '../src/measurement/attribution-revenue.js';
import { AttributionRevenueService } from '../src/measurement/attribution-revenue-service.js';
import {
  CommerceProviderRevenueCoordinator,
  commerceIdempotencyKey,
  resolveCommerceOpportunity,
} from '../src/measurement/commerce-provider-boundary.js';
import type { MeasurementOperationContext } from '../src/measurement/service.js';

const scope = { tenantId: 'toca', workspaceId: 'toca', organizationId: 'toca' } as const;

const opportunity: OpportunityRecord = {
  ...scope,
  opportunityId: 'opp-1',
  contactId: 'contact-1',
  leadId: 'lead-1',
  eventId: 'event-1',
  name: 'Ticket sale',
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
  evidence: ['test:commerce-boundary'],
  now: '2026-08-20T19:00:05.000Z',
} as unknown as MeasurementOperationContext;

function attribution(overrides: Partial<CommerceProviderReadback['attribution']> = {}) {
  return {
    contactId: null,
    leadId: null,
    opportunityId: 'opp-1',
    conversationId: null,
    eventId: 'event-1',
    source: null,
    campaign: null,
    ad: null,
    content: null,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmContent: null,
    utmTerm: null,
    ...overrides,
  };
}

function commerceEvent(
  status: CommerceProviderStatus,
  overrides: Partial<CommerceProviderEvent> = {},
): CommerceProviderEvent {
  return {
    provider: 'provider-test',
    providerDeliveryId: 'delivery-1',
    providerEventId: 'provider-event-1',
    source: 'PAYMENT',
    externalReference: 'payment-1',
    providerStatus: status.toLowerCase(),
    status,
    occurredAt: '2026-08-20T19:00:00.000Z',
    customer: { providerCustomerId: 'customer-1', email: null, phone: null },
    attribution: attribution(),
    ticketReference: null,
    orderReference: null,
    paymentReference: 'payment-1',
    checkoutReference: null,
    evidence: ['provider:webhook-event'],
    ...overrides,
  };
}

function readback(
  status: CommerceProviderStatus,
  overrides: Partial<CommerceProviderReadback> = {},
): CommerceProviderReadback {
  const event = commerceEvent(status);
  return {
    ...event,
    providerEvidenceRef: 'provider-readback:payment-1',
    providerReadbackAt: '2026-08-20T19:00:04.000Z',
    currency: status === 'PENDING' || status === 'CANCELED' ? null : 'BRL',
    grossRevenueMinor: status === 'PAID' ? 10000 : null,
    netRevenueMinor: status === 'PAID' ? 9500 : null,
    refundMinor: status === 'REFUNDED' || status === 'CHARGEBACK' ? 10000 : null,
    costMinor: null,
    evidence: ['provider:readback'],
    ...overrides,
  };
}

function revenueEvidence(status: RevenueEvidenceRecord['status']): RevenueEvidenceRecord {
  return {
    ...scope,
    revenueEvidenceId: 'revenue-1',
    dedupeKey: 'a'.repeat(64),
    opportunityId: 'opp-1',
    contactId: 'contact-1',
    leadId: 'lead-1',
    conversationId: null,
    eventId: 'event-1',
    source: 'PAYMENT',
    provider: 'provider-test',
    providerEventId: 'provider-event-1',
    providerEvidenceRef: 'provider-readback:payment-1',
    externalReference: 'payment-1',
    status,
    providerReadbackAt: '2026-08-20T19:00:04.000Z',
    occurredAt: '2026-08-20T19:00:00.000Z',
    currency: status === 'CONFIRMED' || status === 'REFUNDED' ? 'BRL' : null,
    grossRevenueMinor: status === 'CONFIRMED' ? 10000 : null,
    netRevenueMinor: status === 'CONFIRMED' ? 9500 : null,
    refundMinor: status === 'REFUNDED' ? 10000 : null,
    costMinor: null,
    ticketReference: null,
    orderReference: null,
    paymentReference: 'payment-1',
    checkoutReference: null,
    idempotencyKey: 'commerce:test',
    executionId: 'exec-1',
    correlationId: 'corr-1',
    actorPrincipalId: 'agent-1',
    evidence: ['provider-readback:payment-1'],
    createdAt: '2026-08-20T19:00:05.000Z',
  };
}

function crm(overrides: Partial<CrmCoreStore> = {}): CrmCoreStore {
  return {
    createContact: vi.fn(),
    getContact: vi.fn(async ({ contactId }) =>
      contactId === 'contact-1'
        ? {
            ...scope,
            contactId,
            contactType: 'PERSON',
            displayName: 'Buyer',
            status: 'ACTIVE',
            attributes: {},
            version: 1,
            createdAt: '2026-08-20T18:00:00.000Z',
            updatedAt: '2026-08-20T18:00:00.000Z',
          }
        : undefined,
    ),
    updateContact: vi.fn(),
    attachContactChannel: vi.fn(),
    findContactByChannel: vi.fn(async ({ value }) =>
      value === 'buyer@example.com'
        ? {
            ...scope,
            contactId: 'contact-1',
            contactType: 'PERSON',
            displayName: 'Buyer',
            status: 'ACTIVE',
            attributes: {},
            version: 1,
            createdAt: '2026-08-20T18:00:00.000Z',
            updatedAt: '2026-08-20T18:00:00.000Z',
          }
        : undefined,
    ),
    listContactChannels: vi.fn(async () => []),
    createLead: vi.fn(),
    getLead: vi.fn(),
    updateLead: vi.fn(),
    listLeadsForContact: vi.fn(async () => []),
    createOpportunity: vi.fn(),
    getOpportunity: vi.fn(async ({ opportunityId }) =>
      opportunityId === opportunity.opportunityId ? opportunity : undefined,
    ),
    updateOpportunity: vi.fn(),
    transitionOpportunity: vi.fn(),
    listOpportunitiesForContact: vi.fn(async () => [opportunity]),
    listRevisions: vi.fn(async () => []),
    ...overrides,
  } as CrmCoreStore;
}

function service() {
  const recordRevenueEvidence = vi.fn(async (_context, input) =>
    revenueEvidence(input.status as RevenueEvidenceRecord['status']),
  );
  const captureTouchpoint = vi.fn(async () => ({ touchpointId: 'touch-1' }));
  const confirmOpportunityWon = vi.fn();
  return {
    value: {
      recordRevenueEvidence,
      captureTouchpoint,
      confirmOpportunityWon,
    } as unknown as AttributionRevenueService,
    recordRevenueEvidence,
    captureTouchpoint,
    confirmOpportunityWon,
  };
}

function adapter(providerReadback: CommerceProviderReadback, verified = true) {
  const event = commerceEvent(providerReadback.status, {
    providerEventId: providerReadback.providerEventId,
    externalReference: providerReadback.externalReference,
    source: providerReadback.source,
    attribution: providerReadback.attribution,
    customer: providerReadback.customer,
  });
  return {
    provider: 'provider-test',
    verifyWebhookSignature: vi.fn(async () => ({
      verified,
      providerDeliveryId: 'delivery-1',
      evidence: ['signature:hmac:verified'],
    })),
    parseWebhook: vi.fn(async () => event),
    readback: vi.fn(async () => providerReadback),
  } satisfies CommerceProviderReadbackAdapter;
}

const envelope = {
  rawBody: '{"id":"provider-event-1"}',
  headers: { 'x-provider-signature': 'signature' },
  receivedAt: '2026-08-20T19:00:01.000Z',
} as const;

describe('commerce provider boundary', () => {
  it('records paid readback as provider-confirmed revenue', async () => {
    const attributionRevenue = service();
    const coordinator = new CommerceProviderRevenueCoordinator(
      adapter(readback('PAID')),
      crm(),
      attributionRevenue.value,
    );

    const result = await coordinator.ingestWebhook(context, envelope);

    expect(result.status).toBe('REVENUE_RECORDED');
    expect(attributionRevenue.recordRevenueEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        evidence: expect.arrayContaining(['provider-readback:payment-1']),
      }),
      expect.objectContaining({ status: 'CONFIRMED', opportunityId: 'opp-1' }),
    );
  });

  it('never records pending as revenue', async () => {
    const attributionRevenue = service();
    const coordinator = new CommerceProviderRevenueCoordinator(
      adapter(readback('PENDING')),
      crm(),
      attributionRevenue.value,
    );

    const result = await coordinator.ingestWebhook(context, envelope);

    expect(result.status).toBe('PENDING_NO_REVENUE');
    expect(attributionRevenue.recordRevenueEvidence).not.toHaveBeenCalled();
  });

  it.each([
    ['CANCELED', 'CANCELED'],
    ['REFUNDED', 'REFUNDED'],
    ['CHARGEBACK', 'REFUNDED'],
  ] as const)(
    'maps %s readback without inventing a financial state',
    async (providerStatus, revenueStatus) => {
      const attributionRevenue = service();
      const coordinator = new CommerceProviderRevenueCoordinator(
        adapter(readback(providerStatus)),
        crm(),
        attributionRevenue.value,
      );

      await coordinator.ingestWebhook(context, envelope);

      expect(attributionRevenue.recordRevenueEvidence).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: revenueStatus }),
      );
    },
  );

  it('deduplicates duplicate webhook processing with a deterministic idempotency key', async () => {
    const value = readback('PAID');
    const first = commerceIdempotencyKey('revenue', value, 'opp-1');
    const second = commerceIdempotencyKey('revenue', { ...value }, 'opp-1');

    expect(first).toBe(second);

    const restarted = commerceIdempotencyKey('revenue', readback('PAID'), 'opp-1');
    expect(restarted).toBe(first);
  });

  it('keeps unknown contacts unmatched and revenue-free', async () => {
    const value = readback('PAID', {
      attribution: attribution({ opportunityId: null, contactId: null }),
      customer: { providerCustomerId: 'unknown', email: 'unknown@example.com', phone: null },
    });
    const attributionRevenue = service();
    const coordinator = new CommerceProviderRevenueCoordinator(
      adapter(value),
      crm(),
      attributionRevenue.value,
    );

    const result = await coordinator.ingestWebhook(context, envelope);

    expect(result).toMatchObject({
      status: 'UNMATCHED_NO_REVENUE',
      resolution: { status: 'UNMATCHED', reason: 'UNKNOWN_CONTACT' },
    });
    expect(attributionRevenue.recordRevenueEvidence).not.toHaveBeenCalled();
  });

  it('matches a canonical CRM contact by email and resolves its single eligible opportunity', async () => {
    const value = readback('PAID', {
      attribution: attribution({ opportunityId: null, contactId: null }),
      customer: { providerCustomerId: 'customer-1', email: 'buyer@example.com', phone: null },
    });

    const resolution = await resolveCommerceOpportunity(crm(), scope, value);

    expect(resolution).toMatchObject({
      status: 'MATCHED',
      matchedBy: 'CONTACT_CHANNEL',
      opportunity: { opportunityId: 'opp-1', contactId: 'contact-1' },
    });
  });

  it('captures attribution only when provider-carried attribution signals exist', async () => {
    const attributionRevenue = service();
    const withAttribution = readback('PAID', {
      attribution: attribution({
        source: 'instagram',
        campaign: 'party-aug',
        ad: 'ad-42',
        content: 'creative-42',
        utmSource: 'instagram',
        utmMedium: 'paid_social',
        utmCampaign: 'party-aug',
        utmContent: 'creative-42',
      }),
    });
    const coordinator = new CommerceProviderRevenueCoordinator(
      adapter(withAttribution),
      crm(),
      attributionRevenue.value,
    );

    await coordinator.ingestWebhook(context, envelope);

    expect(attributionRevenue.captureTouchpoint).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        source: 'instagram',
        medium: 'paid_social',
        campaign: 'party-aug',
        content: 'creative-42',
        messageRef: 'ad-42',
      }),
    );

    const withoutAttribution = service();
    const noSignal = new CommerceProviderRevenueCoordinator(
      adapter(readback('PAID')),
      crm(),
      withoutAttribution.value,
    );
    await noSignal.ingestWebhook(context, envelope);
    expect(withoutAttribution.captureTouchpoint).not.toHaveBeenCalled();
  });

  it('rejects invalid webhook signatures before parse/readback', async () => {
    const provider = adapter(readback('PAID'), false);
    const coordinator = new CommerceProviderRevenueCoordinator(provider, crm(), service().value);

    await expect(coordinator.ingestWebhook(context, envelope)).rejects.toThrow(
      'COMMERCE_WEBHOOK_SIGNATURE_INVALID',
    );
    expect(provider.parseWebhook).not.toHaveBeenCalled();
    expect(provider.readback).not.toHaveBeenCalled();
  });

  it('rejects a readback that does not match the webhook provider event', async () => {
    const value = readback('PAID', { providerEventId: 'different-provider-event' });
    const coordinator = new CommerceProviderRevenueCoordinator(
      adapter(value),
      crm(),
      service().value,
    );

    await expect(coordinator.ingestWebhook(context, envelope)).rejects.toThrow(
      'COMMERCE_PROVIDER_READBACK_EVENT_MISMATCH',
    );
  });
});
