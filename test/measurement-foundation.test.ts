import { describe, expect, it } from 'vitest';
import {
  calculateAttribution,
  calculateFunnel,
  calculateSalesPacing,
  reconciliationConfidence,
} from '../src/measurement/analytics.js';
import {
  MEASUREMENT_CAPABILITY_CONTRACTS,
  type AttributionTouchpoint,
} from '../src/measurement/contracts.js';
import {
  assertDataQuality,
  normalizeMeasurementEvent,
  normalizeUtm,
  payloadSha256,
} from '../src/measurement/normalization.js';
import {
  normalizeTicketingInventory,
  normalizeTicketingSalesSummary,
  normalizeTicketingWebhook,
} from '../src/measurement/ticketing.js';

const eventRecord = {
  eventId: 'event-1',
  eventKey: 'the-party-2026-08-22',
  tenantId: 'toca',
  workspaceId: 'toca',
  organizationId: 'toca',
  seriesKey: 'the-party',
  name: 'The Party',
  eventType: 'PARTY',
  status: 'ON_SALE' as const,
  startsAt: '2026-08-22T23:59:00-03:00',
  endsAt: '2026-08-23T06:00:00-03:00',
  timezone: 'America/Bahia',
  venueName: 'Toca do Morcego',
  attributes: {},
  version: 1,
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-01T12:00:00.000Z',
};

describe('measurement normalization', () => {
  it('normalizes UTM source/medium while preserving campaign identity', () => {
    expect(
      normalizeUtm({
        source: ' Instagram ',
        medium: ' PAID_SOCIAL ',
        campaign: 'TheParty_Aug22',
        content: 'Creative_A',
        term: 'Tourists',
      }),
    ).toEqual({
      source: 'instagram',
      medium: 'paid_social',
      campaign: 'TheParty_Aug22',
      content: 'Creative_A',
      term: 'Tourists',
    });
  });

  it('fails closed when ticketing measurement has no EventRecord link', () => {
    const value = normalizeMeasurementEvent({
      measurementEventId: 'm-1',
      tenantId: 'toca',
      workspaceId: 'toca',
      organizationId: 'toca',
      sourceSystem: 'TICKETING',
      sourceEventId: 'ticket-sale-1',
      eventName: 'ticket_purchase',
      occurredAt: '2026-08-15T03:00:00.000Z',
      ingestedAt: '2026-08-15T03:00:01.000Z',
      isConversion: true,
      valueMinor: 10000,
      currency: 'BRL',
      requesterPrincipalId: 'agent-1',
      correlationId: 'corr-1',
      evidence: ['provider:webhook:delivery-1'],
    });
    expect(value.dataQuality.valid).toBe(false);
    expect(value.dataQuality.issues.map((issue) => issue.code)).toContain(
      'EVENT_RECORD_LINK_REQUIRED',
    );
    expect(() => assertDataQuality(value.dataQuality)).toThrow(/MEASUREMENT_DATA_QUALITY_FAILED/);
  });

  it('requires currency when monetary value is present', () => {
    expect(() =>
      normalizeMeasurementEvent({
        measurementEventId: 'm-2',
        tenantId: 'toca',
        workspaceId: 'toca',
        organizationId: 'toca',
        sourceSystem: 'GA4',
        sourceEventId: 'ga4-1',
        eventName: 'purchase',
        occurredAt: '2026-08-15T03:00:00.000Z',
        valueMinor: 100,
        requesterPrincipalId: 'agent-1',
        correlationId: 'corr-1',
        evidence: ['ga4:export:1'],
      }),
    ).toThrow('MEASUREMENT_CURRENCY_REQUIRED');
  });
});

describe('ticketing read-only normalization', () => {
  it('normalizes sales and inventory snapshots without provider mutation concepts', () => {
    const sales = normalizeTicketingSalesSummary({
      snapshotId: 'sales-1',
      eventId: 'event-1',
      tenantId: 'toca',
      workspaceId: 'toca',
      organizationId: 'toca',
      provider: 'doticket',
      externalEventId: 'ext-1',
      result: {
        soldCount: 80,
        orderCount: 65,
        grossRevenueMinor: 1200000,
        netRevenueMinor: 1100000,
        currency: 'brl',
        asOf: '2026-08-15T03:00:00.000Z',
        evidence: ['ticketing:read:1'],
      },
      requesterPrincipalId: 'agent-1',
      correlationId: 'corr-1',
    });
    const inventory = normalizeTicketingInventory({
      snapshotId: 'inventory-1',
      eventId: 'event-1',
      tenantId: 'toca',
      workspaceId: 'toca',
      organizationId: 'toca',
      provider: 'doticket',
      externalEventId: 'ext-1',
      result: {
        capacity: 200,
        sold: 80,
        available: 120,
        held: 0,
        asOf: '2026-08-15T03:00:00.000Z',
        evidence: ['ticketing:read:2'],
      },
      requesterPrincipalId: 'agent-1',
      correlationId: 'corr-1',
    });
    expect(sales.currency).toBe('BRL');
    expect(inventory.available).toBe(120);
    expect(MEASUREMENT_CAPABILITY_CONTRACTS.filter((item) => item.capabilityId.startsWith('ticketing.')).every((item) => item.providerWritesAllowed === false)).toBe(true);
  });

  it('hashes webhook payloads and keeps EventRecord mandatory', () => {
    const rawPayload = { event: 'sale', id: 10 };
    const receipt = normalizeTicketingWebhook({
      receiptId: 'receipt-1',
      eventId: 'event-1',
      tenantId: 'toca',
      workspaceId: 'toca',
      organizationId: 'toca',
      provider: 'doticket',
      externalEventId: 'ext-1',
      providerDeliveryId: 'delivery-1',
      eventType: 'ticket.sale',
      occurredAt: '2026-08-15T03:00:00.000Z',
      receivedAt: '2026-08-15T03:00:01.000Z',
      rawPayload,
      normalizedPayload: { ticketId: 'ticket-1' },
      requesterPrincipalId: 'agent-1',
      correlationId: 'corr-1',
      evidence: ['webhook:delivery-1'],
    });
    expect(receipt.payloadHash).toBe(payloadSha256(rawPayload));
    expect(receipt.dataQuality.valid).toBe(true);
  });
});

describe('funnel, attribution and event pacing', () => {
  it('calculates funnel and drop-off', () => {
    const funnel = calculateFunnel([
      { name: 'visit', count: 1000 },
      { name: 'checkout', count: 200 },
      { name: 'ticket', count: 100 },
    ]);
    expect(funnel.conversionRate).toBe(0.1);
    expect(funnel.dropOffs).toEqual([
      { from: 'visit', to: 'checkout', count: 800, rate: 0.8 },
      { from: 'checkout', to: 'ticket', count: 100, rate: 0.5 },
    ]);
  });

  it('allocates last-touch credit and returns confidence', () => {
    const touchpoints: AttributionTouchpoint[] = [
      {
        touchpointId: 't1',
        occurredAt: '2026-08-14T12:00:00.000Z',
        source: 'instagram',
        medium: 'paid_social',
        campaign: 'party',
        content: 'a',
        term: null,
        campaignId: 'c1',
        contentId: 'ad1',
      },
      {
        touchpointId: 't2',
        occurredAt: '2026-08-15T01:00:00.000Z',
        source: 'google',
        medium: 'organic',
        campaign: null,
        content: null,
        term: 'toca do morcego',
        campaignId: null,
        contentId: null,
      },
    ];
    const result = calculateAttribution({
      model: 'LAST_TOUCH',
      touchpoints,
      conversionOccurredAt: '2026-08-15T02:00:00.000Z',
      sourceQualityScore: 0.95,
      identityContinuityScore: 0.9,
      reconciliationScore: 0.85,
    });
    expect(result.credits.map((item) => item.credit)).toEqual([0, 1]);
    expect(result.confidence.score).toBeGreaterThan(0.8);
  });

  it('makes reconciliation confidence explicit', () => {
    const confidence = reconciliationConfidence({
      measuredConversions: 100,
      ticketConversions: 105,
      matchedConversions: 95,
      sourceQualityScore: 0.95,
    });
    expect(confidence.score).toBeGreaterThan(0.8);
    expect(confidence.level).toBe('HIGH');
  });

  it('calculates sales pacing against EventRecord timing', () => {
    const pacing = calculateSalesPacing({
      event: eventRecord,
      salesStartedAt: '2026-08-01T03:00:00.000Z',
      asOf: '2026-08-15T03:00:00.000Z',
      sold: 100,
      capacity: 200,
      dataQualityScore: 0.95,
    });
    expect(pacing.eventId).toBe('event-1');
    expect(pacing.sellThroughRate).toBe(0.5);
    expect(pacing.ticketsPerDay).toBeGreaterThan(0);
  });
});
