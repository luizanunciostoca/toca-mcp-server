import { describe, expect, it } from 'vitest';
import {
  buildExecutiveAnalyticsSnapshot,
  type AnalyticsReadModelInput,
} from '../src/measurement/analytics-read-models.js';
import { assessOperationalCapacity } from '../src/measurement/capacity-intelligence.js';
import { deriveAnalyticsAlerts } from '../src/measurement/analytics-alerts.js';

function input(): AnalyticsReadModelInput {
  const capacity = assessOperationalCapacity(
    {
      eventId: 'event-sunset-1',
      capacity: 100,
      sold: 92,
      available: 8,
      held: 0,
      asOf: '2026-08-20T12:00:00-03:00',
      constraints: [],
      evidence: ['ticketing:inventory:snapshot-1'],
    },
    {
      watchOccupancyRatio: 0.75,
      nearCapacityRatio: 0.9,
      maxIncreaseAtWatchPercent: 10,
    },
  );

  return {
    scope: {
      tenantId: 'toca-do-morcego',
      workspaceId: 'marketing',
      organizationId: 'toca',
    },
    window: {
      startsAt: '2026-08-19T00:00:00-03:00',
      endsAt: '2026-08-20T00:00:00-03:00',
    },
    marketing: {
      reach: 20_000,
      engagements: 1_000,
      spend: { valueMinor: 50_000, currency: 'BRL' },
      evidence: ['meta:insights:window-1'],
    },
    crm: {
      leadsCaptured: 100,
      qualifiedLeads: 40,
      opportunitiesCreated: 20,
      opportunitiesWon: 8,
      opportunitiesLost: 2,
      wonCustomers: 8,
      openOpportunities: 10,
      openPipelineValue: { valueMinor: 800_000, currency: 'BRL' },
      averageOpenOpportunityAgeDays: 4,
      evidence: ['postgres:crm'],
    },
    revenue: { valueMinor: 250_000, currency: 'BRL' },
    responseSla: null,
    publicationReliability: {
      total: 100,
      successful: 98,
      failed: 2,
      evidence: ['postgres:provider_publications'],
    },
    providerReliability: {
      total: 50,
      successful: 48,
      failed: 2,
      evidence: ['postgres:audit_ledger_events'],
    },
    creativePerformance: [
      {
        creativeId: 'creative-a',
        contentId: 'content-a',
        campaignId: 'campaign-a',
        adId: 'ad-a',
        reach: 10_000,
        engagements: 500,
        conversions: 25,
        spend: { valueMinor: 20_000, currency: 'BRL' },
        attributedRevenue: { valueMinor: 100_000, currency: 'BRL' },
        evidence: ['measurement:creative-a'],
      },
    ],
    demand: {
      index: 78,
      confidence: 0.82,
      observedAt: '2026-08-20T11:00:00-03:00',
      evidence: ['demand:sample-1'],
    },
    capacity,
    evidence: ['read-model:test-fixture'],
  };
}

describe('Executive analytics read model', () => {
  it('derives commercial, revenue, reliability and creative KPIs without inventing missing SLA data', () => {
    const snapshot = buildExecutiveAnalyticsSnapshot(input());

    expect(snapshot.reach.value).toBe(20_000);
    expect(snapshot.engagement.value).toBe(1_000);
    expect(snapshot.cpl.value).toEqual({ valueMinor: 500, currency: 'BRL' });
    expect(snapshot.qualifiedLeadRate.value).toBe(0.4);
    expect(snapshot.opportunityRate.value).toBe(0.5);
    expect(snapshot.winRate.value).toBe(0.8);
    expect(snapshot.cac.value).toEqual({ valueMinor: 6_250, currency: 'BRL' });
    expect(snapshot.revenue.value).toEqual({ valueMinor: 250_000, currency: 'BRL' });
    expect(snapshot.roas.value).toBe(5);
    expect(snapshot.pipelineValue.value).toEqual({ valueMinor: 800_000, currency: 'BRL' });
    expect(snapshot.publicationReliabilityRate.value).toBe(0.98);
    expect(snapshot.providerFailureRate.value).toBe(0.04);
    expect(snapshot.responseSlaComplianceRate.state).toBe('UNAVAILABLE');
    expect(snapshot.responseSlaComplianceRate.reason).toBe('RESPONSE_SLA_SOURCE_UNAVAILABLE');
    expect(snapshot.demandIndex.value).toBe(78);
    expect(snapshot.capacity.value?.status).toBe('NEAR_CAPACITY');
    expect(snapshot.creativePerformance.value?.[0]?.engagementRate).toBe(0.05);
    expect(snapshot.creativePerformance.value?.[0]?.roas).toBe(5);
  });

  it('fails ROAS closed when revenue and spend currencies differ', () => {
    const base = input();
    const snapshot = buildExecutiveAnalyticsSnapshot({
      ...base,
      revenue: { valueMinor: 250_000, currency: 'USD' },
    });

    expect(snapshot.roas.state).toBe('AMBIGUOUS');
    expect(snapshot.roas.reason).toBe('ROAS_CURRENCY_MISMATCH');
  });

  it('derives alerts from explicit thresholds and reports missing SLA as informational evidence', () => {
    const snapshot = buildExecutiveAnalyticsSnapshot(input());
    const alerts = deriveAnalyticsAlerts(snapshot, {
      minimumPublicationReliabilityRate: 0.99,
      maximumProviderFailureRate: 0.03,
      maximumAverageOpenOpportunityAgeDays: 3,
      minimumResponseSlaComplianceRate: 0.9,
    });

    expect(alerts.map((alert) => alert.code)).toEqual([
      'CAPACITY_NEAR_LIMIT',
      'PIPELINE_AGING_HIGH',
      'PROVIDER_FAILURE_RATE_HIGH',
      'PUBLICATION_RELIABILITY_LOW',
      'RESPONSE_SLA_SOURCE_UNAVAILABLE',
    ]);
  });
});
