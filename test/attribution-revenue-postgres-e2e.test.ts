import { describe, expect, it } from 'vitest';
import { createTrustedServiceExecutionIdentity } from '../src/core/identity.js';
import { AttributionRevenueService } from '../src/measurement/attribution-revenue-service.js';
import { PostgresAttributionRevenueStore } from '../src/persistence/postgres-attribution-revenue-store.js';
import { PostgresCrmCoreStore } from '../src/persistence/postgres-crm-core-store.js';
import { createPostgresPool } from '../src/persistence/postgres.js';

const DATABASE_URL = process.env.DATABASE_URL;
const postgresDescribe = DATABASE_URL ? describe : describe.skip;

function databaseUrl(): string {
  if (!DATABASE_URL) throw new Error('ATTRIBUTION_REVENUE_DATABASE_URL_REQUIRED');
  return DATABASE_URL;
}

postgresDescribe('Attribution + Revenue PostgreSQL E2E', () => {
  it('survives restart, dedupes retries and blocks WON until provider readback evidence exists', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const tenantId = `attr-tenant-${suffix}`;
    const workspaceId = `attr-workspace-${suffix}`;
    const organizationId = `attr-org-${suffix}`;
    const contactId = `attr-contact-${suffix}`;
    const leadId = `attr-lead-${suffix}`;
    const opportunityId = `attr-opportunity-${suffix}`;
    const correlationId = `attr-correlation-${suffix}`;
    const baseEvidence = ['postgres-e2e:attribution-revenue'];
    const identity = createTrustedServiceExecutionIdentity({
      principalId: 'postgres-e2e:attribution-revenue',
      tenantId,
      workspaceId,
      organizationId,
      roles: ['OPERATOR'],
      allowedRouteIds: ['R31'],
      evidence: baseEvidence,
      now: '2026-08-20T05:00:00.000Z',
    });

    const pool1 = createPostgresPool({ connectionString: databaseUrl(), max: 4 });
    const crm1 = new PostgresCrmCoreStore(pool1);
    const store1 = new PostgresAttributionRevenueStore(pool1);
    const service1 = new AttributionRevenueService(store1, crm1);
    const crmMutation = {
      tenantId,
      workspaceId,
      organizationId,
      correlationId,
      actorPrincipalId: identity.principal.principalId,
      evidence: baseEvidence,
      now: '2026-08-20T05:00:00.000Z',
    } as const;

    await crm1.createContact({
      ...crmMutation,
      executionId: `contact-exec-${suffix}`,
      idempotencyKey: `contact-idem-${suffix}`,
      contactId,
      contactType: 'PERSON',
      displayName: 'Opaque attribution E2E contact',
    });
    await crm1.createLead({
      ...crmMutation,
      executionId: `lead-exec-${suffix}`,
      idempotencyKey: `lead-idem-${suffix}`,
      leadId,
      contactId,
      sourceType: 'instagram_dm',
      status: 'QUALIFIED',
      qualification: 'SALES_QUALIFIED',
      score: 92,
    });
    const opportunity = await crm1.createOpportunity({
      ...crmMutation,
      executionId: `opportunity-exec-${suffix}`,
      idempotencyKey: `opportunity-idem-${suffix}`,
      opportunityId,
      contactId,
      leadId,
      name: 'Attribution revenue E2E opportunity',
      pipelineKey: 'tickets',
      stageKey: 'checkout_started',
      currency: 'BRL',
      valueMinor: 20000,
    });

    const policyContext = {
      identity,
      executionId: `policy-exec-${suffix}`,
      correlationId,
      evidence: baseEvidence,
      now: '2026-08-20T05:01:00.000Z',
    } as const;
    const policy = await service1.recordWindowPolicy(policyContext, {
      policyKey: 'default-sales',
      version: 1,
      firstTouchLookbackDays: 90,
      lastTouchLookbackDays: 7,
      assistedLookbackDays: 30,
      idempotencyKey: `policy-idem-${suffix}`,
    });
    const policyReplay = await service1.recordWindowPolicy(policyContext, {
      policyKey: 'default-sales',
      version: 1,
      firstTouchLookbackDays: 90,
      lastTouchLookbackDays: 7,
      assistedLookbackDays: 30,
      idempotencyKey: `policy-idem-${suffix}`,
    });
    expect(policyReplay.policyId).toBe(policy.policyId);

    const touchContext = {
      identity,
      executionId: `touch-exec-${suffix}`,
      correlationId,
      evidence: baseEvidence,
      now: '2026-08-20T05:02:00.000Z',
    } as const;
    const touchpointInput = {
      sourceEventId: `meta-click-${suffix}`,
      opportunityId,
      conversationId: `conversation-${suffix}`,
      messageId: `message-${suffix}`,
      channel: 'INSTAGRAM',
      source: 'instagram',
      medium: 'paid_social',
      campaign: 'party-aug',
      content: 'creative-a',
      metaCampaignId: 'meta-campaign-1',
      metaAdsetId: 'meta-adset-1',
      metaAdId: 'meta-ad-1',
      metaCreativeId: 'meta-creative-1',
      clickId: `click-${suffix}`,
      landingUrl: 'https://example.test/party',
      sessionId: `session-${suffix}`,
      leadSource: 'instagram_dm',
      messageRef: 'copy:party-a',
      intent: 'buy_ticket',
      demandContext: { demandIndex: 80, band: 'HIGH' },
      attributionSource: 'meta_ads',
      occurredAt: '2026-08-20T04:30:00.000Z',
      idempotencyKey: `touch-idem-${suffix}`,
    } as const;
    const firstTouchpoint = await service1.captureTouchpoint(touchContext, touchpointInput);
    const retriedTouchpoint = await service1.captureTouchpoint(touchContext, touchpointInput);
    expect(retriedTouchpoint.touchpointId).toBe(firstTouchpoint.touchpointId);
    const dedupedTouchpoint = await service1.captureTouchpoint(touchContext, {
      ...touchpointInput,
      idempotencyKey: `touch-idem-second-${suffix}`,
    });
    expect(dedupedTouchpoint.touchpointId).toBe(firstTouchpoint.touchpointId);

    await expect(
      crm1.transitionOpportunity({
        ...crmMutation,
        executionId: `won-before-evidence-${suffix}`,
        idempotencyKey: `won-before-evidence-${suffix}`,
        opportunityId,
        expectedVersion: opportunity.version,
        status: 'WON',
      }),
    ).rejects.toThrow('CRM_WON_REQUIRES_VERIFIED_CONVERSION_EVIDENCE');

    await pool1.end();

    const pool2 = createPostgresPool({ connectionString: databaseUrl(), max: 4 });
    try {
      const crm2 = new PostgresCrmCoreStore(pool2);
      const store2 = new PostgresAttributionRevenueStore(pool2);
      const service2 = new AttributionRevenueService(store2, crm2);
      const persistedTouchpoints = await store2.listTouchpoints({
        tenantId,
        workspaceId,
        organizationId,
        opportunityId,
      });
      expect(persistedTouchpoints).toHaveLength(1);
      expect(persistedTouchpoints[0]).toMatchObject({
        metaCampaignId: 'meta-campaign-1',
        metaAdsetId: 'meta-adset-1',
        metaAdId: 'meta-ad-1',
        metaCreativeId: 'meta-creative-1',
        conversationId: `conversation-${suffix}`,
        sessionId: `session-${suffix}`,
      });

      const revenueContext = {
        identity,
        executionId: `revenue-exec-${suffix}`,
        correlationId,
        evidence: baseEvidence,
        now: '2026-08-20T05:05:00.000Z',
      } as const;
      const revenueInput = {
        opportunityId,
        source: 'PAYMENT' as const,
        provider: 'mercado-pago',
        providerEventId: `payment-event-${suffix}`,
        providerEvidenceRef: `provider-readback:payment-${suffix}`,
        externalReference: `payment-${suffix}`,
        status: 'CONFIRMED' as const,
        providerReadbackAt: '2026-08-20T05:04:00.000Z',
        occurredAt: '2026-08-20T05:03:00.000Z',
        currency: 'BRL',
        grossRevenueMinor: 20000,
        netRevenueMinor: 19000,
        costMinor: 7000,
        paymentReference: `payment-${suffix}`,
        conversationId: `conversation-${suffix}`,
        idempotencyKey: `revenue-idem-${suffix}`,
      } as const;
      const evidence = await service2.recordRevenueEvidence(revenueContext, revenueInput);
      const evidenceReplay = await service2.recordRevenueEvidence(revenueContext, revenueInput);
      expect(evidenceReplay.revenueEvidenceId).toBe(evidence.revenueEvidenceId);
      const evidenceDedupe = await service2.recordRevenueEvidence(revenueContext, {
        ...revenueInput,
        idempotencyKey: `revenue-idem-second-${suffix}`,
      });
      expect(evidenceDedupe.revenueEvidenceId).toBe(evidence.revenueEvidenceId);

      const wonContext = {
        identity,
        executionId: `won-exec-${suffix}`,
        correlationId,
        evidence: baseEvidence,
        now: '2026-08-20T05:06:00.000Z',
      } as const;
      const result = await service2.confirmOpportunityWon(wonContext, {
        opportunityId,
        expectedVersion: opportunity.version,
        idempotencyKey: `won-idem-${suffix}`,
        feedbackIdempotencyKey: `feedback-idem-${suffix}`,
        attributionPolicyKey: 'default-sales',
      });
      expect(result.opportunity.status).toBe('WON');
      expect(result.feedback.marketing).toMatchObject({
        leadQuality: 92,
        qualification: 'SALES_QUALIFIED',
        outcome: 'WON',
        revenueMinor: 19000,
        contributionMarginMinor: 12000,
        currency: 'BRL',
      });
      expect(result.feedback.sales).toMatchObject({
        campaign: 'party-aug',
        creative: 'meta-creative-1',
        source: 'instagram',
        intent: 'buy_ticket',
      });

      const outboxRows = await pool2.query<{ count: string }>(
        `select count(*)::text as count from event_outbox
          where tenant_id = $1 and correlation_id = $2
            and event_type in (
              'attribution.window_policy.recorded',
              'attribution.touchpoint.recorded',
              'revenue.evidence.recorded',
              'marketing_sales.feedback.recorded'
            )`,
        [tenantId, correlationId],
      );
      expect(Number(outboxRows.rows[0]?.count ?? '0')).toBeGreaterThanOrEqual(4);

      const auditRows = await pool2.query<{ count: string }>(
        `select count(*)::text as count from audit_ledger_events
          where tenant_id = $1 and correlation_id = $2 and tool_name like 'core.measurement.%'`,
        [tenantId, correlationId],
      );
      expect(Number(auditRows.rows[0]?.count ?? '0')).toBeGreaterThanOrEqual(4);
    } finally {
      await pool2.end();
    }
  });
});
