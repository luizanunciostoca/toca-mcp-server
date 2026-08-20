import { describe, expect, it } from 'vitest';
import { createPostgresPool } from '../src/persistence/postgres.js';
import { PostgresAnalyticsReadModelStore } from '../src/persistence/postgres-analytics-read-model-store.js';

const DATABASE_URL = process.env.DATABASE_URL;
const postgresDescribe = DATABASE_URL ? describe : describe.skip;

function databaseUrl(): string {
  if (!DATABASE_URL) throw new Error('ANALYTICS_DATABASE_URL_REQUIRED');
  return DATABASE_URL;
}

postgresDescribe('Analytics + Capacity PostgreSQL read models', () => {
  it('projects existing CRM/measurement/ticketing/audit/publication tables without a new warehouse', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const tenantId = `analytics-tenant-${suffix}`;
    const workspaceId = `analytics-workspace-${suffix}`;
    const organizationId = `analytics-org-${suffix}`;
    const eventId = `analytics-event-${suffix}`;
    const contactA = `analytics-contact-a-${suffix}`;
    const contactB = `analytics-contact-b-${suffix}`;
    const leadA = `analytics-lead-a-${suffix}`;
    const leadB = `analytics-lead-b-${suffix}`;
    const opportunityWon = `analytics-opportunity-won-${suffix}`;
    const opportunityOpen = `analytics-opportunity-open-${suffix}`;
    const externalEventId = `analytics-external-event-${suffix}`;
    const pool = createPostgresPool({
      connectionString: databaseUrl(),
      max: 2,
    });

    try {
      await pool.query(
        `insert into event_records (
           event_id, event_key, tenant_id, workspace_id, organization_id, name, event_type,
           status, starts_at, ends_at, timezone, attributes, version, created_at, updated_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'{}'::jsonb,1,$12,$12)`,
        [
          eventId,
          `event-key-${suffix}`,
          tenantId,
          workspaceId,
          organizationId,
          'Analytics E2E Event',
          'SUNSET',
          'ON_SALE',
          '2026-08-20T20:00:00.000Z',
          '2026-08-21T01:00:00.000Z',
          'America/Bahia',
          '2026-08-19T10:00:00.000Z',
        ],
      );

      await pool.query(
        `insert into crm_contacts (
           contact_id, tenant_id, workspace_id, organization_id, contact_type, display_name,
           status, attributes, version, created_at, updated_at
         ) values
           ($1,$3,$4,$5,'PERSON','Contact A','ACTIVE','{}'::jsonb,1,$6,$6),
           ($2,$3,$4,$5,'PERSON','Contact B','ACTIVE','{}'::jsonb,1,$6,$6)`,
        [contactA, contactB, tenantId, workspaceId, organizationId, '2026-08-19T10:00:00.000Z'],
      );

      await pool.query(
        `insert into crm_leads (
           lead_id, tenant_id, workspace_id, organization_id, contact_id, event_id, source_type,
           source_ref, status, qualification, score, captured_at, qualified_at, attributes,
           version, created_at, updated_at
         ) values
           ($1,$3,$4,$5,$6,$8,'META','campaign-a','QUALIFIED','SALES_QUALIFIED',80,$9,$10,'{}'::jsonb,1,$9,$10),
           ($2,$3,$4,$5,$7,$8,'META','campaign-a','QUALIFIED','SALES_QUALIFIED',70,$9,$10,'{}'::jsonb,1,$9,$10)`,
        [
          leadA,
          leadB,
          tenantId,
          workspaceId,
          organizationId,
          contactA,
          contactB,
          eventId,
          '2026-08-19T11:00:00.000Z',
          '2026-08-19T12:00:00.000Z',
        ],
      );

      await pool.query(
        `insert into crm_opportunities (
           opportunity_id, tenant_id, workspace_id, organization_id, contact_id, lead_id, event_id,
           name, pipeline_key, stage_key, status, currency, value_minor, closed_at, attributes,
           version, created_at, updated_at
         ) values
           ($1,$3,$4,$5,$6,$8,$10,'Won opportunity','sales','won','WON','BRL',50000,$12,'{}'::jsonb,1,$11,$12),
           ($2,$3,$4,$5,$7,$9,$10,'Open opportunity','sales','proposal','OPEN','BRL',80000,null,'{}'::jsonb,1,$11,$12)`,
        [
          opportunityWon,
          opportunityOpen,
          tenantId,
          workspaceId,
          organizationId,
          contactA,
          contactB,
          leadA,
          leadB,
          eventId,
          '2026-08-19T13:00:00.000Z',
          '2026-08-19T14:00:00.000Z',
        ],
      );

      const measurementBase = {
        tenantId,
        workspaceId,
        organizationId,
        eventId,
        contactId: contactA,
        campaignId: `campaign-${suffix}`,
        contentId: `content-${suffix}`,
        creativeId: `creative-${suffix}`,
        adId: `ad-${suffix}`,
      };
      const observations = [
        {
          metric: 'reach',
          analyticsValue: 1000,
          valueMinor: null,
          currency: null,
          conversion: false,
        },
        {
          metric: 'engagement',
          analyticsValue: 100,
          valueMinor: null,
          currency: null,
          conversion: false,
        },
        {
          metric: 'spend',
          analyticsValue: null,
          valueMinor: 10000,
          currency: 'BRL',
          conversion: false,
        },
        {
          metric: 'conversion',
          analyticsValue: 1,
          valueMinor: null,
          currency: null,
          conversion: true,
        },
        {
          metric: 'attributed_revenue',
          analyticsValue: null,
          valueMinor: 30000,
          currency: 'BRL',
          conversion: false,
        },
      ] as const;
      for (const [index, observation] of observations.entries()) {
        await pool.query(
          `insert into measurement_events (
             measurement_event_id, tenant_id, workspace_id, organization_id, event_id,
             source_system, source_event_id, event_name, occurred_at, ingested_at, subject_id,
             utm_source, utm_medium, utm_campaign, campaign_id, content_id, is_conversion,
             value_minor, currency, properties, data_quality, requester_principal_id,
             correlation_id, evidence
           ) values ($1,$2,$3,$4,$5,'META',$6,$7,$8,$8,$9,'instagram','paid_social','campaign-a',$10,$11,$12,$13,$14,$15,'{}'::jsonb,'analytics-e2e',$16,$17::jsonb)`,
          [
            `measurement-${index}-${suffix}`,
            measurementBase.tenantId,
            measurementBase.workspaceId,
            measurementBase.organizationId,
            measurementBase.eventId,
            `source-${index}-${suffix}`,
            `analytics.${observation.metric}`,
            `2026-08-19T15:0${index}:00.000Z`,
            measurementBase.contactId,
            measurementBase.campaignId,
            measurementBase.contentId,
            observation.conversion,
            observation.valueMinor,
            observation.currency,
            JSON.stringify({
              analyticsMetric: observation.metric,
              ...(observation.analyticsValue === null
                ? {}
                : { analyticsValue: observation.analyticsValue }),
              creativeId: measurementBase.creativeId,
              adId: measurementBase.adId,
            }),
            `measurement-correlation-${index}-${suffix}`,
            JSON.stringify([`measurement:e2e:${index}`]),
          ],
        );
      }

      await pool.query(
        `insert into ticketing_event_bindings (
           binding_id, tenant_id, workspace_id, organization_id, event_id, provider,
           external_event_id, requester_principal_id, correlation_id, evidence, created_at
         ) values ($1,$2,$3,$4,$5,'TEST_TICKETING',$6,'analytics-e2e',$7,$8::jsonb,$9)`,
        [
          `binding-${suffix}`,
          tenantId,
          workspaceId,
          organizationId,
          eventId,
          externalEventId,
          `binding-correlation-${suffix}`,
          JSON.stringify(['ticketing:binding:e2e']),
          '2026-08-19T10:00:00.000Z',
        ],
      );
      await pool.query(
        `insert into ticketing_sales_snapshots (
           snapshot_id, tenant_id, workspace_id, organization_id, event_id, provider,
           external_event_id, sold_count, order_count, gross_revenue_minor, net_revenue_minor,
           currency, as_of, requester_principal_id, correlation_id, evidence
         ) values ($1,$2,$3,$4,$5,'TEST_TICKETING',$6,92,70,50000,40000,'BRL',$7,'analytics-e2e',$8,$9::jsonb)`,
        [
          `sales-${suffix}`,
          tenantId,
          workspaceId,
          organizationId,
          eventId,
          externalEventId,
          '2026-08-19T20:00:00.000Z',
          `sales-correlation-${suffix}`,
          JSON.stringify(['ticketing:sales:e2e']),
        ],
      );
      await pool.query(
        `insert into ticketing_inventory_snapshots (
           snapshot_id, tenant_id, workspace_id, organization_id, event_id, provider,
           external_event_id, capacity, sold, available, held, as_of, requester_principal_id,
           correlation_id, evidence
         ) values ($1,$2,$3,$4,$5,'TEST_TICKETING',$6,100,92,8,0,$7,'analytics-e2e',$8,$9::jsonb)`,
        [
          `inventory-${suffix}`,
          tenantId,
          workspaceId,
          organizationId,
          eventId,
          externalEventId,
          '2026-08-19T20:00:00.000Z',
          `inventory-correlation-${suffix}`,
          JSON.stringify(['ticketing:inventory:e2e']),
        ],
      );

      for (const [index, state] of ['PUBLISHED', 'FAILED'].entries()) {
        await pool.query(
          `insert into provider_publications (
             correlation_id, provider, account_id, external_resource_id, state, idempotency_key,
             payload, last_error, created_at, updated_at
           ) values ($1,'instagram','ig-test',$2,$3,$4,$5::jsonb,$6,$7,$7)`,
          [
            `publication-correlation-${index}-${suffix}`,
            `external-${index}-${suffix}`,
            state,
            `publication-idempotency-${index}-${suffix}`,
            JSON.stringify({ tenantId, eventId }),
            state === 'FAILED' ? 'provider failure fixture' : null,
            `2026-08-19T18:0${index}:00.000Z`,
          ],
        );
      }

      for (const [index, status] of ['SUCCEEDED', 'FAILED'].entries()) {
        await pool.query(
          `insert into audit_ledger_events (
             event_id, execution_id, correlation_id, sequence, previous_hash, event_hash,
             actor_id, principal_type, tenant_id, workspace_id, organization_id, tool_name,
             risk_class, status, connected_account, error_code, evidence, canonical_payload, created_at
           ) values ($1,$2,$3,1,$4,$5,'analytics-e2e','SERVICE',$6,$7,$8,'meta_ads.insights.get','READ_ONLY',$9,'meta-test',$10,$11::jsonb,'{}'::jsonb,$12)`,
          [
            `audit-event-${index}-${suffix}`,
            `audit-execution-${index}-${suffix}`,
            `audit-correlation-${index}-${suffix}`,
            '0'.repeat(64),
            `${index + 1}`.repeat(64),
            tenantId,
            workspaceId,
            organizationId,
            status,
            status === 'FAILED' ? 'PROVIDER_TEST_FAILURE' : null,
            JSON.stringify([`audit:e2e:${index}`]),
            `2026-08-19T19:0${index}:00.000Z`,
          ],
        );
      }

      const store = new PostgresAnalyticsReadModelStore(pool);
      const snapshot = await store.buildSnapshot({
        scope: { tenantId, workspaceId, organizationId },
        window: {
          startsAt: '2026-08-19T00:00:00.000Z',
          endsAt: '2026-08-20T00:00:00.000Z',
        },
        eventId,
        capacityPolicy: {
          watchOccupancyRatio: 0.75,
          nearCapacityRatio: 0.9,
          maxIncreaseAtWatchPercent: 10,
        },
        operationalConstraints: [],
        responseSla: null,
        demand: null,
      });

      expect(snapshot.reach.value).toBe(1000);
      expect(snapshot.engagement.value).toBe(100);
      expect(snapshot.spend.value).toEqual({
        valueMinor: 10000,
        currency: 'BRL',
      });
      expect(snapshot.qualifiedLeadRate.value).toBe(1);
      expect(snapshot.opportunityRate.value).toBe(1);
      expect(snapshot.winRate.value).toBe(1);
      expect(snapshot.pipelineValue.value).toEqual({
        valueMinor: 80000,
        currency: 'BRL',
      });
      expect(snapshot.revenue.value).toEqual({
        valueMinor: 40000,
        currency: 'BRL',
      });
      expect(snapshot.roas.value).toBe(4);
      expect(snapshot.publicationReliabilityRate.value).toBe(0.5);
      expect(snapshot.providerFailureRate.value).toBe(0.5);
      expect(snapshot.capacity.value?.status).toBe('NEAR_CAPACITY');
      expect(snapshot.responseSlaComplianceRate.state).toBe('UNAVAILABLE');
      expect(snapshot.demandIndex.state).toBe('UNAVAILABLE');
      expect(snapshot.creativePerformance.value?.[0]).toMatchObject({
        creativeId: measurementBase.creativeId,
        campaignId: measurementBase.campaignId,
        adId: measurementBase.adId,
        reach: 1000,
        engagements: 100,
        conversions: 1,
      });

      const drilldown = await store.getDrilldown(
        { tenantId, workspaceId, organizationId },
        opportunityWon,
      );
      expect(drilldown).not.toBeNull();
      expect(drilldown?.leadId).toBe(leadA);
      expect(drilldown?.campaignIds).toEqual([measurementBase.campaignId]);
      expect(drilldown?.adIds).toEqual([measurementBase.adId]);
      expect(drilldown?.creativeIds).toEqual([measurementBase.creativeId]);
      expect(drilldown?.contentIds).toEqual([measurementBase.contentId]);
      expect(drilldown?.touchpoints).toHaveLength(observations.length);
    } finally {
      await pool.end();
    }
  });
});
