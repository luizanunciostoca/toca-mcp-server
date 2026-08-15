import type pg from 'pg';
import {
  PRIVACY_CAPABILITY_IDS,
  PRIVACY_LEDGER_EVENT_TYPES,
  type PrivacyCapabilityId,
  type PrivacyLedgerEvent,
  type PrivacyLedgerEventType,
  type PrivacyLedgerStore,
} from '../privacy/contracts.js';

interface PrivacyLedgerRow {
  readonly event_id: string;
  readonly tenant_id: string;
  readonly subject_ref: string;
  readonly request_id: string | null;
  readonly purpose_id: string | null;
  readonly channel: string | null;
  readonly policy_ref: string | null;
  readonly approval_id: string | null;
  readonly capability_id: string;
  readonly event_type: string;
  readonly requester: string;
  readonly execution_id: string;
  readonly correlation_id: string;
  readonly occurred_at: Date | string;
  readonly evidence: unknown;
  readonly payload: unknown;
}

export class PostgresPrivacyLedgerStore implements PrivacyLedgerStore {
  constructor(private readonly pool: pg.Pool) {}

  async append(event: PrivacyLedgerEvent): Promise<void> {
    validateEvent(event);
    try {
      await this.pool.query(
        `insert into privacy_ledger_events (
          event_id, tenant_id, subject_ref, request_id, purpose_id, channel, policy_ref,
          approval_id, capability_id, event_type, requester, execution_id, correlation_id,
          occurred_at, evidence, payload
        ) values (
          $1::uuid, $2, $3, $4::uuid, $5, $6, $7, $8::uuid, $9, $10, $11, $12, $13,
          $14::timestamptz, $15::jsonb, $16::jsonb
        )`,
        [
          event.eventId,
          event.tenantId,
          event.subjectRef,
          event.requestId,
          event.purposeId,
          event.channel,
          event.policyRef,
          event.approvalId,
          event.capabilityId,
          event.eventType,
          event.requester,
          event.executionId,
          event.correlationId,
          event.occurredAt,
          JSON.stringify(event.evidence),
          JSON.stringify(event.payload),
        ],
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error('PRIVACY_EVENT_DUPLICATE');
      throw error;
    }
  }

  async listForSubject(
    tenantId: string,
    subjectRef: string,
  ): Promise<readonly PrivacyLedgerEvent[]> {
    const result = await this.pool.query<PrivacyLedgerRow>(
      `select * from privacy_ledger_events
       where tenant_id = $1 and subject_ref = $2
       order by occurred_at asc, event_id asc`,
      [
        requireText(tenantId, 'PRIVACY_TENANT_REQUIRED'),
        requireText(subjectRef, 'PRIVACY_SUBJECT_REQUIRED'),
      ],
    );
    return result.rows.map(eventFromRow);
  }

  async listForRequest(
    tenantId: string,
    requestId: string,
  ): Promise<readonly PrivacyLedgerEvent[]> {
    const result = await this.pool.query<PrivacyLedgerRow>(
      `select * from privacy_ledger_events
       where tenant_id = $1 and request_id = $2::uuid
       order by occurred_at asc, event_id asc`,
      [
        requireText(tenantId, 'PRIVACY_TENANT_REQUIRED'),
        requireText(requestId, 'PRIVACY_REQUEST_ID_REQUIRED'),
      ],
    );
    return result.rows.map(eventFromRow);
  }
}

function eventFromRow(row: PrivacyLedgerRow): PrivacyLedgerEvent {
  if (!isCapabilityId(row.capability_id)) throw new Error('PRIVACY_CAPABILITY_ID_INVALID');
  if (!isEventType(row.event_type)) throw new Error('PRIVACY_EVENT_TYPE_INVALID');
  return {
    eventId: row.event_id,
    tenantId: row.tenant_id,
    subjectRef: row.subject_ref,
    requestId: row.request_id,
    purposeId: row.purpose_id,
    channel: row.channel,
    policyRef: row.policy_ref,
    approvalId: row.approval_id,
    capabilityId: row.capability_id,
    eventType: row.event_type,
    requester: row.requester,
    executionId: row.execution_id,
    correlationId: row.correlation_id,
    occurredAt: normalizeTimestamp(row.occurred_at),
    evidence: parseEvidence(row.evidence),
    payload: parsePayload(row.payload),
  };
}

function validateEvent(event: PrivacyLedgerEvent): void {
  requireText(event.eventId, 'PRIVACY_EVENT_ID_REQUIRED');
  requireText(event.tenantId, 'PRIVACY_TENANT_REQUIRED');
  requireText(event.subjectRef, 'PRIVACY_SUBJECT_REQUIRED');
  requireText(event.requester, 'PRIVACY_REQUESTER_REQUIRED');
  requireText(event.executionId, 'PRIVACY_EXECUTION_ID_REQUIRED');
  requireText(event.correlationId, 'PRIVACY_CORRELATION_ID_REQUIRED');
  if (!isCapabilityId(event.capabilityId)) throw new Error('PRIVACY_CAPABILITY_ID_INVALID');
  if (!isEventType(event.eventType)) throw new Error('PRIVACY_EVENT_TYPE_INVALID');
  if (event.evidence.length === 0) throw new Error('PRIVACY_EVENT_EVIDENCE_REQUIRED');
  if (!Number.isFinite(Date.parse(event.occurredAt)))
    throw new Error('PRIVACY_EVENT_TIMESTAMP_INVALID');
}

function isCapabilityId(value: string): value is PrivacyCapabilityId {
  return (PRIVACY_CAPABILITY_IDS as readonly string[]).includes(value);
}

function isEventType(value: string): value is PrivacyLedgerEventType {
  return (PRIVACY_LEDGER_EVENT_TYPES as readonly string[]).includes(value);
}

function parseEvidence(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
    throw new Error('PRIVACY_EVENT_EVIDENCE_INVALID');
  return [...new Set(value)].sort();
}

function parsePayload(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('PRIVACY_EVENT_PAYLOAD_INVALID');
  return value as Readonly<Record<string, unknown>>;
}

function normalizeTimestamp(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('PRIVACY_EVENT_TIMESTAMP_INVALID');
  return date.toISOString();
}

function requireText(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505');
}
