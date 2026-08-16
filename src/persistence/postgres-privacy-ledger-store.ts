import type pg from 'pg';
import {
  PRIVACY_CAPABILITY_IDS,
  PRIVACY_LEDGER_EVENT_TYPES,
  type PrivacyCapabilityId,
  type PrivacyLedgerEvent,
  type PrivacyLedgerEventType,
  type PrivacyLedgerStore,
  type PrivacyScope,
} from '../privacy/contracts.js';

interface PrivacyLedgerRow {
  readonly ledger_sequence: string | number;
  readonly event_id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
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
      await insertEvent(this.pool, event);
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error('PRIVACY_EVENT_DUPLICATE');
      throw error;
    }
  }

  async appendConsentTransition(
    event: PrivacyLedgerEvent,
    expectedHeadEventId: string | null,
  ): Promise<void> {
    validateEvent(event);
    if (event.eventType !== 'CONSENT_RECORDED' && event.eventType !== 'CONSENT_REVOKED')
      throw new Error('PRIVACY_CONSENT_TRANSITION_EVENT_INVALID');

    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const lockKey = [
        event.tenantId,
        event.workspaceId,
        event.organizationId,
        event.subjectRef,
        event.purposeId ?? '',
        event.channel ?? '',
      ].join('|');
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [lockKey]);
      const current = await client.query<Pick<PrivacyLedgerRow, 'event_id'>>(
        `select event_id
           from privacy_ledger_events
          where tenant_id = $1
            and workspace_id = $2
            and organization_id = $3
            and subject_ref = $4
            and purpose_id = $5
            and channel = $6
            and event_type in ('CONSENT_RECORDED', 'CONSENT_REVOKED')
          order by ledger_sequence desc
          limit 1`,
        [
          event.tenantId,
          event.workspaceId,
          event.organizationId,
          event.subjectRef,
          event.purposeId,
          event.channel,
        ],
      );
      const currentHeadEventId = current.rows[0]?.event_id ?? null;
      if (currentHeadEventId !== expectedHeadEventId)
        throw new Error('PRIVACY_CONSENT_CONCURRENT_UPDATE');

      await insertEvent(client, event);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      if (isUniqueViolation(error)) throw new Error('PRIVACY_EVENT_DUPLICATE');
      throw error;
    } finally {
      client.release();
    }
  }

  async findByExecution(
    scope: PrivacyScope,
    executionId: string,
    capabilityId: PrivacyCapabilityId,
  ): Promise<PrivacyLedgerEvent | undefined> {
    validateScope(scope);
    const result = await this.pool.query<PrivacyLedgerRow>(
      `select *
         from privacy_ledger_events
        where tenant_id = $1
          and workspace_id = $2
          and organization_id = $3
          and execution_id = $4
          and capability_id = $5
        order by ledger_sequence asc
        limit 1`,
      [
        scope.tenantId,
        scope.workspaceId,
        scope.organizationId,
        requireText(executionId, 'PRIVACY_EXECUTION_ID_REQUIRED'),
        capabilityId,
      ],
    );
    return result.rows[0] ? eventFromRow(result.rows[0]) : undefined;
  }

  async listForSubject(
    scope: PrivacyScope,
    subjectRef: string,
  ): Promise<readonly PrivacyLedgerEvent[]> {
    validateScope(scope);
    const result = await this.pool.query<PrivacyLedgerRow>(
      `select *
         from privacy_ledger_events
        where tenant_id = $1
          and workspace_id = $2
          and organization_id = $3
          and subject_ref = $4
        order by ledger_sequence asc`,
      [
        scope.tenantId,
        scope.workspaceId,
        scope.organizationId,
        requireText(subjectRef, 'PRIVACY_SUBJECT_REQUIRED'),
      ],
    );
    return result.rows.map(eventFromRow);
  }

  async listForRequest(
    scope: PrivacyScope,
    requestId: string,
  ): Promise<readonly PrivacyLedgerEvent[]> {
    validateScope(scope);
    const result = await this.pool.query<PrivacyLedgerRow>(
      `select *
         from privacy_ledger_events
        where tenant_id = $1
          and workspace_id = $2
          and organization_id = $3
          and request_id = $4::uuid
        order by ledger_sequence asc`,
      [
        scope.tenantId,
        scope.workspaceId,
        scope.organizationId,
        requireText(requestId, 'PRIVACY_REQUEST_ID_REQUIRED'),
      ],
    );
    return result.rows.map(eventFromRow);
  }
}

async function insertEvent(
  queryable: Pick<pg.Pool, 'query'> | Pick<pg.PoolClient, 'query'>,
  event: PrivacyLedgerEvent,
): Promise<void> {
  await queryable.query(
    `insert into privacy_ledger_events (
       event_id, tenant_id, workspace_id, organization_id, subject_ref, request_id,
       purpose_id, channel, policy_ref, approval_id, capability_id, event_type,
       requester, execution_id, correlation_id, occurred_at, evidence, payload
     ) values (
       $1::uuid, $2, $3, $4, $5, $6::uuid, $7, $8, $9, $10::uuid, $11, $12,
       $13, $14, $15, $16::timestamptz, $17::jsonb, $18::jsonb
     )`,
    [
      event.eventId,
      event.tenantId,
      event.workspaceId,
      event.organizationId,
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
}

function eventFromRow(row: PrivacyLedgerRow): PrivacyLedgerEvent {
  if (!isCapabilityId(row.capability_id)) throw new Error('PRIVACY_CAPABILITY_ID_INVALID');
  if (!isEventType(row.event_type)) throw new Error('PRIVACY_EVENT_TYPE_INVALID');
  return {
    eventId: row.event_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
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
  validateScope(event);
  assertOpaqueRef(event.subjectRef, 'PRIVACY_SUBJECT_REF_NOT_OPAQUE');
  assertOpaqueRef(event.requester, 'PRIVACY_REQUESTER_REF_INVALID');
  requireText(event.executionId, 'PRIVACY_EXECUTION_ID_REQUIRED');
  requireText(event.correlationId, 'PRIVACY_CORRELATION_ID_REQUIRED');
  if (!isCapabilityId(event.capabilityId)) throw new Error('PRIVACY_CAPABILITY_ID_INVALID');
  if (!isEventType(event.eventType)) throw new Error('PRIVACY_EVENT_TYPE_INVALID');
  if (event.evidence.length === 0) throw new Error('PRIVACY_EVENT_EVIDENCE_REQUIRED');
  assertNoRawPii(event.evidence, 'PRIVACY_RAW_PII_EVIDENCE_REJECTED');
  assertNoRawPii(event.payload, 'PRIVACY_RAW_PII_PAYLOAD_REJECTED');
  if (!Number.isFinite(Date.parse(event.occurredAt)))
    throw new Error('PRIVACY_EVENT_TIMESTAMP_INVALID');
}

function validateScope(scope: PrivacyScope): void {
  requireText(scope.tenantId, 'PRIVACY_TENANT_REQUIRED');
  requireText(scope.workspaceId, 'PRIVACY_WORKSPACE_REQUIRED');
  requireText(scope.organizationId, 'PRIVACY_ORGANIZATION_REQUIRED');
}

function isCapabilityId(value: string): value is PrivacyCapabilityId {
  return (PRIVACY_CAPABILITY_IDS as readonly string[]).includes(value);
}

function isEventType(value: string): value is PrivacyLedgerEventType {
  return (PRIVACY_LEDGER_EVENT_TYPES as readonly string[]).includes(value);
}

function parseEvidence(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new Error('PRIVACY_EVENT_EVIDENCE_INVALID');
  const evidence = value.filter((item): item is string => typeof item === 'string');
  if (evidence.length !== value.length) throw new Error('PRIVACY_EVENT_EVIDENCE_INVALID');
  return [...new Set(evidence)].sort();
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

function assertOpaqueRef(value: string, errorCode: string): void {
  const normalized = requireText(value, errorCode);
  if (normalized.length > 256 || /\s/.test(normalized)) throw new Error(errorCode);
  assertNoRawPii(normalized, errorCode);
}

function assertNoRawPii(value: unknown, errorCode: string): void {
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(normalized)) throw new Error(errorCode);
    if (/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/.test(normalized)) throw new Error(errorCode);
    if (/(?:\+?\d[\d\s().-]{7,}\d)/.test(normalized)) throw new Error(errorCode);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertNoRawPii(item, errorCode);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      assertNoRawPii(item, errorCode);
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505');
}
