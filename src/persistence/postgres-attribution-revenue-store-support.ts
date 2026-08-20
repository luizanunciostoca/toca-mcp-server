import { createHash } from 'node:crypto';
import type pg from 'pg';
import {
  validateAttributionTouchpoint,
  validateAttributionWindowPolicy,
  validateRevenueEvidence,
  type AttributionTouchpointRecord,
  type AttributionWindowPolicy,
  type MarketingFeedbackView,
  type MarketingSalesFeedbackSnapshot,
  type RevenueEvidenceRecord,
  type SalesDemandContextView,
} from '../measurement/attribution-revenue.js';
import type { AttributionRevenueScope } from '../measurement/attribution-revenue-store.js';
import type {
  FeedbackRow,
  IdempotencyRow,
  IntelligenceRecordType,
  PersistedIntelligenceRecord,
  RevenueEvidenceRow,
  TouchpointRow,
  WindowPolicyRow,
} from './postgres-attribution-revenue-rows.js';

export async function beginIdempotency(
  client: pg.PoolClient,
  operation: string,
  recordType: IntelligenceRecordType,
  record: PersistedIntelligenceRecord,
): Promise<unknown> {
  const requestHash = businessHash(record);
  const recordId = recordIdFor(recordType, record);
  await client.query(
    `insert into measurement_intelligence_idempotency (
       tenant_id, workspace_id, organization_id, operation, idempotency_key,
       request_hash, record_type, record_id, response_snapshot, created_at, completed_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,null,$9::timestamptz,null)
     on conflict (tenant_id, workspace_id, organization_id, operation, idempotency_key) do nothing`,
    [
      record.tenantId,
      record.workspaceId,
      record.organizationId,
      operation,
      record.idempotencyKey,
      requestHash,
      recordType,
      recordId,
      record.createdAt,
    ],
  );
  const result = await client.query<IdempotencyRow>(
    `select request_hash, record_type, record_id, response_snapshot
       from measurement_intelligence_idempotency
      where tenant_id=$1 and workspace_id=$2 and organization_id=$3
        and operation=$4 and idempotency_key=$5 for update`,
    [record.tenantId, record.workspaceId, record.organizationId, operation, record.idempotencyKey],
  );
  const row = requiredRow(result.rows[0], 'MEASUREMENT_INTELLIGENCE_IDEMPOTENCY_NOT_FOUND');
  if (
    row.request_hash !== requestHash ||
    row.record_type !== recordType ||
    row.record_id !== recordId
  ) {
    throw new Error('MEASUREMENT_INTELLIGENCE_IDEMPOTENCY_CONFLICT');
  }
  return row.response_snapshot ?? undefined;
}

export async function completeIdempotency(
  client: pg.PoolClient,
  operation: string,
  request: PersistedIntelligenceRecord,
  response: PersistedIntelligenceRecord,
): Promise<void> {
  const updated = await client.query(
    `update measurement_intelligence_idempotency
        set response_snapshot=$6::jsonb, completed_at=$7::timestamptz
      where tenant_id=$1 and workspace_id=$2 and organization_id=$3
        and operation=$4 and idempotency_key=$5 and request_hash=$8`,
    [
      request.tenantId,
      request.workspaceId,
      request.organizationId,
      operation,
      request.idempotencyKey,
      json(response),
      request.createdAt,
      businessHash(request),
    ],
  );
  if (updated.rowCount !== 1)
    throw new Error('MEASUREMENT_INTELLIGENCE_IDEMPOTENCY_COMPLETE_FAILED');
}

export function windowPolicyFromRow(row: WindowPolicyRow): AttributionWindowPolicy {
  const value: AttributionWindowPolicy = {
    policyId: row.policy_id,
    policyKey: row.policy_key,
    version: row.version,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    firstTouchLookbackDays: row.first_touch_lookback_days,
    lastTouchLookbackDays: row.last_touch_lookback_days,
    assistedLookbackDays: row.assisted_lookback_days,
    idempotencyKey: row.idempotency_key,
    executionId: row.execution_id,
    correlationId: row.correlation_id,
    actorPrincipalId: row.actor_principal_id,
    evidence: stringArray(row.evidence, 'ATTRIBUTION_POLICY_EVIDENCE_INVALID'),
    createdAt: iso(row.created_at),
  };
  validateAttributionWindowPolicy(value);
  return value;
}

export function touchpointFromRow(row: TouchpointRow): AttributionTouchpointRecord {
  const value: AttributionTouchpointRecord = {
    touchpointId: row.touchpoint_id,
    dedupeKey: row.dedupe_key,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    contactId: row.contact_id,
    leadId: row.lead_id,
    opportunityId: row.opportunity_id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    channel: row.channel,
    utm: {
      source: row.utm_source,
      medium: row.utm_medium,
      campaign: row.utm_campaign,
      content: row.utm_content,
      term: row.utm_term,
    },
    metaCampaignId: row.meta_campaign_id,
    metaAdsetId: row.meta_adset_id,
    metaAdId: row.meta_ad_id,
    metaCreativeId: row.meta_creative_id,
    googleCampaignId: row.google_campaign_id,
    googleAdGroupId: row.google_ad_group_id,
    googleAdId: row.google_ad_id,
    googleCreativeId: row.google_creative_id,
    clickId: row.click_id,
    fbclid: row.fbclid,
    gclid: row.gclid,
    gbraid: row.gbraid,
    wbraid: row.wbraid,
    landingUrl: row.landing_url,
    sessionId: row.session_id,
    leadSource: row.lead_source,
    ticketReference: row.ticket_reference,
    orderReference: row.order_reference,
    paymentReference: row.payment_reference,
    checkoutReference: row.checkout_reference,
    messageRef: row.message_ref,
    intent: row.intent,
    demandContext: primitiveObject(row.demand_context, 'ATTRIBUTION_DEMAND_CONTEXT_INVALID'),
    attributionSource: row.attribution_source,
    occurredAt: iso(row.occurred_at),
    idempotencyKey: row.idempotency_key,
    executionId: row.execution_id,
    correlationId: row.correlation_id,
    actorPrincipalId: row.actor_principal_id,
    evidence: stringArray(row.evidence, 'ATTRIBUTION_TOUCHPOINT_EVIDENCE_INVALID'),
    createdAt: iso(row.created_at),
  };
  validateAttributionTouchpoint(value);
  return value;
}

export function revenueFromRow(row: RevenueEvidenceRow): RevenueEvidenceRecord {
  const value: RevenueEvidenceRecord = {
    revenueEvidenceId: row.revenue_evidence_id,
    dedupeKey: row.dedupe_key,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    opportunityId: row.opportunity_id,
    contactId: row.contact_id,
    leadId: row.lead_id,
    conversationId: row.conversation_id,
    eventId: row.event_id,
    source: row.source_type,
    provider: row.provider,
    providerEventId: row.provider_event_id,
    providerEvidenceRef: row.provider_evidence_ref,
    externalReference: row.external_reference,
    status: row.status,
    providerReadbackAt: iso(row.provider_readback_at),
    occurredAt: iso(row.occurred_at),
    currency: row.currency,
    grossRevenueMinor: bigint(row.gross_revenue_minor),
    netRevenueMinor: bigint(row.net_revenue_minor),
    refundMinor: bigint(row.refund_minor),
    costMinor: bigint(row.cost_minor),
    ticketReference: row.ticket_reference,
    orderReference: row.order_reference,
    paymentReference: row.payment_reference,
    checkoutReference: row.checkout_reference,
    idempotencyKey: row.idempotency_key,
    executionId: row.execution_id,
    correlationId: row.correlation_id,
    actorPrincipalId: row.actor_principal_id,
    evidence: stringArray(row.evidence, 'REVENUE_EVIDENCE_ARRAY_INVALID'),
    createdAt: iso(row.created_at),
  };
  validateRevenueEvidence(value);
  return value;
}

export function feedbackFromRow(row: FeedbackRow): MarketingSalesFeedbackSnapshot {
  const value: MarketingSalesFeedbackSnapshot = {
    feedbackId: row.feedback_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    opportunityId: row.opportunity_id,
    marketing: marketingView(row.marketing),
    sales: salesView(row.sales),
    idempotencyKey: row.idempotency_key,
    executionId: row.execution_id,
    correlationId: row.correlation_id,
    actorPrincipalId: row.actor_principal_id,
    evidence: stringArray(row.evidence, 'MARKETING_SALES_FEEDBACK_EVIDENCE_INVALID'),
    createdAt: iso(row.created_at),
  };
  requireFeedbackSnapshot(value);
  return value;
}

export function windowPolicyFromSnapshot(value: unknown): AttributionWindowPolicy {
  return windowPolicyFromRow(snapshotRow(value) as unknown as WindowPolicyRow);
}

export function touchpointFromSnapshot(value: unknown): AttributionTouchpointRecord {
  const record = object(value, 'ATTRIBUTION_TOUCHPOINT_SNAPSHOT_INVALID');
  const typed = record as unknown as AttributionTouchpointRecord;
  validateAttributionTouchpoint(typed);
  return typed;
}

export function revenueFromSnapshot(value: unknown): RevenueEvidenceRecord {
  const record = object(value, 'REVENUE_EVIDENCE_SNAPSHOT_INVALID');
  const typed = record as unknown as RevenueEvidenceRecord;
  validateRevenueEvidence(typed);
  return typed;
}

export function feedbackFromSnapshot(value: unknown): MarketingSalesFeedbackSnapshot {
  const record = object(value, 'MARKETING_SALES_FEEDBACK_SNAPSHOT_INVALID');
  const typed = record as unknown as MarketingSalesFeedbackSnapshot;
  requireFeedbackSnapshot(typed);
  return typed;
}

export function snapshotRow(value: unknown): Readonly<Record<string, unknown>> {
  const record = object(value, 'ATTRIBUTION_POLICY_SNAPSHOT_INVALID');
  return {
    policy_id: record.policyId,
    policy_key: record.policyKey,
    version: record.version,
    tenant_id: record.tenantId,
    workspace_id: record.workspaceId,
    organization_id: record.organizationId,
    first_touch_lookback_days: record.firstTouchLookbackDays,
    last_touch_lookback_days: record.lastTouchLookbackDays,
    assisted_lookback_days: record.assistedLookbackDays,
    idempotency_key: record.idempotencyKey,
    execution_id: record.executionId,
    correlation_id: record.correlationId,
    actor_principal_id: record.actorPrincipalId,
    evidence: record.evidence,
    created_at: record.createdAt,
  };
}

export function requireFeedbackSnapshot(snapshot: MarketingSalesFeedbackSnapshot): void {
  requireScope(snapshot);
  if (!snapshot.feedbackId.trim()) throw new Error('MARKETING_SALES_FEEDBACK_ID_REQUIRED');
  if (!snapshot.opportunityId.trim())
    throw new Error('MARKETING_SALES_FEEDBACK_OPPORTUNITY_REQUIRED');
  if (!snapshot.idempotencyKey.trim()) throw new Error('ATTRIBUTION_IDEMPOTENCY_KEY_REQUIRED');
  if (!snapshot.executionId.trim()) throw new Error('ATTRIBUTION_EXECUTION_ID_REQUIRED');
  if (!snapshot.correlationId.trim()) throw new Error('ATTRIBUTION_CORRELATION_ID_REQUIRED');
  if (!snapshot.actorPrincipalId.trim()) throw new Error('ATTRIBUTION_ACTOR_REQUIRED');
  if (snapshot.evidence.length === 0) throw new Error('ATTRIBUTION_EVIDENCE_REQUIRED');
  if (!Number.isFinite(Date.parse(snapshot.createdAt)))
    throw new Error('ATTRIBUTION_CREATED_AT_INVALID');
}

export function marketingView(value: unknown): MarketingFeedbackView {
  const record = object(value, 'MARKETING_FEEDBACK_INVALID');
  return record as unknown as MarketingFeedbackView;
}

export function salesView(value: unknown): SalesDemandContextView {
  const record = object(value, 'SALES_DEMAND_CONTEXT_INVALID');
  return record as unknown as SalesDemandContextView;
}

export function businessPayload(record: PersistedIntelligenceRecord): unknown {
  const parsed: unknown = JSON.parse(JSON.stringify(record));
  return object(parsed, 'MEASUREMENT_INTELLIGENCE_PAYLOAD_INVALID');
}

export function businessHash(record: PersistedIntelligenceRecord): string {
  const payload = businessComparable(record);
  return createHash('sha256').update(stableJson(payload), 'utf8').digest('hex');
}

export function assertBusinessEquivalent(
  left: PersistedIntelligenceRecord,
  right: PersistedIntelligenceRecord,
  errorCode: string,
): void {
  if (businessHash(left) !== businessHash(right)) throw new Error(errorCode);
}

export function businessComparable(
  record: PersistedIntelligenceRecord,
): Readonly<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(JSON.stringify(record));
  const business = { ...object(parsed, 'MEASUREMENT_INTELLIGENCE_RECORD_INVALID') };
  delete business.idempotencyKey;
  delete business.executionId;
  delete business.correlationId;
  delete business.actorPrincipalId;
  delete business.evidence;
  delete business.createdAt;
  delete business.policyId;
  delete business.touchpointId;
  delete business.revenueEvidenceId;
  delete business.feedbackId;
  return business;
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Readonly<Record<string, unknown>>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function recordIdFor(
  recordType: IntelligenceRecordType,
  record: PersistedIntelligenceRecord,
): string {
  switch (recordType) {
    case 'ATTRIBUTION_WINDOW_POLICY':
      return (record as AttributionWindowPolicy).policyId;
    case 'ATTRIBUTION_TOUCHPOINT':
      return (record as AttributionTouchpointRecord).touchpointId;
    case 'REVENUE_EVIDENCE':
      return (record as RevenueEvidenceRecord).revenueEvidenceId;
    case 'MARKETING_SALES_FEEDBACK':
      return (record as MarketingSalesFeedbackSnapshot).feedbackId;
  }
}

export function aggregateVersion(record: PersistedIntelligenceRecord): number {
  return 'policyId' in record ? record.version : 1;
}

export function appendNullableFilter(
  clauses: string[],
  values: Array<string | number>,
  column: string,
  value: string | null | undefined,
): void {
  if (value === undefined) return;
  if (value === null) {
    clauses.push(`${column} is null`);
    return;
  }
  appendFilter(clauses, values, `${column} =`, value);
}

export function appendFilter(
  clauses: string[],
  values: Array<string | number>,
  operator: string,
  value: string | number,
): void {
  values.push(value);
  clauses.push(`${operator} $${values.length}`);
}

export function normalizeLimit(value: number | undefined): number {
  const limit = value ?? 250;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error('MEASUREMENT_INTELLIGENCE_LIMIT_INVALID');
  }
  return limit;
}

export function requireScope(scope: AttributionRevenueScope): void {
  if (!scope.tenantId.trim()) throw new Error('ATTRIBUTION_TENANT_ID_REQUIRED');
  if (!scope.workspaceId.trim()) throw new Error('ATTRIBUTION_WORKSPACE_ID_REQUIRED');
  if (!scope.organizationId.trim()) throw new Error('ATTRIBUTION_ORGANIZATION_ID_REQUIRED');
}

export function primitiveObject(
  value: unknown,
  errorCode: string,
): Readonly<Record<string, string | number | boolean | null>> {
  const record = object(value, errorCode);
  for (const item of Object.values(record)) {
    if (item !== null && !['string', 'number', 'boolean'].includes(typeof item))
      throw new Error(errorCode);
  }
  return record as Readonly<Record<string, string | number | boolean | null>>;
}

export function object(value: unknown, errorCode: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(errorCode);
  return value as Readonly<Record<string, unknown>>;
}

export function stringArray(value: unknown, errorCode: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
    throw new Error(errorCode);
  return value as string[];
}

export function bigint(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error('REVENUE_AMOUNT_OUT_OF_RANGE');
  return parsed;
}

export function iso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new Error('MEASUREMENT_INTELLIGENCE_TIMESTAMP_INVALID');
  return date.toISOString();
}

export function json(value: unknown): string {
  return JSON.stringify(value) ?? 'null';
}

export function requiredRow<T>(value: T | undefined, errorCode: string): T {
  if (!value) throw new Error(errorCode);
  return value;
}
