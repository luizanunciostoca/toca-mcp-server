import type pg from 'pg';
import type {
  ApprovalRecord,
  ApprovalStatus,
  ApprovalStore,
} from '../governance/approval-governance.js';
import { isRouteId } from '../governance/types.js';

interface ApprovalRow {
  readonly approval_id: string;
  readonly requester: string;
  readonly approver: string | null;
  readonly route_id: string;
  readonly capability_id: string;
  readonly descriptor_sha256: string;
  readonly target_account: string;
  readonly scope: unknown;
  readonly financial_ceiling: unknown;
  readonly requested_at: Date | string;
  readonly issued_at: Date | string | null;
  readonly expires_at: Date | string;
  readonly consumed_at: Date | string | null;
  readonly revoked_at: Date | string | null;
  readonly status: string;
  readonly evidence: unknown;
  readonly correlation_id: string;
  readonly version: number;
}

export class PostgresApprovalStore implements ApprovalStore {
  constructor(private readonly pool: pg.Pool) {}

  async put(record: ApprovalRecord, expectedVersion?: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const current = await client.query(
        'select version from approval_records where approval_id = $1 for update',
        [record.approvalId],
      );
      const currentVersion = (current.rows[0] as { version: number } | undefined)?.version;
      if (expectedVersion !== undefined && currentVersion !== expectedVersion)
        throw new Error('APPROVAL_VERSION_CONFLICT');
      if (currentVersion === undefined) {
        if (record.version !== 1) throw new Error('APPROVAL_INITIAL_VERSION_INVALID');
        await client.query(insertSql, values(record));
      } else {
        if (record.version !== currentVersion + 1)
          throw new Error('APPROVAL_VERSION_SEQUENCE_INVALID');
        await client.query(updateSql, values(record));
      }
      await client.query(
        `insert into approval_record_history (approval_id, version, record)
         values ($1, $2, $3::jsonb)`,
        [record.approvalId, record.version, JSON.stringify(record)],
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async get(approvalId: string): Promise<ApprovalRecord | undefined> {
    const result = await this.pool.query(
      'select * from approval_records where approval_id = $1',
      [approvalId],
    );
    const row = result.rows[0] as ApprovalRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  async history(approvalId: string): Promise<readonly ApprovalRecord[]> {
    const result = await this.pool.query(
      `select record from approval_record_history
       where approval_id = $1 order by version asc`,
      [approvalId],
    );
    return result.rows.map((row) => (row as { record: ApprovalRecord }).record);
  }
}

const insertSql = `insert into approval_records (
  approval_id, requester, approver, route_id, capability_id, descriptor_sha256,
  target_account, scope, financial_ceiling, requested_at, issued_at, expires_at,
  consumed_at, revoked_at, status, evidence, correlation_id, version, updated_at
) values (
  $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::timestamptz,
  $11::timestamptz, $12::timestamptz, $13::timestamptz, $14::timestamptz,
  $15, $16::jsonb, $17, $18, now()
)`;

const updateSql = `update approval_records set
  requester = $2, approver = $3, route_id = $4, capability_id = $5,
  descriptor_sha256 = $6, target_account = $7, scope = $8::jsonb,
  financial_ceiling = $9::jsonb, requested_at = $10::timestamptz,
  issued_at = $11::timestamptz, expires_at = $12::timestamptz,
  consumed_at = $13::timestamptz, revoked_at = $14::timestamptz,
  status = $15, evidence = $16::jsonb, correlation_id = $17,
  version = $18, updated_at = now()
where approval_id = $1`;

function values(record: ApprovalRecord): unknown[] {
  return [
    record.approvalId,
    record.requester,
    record.approver,
    record.routeId,
    record.capabilityId,
    record.descriptorSha256,
    record.targetAccount,
    JSON.stringify(record.scope),
    record.financialCeiling ? JSON.stringify(record.financialCeiling) : null,
    record.requestedAt,
    record.issuedAt,
    record.expiresAt,
    record.consumedAt,
    record.revokedAt,
    record.status,
    JSON.stringify(record.evidence),
    record.correlationId,
    record.version,
  ];
}

function fromRow(row: ApprovalRow): ApprovalRecord {
  if (!isRouteId(row.route_id)) throw new Error('APPROVAL_ROUTE_INVALID');
  if (!isApprovalStatus(row.status)) throw new Error('APPROVAL_STATUS_INVALID');
  return {
    approvalId: row.approval_id,
    requester: row.requester,
    approver: row.approver,
    routeId: row.route_id,
    capabilityId: row.capability_id,
    descriptorSha256: row.descriptor_sha256,
    targetAccount: row.target_account,
    scope: asStringArray(row.scope),
    financialCeiling: asFinancialCeiling(row.financial_ceiling),
    requestedAt: iso(row.requested_at),
    issuedAt: row.issued_at ? iso(row.issued_at) : null,
    expiresAt: iso(row.expires_at),
    consumedAt: row.consumed_at ? iso(row.consumed_at) : null,
    revokedAt: row.revoked_at ? iso(row.revoked_at) : null,
    status: row.status,
    evidence: asStringArray(row.evidence),
    correlationId: row.correlation_id,
    version: row.version,
  };
}

function asStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new Error('APPROVAL_ARRAY_INVALID');
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') throw new Error('APPROVAL_ARRAY_INVALID');
    result.push(item);
  }
  return result;
}

function asFinancialCeiling(value: unknown): ApprovalRecord['financialCeiling'] {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') throw new Error('APPROVAL_FINANCIAL_CEILING_INVALID');
  const record = value as Record<string, unknown>;
  if (!Number.isInteger(record.amountMinor) || typeof record.currency !== 'string')
    throw new Error('APPROVAL_FINANCIAL_CEILING_INVALID');
  return { amountMinor: record.amountMinor as number, currency: record.currency };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isApprovalStatus(value: string): value is ApprovalStatus {
  return ['REQUESTED', 'APPROVED', 'CONSUMED', 'REVOKED', 'EXPIRED'].includes(value);
}
