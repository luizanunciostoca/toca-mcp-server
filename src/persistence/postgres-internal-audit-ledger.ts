import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { AuditEvent } from '../core/audit.js';
import {
  AUDIT_GENESIS_HASH,
  canonicalAuditPayload,
  hashAuditPayload,
  normalizeAuditEvidence,
} from '../core/audit-ledger.js';
import type { RiskClass } from '../core/tool-registry.js';

interface AuditLedgerHeadRow {
  readonly correlation_id: string;
  readonly tenant_id: string | null;
  readonly last_sequence: number;
  readonly head_hash: string;
}

export type InternalAuditRecordType =
  | 'CONTACT'
  | 'LEAD'
  | 'OPPORTUNITY'
  | 'OBSERVATION'
  | 'EXPERIMENT'
  | 'OUTCOME'
  | 'DECISION'
  | 'RECOMMENDATION';

export interface InternalAuditLedgerInput {
  readonly namespace?: 'crm' | 'learning';
  readonly operation: string;
  readonly recordType: InternalAuditRecordType;
  readonly recordId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly executionId: string;
  readonly correlationId: string;
  readonly actorPrincipalId: string;
  readonly evidence: readonly string[];
  readonly createdAt: string;
}

/**
 * Appends a successful internal core mutation to the existing hash-chained Audit Ledger.
 * It deliberately does not register an MCP tool or a capability: the operation name is
 * audit metadata only. The caller owns the surrounding PostgreSQL transaction so the
 * business mutation, revision, outbox event and audit evidence commit atomically.
 */
export async function appendInternalAuditLedgerEvent(
  client: pg.PoolClient,
  input: InternalAuditLedgerInput,
): Promise<void> {
  const namespace = input.namespace ?? 'crm';
  const errorPrefix = namespace === 'crm' ? 'CRM' : 'R31';
  const toolName = `core.${namespace}.${requireText(input.operation, `${errorPrefix}_AUDIT_OPERATION_REQUIRED`)}`;
  const evidence = normalizeAuditEvidence({
    executionId: input.executionId,
    correlationId: input.correlationId,
    toolName,
    requester: input.actorPrincipalId,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    organizationId: input.organizationId,
    status: 'SUCCEEDED',
    externalResourceId: input.recordId,
    evidence: input.evidence,
    createdAt: input.createdAt,
  });
  const event: AuditEvent = {
    executionId: requireText(input.executionId, `${errorPrefix}_EXECUTION_ID_REQUIRED`),
    correlationId: requireText(input.correlationId, `${errorPrefix}_CORRELATION_ID_REQUIRED`),
    toolName,
    requester: requireText(input.actorPrincipalId, `${errorPrefix}_ACTOR_PRINCIPAL_ID_REQUIRED`),
    tenantId: requireText(input.tenantId, `${errorPrefix}_TENANT_ID_REQUIRED`),
    workspaceId: requireText(input.workspaceId, `${errorPrefix}_WORKSPACE_ID_REQUIRED`),
    organizationId: requireText(input.organizationId, `${errorPrefix}_ORGANIZATION_ID_REQUIRED`),
    status: 'SUCCEEDED',
    externalResourceId: requireText(input.recordId, `${errorPrefix}_AUDIT_RECORD_ID_REQUIRED`),
    evidence,
    createdAt: input.createdAt,
  };
  const riskClass: RiskClass = 'WRITE_REVERSIBLE';

  await client.query('select pg_advisory_xact_lock(hashtext($1))', [event.executionId]);
  const headResult = await client.query<AuditLedgerHeadRow>(
    'select correlation_id, tenant_id, last_sequence, head_hash from audit_ledger_heads where execution_id = $1 for update',
    [event.executionId],
  );
  const head = headResult.rows[0];
  if (head && head.correlation_id !== event.correlationId) {
    throw new Error('AUDIT_CORRELATION_ID_CONFLICT');
  }
  if (head && head.tenant_id !== event.tenantId) {
    throw new Error('AUDIT_TENANT_ID_CONFLICT');
  }

  const sequence = (head?.last_sequence ?? 0) + 1;
  const previousHash = head?.head_hash ?? AUDIT_GENESIS_HASH;
  const canonicalPayload = canonicalAuditPayload(event, riskClass, sequence, previousHash);
  const eventHash = hashAuditPayload(canonicalPayload);
  const eventId = randomUUID();

  await client.query(
    `insert into audit_ledger_events (
       event_id, execution_id, correlation_id, sequence, previous_hash, event_hash,
       actor_id, principal_type, tenant_id, workspace_id, organization_id, session_id,
       authentication_method, authorization_roles, tool_name, risk_class, status,
       approval_id, connected_account, external_resource_id, error_code, evidence,
       canonical_payload, created_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, null, $8, $9, $10, null, null,
       '[]'::jsonb, $11, $12, $13, null, null, $14, null, $15::jsonb,
       $16::jsonb, $17::timestamptz
     )`,
    [
      eventId,
      event.executionId,
      event.correlationId,
      sequence,
      previousHash,
      eventHash,
      event.requester,
      event.tenantId,
      event.workspaceId,
      event.organizationId,
      event.toolName,
      riskClass,
      event.status,
      event.externalResourceId,
      JSON.stringify(evidence),
      JSON.stringify(canonicalPayload),
      event.createdAt,
    ],
  );

  if (head) {
    const updated = await client.query(
      `update audit_ledger_heads set
         last_sequence = $2, head_hash = $3, updated_at = $4::timestamptz
       where execution_id = $1 and last_sequence = $5 and head_hash = $6`,
      [event.executionId, sequence, eventHash, event.createdAt, head.last_sequence, head.head_hash],
    );
    if (updated.rowCount !== 1) throw new Error('AUDIT_LEDGER_HEAD_CONCURRENT_UPDATE');
  } else {
    await client.query(
      `insert into audit_ledger_heads (
         execution_id, correlation_id, tenant_id, last_sequence, head_hash, updated_at
       ) values ($1, $2, $3, $4, $5, $6::timestamptz)`,
      [
        event.executionId,
        event.correlationId,
        event.tenantId,
        sequence,
        eventHash,
        event.createdAt,
      ],
    );
  }

  await client.query(
    `insert into audit_events
       (correlation_id, actor_id, tool_name, risk_class, decision, normalized_payload, provider_result)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
    [
      event.correlationId,
      event.requester,
      event.toolName,
      riskClass,
      event.status,
      JSON.stringify({
        executionId: event.executionId,
        ledgerEventId: eventId,
        ledgerSequence: sequence,
        ledgerHash: eventHash,
        tenantId: event.tenantId,
        workspaceId: event.workspaceId,
        organizationId: event.organizationId,
        recordType: input.recordType,
        recordId: input.recordId,
        evidence,
        createdAt: event.createdAt,
      }),
      JSON.stringify({ externalResourceId: input.recordId, errorCode: null }),
    ],
  );
}

function requireText(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}
