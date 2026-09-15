import { createHash } from 'node:crypto';
import type pg from 'pg';
import { parseCostEvent, type CostEvent } from './cost-event.js';

interface CostEventRow {
  readonly event_id: string;
  readonly event_sha256: string;
  readonly execution_id: string;
  readonly correlation_id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly route_id: string | null;
  readonly agent_id: string | null;
  readonly provider: string;
  readonly model: string | null;
  readonly category: CostEvent['category'];
  readonly phase: CostEvent['phase'];
  readonly price_catalog_version: string;
  readonly currency: 'USD';
  readonly estimated_cost_micro_usd: string | number | null;
  readonly actual_cost_micro_usd: string | number | null;
  readonly usage: unknown;
  readonly content_item_id: string | null;
  readonly campaign_id: string | null;
  readonly metadata: unknown;
  readonly created_at: Date | string;
}

export interface CostLedgerAppendResult {
  readonly status: 'APPENDED' | 'IDEMPOTENT_REPLAY';
  readonly eventHash: string;
}

export interface CostLedgerCorrelationQuery {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly correlationId: string;
  readonly limit?: number;
}

export interface CostLedger {
  append(event: CostEvent): Promise<CostLedgerAppendResult>;
  listByCorrelation(query: CostLedgerCorrelationQuery): Promise<readonly CostEvent[]>;
}

export class PostgresCostLedger implements CostLedger {
  constructor(private readonly pool: pg.Pool) {}

  async append(candidate: CostEvent): Promise<CostLedgerAppendResult> {
    const event = canonicalizeCostEvent(candidate);
    const eventHash = hashCostEvent(event);
    const inserted = await this.pool.query<{ readonly event_id: string }>(
      `insert into finops_cost_events (
         event_id, event_sha256, execution_id, correlation_id,
         tenant_id, workspace_id, organization_id, route_id, agent_id,
         provider, model, category, phase, price_catalog_version, currency,
         estimated_cost_micro_usd, actual_cost_micro_usd, usage,
         content_item_id, campaign_id, metadata, created_at
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
         $16, $17, $18::jsonb, $19, $20, $21::jsonb, $22::timestamptz
       ) on conflict (event_id) do nothing
       returning event_id`,
      [
        event.eventId,
        eventHash,
        event.executionId,
        event.correlationId,
        event.tenantId,
        event.workspaceId,
        event.organizationId,
        event.routeId ?? null,
        event.agentId ?? null,
        event.provider,
        event.model ?? null,
        event.category,
        event.phase,
        event.priceCatalogVersion,
        event.currency,
        event.estimatedCostMicroUsd ?? null,
        event.actualCostMicroUsd ?? null,
        JSON.stringify(event.usage),
        event.contentItemId ?? null,
        event.campaignId ?? null,
        JSON.stringify(event.metadata ?? {}),
        event.createdAt,
      ],
    );

    if (inserted.rowCount === 1) return { status: 'APPENDED', eventHash };

    const existing = await this.pool.query<{ readonly event_sha256: string }>(
      'select event_sha256 from finops_cost_events where event_id = $1',
      [event.eventId],
    );
    if (existing.rows[0]?.event_sha256 !== eventHash) {
      throw new Error('FINOPS_COST_EVENT_ID_CONFLICT');
    }
    return { status: 'IDEMPOTENT_REPLAY', eventHash };
  }

  async listByCorrelation(query: CostLedgerCorrelationQuery): Promise<readonly CostEvent[]> {
    const tenantId = requiredScope(query.tenantId, 'TENANT_ID');
    const workspaceId = requiredScope(query.workspaceId, 'WORKSPACE_ID');
    const organizationId = requiredScope(query.organizationId, 'ORGANIZATION_ID');
    const correlationId = requiredScope(query.correlationId, 'CORRELATION_ID');
    const limit = query.limit ?? 500;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new Error('FINOPS_LIMIT_INVALID');
    }
    const result = await this.pool.query<CostEventRow>(
      `select * from finops_cost_events
       where tenant_id = $1
         and workspace_id = $2
         and organization_id = $3
         and correlation_id = $4
       order by created_at asc, event_id asc
       limit $5`,
      [tenantId, workspaceId, organizationId, correlationId, limit],
    );
    return result.rows.map(costEventFromRow);
  }
}

export function hashCostEvent(event: CostEvent): string {
  const canonical = stableJson(canonicalizeCostEvent(event));
  return createHash('sha256').update(canonical).digest('hex');
}

function canonicalizeCostEvent(candidate: CostEvent): CostEvent {
  const event = parseCostEvent(candidate);
  return parseCostEvent({
    ...event,
    metadata: event.metadata ?? {},
    createdAt: new Date(event.createdAt).toISOString(),
  });
}

function costEventFromRow(row: CostEventRow): CostEvent {
  return parseCostEvent({
    eventId: row.event_id,
    executionId: row.execution_id,
    correlationId: row.correlation_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    ...(row.route_id ? { routeId: row.route_id } : {}),
    ...(row.agent_id ? { agentId: row.agent_id } : {}),
    provider: row.provider,
    ...(row.model ? { model: row.model } : {}),
    category: row.category,
    phase: row.phase,
    priceCatalogVersion: row.price_catalog_version,
    currency: row.currency,
    ...(row.estimated_cost_micro_usd !== null
      ? { estimatedCostMicroUsd: safeInteger(row.estimated_cost_micro_usd) }
      : {}),
    ...(row.actual_cost_micro_usd !== null
      ? { actualCostMicroUsd: safeInteger(row.actual_cost_micro_usd) }
      : {}),
    usage: requireJsonObject(row.usage, 'USAGE'),
    ...(row.content_item_id ? { contentItemId: row.content_item_id } : {}),
    ...(row.campaign_id ? { campaignId: row.campaign_id } : {}),
    metadata: requireJsonObject(row.metadata, 'METADATA'),
    createdAt: iso(row.created_at),
  });
}

function safeInteger(value: string | number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('FINOPS_DB_COST_INVALID');
  return parsed;
}

function requireJsonObject(
  value: unknown,
  field: 'USAGE' | 'METADATA',
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`FINOPS_DB_JSON_INVALID:${field}`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function requiredScope(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`FINOPS_${field}_REQUIRED`);
  return normalized;
}

function iso(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('FINOPS_DB_TIMESTAMP_INVALID');
  return parsed.toISOString();
}

function stableJson(value: unknown): string {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    throw new Error('FINOPS_COST_EVENT_NON_JSON_VALUE');
  }
  if (typeof value === 'bigint') throw new Error('FINOPS_COST_EVENT_NON_JSON_VALUE');
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('FINOPS_COST_EVENT_NON_JSON_VALUE');
  }
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error('FINOPS_COST_EVENT_NON_JSON_VALUE');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const object = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
    .join(',')}}`;
}
