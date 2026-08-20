import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTION_REVENUE_CAPABILITY_CONTRACTS,
  REVENUE_EVIDENCE_SOURCES,
  assertReliableWonEvidence,
  buildMarketingSalesFeedback,
  calculateRevenueIntelligence,
  resolveAttributionRoles,
  validateRevenueEvidence,
  type AttributionTouchpointRecord,
  type AttributionWindowPolicy,
  type RevenueEvidenceRecord,
} from '../src/measurement/attribution-revenue.js';

const scope = {
  tenantId: 'toca',
  workspaceId: 'toca',
  organizationId: 'toca',
} as const;

const metadata = {
  idempotencyKey: 'idem-1',
  executionId: 'exec-1',
  correlationId: 'corr-1',
  actorPrincipalId: 'agent-1',
  evidence: ['test:evidence'],
  createdAt: '2026-08-20T05:00:00.000Z',
} as const;

const policy: AttributionWindowPolicy = {
  ...scope,
  ...metadata,
  policyId: 'policy-1',
  policyKey: 'default-sales',
  version: 1,
  firstTouchLookbackDays: 90,
  lastTouchLookbackDays: 7,
  assistedLookbackDays: 30,
};

function touchpoint(
  id: string,
  occurredAt: string,
  overrides: Partial<AttributionTouchpointRecord> = {},
): AttributionTouchpointRecord {
  return {
    ...scope,
    ...metadata,
    idempotencyKey: `idem-${id}`,
    touchpointId: id,
    dedupeKey: id.padEnd(64, '0').slice(0, 64),
    contactId: 'contact-1',
    leadId: 'lead-1',
    opportunityId: 'opp-1',
    conversationId: 'conv-1',
    messageId: `message-${id}`,
    channel: 'INSTAGRAM',
    utm: {
      source: 'instagram',
      medium: 'paid_social',
      campaign: 'party-aug',
      content: `creative-${id}`,
      term: null,
    },
    metaCampaignId: 'meta-campaign-1',
    metaAdsetId: 'meta-adset-1',
    metaAdId: `meta-ad-${id}`,
    metaCreativeId: `meta-creative-${id}`,
    googleCampaignId: null,
    googleAdGroupId: null,
    googleAdId: null,
    googleCreativeId: null,
    clickId: `click-${id}`,
    fbclid: null,
    gclid: null,
    gbraid: null,
    wbraid: null,
    landingUrl: 'https://example.test/party',
    sessionId: 'session-1',
    leadSource: 'instagram_dm',
    ticketReference: null,
    orderReference: null,
    paymentReference: null,
    checkoutReference: null,
    messageRef: `copy:${id}`,
    intent: 'buy_ticket',
    demandContext: { demandIndex: 78, band: 'HIGH' },
    attributionSource: 'meta_ads',
    occurredAt,
    ...overrides,
  };
}

function revenue(
  id: string,
  status: RevenueEvidenceRecord['status'],
  occurredAt: string,
  overrides: Partial<RevenueEvidenceRecord> = {},
): RevenueEvidenceRecord {
  return {
    ...scope,
    ...metadata,
    idempotencyKey: `revenue-${id}`,
    revenueEvidenceId: id,
    dedupeKey: id.padEnd(64, 'a').slice(0, 64),
    opportunityId: 'opp-1',
    contactId: 'contact-1',
    leadId: 'lead-1',
    conversationId: 'conv-1',
    eventId: 'event-1',
    source: 'PAYMENT',
    provider: 'mercado-pago',
    providerEventId: `provider-${id}`,
    providerEvidenceRef: `provider-readback:${id}`,
    externalReference: 'payment-123',
    status,
    providerReadbackAt: '2026-08-20T05:10:00.000Z',
    occurredAt,
    currency: 'BRL',
    grossRevenueMinor: status === 'CONFIRMED' ? 20000 : null,
    netRevenueMinor: status === 'CONFIRMED' ? 19000 : null,
    refundMinor: status === 'REFUNDED' ? 5000 : null,
    costMinor: status === 'CONFIRMED' ? 7000 : null,
    ticketReference: null,
    orderReference: null,
    paymentReference: 'payment-123',
    checkoutReference: null,
    ...overrides,
  };
}

describe('Attribution + Revenue Intelligence', () => {
  it('keeps revenue evidence restricted to trustworthy commerce systems', () => {
    expect(REVENUE_EVIDENCE_SOURCES).toEqual(['TICKETING', 'CHECKOUT', 'PAYMENT', 'ORDER']);
    expect(REVENUE_EVIDENCE_SOURCES).not.toContain('CLICK');
    expect(REVENUE_EVIDENCE_SOURCES).not.toContain('DM');
    expect(
      ATTRIBUTION_REVENUE_CAPABILITY_CONTRACTS.every(
        (contract) => contract.providerWritesAllowed === false && contract.routeId === 'R31',
      ),
    ).toBe(true);
  });

  it('resolves configurable first, last and assisted touch windows deterministically', () => {
    const resolved = resolveAttributionRoles({
      policy,
      conversionOccurredAt: '2026-08-20T05:00:00.000Z',
      touchpoints: [
        touchpoint('first', '2026-06-20T05:00:00.000Z'),
        touchpoint('assist', '2026-08-01T05:00:00.000Z'),
        touchpoint('last', '2026-08-19T05:00:00.000Z'),
      ],
    });

    expect(resolved.find((item) => item.touchpointId === 'first')?.roles).toContain('FIRST_TOUCH');
    expect(resolved.find((item) => item.touchpointId === 'assist')?.roles).toContain('ASSISTED');
    expect(resolved.find((item) => item.touchpointId === 'last')?.roles).toContain('LAST_TOUCH');
  });

  it('dedupes provider evidence and accounts for refund, cancellation and contribution margin', () => {
    const confirmed = revenue('confirmed', 'CONFIRMED', '2026-08-20T04:00:00.000Z');
    const duplicate = { ...confirmed };
    const refunded = revenue('refund', 'REFUNDED', '2026-08-20T04:30:00.000Z');

    const result = calculateRevenueIntelligence([confirmed, duplicate, refunded]);
    expect(result).toMatchObject({
      currency: 'BRL',
      grossRevenueMinor: 20000,
      refundMinor: 5000,
      realizedRevenueMinor: 14000,
      contributionMarginMinor: 7000,
      confirmedReferences: 1,
      refundedReferences: 1,
      canceledReferences: 0,
    });

    const canceled = revenue('cancel', 'CANCELED', '2026-08-20T04:45:00.000Z');
    expect(calculateRevenueIntelligence([confirmed, refunded, canceled]).realizedRevenueMinor).toBe(
      0,
    );
    expect(() => assertReliableWonEvidence([confirmed, refunded])).not.toThrow();
    expect(() => assertReliableWonEvidence([confirmed, canceled])).toThrow(
      'CRM_WON_REQUIRES_ACTIVE_CONVERSION_EVIDENCE',
    );
    const fullyRefunded = revenue('full-refund', 'REFUNDED', '2026-08-20T04:50:00.000Z', {
      refundMinor: 19000,
    });
    expect(() => assertReliableWonEvidence([confirmed, fullyRefunded])).toThrow(
      'CRM_WON_REQUIRES_ACTIVE_CONVERSION_EVIDENCE',
    );
  });

  it('rejects non-commerce evidence and mixed-currency revenue', () => {
    const invalidSource = {
      ...revenue('invalid', 'CONFIRMED', '2026-08-20T04:00:00.000Z'),
      source: 'DM',
    } as unknown as RevenueEvidenceRecord;
    expect(() => validateRevenueEvidence(invalidSource)).toThrow('REVENUE_SOURCE_INVALID');

    const brl = revenue('brl', 'CONFIRMED', '2026-08-20T04:00:00.000Z');
    const usd = revenue('usd', 'CONFIRMED', '2026-08-20T04:05:00.000Z', {
      externalReference: 'payment-456',
      paymentReference: 'payment-456',
      currency: 'USD',
    });
    expect(() => calculateRevenueIntelligence([brl, usd])).toThrow('REVENUE_CURRENCY_MISMATCH');
  });

  it('feeds campaign context to Sales and qualified revenue outcomes back to Marketing', () => {
    const wonOpportunity = {
      ...scope,
      opportunityId: 'opp-1',
      contactId: 'contact-1',
      leadId: 'lead-1',
      eventId: 'event-1',
      name: 'Ticket sale',
      pipelineKey: 'tickets',
      stageKey: 'won',
      status: 'WON' as const,
      currency: 'BRL',
      valueMinor: 20000,
      nextAction: null,
      nextActionAt: null,
      ownerPrincipalId: 'sales-1',
      expectedCloseAt: null,
      closedAt: '2026-08-20T05:00:00.000Z',
      lossReason: null,
      attributes: {},
      version: 2,
      createdAt: '2026-08-18T05:00:00.000Z',
      updatedAt: '2026-08-20T05:00:00.000Z',
    };
    const lead = {
      ...scope,
      leadId: 'lead-1',
      contactId: 'contact-1',
      eventId: 'event-1',
      sourceType: 'instagram_dm',
      sourceRef: 'message-1',
      status: 'QUALIFIED' as const,
      qualification: 'SALES_QUALIFIED' as const,
      score: 91,
      ownerPrincipalId: 'sales-1',
      slaDueAt: null,
      capturedAt: '2026-08-18T05:00:00.000Z',
      qualifiedAt: '2026-08-18T05:10:00.000Z',
      convertedAt: null,
      disqualifiedReason: null,
      attributes: {},
      version: 2,
      createdAt: '2026-08-18T05:00:00.000Z',
      updatedAt: '2026-08-18T05:10:00.000Z',
    };
    const resolved = resolveAttributionRoles({
      policy,
      conversionOccurredAt: wonOpportunity.closedAt,
      touchpoints: [touchpoint('last', '2026-08-19T05:00:00.000Z')],
    });
    const snapshot = buildMarketingSalesFeedback({
      feedbackId: 'feedback-1',
      opportunity: wonOpportunity,
      lead,
      touchpoints: resolved,
      revenueEvidence: [revenue('confirmed', 'CONFIRMED', '2026-08-20T04:00:00.000Z')],
      metadata,
    });

    expect(snapshot.marketing).toMatchObject({
      leadQuality: 91,
      qualification: 'SALES_QUALIFIED',
      outcome: 'WON',
      revenueMinor: 19000,
      contributionMarginMinor: 12000,
      currency: 'BRL',
      salesCycleDays: 2,
    });
    expect(snapshot.sales).toMatchObject({
      campaign: 'party-aug',
      creative: 'meta-creative-last',
      source: 'instagram',
      intent: 'buy_ticket',
      touchpointId: 'last',
    });
  });
});
