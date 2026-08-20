import type pg from 'pg';
import {
  buildExecutiveAnalyticsSnapshot,
  normalizeAnalyticsEvidence,
  validateAnalyticsDrilldown,
  type AnalyticsDrilldown,
  type AnalyticsDrilldownTouchpoint,
  type AnalyticsReadModelInput,
  type AnalyticsScope,
  type AnalyticsWindow,
  type CreativePerformanceObservation,
  type DemandSignalInput,
  type ExecutiveAnalyticsSnapshot,
  type MarketingAggregate,
  type MoneyAmount,
  type ReliabilityAggregate,
  type ResponseSlaAggregate,
} from '../measurement/analytics-read-models.js';
import {
  assessOperationalCapacity,
  type CapacityObservation,
  type CapacityPolicy,
  type OperationalConstraint,
} from '../measurement/capacity-intelligence.js';

export interface AnalyticsReadModelQuery {
  readonly scope: AnalyticsScope;
  readonly window: AnalyticsWindow;
  readonly eventId: string | null;
  readonly capacityPolicy: CapacityPolicy;
  readonly operationalConstraints: readonly OperationalConstraint[];
  readonly responseSla: ResponseSlaAggregate | null;
  readonly demand: DemandSignalInput | null;
}

interface MarketingRow {
  readonly reach: string;
  readonly reach_observations: string;
  readonly engagements: string;
  readonly engagement_observations: string;
  readonly spend_minor: string;
  readonly spend_observations: string;
  readonly spend_currency_count: string;
  readonly spend_currency: string | null;
}

interface CrmRow {
  readonly leads_captured: string;
  readonly qualified_leads: string;
  readonly opportunities_created: string;
  readonly opportunities_won: string;
  readonly opportunities_lost: string;
  readonly won_customers: string;
  readonly open_opportunities: string;
  readonly pipeline_value_minor: string;
  readonly pipeline_currency_count: string;
  readonly pipeline_currency: string | null;
  readonly average_open_age_days: string | null;
}

interface RevenueRow {
  readonly revenue_minor: string;
  readonly currency_count: string;
  readonly currency: string | null;
  readonly snapshot_count: string;
}

interface ReliabilityRow {
  readonly total: string;
  readonly successful: string;
  readonly failed: string;
}

interface CapacityRow {
  readonly event_id: string;
  readonly capacity: number | null;
  readonly sold: number;
  readonly available: number | null;
  readonly held: number | null;
  readonly as_of: Date;
  readonly snapshot_id: string;
}

interface CreativeRow {
  readonly creative_id: string;
  readonly content_id: string | null;
  readonly campaign_id: string | null;
  readonly ad_id: string | null;
  readonly reach: string;
  readonly reach_observations: string;
  readonly engagements: string;
  readonly engagement_observations: string;
  readonly conversions: string;
  readonly spend_minor: string;
  readonly spend_currency_count: string;
  readonly spend_currency: string | null;
  readonly revenue_minor: string;
  readonly revenue_currency_count: string;
  readonly revenue_currency: string | null;
  readonly measurement_ids: readonly string[];
}

interface OpportunityDrilldownRow {
  readonly opportunity_id: string;
  readonly lead_id: string | null;
  readonly contact_id: string;
}

interface TouchpointRow {
  readonly measurement_event_id: string;
  readonly occurred_at: Date;
  readonly utm_source: string | null;
  readonly utm_medium: string | null;
  readonly utm_campaign: string | null;
  readonly campaign_id: string | null;
  readonly content_id: string | null;
  readonly ad_id: string | null;
  readonly creative_id: string | null;
  readonly evidence: unknown;
}

export class PostgresAnalyticsReadModelStore {
  public constructor(private readonly pool: pg.Pool) {}

  public async buildSnapshot(query: AnalyticsReadModelQuery): Promise<ExecutiveAnalyticsSnapshot> {
    validateQuery(query);
    const [
      marketing,
      crm,
      revenue,
      publicationReliability,
      providerReliability,
      creativePerformance,
      capacity,
    ] = await Promise.all([
      this.readMarketing(query),
      this.readCrm(query),
      this.readRevenue(query),
      this.readPublicationReliability(query),
      this.readProviderReliability(query),
      this.readCreativePerformance(query),
      this.readCapacity(query),
    ]);

    const input: AnalyticsReadModelInput = {
      scope: query.scope,
      window: query.window,
      marketing,
      crm,
      revenue,
      responseSla: query.responseSla,
      publicationReliability,
      providerReliability,
      creativePerformance,
      demand: query.demand,
      capacity,
      evidence: normalizeAnalyticsEvidence([
        'read-model:postgres-canonical-tables',
        `window:${query.window.startsAt}/${query.window.endsAt}`,
        ...(query.eventId === null ? [] : [`event:${query.eventId}`]),
      ]),
    };
    return buildExecutiveAnalyticsSnapshot(input);
  }

  public async getDrilldown(
    scope: AnalyticsScope,
    opportunityId: string,
  ): Promise<AnalyticsDrilldown | null> {
    requireText(opportunityId, 'ANALYTICS_DRILLDOWN_OPPORTUNITY_REQUIRED');
    const opportunity = await this.pool.query<OpportunityDrilldownRow>(
      `select opportunity_id, lead_id, contact_id
         from crm_opportunities
        where tenant_id = $1 and workspace_id = $2 and organization_id = $3
          and opportunity_id = $4`,
      [scope.tenantId, scope.workspaceId, scope.organizationId, opportunityId],
    );
    const row = opportunity.rows[0];
    if (!row || row.lead_id === null) return null;

    const touchpointResult = await this.pool.query<TouchpointRow>(
      `select measurement_event_id, occurred_at, utm_source, utm_medium, utm_campaign,
              campaign_id, content_id,
              nullif(properties->>'adId', '') as ad_id,
              nullif(properties->>'creativeId', '') as creative_id,
              evidence
         from measurement_events
        where tenant_id = $1 and workspace_id = $2 and organization_id = $3
          and subject_id = any($4::text[])
        order by occurred_at asc, measurement_event_id asc`,
      [
        scope.tenantId,
        scope.workspaceId,
        scope.organizationId,
        [row.contact_id, row.lead_id, row.opportunity_id],
      ],
    );

    const touchpoints: AnalyticsDrilldownTouchpoint[] = touchpointResult.rows.map((touchpoint) => ({
      measurementEventId: touchpoint.measurement_event_id,
      occurredAt: touchpoint.occurred_at.toISOString(),
      source: touchpoint.utm_source,
      medium: touchpoint.utm_medium,
      campaign: touchpoint.utm_campaign,
      campaignId: touchpoint.campaign_id,
      adId: touchpoint.ad_id,
      creativeId: touchpoint.creative_id,
      contentId: touchpoint.content_id,
      evidence: readEvidence(touchpoint.evidence, `measurement:${touchpoint.measurement_event_id}`),
    }));

    const drilldown: AnalyticsDrilldown = {
      resultKey: `opportunity:${row.opportunity_id}`,
      opportunityId: row.opportunity_id,
      leadId: row.lead_id,
      contactId: row.contact_id,
      touchpoints,
      campaignIds: uniqueText(touchpoints.map((touchpoint) => touchpoint.campaignId)),
      adIds: uniqueText(touchpoints.map((touchpoint) => touchpoint.adId)),
      creativeIds: uniqueText(touchpoints.map((touchpoint) => touchpoint.creativeId)),
      contentIds: uniqueText(touchpoints.map((touchpoint) => touchpoint.contentId)),
      evidence: normalizeAnalyticsEvidence([
        `crm:opportunity:${row.opportunity_id}`,
        `crm:lead:${row.lead_id}`,
        ...touchpoints.flatMap((touchpoint) => touchpoint.evidence),
      ]),
    };
    validateAnalyticsDrilldown(drilldown);
    return drilldown;
  }

  private async readMarketing(query: AnalyticsReadModelQuery): Promise<MarketingAggregate | null> {
    const result = await this.pool.query<MarketingRow>(
      `select
          coalesce(sum(case
            when properties->>'analyticsMetric' = 'reach'
             and properties->>'analyticsValue' ~ '^[0-9]+([.][0-9]+)?$'
            then (properties->>'analyticsValue')::numeric else 0 end), 0)::text as reach,
          count(*) filter (where properties->>'analyticsMetric' = 'reach')::text as reach_observations,
          coalesce(sum(case
            when properties->>'analyticsMetric' = 'engagement'
             and properties->>'analyticsValue' ~ '^[0-9]+([.][0-9]+)?$'
            then (properties->>'analyticsValue')::numeric else 0 end), 0)::text as engagements,
          count(*) filter (where properties->>'analyticsMetric' = 'engagement')::text as engagement_observations,
          coalesce(sum(case when properties->>'analyticsMetric' = 'spend' then value_minor else 0 end), 0)::text as spend_minor,
          count(*) filter (where properties->>'analyticsMetric' = 'spend' and value_minor is not null)::text as spend_observations,
          count(distinct currency) filter (where properties->>'analyticsMetric' = 'spend' and value_minor is not null)::text as spend_currency_count,
          min(currency) filter (where properties->>'analyticsMetric' = 'spend' and value_minor is not null) as spend_currency
         from measurement_events
        where tenant_id = $1 and workspace_id = $2 and organization_id = $3
          and occurred_at >= $4 and occurred_at < $5
          and ($6::text is null or event_id = $6)`,
      scopeWindowParams(query),
    );
    const row = result.rows[0];
    if (!row) return null;
    const reachObservations = toCount(row.reach_observations);
    const engagementObservations = toCount(row.engagement_observations);
    const spendObservations = toCount(row.spend_observations);
    if (reachObservations + engagementObservations + spendObservations === 0) return null;
    const spend = moneyFromAggregate(
      row.spend_minor,
      row.spend_currency_count,
      row.spend_currency,
      spendObservations,
    );
    return {
      reach:
        reachObservations === 0
          ? null
          : toFiniteNumber(row.reach, 'ANALYTICS_REACH_AGGREGATE_INVALID'),
      engagements:
        engagementObservations === 0
          ? null
          : toFiniteNumber(row.engagements, 'ANALYTICS_ENGAGEMENT_AGGREGATE_INVALID'),
      spend,
      evidence: normalizeAnalyticsEvidence([
        'postgres:measurement_events',
        'convention:properties.analyticsMetric/v1',
      ]),
    };
  }

  private async readCrm(query: AnalyticsReadModelQuery) {
    const result = await this.pool.query<CrmRow>(
      `with lead_cohort as (
         select * from crm_leads
          where tenant_id = $1 and workspace_id = $2 and organization_id = $3
            and captured_at >= $4 and captured_at < $5
            and ($6::text is null or event_id = $6)
       ), opportunity_cohort as (
         select * from crm_opportunities
          where tenant_id = $1 and workspace_id = $2 and organization_id = $3
            and created_at >= $4 and created_at < $5
            and ($6::text is null or event_id = $6)
       ), open_pipeline as (
         select * from crm_opportunities
          where tenant_id = $1 and workspace_id = $2 and organization_id = $3
            and status = 'OPEN' and created_at < $5
            and ($6::text is null or event_id = $6)
       )
       select
         (select count(*) from lead_cohort)::text as leads_captured,
         (select count(*) from lead_cohort where qualification in ('MARKETING_QUALIFIED','SALES_QUALIFIED'))::text as qualified_leads,
         (select count(*) from opportunity_cohort)::text as opportunities_created,
         (select count(*) from opportunity_cohort where status = 'WON')::text as opportunities_won,
         (select count(*) from opportunity_cohort where status = 'LOST')::text as opportunities_lost,
         (select count(distinct contact_id) from opportunity_cohort where status = 'WON')::text as won_customers,
         (select count(*) from open_pipeline)::text as open_opportunities,
         coalesce((select sum(value_minor) from open_pipeline where value_minor is not null), 0)::text as pipeline_value_minor,
         (select count(distinct currency) from open_pipeline where value_minor is not null)::text as pipeline_currency_count,
         (select min(currency) from open_pipeline where value_minor is not null) as pipeline_currency,
         (select avg(extract(epoch from ($5::timestamptz - created_at)) / 86400.0) from open_pipeline) ::text as average_open_age_days`,
      scopeWindowParams(query),
    );
    const row = result.rows[0];
    if (!row) throw new Error('ANALYTICS_CRM_READ_FAILED');
    const openOpportunities = toCount(row.open_opportunities);
    return {
      leadsCaptured: toCount(row.leads_captured),
      qualifiedLeads: toCount(row.qualified_leads),
      opportunitiesCreated: toCount(row.opportunities_created),
      opportunitiesWon: toCount(row.opportunities_won),
      opportunitiesLost: toCount(row.opportunities_lost),
      wonCustomers: toCount(row.won_customers),
      openOpportunities,
      openPipelineValue: moneyFromAggregate(
        row.pipeline_value_minor,
        row.pipeline_currency_count,
        row.pipeline_currency,
        openOpportunities,
      ),
      averageOpenOpportunityAgeDays:
        row.average_open_age_days === null
          ? null
          : toFiniteNumber(row.average_open_age_days, 'ANALYTICS_PIPELINE_AGE_INVALID'),
      evidence: ['postgres:crm_leads', 'postgres:crm_opportunities'],
    };
  }

  private async readRevenue(query: AnalyticsReadModelQuery): Promise<MoneyAmount | null> {
    const result = await this.pool.query<RevenueRow>(
      `with latest as (
         select distinct on (event_id)
                event_id, coalesce(net_revenue_minor, gross_revenue_minor) as revenue_minor, currency
           from ticketing_sales_snapshots
          where tenant_id = $1 and workspace_id = $2 and organization_id = $3
            and as_of <= $4 and ($5::text is null or event_id = $5)
          order by event_id, as_of desc, snapshot_id desc
       )
       select coalesce(sum(revenue_minor), 0)::text as revenue_minor,
              count(distinct currency)::text as currency_count,
              min(currency) as currency,
              count(*)::text as snapshot_count
         from latest`,
      [
        query.scope.tenantId,
        query.scope.workspaceId,
        query.scope.organizationId,
        query.window.endsAt,
        query.eventId,
      ],
    );
    const row = result.rows[0];
    if (!row) return null;
    return moneyFromAggregate(
      row.revenue_minor,
      row.currency_count,
      row.currency,
      toCount(row.snapshot_count),
    );
  }

  private async readPublicationReliability(
    query: AnalyticsReadModelQuery,
  ): Promise<ReliabilityAggregate | null> {
    const result = await this.pool.query<ReliabilityRow>(
      `select count(*)::text as total,
              count(*) filter (where state in ('PUBLISHED','SUCCEEDED'))::text as successful,
              count(*) filter (where state in ('FAILED','PUBLISH_UNCERTAIN'))::text as failed
         from provider_publications
        where created_at >= $2 and created_at < $3
          and coalesce(payload->>'tenantId', payload->>'tenant_id') = $1`,
      [query.scope.tenantId, query.window.startsAt, query.window.endsAt],
    );
    const row = result.rows[0];
    if (!row || toCount(row.total) === 0) return null;
    return {
      total: toCount(row.total),
      successful: toCount(row.successful),
      failed: toCount(row.failed),
      evidence: ['postgres:provider_publications', 'scope:tenant-bound-payload'],
    };
  }

  private async readProviderReliability(
    query: AnalyticsReadModelQuery,
  ): Promise<ReliabilityAggregate | null> {
    const result = await this.pool.query<ReliabilityRow>(
      `select count(*) filter (where status in ('SUCCEEDED','FAILED'))::text as total,
              count(*) filter (where status = 'SUCCEEDED')::text as successful,
              count(*) filter (where status = 'FAILED')::text as failed
         from audit_ledger_events
        where tenant_id = $1 and workspace_id = $2 and organization_id = $3
          and connected_account is not null
          and created_at >= $4 and created_at < $5`,
      [
        query.scope.tenantId,
        query.scope.workspaceId,
        query.scope.organizationId,
        query.window.startsAt,
        query.window.endsAt,
      ],
    );
    const row = result.rows[0];
    if (!row || toCount(row.total) === 0) return null;
    return {
      total: toCount(row.total),
      successful: toCount(row.successful),
      failed: toCount(row.failed),
      evidence: ['postgres:audit_ledger_events', 'filter:connected_account'],
    };
  }

  private async readCreativePerformance(
    query: AnalyticsReadModelQuery,
  ): Promise<readonly CreativePerformanceObservation[]> {
    const result = await this.pool.query<CreativeRow>(
      `select properties->>'creativeId' as creative_id,
              min(content_id) as content_id,
              min(campaign_id) as campaign_id,
              min(nullif(properties->>'adId', '')) as ad_id,
              coalesce(sum(case
                when properties->>'analyticsMetric' = 'reach'
                 and properties->>'analyticsValue' ~ '^[0-9]+([.][0-9]+)?$'
                then (properties->>'analyticsValue')::numeric else 0 end), 0)::text as reach,
              count(*) filter (where properties->>'analyticsMetric' = 'reach')::text as reach_observations,
              coalesce(sum(case
                when properties->>'analyticsMetric' = 'engagement'
                 and properties->>'analyticsValue' ~ '^[0-9]+([.][0-9]+)?$'
                then (properties->>'analyticsValue')::numeric else 0 end), 0)::text as engagements,
              count(*) filter (where properties->>'analyticsMetric' = 'engagement')::text as engagement_observations,
              count(*) filter (where is_conversion or properties->>'analyticsMetric' = 'conversion')::text as conversions,
              coalesce(sum(case when properties->>'analyticsMetric' = 'spend' then value_minor else 0 end), 0)::text as spend_minor,
              count(distinct currency) filter (where properties->>'analyticsMetric' = 'spend' and value_minor is not null)::text as spend_currency_count,
              min(currency) filter (where properties->>'analyticsMetric' = 'spend' and value_minor is not null) as spend_currency,
              coalesce(sum(case when properties->>'analyticsMetric' = 'attributed_revenue' then value_minor else 0 end), 0)::text as revenue_minor,
              count(distinct currency) filter (where properties->>'analyticsMetric' = 'attributed_revenue' and value_minor is not null)::text as revenue_currency_count,
              min(currency) filter (where properties->>'analyticsMetric' = 'attributed_revenue' and value_minor is not null) as revenue_currency,
              array_agg(measurement_event_id order by measurement_event_id) as measurement_ids
         from measurement_events
        where tenant_id = $1 and workspace_id = $2 and organization_id = $3
          and occurred_at >= $4 and occurred_at < $5
          and ($6::text is null or event_id = $6)
          and nullif(properties->>'creativeId', '') is not null
        group by properties->>'creativeId'
        order by properties->>'creativeId'`,
      scopeWindowParams(query),
    );
    return result.rows.map((row) => {
      const reachObservations = toCount(row.reach_observations);
      const engagementObservations = toCount(row.engagement_observations);
      return {
        creativeId: row.creative_id,
        contentId: row.content_id,
        campaignId: row.campaign_id,
        adId: row.ad_id,
        reach:
          reachObservations === 0
            ? null
            : toFiniteNumber(row.reach, 'ANALYTICS_CREATIVE_REACH_INVALID'),
        engagements:
          engagementObservations === 0
            ? null
            : toFiniteNumber(row.engagements, 'ANALYTICS_CREATIVE_ENGAGEMENT_INVALID'),
        conversions: toCount(row.conversions),
        spend: moneyFromAggregate(
          row.spend_minor,
          row.spend_currency_count,
          row.spend_currency,
          row.spend_currency === null ? 0 : 1,
        ),
        attributedRevenue: moneyFromAggregate(
          row.revenue_minor,
          row.revenue_currency_count,
          row.revenue_currency,
          row.revenue_currency === null ? 0 : 1,
        ),
        evidence: normalizeAnalyticsEvidence(
          row.measurement_ids.map((measurementId) => `measurement:${measurementId}`),
        ),
      };
    });
  }

  private async readCapacity(query: AnalyticsReadModelQuery) {
    if (query.eventId === null) return null;
    const result = await this.pool.query<CapacityRow>(
      `select event_id, capacity, sold, available, held, as_of, snapshot_id
         from ticketing_inventory_snapshots
        where tenant_id = $1 and workspace_id = $2 and organization_id = $3
          and event_id = $4 and as_of <= $5
        order by as_of desc, snapshot_id desc
        limit 1`,
      [
        query.scope.tenantId,
        query.scope.workspaceId,
        query.scope.organizationId,
        query.eventId,
        query.window.endsAt,
      ],
    );
    const row = result.rows[0];
    if (!row) return null;
    const observation: CapacityObservation = {
      eventId: row.event_id,
      capacity: row.capacity,
      sold: row.sold,
      available: row.available,
      held: row.held,
      asOf: row.as_of.toISOString(),
      constraints: query.operationalConstraints,
      evidence: [`postgres:ticketing_inventory_snapshots:${row.snapshot_id}`],
    };
    return assessOperationalCapacity(observation, query.capacityPolicy);
  }
}

function scopeWindowParams(query: AnalyticsReadModelQuery): Array<string | null> {
  return [
    query.scope.tenantId,
    query.scope.workspaceId,
    query.scope.organizationId,
    query.window.startsAt,
    query.window.endsAt,
    query.eventId,
  ];
}

function moneyFromAggregate(
  valueMinor: string,
  currencyCountRaw: string,
  currency: string | null,
  observationCount: number,
): MoneyAmount | null {
  if (observationCount === 0) return null;
  const currencyCount = toCount(currencyCountRaw);
  if (currencyCount !== 1 || currency === null) return null;
  const value = Number(valueMinor);
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error('ANALYTICS_MONEY_AGGREGATE_INVALID');
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('ANALYTICS_CURRENCY_INVALID');
  return { valueMinor: value, currency };
}

function toCount(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('ANALYTICS_COUNT_INVALID');
  return parsed;
}

function toFiniteNumber(value: string, code: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(code);
  return parsed;
}

function readEvidence(value: unknown, fallback: string): readonly string[] {
  if (!Array.isArray(value)) return [fallback];
  const evidence = value.filter((item): item is string => typeof item === 'string');
  return normalizeAnalyticsEvidence(evidence.length === 0 ? [fallback] : evidence);
}

function uniqueText(values: readonly (string | null)[]): readonly string[] {
  return [
    ...new Set(values.filter((value): value is string => value !== null && value.trim() !== '')),
  ].sort();
}

function validateQuery(query: AnalyticsReadModelQuery): void {
  requireText(query.scope.tenantId, 'ANALYTICS_TENANT_ID_REQUIRED');
  requireText(query.scope.workspaceId, 'ANALYTICS_WORKSPACE_ID_REQUIRED');
  requireText(query.scope.organizationId, 'ANALYTICS_ORGANIZATION_ID_REQUIRED');
  if (query.eventId !== null) requireText(query.eventId, 'ANALYTICS_EVENT_ID_INVALID');
  const startsAt = Date.parse(query.window.startsAt);
  const endsAt = Date.parse(query.window.endsAt);
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) {
    throw new Error('ANALYTICS_WINDOW_INVALID');
  }
}

function requireText(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}
