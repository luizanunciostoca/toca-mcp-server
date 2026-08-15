import type pg from 'pg';
import { createDomainEvent } from '../events/domain-events.js';
import { PostgresTransactionalOutbox } from '../events/postgres-transactional-outbox.js';
import type { TransactionalOutboxWriter } from '../events/transactional-outbox.js';
import type {
  AttributionConfidence,
  ConversionReconciliation,
  DataQualityReport,
  MeasurementPlan,
  NormalizedMeasurementEvent,
  TicketingEventBinding,
  TicketingInventorySnapshot,
  TicketingSalesSummary,
  TicketingWebhookReceipt,
} from '../measurement/contracts.js';
import type { MeasurementEventQuery, MeasurementStore } from '../measurement/store.js';
import { timestamp } from '../measurement/normalization.js';

interface EventScopeRow {
  readonly event_id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
}

export interface PostgresMeasurementStoreOptions {
  readonly outbox?: TransactionalOutboxWriter;
}

export class PostgresMeasurementStore implements MeasurementStore {
  readonly #outbox: TransactionalOutboxWriter;

  constructor(
    private readonly pool: pg.Pool,
    options: PostgresMeasurementStoreOptions = {},
  ) {
    this.#outbox = options.outbox ?? new PostgresTransactionalOutbox(pool);
  }

  async createPlan(plan: MeasurementPlan): Promise<MeasurementPlan> {
    return this.#write('measurement_plan', plan.planId, plan, async (client) => {
      await assertEventScope(client, plan);
      const result = await client.query<PlanRow>(
        `insert into measurement_plans (
          plan_id, plan_key, tenant_id, workspace_id, organization_id, event_id,
          objective, attribution_model, conversion_event_names, required_dimensions,
          created_by_principal_id, correlation_id, workflow_instance_id, evidence, created_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14::jsonb,$15::timestamptz)
        on conflict (tenant_id, plan_key) do nothing returning *`,
        [
          plan.planId,
          plan.planKey,
          plan.tenantId,
          plan.workspaceId,
          plan.organizationId,
          plan.eventId,
          plan.objective,
          plan.attributionModel,
          json(plan.conversionEventNames),
          json(plan.requiredDimensions),
          plan.createdByPrincipalId,
          plan.correlationId,
          plan.workflowInstanceId,
          json(plan.evidence),
          plan.createdAt,
        ],
      );
      const inserted = result.rows[0];
      if (inserted) return planFromRow(inserted);
      const existing = await client.query<PlanRow>(
        'select * from measurement_plans where tenant_id = $1 and plan_key = $2',
        [plan.tenantId, plan.planKey],
      );
      const row = existing.rows[0];
      if (!row) throw new Error('MEASUREMENT_PLAN_IDEMPOTENCY_LOOKUP_FAILED');
      const value = planFromRow(row);
      if (canonical(value) !== canonical(plan))
        throw new Error('MEASUREMENT_PLAN_IDEMPOTENCY_CONFLICT');
      return value;
    });
  }

  async getPlan(planId: string): Promise<MeasurementPlan | undefined> {
    requireText(planId, 'MEASUREMENT_PLAN_ID_REQUIRED');
    const result = await this.pool.query<PlanRow>(
      'select * from measurement_plans where plan_id = $1',
      [planId],
    );
    return result.rows[0] ? planFromRow(result.rows[0]) : undefined;
  }

  async recordEvent(event: NormalizedMeasurementEvent): Promise<NormalizedMeasurementEvent> {
    return this.#write('measurement_event', event.measurementEventId, event, async (client) => {
      await assertEventScope(client, event);
      const result = await client.query<MeasurementEventRow>(
        `insert into measurement_events (
          measurement_event_id, tenant_id, workspace_id, organization_id, event_id,
          source_system, source_event_id, event_name, occurred_at, ingested_at,
          session_id, anonymous_id, subject_id, utm_source, utm_medium, utm_campaign,
          utm_content, utm_term, campaign_id, content_id, is_conversion, value_minor,
          currency, properties, data_quality, requester_principal_id, correlation_id,
          workflow_instance_id, evidence
        ) values (
          $1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10::timestamptz,$11,$12,$13,$14,$15,
          $16,$17,$18,$19,$20,$21,$22,$23,$24::jsonb,$25::jsonb,$26,$27,$28,$29::jsonb
        ) on conflict (tenant_id, source_system, source_event_id) do nothing returning *`,
        [
          event.measurementEventId,
          event.tenantId,
          event.workspaceId,
          event.organizationId,
          event.eventId,
          event.sourceSystem,
          event.sourceEventId,
          event.eventName,
          event.occurredAt,
          event.ingestedAt,
          event.sessionId,
          event.anonymousId,
          event.subjectId,
          event.utm.source,
          event.utm.medium,
          event.utm.campaign,
          event.utm.content,
          event.utm.term,
          event.campaignId,
          event.contentId,
          event.isConversion,
          event.valueMinor,
          event.currency,
          json(event.properties),
          json(event.dataQuality),
          event.requesterPrincipalId,
          event.correlationId,
          event.workflowInstanceId,
          json(event.evidence),
        ],
      );
      const inserted = result.rows[0];
      if (inserted) return measurementEventFromRow(inserted);
      const existing = await client.query<MeasurementEventRow>(
        `select * from measurement_events
         where tenant_id = $1 and source_system = $2 and source_event_id = $3`,
        [event.tenantId, event.sourceSystem, event.sourceEventId],
      );
      const row = existing.rows[0];
      if (!row) throw new Error('MEASUREMENT_EVENT_IDEMPOTENCY_LOOKUP_FAILED');
      const value = measurementEventFromRow(row);
      if (canonical(value) !== canonical(event))
        throw new Error('MEASUREMENT_EVENT_IDEMPOTENCY_CONFLICT');
      return value;
    });
  }

  async listEvents(query: MeasurementEventQuery): Promise<readonly NormalizedMeasurementEvent[]> {
    requireText(query.tenantId, 'MEASUREMENT_TENANT_ID_REQUIRED');
    requireText(query.eventId, 'MEASUREMENT_EVENT_RECORD_ID_REQUIRED');
    const from = timestamp(query.from, 'MEASUREMENT_RANGE_FROM_INVALID');
    const to = timestamp(query.to, 'MEASUREMENT_RANGE_TO_INVALID');
    if (Date.parse(to) <= Date.parse(from)) throw new Error('MEASUREMENT_RANGE_INVALID');
    const limit = query.limit ?? 1000;
    if (!Number.isInteger(limit) || limit < 1 || limit > 5000)
      throw new Error('MEASUREMENT_LIMIT_INVALID');
    const eventNames =
      query.eventNames?.map((name) => requireText(name, 'MEASUREMENT_EVENT_NAME_REQUIRED')) ?? [];
    const result = await this.pool.query<MeasurementEventRow>(
      `select * from measurement_events
       where tenant_id = $1 and event_id = $2
         and occurred_at >= $3::timestamptz and occurred_at < $4::timestamptz
         and (cardinality($5::text[]) = 0 or event_name = any($5::text[]))
       order by occurred_at asc, measurement_event_id asc limit $6`,
      [query.tenantId, query.eventId, from, to, eventNames, limit],
    );
    return result.rows.map(measurementEventFromRow);
  }

  async bindTicketingEvent(binding: TicketingEventBinding): Promise<TicketingEventBinding> {
    return this.#write('ticketing_event_binding', binding.bindingId, binding, async (client) => {
      await assertEventScope(client, binding, true);
      const result = await client.query<TicketingBindingRow>(
        `insert into ticketing_event_bindings (
          binding_id, tenant_id, workspace_id, organization_id, event_id, provider,
          external_event_id, external_event_url, requester_principal_id, correlation_id,
          workflow_instance_id, evidence, created_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::timestamptz)
        on conflict (provider, external_event_id) do nothing returning *`,
        [
          binding.bindingId,
          binding.tenantId,
          binding.workspaceId,
          binding.organizationId,
          binding.eventId,
          binding.provider,
          binding.externalEventId,
          binding.externalEventUrl,
          binding.requesterPrincipalId,
          binding.correlationId,
          binding.workflowInstanceId,
          json(binding.evidence),
          binding.createdAt,
        ],
      );
      const inserted = result.rows[0];
      if (inserted) return bindingFromRow(inserted);
      const existing = await client.query<TicketingBindingRow>(
        'select * from ticketing_event_bindings where provider = $1 and external_event_id = $2',
        [binding.provider, binding.externalEventId],
      );
      const row = existing.rows[0];
      if (!row) throw new Error('TICKETING_BINDING_LOOKUP_FAILED');
      const value = bindingFromRow(row);
      if (canonical(value) !== canonical(binding)) throw new Error('TICKETING_BINDING_CONFLICT');
      return value;
    });
  }

  async getTicketingBinding(
    provider: string,
    externalEventId: string,
  ): Promise<TicketingEventBinding | undefined> {
    requireText(provider, 'TICKETING_PROVIDER_REQUIRED');
    requireText(externalEventId, 'TICKETING_EXTERNAL_EVENT_ID_REQUIRED');
    const result = await this.pool.query<TicketingBindingRow>(
      'select * from ticketing_event_bindings where provider = $1 and external_event_id = $2',
      [provider, externalEventId],
    );
    return result.rows[0] ? bindingFromRow(result.rows[0]) : undefined;
  }

  async recordSalesSummary(summary: TicketingSalesSummary): Promise<TicketingSalesSummary> {
    return this.#write('ticketing_sales_summary', summary.snapshotId, summary, async (client) => {
      await assertTicketingBinding(client, summary);
      const result = await client.query<TicketingSalesRow>(
        `insert into ticketing_sales_snapshots (
          snapshot_id, tenant_id, workspace_id, organization_id, event_id, provider, external_event_id,
          sold_count, order_count, gross_revenue_minor, net_revenue_minor, currency, as_of,
          requester_principal_id, correlation_id, workflow_instance_id, evidence
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::timestamptz,$14,$15,$16,$17::jsonb)
        on conflict (provider, external_event_id, as_of) do nothing returning *`,
        [
          summary.snapshotId,
          summary.tenantId,
          summary.workspaceId,
          summary.organizationId,
          summary.eventId,
          summary.provider,
          summary.externalEventId,
          summary.soldCount,
          summary.orderCount,
          summary.grossRevenueMinor,
          summary.netRevenueMinor,
          summary.currency,
          summary.asOf,
          summary.requesterPrincipalId,
          summary.correlationId,
          summary.workflowInstanceId,
          json(summary.evidence),
        ],
      );
      return resolveSnapshot(
        result.rows[0],
        summary,
        async () => {
          const existing = await client.query<TicketingSalesRow>(
            'select * from ticketing_sales_snapshots where provider = $1 and external_event_id = $2 and as_of = $3::timestamptz',
            [summary.provider, summary.externalEventId, summary.asOf],
          );
          return existing.rows[0] ? salesFromRow(existing.rows[0]) : undefined;
        },
        salesFromRow,
        'TICKETING_SALES_SNAPSHOT_CONFLICT',
      );
    });
  }

  async recordInventory(snapshot: TicketingInventorySnapshot): Promise<TicketingInventorySnapshot> {
    return this.#write('ticketing_inventory', snapshot.snapshotId, snapshot, async (client) => {
      await assertTicketingBinding(client, snapshot);
      const result = await client.query<TicketingInventoryRow>(
        `insert into ticketing_inventory_snapshots (
          snapshot_id, tenant_id, workspace_id, organization_id, event_id, provider, external_event_id,
          capacity, sold, available, held, as_of, requester_principal_id, correlation_id,
          workflow_instance_id, evidence
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::timestamptz,$13,$14,$15,$16::jsonb)
        on conflict (provider, external_event_id, as_of) do nothing returning *`,
        [
          snapshot.snapshotId,
          snapshot.tenantId,
          snapshot.workspaceId,
          snapshot.organizationId,
          snapshot.eventId,
          snapshot.provider,
          snapshot.externalEventId,
          snapshot.capacity,
          snapshot.sold,
          snapshot.available,
          snapshot.held,
          snapshot.asOf,
          snapshot.requesterPrincipalId,
          snapshot.correlationId,
          snapshot.workflowInstanceId,
          json(snapshot.evidence),
        ],
      );
      return resolveSnapshot(
        result.rows[0],
        snapshot,
        async () => {
          const existing = await client.query<TicketingInventoryRow>(
            'select * from ticketing_inventory_snapshots where provider = $1 and external_event_id = $2 and as_of = $3::timestamptz',
            [snapshot.provider, snapshot.externalEventId, snapshot.asOf],
          );
          return existing.rows[0] ? inventoryFromRow(existing.rows[0]) : undefined;
        },
        inventoryFromRow,
        'TICKETING_INVENTORY_SNAPSHOT_CONFLICT',
      );
    });
  }

  async recordWebhook(receipt: TicketingWebhookReceipt): Promise<TicketingWebhookReceipt> {
    return this.#write('ticketing_webhook', receipt.receiptId, receipt, async (client) => {
      await assertTicketingBinding(client, receipt);
      const result = await client.query<TicketingWebhookRow>(
        `insert into ticketing_webhook_receipts (
          receipt_id, tenant_id, workspace_id, organization_id, event_id, provider, external_event_id,
          provider_delivery_id, event_type, occurred_at, received_at, payload_hash, normalized_payload,
          data_quality, requester_principal_id, correlation_id, workflow_instance_id, evidence
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz,$11::timestamptz,$12,$13::jsonb,$14::jsonb,$15,$16,$17,$18::jsonb)
        on conflict (provider, provider_delivery_id) do nothing returning *`,
        [
          receipt.receiptId,
          receipt.tenantId,
          receipt.workspaceId,
          receipt.organizationId,
          receipt.eventId,
          receipt.provider,
          receipt.externalEventId,
          receipt.providerDeliveryId,
          receipt.eventType,
          receipt.occurredAt,
          receipt.receivedAt,
          receipt.payloadHash,
          json(receipt.normalizedPayload),
          json(receipt.dataQuality),
          receipt.requesterPrincipalId,
          receipt.correlationId,
          receipt.workflowInstanceId,
          json(receipt.evidence),
        ],
      );
      const inserted = result.rows[0];
      if (inserted) return webhookFromRow(inserted);
      const existing = await client.query<TicketingWebhookRow>(
        'select * from ticketing_webhook_receipts where provider = $1 and provider_delivery_id = $2',
        [receipt.provider, receipt.providerDeliveryId],
      );
      const row = existing.rows[0];
      if (!row) throw new Error('TICKETING_WEBHOOK_LOOKUP_FAILED');
      const value = webhookFromRow(row);
      if (canonical(value) !== canonical(receipt))
        throw new Error('TICKETING_WEBHOOK_IDEMPOTENCY_CONFLICT');
      return value;
    });
  }

  async recordReconciliation(value: ConversionReconciliation): Promise<ConversionReconciliation> {
    return this.#write(
      'conversion_reconciliation',
      value.reconciliationId,
      value,
      async (client) => {
        await assertEventScope(client, value, true);
        const result = await client.query<ReconciliationRow>(
          `insert into conversion_reconciliations (
          reconciliation_id, tenant_id, workspace_id, organization_id, event_id,
          window_starts_at, window_ends_at, measured_conversions, ticket_conversions,
          matched_conversions, unmatched_measurements, unmatched_tickets, measured_revenue_minor,
          ticket_revenue_minor, currency, confidence, requester_principal_id, correlation_id,
          workflow_instance_id, evidence, created_at
        ) values ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18,$19,$20::jsonb,$21::timestamptz)
        on conflict (reconciliation_id) do nothing returning *`,
          [
            value.reconciliationId,
            value.tenantId,
            value.workspaceId,
            value.organizationId,
            value.eventId,
            value.windowStartsAt,
            value.windowEndsAt,
            value.measuredConversions,
            value.ticketConversions,
            value.matchedConversions,
            value.unmatchedMeasurements,
            value.unmatchedTickets,
            value.measuredRevenueMinor,
            value.ticketRevenueMinor,
            value.currency,
            json(value.confidence),
            value.requesterPrincipalId,
            value.correlationId,
            value.workflowInstanceId,
            json(value.evidence),
            value.createdAt,
          ],
        );
        const inserted = result.rows[0];
        if (!inserted) throw new Error('CONVERSION_RECONCILIATION_ID_CONFLICT');
        return reconciliationFromRow(inserted);
      },
    );
  }

  async latestSalesSummary(eventId: string): Promise<TicketingSalesSummary | undefined> {
    requireText(eventId, 'TICKETING_EVENT_RECORD_ID_REQUIRED');
    const result = await this.pool.query<TicketingSalesRow>(
      'select * from ticketing_sales_snapshots where event_id = $1 order by as_of desc, snapshot_id desc limit 1',
      [eventId],
    );
    return result.rows[0] ? salesFromRow(result.rows[0]) : undefined;
  }

  async latestInventory(eventId: string): Promise<TicketingInventorySnapshot | undefined> {
    requireText(eventId, 'TICKETING_EVENT_RECORD_ID_REQUIRED');
    const result = await this.pool.query<TicketingInventoryRow>(
      'select * from ticketing_inventory_snapshots where event_id = $1 order by as_of desc, snapshot_id desc limit 1',
      [eventId],
    );
    return result.rows[0] ? inventoryFromRow(result.rows[0]) : undefined;
  }

  async #write<
    T extends {
      readonly tenantId: string;
      readonly workspaceId: string;
      readonly organizationId: string;
      readonly correlationId: string;
      readonly evidence: readonly string[];
    },
  >(
    aggregateType: string,
    aggregateId: string,
    input: T,
    action: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const value = await action(client);
      await this.#outbox.enqueue(
        client,
        createDomainEvent({
          eventKey: `recorded:${aggregateId}`,
          eventType: `${aggregateType}.recorded`,
          aggregateType,
          aggregateId,
          aggregateVersion: 1,
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          organizationId: input.organizationId,
          correlationId: input.correlationId,
          occurredAt: new Date().toISOString(),
          payload: value,
          evidence: input.evidence,
        }),
      );
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

async function assertEventScope(
  client: pg.PoolClient,
  value: {
    readonly eventId?: string | null;
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly organizationId: string;
  },
  required = false,
): Promise<void> {
  if (!value.eventId) {
    if (required) throw new Error('EVENT_RECORD_LINK_REQUIRED');
    return;
  }
  const result = await client.query<EventScopeRow>(
    'select event_id, tenant_id, workspace_id, organization_id from event_records where event_id = $1',
    [value.eventId],
  );
  const event = result.rows[0];
  if (!event) throw new Error('EVENT_RECORD_NOT_FOUND');
  if (
    event.tenant_id !== value.tenantId ||
    event.workspace_id !== value.workspaceId ||
    event.organization_id !== value.organizationId
  ) {
    throw new Error('EVENT_RECORD_SCOPE_MISMATCH');
  }
}

async function assertTicketingBinding(
  client: pg.PoolClient,
  value: {
    readonly eventId: string;
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly organizationId: string;
    readonly provider: string;
    readonly externalEventId: string;
  },
): Promise<void> {
  await assertEventScope(client, value, true);
  const result = await client.query<TicketingBindingRow>(
    'select * from ticketing_event_bindings where provider = $1 and external_event_id = $2',
    [value.provider, value.externalEventId],
  );
  const binding = result.rows[0];
  if (!binding) throw new Error('TICKETING_EVENT_BINDING_REQUIRED');
  if (binding.event_id !== value.eventId || binding.tenant_id !== value.tenantId) {
    throw new Error('TICKETING_EVENT_BINDING_MISMATCH');
  }
}

async function resolveSnapshot<Row, T>(
  inserted: Row | undefined,
  expected: T,
  lookup: () => Promise<T | undefined>,
  mapper: (row: Row) => T,
  conflictCode: string,
): Promise<T> {
  if (inserted) return mapper(inserted);
  const existing = await lookup();
  if (!existing || canonical(existing) !== canonical(expected)) throw new Error(conflictCode);
  return existing;
}

interface PlanRow {
  plan_id: string;
  plan_key: string;
  tenant_id: string;
  workspace_id: string;
  organization_id: string;
  event_id: string | null;
  objective: string;
  attribution_model: MeasurementPlan['attributionModel'];
  conversion_event_names: unknown;
  required_dimensions: unknown;
  created_by_principal_id: string;
  correlation_id: string;
  workflow_instance_id: string | null;
  evidence: unknown;
  created_at: Date | string;
}
interface MeasurementEventRow {
  measurement_event_id: string;
  tenant_id: string;
  workspace_id: string;
  organization_id: string;
  event_id: string | null;
  source_system: NormalizedMeasurementEvent['sourceSystem'];
  source_event_id: string;
  event_name: string;
  occurred_at: Date | string;
  ingested_at: Date | string;
  session_id: string | null;
  anonymous_id: string | null;
  subject_id: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  campaign_id: string | null;
  content_id: string | null;
  is_conversion: boolean;
  value_minor: number | string | null;
  currency: string | null;
  properties: unknown;
  data_quality: unknown;
  requester_principal_id: string;
  correlation_id: string;
  workflow_instance_id: string | null;
  evidence: unknown;
}
interface TicketingBindingRow {
  binding_id: string;
  tenant_id: string;
  workspace_id: string;
  organization_id: string;
  event_id: string;
  provider: string;
  external_event_id: string;
  external_event_url: string | null;
  requester_principal_id: string;
  correlation_id: string;
  workflow_instance_id: string | null;
  evidence: unknown;
  created_at: Date | string;
}
interface TicketingSalesRow {
  snapshot_id: string;
  tenant_id: string;
  workspace_id: string;
  organization_id: string;
  event_id: string;
  provider: string;
  external_event_id: string;
  sold_count: number;
  order_count: number;
  gross_revenue_minor: number | string;
  net_revenue_minor: number | string | null;
  currency: string;
  as_of: Date | string;
  requester_principal_id: string;
  correlation_id: string;
  workflow_instance_id: string | null;
  evidence: unknown;
}
interface TicketingInventoryRow {
  snapshot_id: string;
  tenant_id: string;
  workspace_id: string;
  organization_id: string;
  event_id: string;
  provider: string;
  external_event_id: string;
  capacity: number | null;
  sold: number;
  available: number | null;
  held: number | null;
  as_of: Date | string;
  requester_principal_id: string;
  correlation_id: string;
  workflow_instance_id: string | null;
  evidence: unknown;
}
interface TicketingWebhookRow {
  receipt_id: string;
  tenant_id: string;
  workspace_id: string;
  organization_id: string;
  event_id: string;
  provider: string;
  external_event_id: string;
  provider_delivery_id: string;
  event_type: string;
  occurred_at: Date | string;
  received_at: Date | string;
  payload_hash: string;
  normalized_payload: unknown;
  data_quality: unknown;
  requester_principal_id: string;
  correlation_id: string;
  workflow_instance_id: string | null;
  evidence: unknown;
}
interface ReconciliationRow {
  reconciliation_id: string;
  tenant_id: string;
  workspace_id: string;
  organization_id: string;
  event_id: string;
  window_starts_at: Date | string;
  window_ends_at: Date | string;
  measured_conversions: number;
  ticket_conversions: number;
  matched_conversions: number;
  unmatched_measurements: number;
  unmatched_tickets: number;
  measured_revenue_minor: number | string | null;
  ticket_revenue_minor: number | string | null;
  currency: string | null;
  confidence: unknown;
  requester_principal_id: string;
  correlation_id: string;
  workflow_instance_id: string | null;
  evidence: unknown;
  created_at: Date | string;
}

function planFromRow(row: PlanRow): MeasurementPlan {
  return {
    planId: row.plan_id,
    planKey: row.plan_key,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    eventId: row.event_id,
    objective: row.objective,
    attributionModel: row.attribution_model,
    conversionEventNames: strings(row.conversion_event_names),
    requiredDimensions: strings(row.required_dimensions) as MeasurementPlan['requiredDimensions'],
    createdByPrincipalId: row.created_by_principal_id,
    correlationId: row.correlation_id,
    workflowInstanceId: row.workflow_instance_id,
    evidence: strings(row.evidence),
    createdAt: iso(row.created_at),
  };
}
function measurementEventFromRow(row: MeasurementEventRow): NormalizedMeasurementEvent {
  return {
    measurementEventId: row.measurement_event_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    eventId: row.event_id,
    sourceSystem: row.source_system,
    sourceEventId: row.source_event_id,
    eventName: row.event_name,
    occurredAt: iso(row.occurred_at),
    ingestedAt: iso(row.ingested_at),
    sessionId: row.session_id,
    anonymousId: row.anonymous_id,
    subjectId: row.subject_id,
    utm: {
      source: row.utm_source,
      medium: row.utm_medium,
      campaign: row.utm_campaign,
      content: row.utm_content,
      term: row.utm_term,
    },
    campaignId: row.campaign_id,
    contentId: row.content_id,
    isConversion: row.is_conversion,
    valueMinor: minor(row.value_minor),
    currency: row.currency,
    properties: object(row.properties) as NormalizedMeasurementEvent['properties'],
    dataQuality: object(row.data_quality) as unknown as DataQualityReport,
    requesterPrincipalId: row.requester_principal_id,
    correlationId: row.correlation_id,
    workflowInstanceId: row.workflow_instance_id,
    evidence: strings(row.evidence),
  };
}
function bindingFromRow(row: TicketingBindingRow): TicketingEventBinding {
  return {
    bindingId: row.binding_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    eventId: row.event_id,
    provider: row.provider,
    externalEventId: row.external_event_id,
    externalEventUrl: row.external_event_url,
    requesterPrincipalId: row.requester_principal_id,
    correlationId: row.correlation_id,
    workflowInstanceId: row.workflow_instance_id,
    evidence: strings(row.evidence),
    createdAt: iso(row.created_at),
  };
}
function salesFromRow(row: TicketingSalesRow): TicketingSalesSummary {
  return {
    snapshotId: row.snapshot_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    eventId: row.event_id,
    provider: row.provider,
    externalEventId: row.external_event_id,
    soldCount: row.sold_count,
    orderCount: row.order_count,
    grossRevenueMinor: minor(row.gross_revenue_minor) ?? 0,
    netRevenueMinor: minor(row.net_revenue_minor),
    currency: row.currency,
    asOf: iso(row.as_of),
    requesterPrincipalId: row.requester_principal_id,
    correlationId: row.correlation_id,
    workflowInstanceId: row.workflow_instance_id,
    evidence: strings(row.evidence),
  };
}
function inventoryFromRow(row: TicketingInventoryRow): TicketingInventorySnapshot {
  return {
    snapshotId: row.snapshot_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    eventId: row.event_id,
    provider: row.provider,
    externalEventId: row.external_event_id,
    capacity: row.capacity,
    sold: row.sold,
    available: row.available,
    held: row.held,
    asOf: iso(row.as_of),
    requesterPrincipalId: row.requester_principal_id,
    correlationId: row.correlation_id,
    workflowInstanceId: row.workflow_instance_id,
    evidence: strings(row.evidence),
  };
}
function webhookFromRow(row: TicketingWebhookRow): TicketingWebhookReceipt {
  return {
    receiptId: row.receipt_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    eventId: row.event_id,
    provider: row.provider,
    externalEventId: row.external_event_id,
    providerDeliveryId: row.provider_delivery_id,
    eventType: row.event_type,
    occurredAt: iso(row.occurred_at),
    receivedAt: iso(row.received_at),
    payloadHash: row.payload_hash,
    normalizedPayload: object(
      row.normalized_payload,
    ) as TicketingWebhookReceipt['normalizedPayload'],
    dataQuality: object(row.data_quality) as unknown as DataQualityReport,
    requesterPrincipalId: row.requester_principal_id,
    correlationId: row.correlation_id,
    workflowInstanceId: row.workflow_instance_id,
    evidence: strings(row.evidence),
  };
}
function reconciliationFromRow(row: ReconciliationRow): ConversionReconciliation {
  return {
    reconciliationId: row.reconciliation_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    eventId: row.event_id,
    windowStartsAt: iso(row.window_starts_at),
    windowEndsAt: iso(row.window_ends_at),
    measuredConversions: row.measured_conversions,
    ticketConversions: row.ticket_conversions,
    matchedConversions: row.matched_conversions,
    unmatchedMeasurements: row.unmatched_measurements,
    unmatchedTickets: row.unmatched_tickets,
    measuredRevenueMinor: minor(row.measured_revenue_minor),
    ticketRevenueMinor: minor(row.ticket_revenue_minor),
    currency: row.currency,
    confidence: object(row.confidence) as unknown as AttributionConfidence,
    requesterPrincipalId: row.requester_principal_id,
    correlationId: row.correlation_id,
    workflowInstanceId: row.workflow_instance_id,
    evidence: strings(row.evidence),
    createdAt: iso(row.created_at),
  };
}

function json(value: unknown): string {
  return JSON.stringify(value);
}
function canonical(value: unknown): string {
  return JSON.stringify(sortObject(value));
}
function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortObject(v)]),
    );
  return value;
}
function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
function minor(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new Error('MEASUREMENT_MINOR_VALUE_INVALID');
  return parsed;
}
function requireText(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}
