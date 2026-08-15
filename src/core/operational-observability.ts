import type pg from 'pg';

export const OPERATIONAL_SIGNAL_TYPES = ['COUNTER', 'OBSERVATION', 'STATE'] as const;
export type OperationalSignalType = (typeof OPERATIONAL_SIGNAL_TYPES)[number];

export interface OperationalSignal {
  readonly signalId: string;
  readonly auditEventId: string | null;
  readonly executionId: string | null;
  readonly correlationId: string | null;
  readonly tenantId: string | null;
  readonly signalType: OperationalSignalType;
  readonly name: string;
  readonly value: number;
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
  readonly evidence: readonly string[];
  readonly occurredAt: string;
}

export interface OperationalSignalWriter {
  write(client: pg.PoolClient, signal: OperationalSignal): Promise<void>;
}

export interface OperationalSignalStore extends OperationalSignalWriter {
  listByExecution(executionId: string, limit?: number): Promise<readonly OperationalSignal[]>;
  listByCorrelation(correlationId: string, limit?: number): Promise<readonly OperationalSignal[]>;
}

export function validateOperationalSignal(signal: OperationalSignal): void {
  requireText(signal.signalId, 'OBSERVABILITY_SIGNAL_ID_REQUIRED');
  if (signal.auditEventId !== null)
    requireText(signal.auditEventId, 'OBSERVABILITY_AUDIT_EVENT_ID_INVALID');
  if (signal.executionId !== null)
    requireText(signal.executionId, 'OBSERVABILITY_EXECUTION_ID_INVALID');
  if (signal.correlationId !== null)
    requireText(signal.correlationId, 'OBSERVABILITY_CORRELATION_ID_INVALID');
  if (signal.tenantId !== null) requireText(signal.tenantId, 'OBSERVABILITY_TENANT_ID_INVALID');
  if (!OPERATIONAL_SIGNAL_TYPES.includes(signal.signalType))
    throw new Error('OBSERVABILITY_SIGNAL_TYPE_INVALID');
  requireText(signal.name, 'OBSERVABILITY_SIGNAL_NAME_REQUIRED');
  if (!Number.isFinite(signal.value)) throw new Error('OBSERVABILITY_SIGNAL_VALUE_INVALID');
  if (!Number.isFinite(Date.parse(signal.occurredAt)))
    throw new Error('OBSERVABILITY_OCCURRED_AT_INVALID');
  const evidence = normalizeOperationalEvidence(signal.evidence);
  if (evidence.length === 0) throw new Error('OBSERVABILITY_EVIDENCE_REQUIRED');
  assertAttributes(signal.attributes);
}

export function normalizeOperationalEvidence(evidence: readonly string[]): readonly string[] {
  return [...new Set(evidence.map((item) => item.trim()).filter(Boolean))].sort();
}

export function assertOperationalLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
    throw new Error('OBSERVABILITY_LIMIT_INVALID');
}

function assertAttributes(attributes: Readonly<Record<string, string | number | boolean>>): void {
  for (const [key, value] of Object.entries(attributes)) {
    requireText(key, 'OBSERVABILITY_ATTRIBUTE_KEY_REQUIRED');
    if (typeof value === 'number' && !Number.isFinite(value))
      throw new Error('OBSERVABILITY_ATTRIBUTE_VALUE_INVALID');
  }
}

function requireText(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}
