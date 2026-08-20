import type pg from 'pg';
import { createDomainEvent } from '../events/domain-events.js';
import { PostgresTransactionalOutbox } from '../events/postgres-transactional-outbox.js';
import type { TransactionalOutboxWriter } from '../events/transactional-outbox.js';
import {
  validateAttributionTouchpoint,
  validateAttributionWindowPolicy,
  validateRevenueEvidence,
  type AttributionTouchpointRecord,
  type AttributionWindowPolicy,
  type MarketingSalesFeedbackSnapshot,
  type RevenueEvidenceRecord,
} from '../measurement/attribution-revenue.js';
import type {
  AttributionRevenueScope,
  AttributionRevenueStore,
  AttributionTouchpointQuery,
  RevenueEvidenceQuery,
} from '../measurement/attribution-revenue-store.js';
import { appendInternalMeasurementAuditLedgerEvent } from './postgres-internal-audit-ledger.js';
import type {
  FeedbackRow,
  IntelligenceRecordType,
  PersistedIntelligenceRecord,
  PostgresAttributionRevenueStoreOptions,
  RevenueEvidenceRow,
  TouchpointRow,
  WindowPolicyRow,
} from './postgres-attribution-revenue-rows.js';
import {
  aggregateVersion,
  appendFilter,
  appendNullableFilter,
  assertBusinessEquivalent,
  beginIdempotency,
  businessPayload,
  completeIdempotency,
  feedbackFromRow,
  feedbackFromSnapshot,
  json,
  normalizeLimit,
  recordIdFor,
  requireFeedbackSnapshot,
  requireScope,
  requiredRow,
  revenueFromRow,
  revenueFromSnapshot,
  touchpointFromRow,
  touchpointFromSnapshot,
  windowPolicyFromRow,
  windowPolicyFromSnapshot,
} from './postgres-attribution-revenue-store-support.js';

export class PostgresAttributionRevenueStore implements AttributionRevenueStore {
  readonly #outbox: TransactionalOutboxWriter;

  constructor(
    private readonly pool: pg.Pool,
    options: PostgresAttributionRevenueStoreOptions = {},
  ) {
    this.#outbox = options.outbox ?? new PostgresTransactionalOutbox(pool);
  }

  async recordWindowPolicy(policy: AttributionWindowPolicy): Promise<AttributionWindowPolicy> {
    validateAttributionWindowPolicy(policy);
    return this.#transaction(async (client) => {
      const replay = await beginIdempotency(
        client,
        'attribution.window_policy.record',
        'ATTRIBUTION_WINDOW_POLICY',
        policy,
      );
      if (replay) return windowPolicyFromSnapshot(replay);
      const existing = await client.query<WindowPolicyRow>(
        `select * from attribution_window_policies
         where tenant_id=$1 and workspace_id=$2 and organization_id=$3
           and policy_key=$4 and version=$5`,
        [
          policy.tenantId,
          policy.workspaceId,
          policy.organizationId,
          policy.policyKey,
          policy.version,
        ],
      );
      if (existing.rows[0]) {
        const value = windowPolicyFromRow(existing.rows[0]);
        assertBusinessEquivalent(policy, value, 'ATTRIBUTION_WINDOW_POLICY_DEDUPE_CONFLICT');
        await completeIdempotency(client, 'attribution.window_policy.record', policy, value);
        return value;
      }
      const inserted = await client.query<WindowPolicyRow>(
        `insert into attribution_window_policies (
           policy_id, policy_key, version, tenant_id, workspace_id, organization_id,
           first_touch_lookback_days, last_touch_lookback_days, assisted_lookback_days,
           idempotency_key, execution_id, correlation_id, actor_principal_id, evidence, created_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::timestamptz)
         returning *`,
        [
          policy.policyId,
          policy.policyKey,
          policy.version,
          policy.tenantId,
          policy.workspaceId,
          policy.organizationId,
          policy.firstTouchLookbackDays,
          policy.lastTouchLookbackDays,
          policy.assistedLookbackDays,
          policy.idempotencyKey,
          policy.executionId,
          policy.correlationId,
          policy.actorPrincipalId,
          json(policy.evidence),
          policy.createdAt,
        ],
      );
      const value = windowPolicyFromRow(
        requiredRow(inserted.rows[0], 'ATTRIBUTION_POLICY_INSERT_FAILED'),
      );
      await this.#emitMutation(
        client,
        value,
        'ATTRIBUTION_WINDOW_POLICY',
        'attribution.window_policy.recorded',
      );
      await completeIdempotency(client, 'attribution.window_policy.record', policy, value);
      return value;
    });
  }

  async latestWindowPolicy(
    scope: AttributionRevenueScope & { readonly policyKey: string },
  ): Promise<AttributionWindowPolicy | undefined> {
    requireScope(scope);
    const result = await this.pool.query<WindowPolicyRow>(
      `select * from attribution_window_policies
       where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and policy_key=$4
       order by version desc, created_at desc, policy_id desc limit 1`,
      [scope.tenantId, scope.workspaceId, scope.organizationId, scope.policyKey],
    );
    return result.rows[0] ? windowPolicyFromRow(result.rows[0]) : undefined;
  }

  async recordTouchpoint(
    touchpoint: AttributionTouchpointRecord,
  ): Promise<AttributionTouchpointRecord> {
    validateAttributionTouchpoint(touchpoint);
    return this.#transaction(async (client) => {
      const replay = await beginIdempotency(
        client,
        'attribution.touchpoint.record',
        'ATTRIBUTION_TOUCHPOINT',
        touchpoint,
      );
      if (replay) return touchpointFromSnapshot(replay);
      const existing = await client.query<TouchpointRow>(
        `select * from attribution_touchpoints
         where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and dedupe_key=$4`,
        [
          touchpoint.tenantId,
          touchpoint.workspaceId,
          touchpoint.organizationId,
          touchpoint.dedupeKey,
        ],
      );
      if (existing.rows[0]) {
        const value = touchpointFromRow(existing.rows[0]);
        assertBusinessEquivalent(touchpoint, value, 'ATTRIBUTION_TOUCHPOINT_DEDUPE_CONFLICT');
        await completeIdempotency(client, 'attribution.touchpoint.record', touchpoint, value);
        return value;
      }
      const inserted = await client.query<TouchpointRow>(
        `insert into attribution_touchpoints (
           touchpoint_id, dedupe_key, tenant_id, workspace_id, organization_id,
           contact_id, lead_id, opportunity_id, conversation_id, message_id, channel,
           utm_source, utm_medium, utm_campaign, utm_content, utm_term,
           meta_campaign_id, meta_adset_id, meta_ad_id, meta_creative_id,
           google_campaign_id, google_ad_group_id, google_ad_id, google_creative_id,
           click_id, fbclid, gclid, gbraid, wbraid, landing_url, session_id, lead_source,
           ticket_reference, order_reference, payment_reference, checkout_reference,
           message_ref, intent, demand_context, attribution_source, occurred_at,
           idempotency_key, execution_id, correlation_id, actor_principal_id, evidence, created_at
         ) values (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
           $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,
           $39::jsonb,$40,$41::timestamptz,$42,$43,$44,$45,$46::jsonb,$47::timestamptz
         ) returning *`,
        [
          touchpoint.touchpointId,
          touchpoint.dedupeKey,
          touchpoint.tenantId,
          touchpoint.workspaceId,
          touchpoint.organizationId,
          touchpoint.contactId,
          touchpoint.leadId,
          touchpoint.opportunityId,
          touchpoint.conversationId,
          touchpoint.messageId,
          touchpoint.channel,
          touchpoint.utm.source,
          touchpoint.utm.medium,
          touchpoint.utm.campaign,
          touchpoint.utm.content,
          touchpoint.utm.term,
          touchpoint.metaCampaignId,
          touchpoint.metaAdsetId,
          touchpoint.metaAdId,
          touchpoint.metaCreativeId,
          touchpoint.googleCampaignId,
          touchpoint.googleAdGroupId,
          touchpoint.googleAdId,
          touchpoint.googleCreativeId,
          touchpoint.clickId,
          touchpoint.fbclid,
          touchpoint.gclid,
          touchpoint.gbraid,
          touchpoint.wbraid,
          touchpoint.landingUrl,
          touchpoint.sessionId,
          touchpoint.leadSource,
          touchpoint.ticketReference,
          touchpoint.orderReference,
          touchpoint.paymentReference,
          touchpoint.checkoutReference,
          touchpoint.messageRef,
          touchpoint.intent,
          json(touchpoint.demandContext),
          touchpoint.attributionSource,
          touchpoint.occurredAt,
          touchpoint.idempotencyKey,
          touchpoint.executionId,
          touchpoint.correlationId,
          touchpoint.actorPrincipalId,
          json(touchpoint.evidence),
          touchpoint.createdAt,
        ],
      );
      const value = touchpointFromRow(
        requiredRow(inserted.rows[0], 'ATTRIBUTION_TOUCHPOINT_INSERT_FAILED'),
      );
      await this.#emitMutation(
        client,
        value,
        'ATTRIBUTION_TOUCHPOINT',
        'attribution.touchpoint.recorded',
      );
      await completeIdempotency(client, 'attribution.touchpoint.record', touchpoint, value);
      return value;
    });
  }

  async listTouchpoints(
    query: AttributionTouchpointQuery,
  ): Promise<readonly AttributionTouchpointRecord[]> {
    requireScope(query);
    const limit = normalizeLimit(query.limit);
    const clauses = ['tenant_id=$1', 'workspace_id=$2', 'organization_id=$3'];
    const values: Array<string | number> = [
      query.tenantId,
      query.workspaceId,
      query.organizationId,
    ];
    appendNullableFilter(clauses, values, 'contact_id', query.contactId);
    appendNullableFilter(clauses, values, 'lead_id', query.leadId);
    appendNullableFilter(clauses, values, 'opportunity_id', query.opportunityId);
    appendNullableFilter(clauses, values, 'conversation_id', query.conversationId);
    if (query.from) appendFilter(clauses, values, 'occurred_at >=', query.from);
    if (query.to) appendFilter(clauses, values, 'occurred_at <=', query.to);
    values.push(limit);
    const result = await this.pool.query<TouchpointRow>(
      `select * from attribution_touchpoints where ${clauses.join(' and ')}
       order by occurred_at asc, touchpoint_id asc limit $${values.length}`,
      values,
    );
    return result.rows.map(touchpointFromRow);
  }

  async recordRevenueEvidence(record: RevenueEvidenceRecord): Promise<RevenueEvidenceRecord> {
    validateRevenueEvidence(record);
    return this.#transaction(async (client) => {
      const replay = await beginIdempotency(
        client,
        'revenue.evidence.record',
        'REVENUE_EVIDENCE',
        record,
      );
      if (replay) return revenueFromSnapshot(replay);
      const existing = await client.query<RevenueEvidenceRow>(
        `select * from revenue_evidence_records
         where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and dedupe_key=$4`,
        [record.tenantId, record.workspaceId, record.organizationId, record.dedupeKey],
      );
      if (existing.rows[0]) {
        const value = revenueFromRow(existing.rows[0]);
        assertBusinessEquivalent(record, value, 'REVENUE_DEDUPE_CONFLICT');
        await completeIdempotency(client, 'revenue.evidence.record', record, value);
        return value;
      }
      const inserted = await client.query<RevenueEvidenceRow>(
        `insert into revenue_evidence_records (
           revenue_evidence_id, dedupe_key, tenant_id, workspace_id, organization_id,
           opportunity_id, contact_id, lead_id, conversation_id, event_id,
           source_type, provider, provider_event_id, provider_evidence_ref, external_reference,
           status, provider_readback_at, occurred_at, currency, gross_revenue_minor,
           net_revenue_minor, refund_minor, cost_minor, ticket_reference, order_reference,
           payment_reference, checkout_reference, idempotency_key, execution_id,
           correlation_id, actor_principal_id, evidence, created_at
         ) values (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::timestamptz,
           $18::timestamptz,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32::jsonb,
           $33::timestamptz
         ) returning *`,
        [
          record.revenueEvidenceId,
          record.dedupeKey,
          record.tenantId,
          record.workspaceId,
          record.organizationId,
          record.opportunityId,
          record.contactId,
          record.leadId,
          record.conversationId,
          record.eventId,
          record.source,
          record.provider,
          record.providerEventId,
          record.providerEvidenceRef,
          record.externalReference,
          record.status,
          record.providerReadbackAt,
          record.occurredAt,
          record.currency,
          record.grossRevenueMinor,
          record.netRevenueMinor,
          record.refundMinor,
          record.costMinor,
          record.ticketReference,
          record.orderReference,
          record.paymentReference,
          record.checkoutReference,
          record.idempotencyKey,
          record.executionId,
          record.correlationId,
          record.actorPrincipalId,
          json(record.evidence),
          record.createdAt,
        ],
      );
      const value = revenueFromRow(requiredRow(inserted.rows[0], 'REVENUE_EVIDENCE_INSERT_FAILED'));
      await this.#emitMutation(client, value, 'REVENUE_EVIDENCE', 'revenue.evidence.recorded');
      await completeIdempotency(client, 'revenue.evidence.record', record, value);
      return value;
    });
  }

  async listRevenueEvidence(
    query: RevenueEvidenceQuery,
  ): Promise<readonly RevenueEvidenceRecord[]> {
    requireScope(query);
    const result = await this.pool.query<RevenueEvidenceRow>(
      `select * from revenue_evidence_records
       where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and opportunity_id=$4
       order by occurred_at asc, revenue_evidence_id asc limit $5`,
      [
        query.tenantId,
        query.workspaceId,
        query.organizationId,
        query.opportunityId,
        normalizeLimit(query.limit),
      ],
    );
    return result.rows.map(revenueFromRow);
  }

  async recordFeedbackSnapshot(
    snapshot: MarketingSalesFeedbackSnapshot,
  ): Promise<MarketingSalesFeedbackSnapshot> {
    requireFeedbackSnapshot(snapshot);
    return this.#transaction(async (client) => {
      const replay = await beginIdempotency(
        client,
        'marketing_sales.feedback.record',
        'MARKETING_SALES_FEEDBACK',
        snapshot,
      );
      if (replay) return feedbackFromSnapshot(replay);
      const inserted = await client.query<FeedbackRow>(
        `insert into marketing_sales_feedback_snapshots (
           feedback_id, tenant_id, workspace_id, organization_id, opportunity_id,
           marketing, sales, idempotency_key, execution_id, correlation_id,
           actor_principal_id, evidence, created_at
         ) values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12::jsonb,$13::timestamptz)
         returning *`,
        [
          snapshot.feedbackId,
          snapshot.tenantId,
          snapshot.workspaceId,
          snapshot.organizationId,
          snapshot.opportunityId,
          json(snapshot.marketing),
          json(snapshot.sales),
          snapshot.idempotencyKey,
          snapshot.executionId,
          snapshot.correlationId,
          snapshot.actorPrincipalId,
          json(snapshot.evidence),
          snapshot.createdAt,
        ],
      );
      const value = feedbackFromRow(
        requiredRow(inserted.rows[0], 'MARKETING_SALES_FEEDBACK_INSERT_FAILED'),
      );
      await this.#emitMutation(
        client,
        value,
        'MARKETING_SALES_FEEDBACK',
        'marketing_sales.feedback.recorded',
      );
      await completeIdempotency(client, 'marketing_sales.feedback.record', snapshot, value);
      return value;
    });
  }

  async latestFeedbackSnapshot(
    scope: AttributionRevenueScope & { readonly opportunityId: string },
  ): Promise<MarketingSalesFeedbackSnapshot | undefined> {
    requireScope(scope);
    const result = await this.pool.query<FeedbackRow>(
      `select * from marketing_sales_feedback_snapshots
       where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and opportunity_id=$4
       order by created_at desc, feedback_id desc limit 1`,
      [scope.tenantId, scope.workspaceId, scope.organizationId, scope.opportunityId],
    );
    return result.rows[0] ? feedbackFromRow(result.rows[0]) : undefined;
  }

  async #emitMutation(
    client: pg.PoolClient,
    record: PersistedIntelligenceRecord,
    recordType: IntelligenceRecordType,
    eventType: string,
  ): Promise<void> {
    const recordId = recordIdFor(recordType, record);
    const event = createDomainEvent({
      tenantId: record.tenantId,
      workspaceId: record.workspaceId,
      organizationId: record.organizationId,
      eventKey: `${eventType}:${recordId}`,
      eventType,
      aggregateType: recordType,
      aggregateId: recordId,
      aggregateVersion: aggregateVersion(record),
      correlationId: record.correlationId,
      causationId: record.executionId,
      occurredAt: record.createdAt,
      payload: businessPayload(record),
      evidence: record.evidence,
    });
    await this.#outbox.enqueue(client, event);
    await appendInternalMeasurementAuditLedgerEvent(client, {
      operation: eventType,
      recordType,
      recordId,
      tenantId: record.tenantId,
      workspaceId: record.workspaceId,
      organizationId: record.organizationId,
      executionId: record.executionId,
      correlationId: record.correlationId,
      actorPrincipalId: record.actorPrincipalId,
      evidence: record.evidence,
      createdAt: record.createdAt,
    });
  }

  async #transaction<T>(operation: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const value = await operation(client);
      await client.query('commit');
      return value;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}
