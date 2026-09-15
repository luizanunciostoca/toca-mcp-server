import type pg from 'pg';
import {
  parseBillingSnapshot,
  type BillingSnapshot,
  type BillingSnapshotScope,
} from './billing-snapshot.js';
import {
  reconcileBillingAmounts,
  type BillingReconciliationResult,
} from './billing-reconciliation.js';
import { costCategorySchema, type CostCategory } from './cost-event.js';

export type FinopsCostDimension = 'PROVIDER' | 'CATEGORY' | 'ROUTE' | 'AGENT' | 'CAMPAIGN';

export interface FinopsActualCostQuery extends BillingSnapshotScope {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
  readonly category?: CostCategory | undefined;
  readonly routeId?: string | undefined;
  readonly agentId?: string | undefined;
  readonly campaignId?: string | undefined;
}

export interface FinopsActualCostSummary {
  readonly actualCostMicroUsd: number;
  readonly eventCount: number;
}

export interface FinopsActualCostGroup extends FinopsActualCostSummary {
  readonly groupKey: string;
}

export interface BillingSnapshotReconciliation extends BillingReconciliationResult {
  readonly snapshotId: string;
}

interface AggregateRow {
  readonly actual_cost_micro_usd: string | number;
  readonly event_count: string | number;
}

interface GroupRow extends AggregateRow {
  readonly group_key: string;
}

const dimensionColumns: Readonly<Record<FinopsCostDimension, string>> = {
  PROVIDER: 'provider',
  CATEGORY: 'category',
  ROUTE: 'route_id',
  AGENT: 'agent_id',
  CAMPAIGN: 'campaign_id',
};

export class PostgresFinopsReadModel {
  constructor(private readonly pool: pg.Pool) {}

  async aggregateActualCost(query: FinopsActualCostQuery): Promise<FinopsActualCostSummary> {
    const filter = buildActualCostFilter(query);
    const result = await this.pool.query<AggregateRow>(
      `select
         coalesce(sum(actual_cost_micro_usd), 0)::text as actual_cost_micro_usd,
         count(*)::text as event_count
       from finops_cost_events
       where ${filter.where.join('\n         and ')}`,
      filter.values,
    );
    const row = result.rows[0];
    if (!row) throw new Error('FINOPS_ACTUAL_COST_AGGREGATE_MISSING');
    return {
      actualCostMicroUsd: safeDbInteger(row.actual_cost_micro_usd, 'ACTUAL_COST'),
      eventCount: safeDbInteger(row.event_count, 'EVENT_COUNT'),
    };
  }

  async aggregateActualCostByDimension(
    query: FinopsActualCostQuery,
    dimension: FinopsCostDimension,
    limit = 100,
  ): Promise<readonly FinopsActualCostGroup[]> {
    const column = dimensionColumns[dimension];
    if (!column) throw new Error('FINOPS_COST_DIMENSION_INVALID');
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new Error('FINOPS_COST_GROUP_LIMIT_INVALID');
    }
    const filter = buildActualCostFilter(query);
    const result = await this.pool.query<GroupRow>(
      `select
         coalesce(${column}, 'UNATTRIBUTED') as group_key,
         coalesce(sum(actual_cost_micro_usd), 0)::text as actual_cost_micro_usd,
         count(*)::text as event_count
       from finops_cost_events
       where ${filter.where.join('\n         and ')}
       group by coalesce(${column}, 'UNATTRIBUTED')
       order by sum(actual_cost_micro_usd) desc, group_key asc
       limit ${limit}`,
      filter.values,
    );
    return result.rows.map((row) => ({
      groupKey: row.group_key,
      actualCostMicroUsd: safeDbInteger(row.actual_cost_micro_usd, 'ACTUAL_COST'),
      eventCount: safeDbInteger(row.event_count, 'EVENT_COUNT'),
    }));
  }

  async reconcileBillingSnapshot(
    candidate: BillingSnapshot,
    toleranceMicroUsd = 0,
  ): Promise<BillingSnapshotReconciliation> {
    const snapshot = parseBillingSnapshot(candidate);
    const summary = await this.aggregateActualCost({
      tenantId: snapshot.tenantId,
      workspaceId: snapshot.workspaceId,
      organizationId: snapshot.organizationId,
      periodStart: snapshot.periodStart,
      periodEnd: snapshot.periodEnd,
      provider: snapshot.provider,
      ...(snapshot.model ? { model: snapshot.model } : {}),
      category: snapshot.category,
      ...(snapshot.campaignId ? { campaignId: snapshot.campaignId } : {}),
    });
    return {
      snapshotId: snapshot.snapshotId,
      ...reconcileBillingAmounts({
        ledgerActualCostMicroUsd: summary.actualCostMicroUsd,
        billedCostMicroUsd: snapshot.billedCostMicroUsd,
        toleranceMicroUsd,
      }),
    };
  }
}

function buildActualCostFilter(query: FinopsActualCostQuery): {
  readonly where: string[];
  readonly values: unknown[];
} {
  const tenantId = requiredText(query.tenantId, 'TENANT_ID');
  const workspaceId = requiredText(query.workspaceId, 'WORKSPACE_ID');
  const organizationId = requiredText(query.organizationId, 'ORGANIZATION_ID');
  const periodStart = normalizedIso(query.periodStart, 'PERIOD_START');
  const periodEnd = normalizedIso(query.periodEnd, 'PERIOD_END');
  if (Date.parse(periodEnd) <= Date.parse(periodStart)) {
    throw new Error('FINOPS_COST_PERIOD_INVALID');
  }

  const values: unknown[] = [tenantId, workspaceId, organizationId, periodStart, periodEnd];
  const where = [
    'tenant_id = $1',
    'workspace_id = $2',
    'organization_id = $3',
    "phase = 'ACTUAL'",
    'created_at >= $4::timestamptz',
    'created_at < $5::timestamptz',
  ];

  addTextFilter(where, values, 'provider', query.provider, 'PROVIDER');
  addTextFilter(where, values, 'model', query.model, 'MODEL');
  if (query.category !== undefined) {
    values.push(costCategorySchema.parse(query.category));
    where.push(`category = $${values.length}`);
  }
  addTextFilter(where, values, 'route_id', query.routeId, 'ROUTE_ID');
  addTextFilter(where, values, 'agent_id', query.agentId, 'AGENT_ID');
  addTextFilter(where, values, 'campaign_id', query.campaignId, 'CAMPAIGN_ID');
  return { where, values };
}

function addTextFilter(
  where: string[],
  values: unknown[],
  column: string,
  value: string | undefined,
  field: string,
): void {
  if (value === undefined) return;
  values.push(requiredText(value, field));
  where.push(`${column} = $${values.length}`);
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`FINOPS_${field}_REQUIRED`);
  return normalized;
}

function normalizedIso(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`FINOPS_${field}_INVALID`);
  return parsed.toISOString();
}

function safeDbInteger(value: string | number, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`FINOPS_DB_${field}_INVALID`);
  }
  return parsed;
}
