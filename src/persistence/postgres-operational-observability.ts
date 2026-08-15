import type pg from 'pg';
import {
  assertOperationalLimit,
  normalizeOperationalEvidence,
  validateOperationalSignal,
  type OperationalSignal,
  type OperationalSignalStore,
} from '../core/operational-observability.js';

interface OperationalSignalRow {
  readonly signal_id: string;
  readonly audit_event_id: string | null;
  readonly execution_id: string | null;
  readonly correlation_id: string | null;
  readonly tenant_id: string | null;
  readonly signal_type: OperationalSignal['signalType'];
  readonly name: string;
  readonly value: number;
  readonly attributes: unknown;
  readonly evidence: unknown;
  readonly occurred_at: Date | string;
}

export class PostgresOperationalObservabilityStore implements OperationalSignalStore {
  constructor(private readonly pool: pg.Pool) {}

  async write(client: pg.PoolClient, signal: OperationalSignal): Promise<void> {
    validateOperationalSignal(signal);
    await client.query(
      `insert into operational_signals (
         signal_id, audit_event_id, execution_id, correlation_id, tenant_id,
         signal_type, name, value, attributes, evidence, occurred_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::timestamptz)`,
      [
        signal.signalId,
        signal.auditEventId,
        signal.executionId,
        signal.correlationId,
        signal.tenantId,
        signal.signalType,
        signal.name,
        signal.value,
        JSON.stringify(signal.attributes),
        JSON.stringify(normalizeOperationalEvidence(signal.evidence)),
        signal.occurredAt,
      ],
    );
  }

  async listByExecution(executionId: string, limit = 200): Promise<readonly OperationalSignal[]> {
    requireText(executionId, 'OBSERVABILITY_EXECUTION_ID_REQUIRED');
    assertOperationalLimit(limit);
    const result = await this.pool.query<OperationalSignalRow>(
      `select * from operational_signals
       where execution_id = $1
       order by occurred_at asc, signal_id asc
       limit $2`,
      [executionId, limit],
    );
    return result.rows.map(signalFromRow);
  }

  async listByCorrelation(
    correlationId: string,
    limit = 500,
  ): Promise<readonly OperationalSignal[]> {
    requireText(correlationId, 'OBSERVABILITY_CORRELATION_ID_REQUIRED');
    assertOperationalLimit(limit);
    const result = await this.pool.query<OperationalSignalRow>(
      `select * from operational_signals
       where correlation_id = $1
       order by occurred_at asc, signal_id asc
       limit $2`,
      [correlationId, limit],
    );
    return result.rows.map(signalFromRow);
  }
}

function signalFromRow(row: OperationalSignalRow): OperationalSignal {
  return {
    signalId: row.signal_id,
    auditEventId: row.audit_event_id,
    executionId: row.execution_id,
    correlationId: row.correlation_id,
    tenantId: row.tenant_id,
    signalType: row.signal_type,
    name: row.name,
    value: row.value,
    attributes: asAttributes(row.attributes),
    evidence: asStringArray(row.evidence),
    occurredAt: iso(row.occurred_at),
  };
}

function asAttributes(value: unknown): Readonly<Record<string, string | number | boolean>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string | number | boolean] =>
        ['string', 'number', 'boolean'].includes(typeof entry[1]),
    ),
  );
}

function asStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function requireText(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}
