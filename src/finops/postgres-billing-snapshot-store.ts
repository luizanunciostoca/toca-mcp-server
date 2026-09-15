import { createHash } from 'node:crypto';
import type pg from 'pg';
import {
  parseBillingSnapshot,
  type BillingSnapshot,
  type BillingSnapshotScope,
} from './billing-snapshot.js';

interface BillingSnapshotRow {
  readonly snapshot_id: string;
  readonly snapshot_sha256: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly provider: string;
  readonly model: string | null;
  readonly category: BillingSnapshot['category'];
  readonly campaign_id: string | null;
  readonly period_start: Date | string;
  readonly period_end: Date | string;
  readonly currency: 'USD';
  readonly billed_cost_micro_usd: string | number;
  readonly evidence_ref: string;
  readonly observed_at: Date | string;
}

export interface BillingSnapshotAppendResult {
  readonly status: 'APPENDED' | 'IDEMPOTENT_REPLAY';
  readonly snapshotHash: string;
}

export interface BillingSnapshotIdentityQuery extends BillingSnapshotScope {
  readonly snapshotId: string;
}

export interface BillingSnapshotStore {
  append(snapshot: BillingSnapshot): Promise<BillingSnapshotAppendResult>;
  getById(query: BillingSnapshotIdentityQuery): Promise<BillingSnapshot | null>;
}

export class PostgresBillingSnapshotStore implements BillingSnapshotStore {
  constructor(private readonly pool: pg.Pool) {}

  async append(candidate: BillingSnapshot): Promise<BillingSnapshotAppendResult> {
    const snapshot = canonicalizeBillingSnapshot(candidate);
    const snapshotHash = hashBillingSnapshot(snapshot);
    const inserted = await this.pool.query<{ readonly snapshot_id: string }>(
      `insert into finops_billing_snapshots (
         snapshot_id, snapshot_sha256, tenant_id, workspace_id, organization_id,
         provider, model, category, campaign_id, period_start, period_end,
         currency, billed_cost_micro_usd, evidence_ref, observed_at
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz,
         $12, $13, $14, $15::timestamptz
       ) on conflict (snapshot_id) do nothing
       returning snapshot_id`,
      [
        snapshot.snapshotId,
        snapshotHash,
        snapshot.tenantId,
        snapshot.workspaceId,
        snapshot.organizationId,
        snapshot.provider,
        snapshot.model ?? null,
        snapshot.category,
        snapshot.campaignId ?? null,
        snapshot.periodStart,
        snapshot.periodEnd,
        snapshot.currency,
        snapshot.billedCostMicroUsd,
        snapshot.evidenceRef,
        snapshot.observedAt,
      ],
    );

    if (inserted.rowCount === 1) return { status: 'APPENDED', snapshotHash };

    const existing = await this.pool.query<{ readonly snapshot_sha256: string }>(
      'select snapshot_sha256 from finops_billing_snapshots where snapshot_id = $1',
      [snapshot.snapshotId],
    );
    if (existing.rows[0]?.snapshot_sha256 !== snapshotHash) {
      throw new Error('FINOPS_BILLING_SNAPSHOT_ID_CONFLICT');
    }
    return { status: 'IDEMPOTENT_REPLAY', snapshotHash };
  }

  async getById(query: BillingSnapshotIdentityQuery): Promise<BillingSnapshot | null> {
    const snapshotId = requiredScope(query.snapshotId, 'SNAPSHOT_ID');
    const tenantId = requiredScope(query.tenantId, 'TENANT_ID');
    const workspaceId = requiredScope(query.workspaceId, 'WORKSPACE_ID');
    const organizationId = requiredScope(query.organizationId, 'ORGANIZATION_ID');
    const result = await this.pool.query<BillingSnapshotRow>(
      `select * from finops_billing_snapshots
       where snapshot_id = $1
         and tenant_id = $2
         and workspace_id = $3
         and organization_id = $4`,
      [snapshotId, tenantId, workspaceId, organizationId],
    );
    const row = result.rows[0];
    return row ? billingSnapshotFromRow(row) : null;
  }
}

export function hashBillingSnapshot(snapshot: BillingSnapshot): string {
  return createHash('sha256')
    .update(stableJson(canonicalizeBillingSnapshot(snapshot)))
    .digest('hex');
}

function canonicalizeBillingSnapshot(candidate: BillingSnapshot): BillingSnapshot {
  const snapshot = parseBillingSnapshot(candidate);
  return parseBillingSnapshot({
    ...snapshot,
    periodStart: new Date(snapshot.periodStart).toISOString(),
    periodEnd: new Date(snapshot.periodEnd).toISOString(),
    observedAt: new Date(snapshot.observedAt).toISOString(),
  });
}

function billingSnapshotFromRow(row: BillingSnapshotRow): BillingSnapshot {
  return parseBillingSnapshot({
    snapshotId: row.snapshot_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    provider: row.provider,
    ...(row.model ? { model: row.model } : {}),
    category: row.category,
    ...(row.campaign_id ? { campaignId: row.campaign_id } : {}),
    periodStart: iso(row.period_start),
    periodEnd: iso(row.period_end),
    currency: row.currency,
    billedCostMicroUsd: safeInteger(row.billed_cost_micro_usd),
    evidenceRef: row.evidence_ref,
    observedAt: iso(row.observed_at),
  });
}

function requiredScope(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`FINOPS_BILLING_${field}_REQUIRED`);
  return normalized;
}

function safeInteger(value: string | number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('FINOPS_BILLING_DB_COST_INVALID');
  }
  return parsed;
}

function iso(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('FINOPS_BILLING_DB_TIMESTAMP_INVALID');
  }
  return parsed.toISOString();
}

function stableJson(value: unknown): string {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    throw new Error('FINOPS_BILLING_NON_JSON_VALUE');
  }
  if (typeof value === 'bigint') throw new Error('FINOPS_BILLING_NON_JSON_VALUE');
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('FINOPS_BILLING_NON_JSON_VALUE');
  }
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error('FINOPS_BILLING_NON_JSON_VALUE');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const object = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
    .join(',')}}`;
}
