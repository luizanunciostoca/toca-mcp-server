import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { AuditEvent, AuditSink } from '../core/audit.js';
import {
  AUDIT_GENESIS_HASH,
  canonicalAuditPayload,
  hashAuditPayload,
  normalizeAuditEvidence,
  verifyAuditLedger,
  type AuditLedgerHead,
  type AuditLedgerRecord,
  type AuditLedgerVerification,
} from '../core/audit-ledger.js';
import type { OperationalSignalWriter } from '../core/operational-observability.js';
import type { RiskClass, ToolRegistry } from '../core/tool-registry.js';
import { PostgresOperationalObservabilityStore } from './postgres-operational-observability.js';

interface AuditLedgerEventRow {
  readonly event_id: string;
  readonly execution_id: string;
  readonly correlation_id: string;
  readonly sequence: number;
  readonly previous_hash: string;
  readonly event_hash: string;
  readonly actor_id: string;
  readonly principal_type: AuditEvent['principalType'] | null;
  readonly tenant_id: string | null;
  readonly workspace_id: string | null;
  readonly organization_id: string | null;
  readonly session_id: string | null;
  readonly authentication_method: AuditEvent['authenticationMethod'] | null;
  readonly authorization_roles: unknown;
  readonly tool_name: string;
  readonly risk_class: RiskClass;
  readonly status: AuditEvent['status'];
  readonly approval_id: string | null;
  readonly connected_account: string | null;
  readonly external_resource_id: string | null;
  readonly error_code: string | null;
  readonly evidence: unknown;
  readonly canonical_payload: unknown;
  readonly created_at: Date | string;
}

interface AuditLedgerHeadRow {
  readonly execution_id: string;
  readonly correlation_id: string;
  readonly tenant_id: string | null;
  readonly last_sequence: number;
  readonly head_hash: string;
  readonly updated_at: Date | string;
}

export interface PostgresAuditSinkOptions {
  readonly createId?: () => string;
  readonly signals?: OperationalSignalWriter;
}

export class PostgresAuditSink implements AuditSink {
  readonly #createId: () => string;
  readonly #signals: OperationalSignalWriter;

  constructor(
    private readonly pool: pg.Pool,
    private readonly registry: ToolRegistry,
    options: PostgresAuditSinkOptions = {},
  ) {
    this.#createId = options.createId ?? randomUUID;
    this.#signals = options.signals ?? new PostgresOperationalObservabilityStore(pool);
  }

  async write(event: AuditEvent): Promise<void> {
    const definition = this.registry.get(event.toolName);
    if (!definition) throw new Error(`AUDIT_TOOL_DEFINITION_NOT_FOUND:${event.toolName}`);
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [event.executionId]);
      const headResult = await client.query<AuditLedgerHeadRow>(
        'select * from audit_ledger_heads where execution_id = $1 for update',
        [event.executionId],
      );
      const head = headResult.rows[0];
      if (head && head.correlation_id !== event.correlationId)
        throw new Error('AUDIT_CORRELATION_ID_CONFLICT');
      if (head && head.tenant_id !== (event.tenantId ?? null))
        throw new Error('AUDIT_TENANT_ID_CONFLICT');

      const sequence = (head?.last_sequence ?? 0) + 1;
      const previousHash = head?.head_hash ?? AUDIT_GENESIS_HASH;
      const canonicalPayload = canonicalAuditPayload(
        event,
        definition.riskClass,
        sequence,
        previousHash,
      );
      const eventHash = hashAuditPayload(canonicalPayload);
      const evidence = normalizeAuditEvidence(event);
      const eventId = this.#createId();

      await client.query(
        `insert into audit_ledger_events (
           event_id, execution_id, correlation_id, sequence, previous_hash, event_hash,
           actor_id, principal_type, tenant_id, workspace_id, organization_id, session_id,
           authentication_method, authorization_roles, tool_name, risk_class, status,
           approval_id, connected_account, external_resource_id, error_code, evidence,
           canonical_payload, created_at
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
           $14::jsonb, $15, $16, $17, $18, $19, $20, $21, $22::jsonb,
           $23::jsonb, $24::timestamptz
         )`,
        [
          eventId,
          event.executionId,
          event.correlationId,
          sequence,
          previousHash,
          eventHash,
          event.requester,
          event.principalType ?? null,
          event.tenantId ?? null,
          event.workspaceId ?? null,
          event.organizationId ?? null,
          event.sessionId ?? null,
          event.authenticationMethod ?? null,
          JSON.stringify([...new Set(event.authorizationRoles ?? [])].sort()),
          event.toolName,
          definition.riskClass,
          event.status,
          event.approvalId ?? null,
          event.connectedAccount ?? null,
          event.externalResourceId ?? null,
          event.errorCode ?? null,
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
          [
            event.executionId,
            sequence,
            eventHash,
            event.createdAt,
            head.last_sequence,
            head.head_hash,
          ],
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
            event.tenantId ?? null,
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
          definition.riskClass,
          event.status,
          JSON.stringify({
            executionId: event.executionId,
            ledgerEventId: eventId,
            ledgerSequence: sequence,
            ledgerHash: eventHash,
            approvalId: event.approvalId ?? null,
            connectedAccount: event.connectedAccount ?? null,
            principalType: event.principalType ?? null,
            tenantId: event.tenantId ?? null,
            workspaceId: event.workspaceId ?? null,
            organizationId: event.organizationId ?? null,
            sessionId: event.sessionId ?? null,
            authenticationMethod: event.authenticationMethod ?? null,
            authorizationRoles: event.authorizationRoles ?? [],
            evidence,
            createdAt: event.createdAt,
          }),
          JSON.stringify({
            externalResourceId: event.externalResourceId ?? null,
            errorCode: event.errorCode ?? null,
          }),
        ],
      );

      await this.#signals.write(client, {
        signalId: this.#createId(),
        auditEventId: eventId,
        executionId: event.executionId,
        correlationId: event.correlationId,
        tenantId: event.tenantId ?? null,
        signalType: 'STATE',
        name: `execution.${event.status.toLowerCase()}`,
        value: 1,
        attributes: {
          toolName: event.toolName,
          riskClass: definition.riskClass,
          status: event.status,
        },
        evidence: [...evidence, `audit-ledger:${eventId}`],
        occurredAt: event.createdAt,
      });

      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async verifyExecution(executionId: string): Promise<AuditLedgerVerification> {
    if (!executionId.trim()) throw new Error('AUDIT_EXECUTION_ID_REQUIRED');
    const client = await this.pool.connect();
    try {
      await client.query('begin isolation level repeatable read read only');
      const [events, head] = await Promise.all([
        client.query<AuditLedgerEventRow>(
          `select * from audit_ledger_events
           where execution_id = $1 order by sequence asc`,
          [executionId],
        ),
        client.query<AuditLedgerHeadRow>(
          'select * from audit_ledger_heads where execution_id = $1',
          [executionId],
        ),
      ]);
      await client.query('commit');
      return verifyAuditLedger(
        executionId,
        events.rows.map(auditRecordFromRow),
        head.rows[0] ? auditHeadFromRow(head.rows[0]) : undefined,
      );
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async listByCorrelation(
    correlationId: string,
    limit = 500,
  ): Promise<readonly AuditLedgerRecord[]> {
    if (!correlationId.trim()) throw new Error('AUDIT_CORRELATION_ID_REQUIRED');
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
      throw new Error('AUDIT_LIMIT_INVALID');
    const result = await this.pool.query<AuditLedgerEventRow>(
      `select * from audit_ledger_events
       where correlation_id = $1
       order by created_at asc, execution_id asc, sequence asc
       limit $2`,
      [correlationId, limit],
    );
    return result.rows.map(auditRecordFromRow);
  }
}

function auditRecordFromRow(row: AuditLedgerEventRow): AuditLedgerRecord {
  return {
    eventId: row.event_id,
    executionId: row.execution_id,
    correlationId: row.correlation_id,
    sequence: row.sequence,
    previousHash: row.previous_hash,
    eventHash: row.event_hash,
    requester: row.actor_id,
    ...(row.principal_type ? { principalType: row.principal_type } : {}),
    ...(row.tenant_id ? { tenantId: row.tenant_id } : {}),
    ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}),
    ...(row.organization_id ? { organizationId: row.organization_id } : {}),
    ...(row.session_id ? { sessionId: row.session_id } : {}),
    ...(row.authentication_method ? { authenticationMethod: row.authentication_method } : {}),
    authorizationRoles: asRoles(row.authorization_roles),
    toolName: row.tool_name,
    riskClass: row.risk_class,
    status: row.status,
    ...(row.approval_id ? { approvalId: row.approval_id } : {}),
    ...(row.connected_account ? { connectedAccount: row.connected_account } : {}),
    ...(row.external_resource_id ? { externalResourceId: row.external_resource_id } : {}),
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    evidence: asStringArray(row.evidence),
    canonicalPayload: asObject(row.canonical_payload),
    createdAt: iso(row.created_at),
  };
}

function auditHeadFromRow(row: AuditLedgerHeadRow): AuditLedgerHead {
  return {
    executionId: row.execution_id,
    correlationId: row.correlation_id,
    tenantId: row.tenant_id,
    lastSequence: row.last_sequence,
    headHash: row.head_hash,
    updatedAt: iso(row.updated_at),
  };
}

function asRoles(value: unknown): NonNullable<AuditEvent['authorizationRoles']> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is NonNullable<AuditEvent['authorizationRoles']>[number] =>
      typeof item === 'string',
  );
}

function asStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function asObject(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
