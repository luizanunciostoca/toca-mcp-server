import type pg from 'pg';
import { isRouteId } from '../governance/types.js';
import type {
  CircuitBreakerState,
  ConversationRecord,
  ConversationStore,
  MessageRecord,
  OrchestratorCheckpoint,
} from './contracts.js';
import { ORCHESTRATOR_CONVERSATION_STATUSES } from './contracts.js';

interface ConversationRow {
  readonly conversation_id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly user_principal_id: string;
  readonly correlation_id: string;
  readonly status: string;
  readonly human_reason: string | null;
  readonly route_id: string | null;
  readonly primary_agent: string | null;
  readonly sop_id: string | null;
  readonly template_id: string | null;
  readonly context_summary: string;
  readonly summarized_message_count: number;
  readonly checkpoint: unknown;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly version: number;
}

interface MessageRow {
  readonly message_id: string;
  readonly conversation_id: string;
  readonly tenant_id: string;
  readonly user_principal_id: string;
  readonly role: MessageRecord['role'];
  readonly content: string;
  readonly source_content_sha256: string;
  readonly correlation_id: string;
  readonly causation_id: string | null;
  readonly idempotency_key: string;
  readonly prompt_injection_detected: boolean;
  readonly redaction_count: number;
  readonly created_at: Date | string;
}

interface CircuitRow {
  readonly tenant_id: string;
  readonly capability_id: string;
  readonly failure_count: number;
  readonly opened_until: Date | string | null;
  readonly last_failure_code: string | null;
  readonly updated_at: Date | string;
}

export class PostgresConversationStore implements ConversationStore {
  constructor(private readonly pool: pg.Pool) {}

  async createConversation(record: ConversationRecord): Promise<ConversationRecord> {
    const inserted = await this.pool.query<ConversationRow>(
      `insert into ag01_conversations (
         conversation_id, tenant_id, workspace_id, organization_id, user_principal_id,
         correlation_id, status, human_reason, route_id, primary_agent, sop_id, template_id,
         context_summary, summarized_message_count, checkpoint, created_at, updated_at, version
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
         $12, $13, $14, $15::jsonb, $16::timestamptz, $17::timestamptz, $18
       )
       on conflict (conversation_id) do nothing
       returning *`,
      [
        record.conversationId,
        record.tenantId,
        record.workspaceId,
        record.organizationId,
        record.userPrincipalId,
        record.correlationId,
        record.status,
        record.humanReason,
        record.routeId,
        record.primaryAgent,
        record.sopId,
        record.templateId,
        record.contextSummary,
        record.summarizedMessageCount,
        record.checkpoint ? json(record.checkpoint) : null,
        record.createdAt,
        record.updatedAt,
        record.version,
      ],
    );
    if (inserted.rows[0]) return mapConversation(inserted.rows[0]);
    const existing = await this.getConversation(record.tenantId, record.conversationId);
    if (!existing) throw new Error('AG01_CONVERSATION_ID_CONFLICT');
    if (
      existing.userPrincipalId !== record.userPrincipalId ||
      existing.workspaceId !== record.workspaceId ||
      existing.organizationId !== record.organizationId
    ) {
      throw new Error('AG01_CONVERSATION_IDENTITY_CONFLICT');
    }
    return existing;
  }

  async getConversation(
    tenantId: string,
    conversationId: string,
  ): Promise<ConversationRecord | undefined> {
    const result = await this.pool.query<ConversationRow>(
      `select * from ag01_conversations where tenant_id = $1 and conversation_id = $2`,
      [tenantId, conversationId],
    );
    return result.rows[0] ? mapConversation(result.rows[0]) : undefined;
  }

  async appendMessage(
    record: MessageRecord,
  ): Promise<{ readonly record: MessageRecord; readonly duplicate: boolean }> {
    const inserted = await this.pool.query<MessageRow>(
      `insert into ag01_message_records (
         message_id, conversation_id, tenant_id, user_principal_id, role, content,
         source_content_sha256, correlation_id, causation_id, idempotency_key,
         prompt_injection_detected, redaction_count, created_at
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::timestamptz
       )
       on conflict (tenant_id, idempotency_key) do nothing
       returning *`,
      [
        record.messageId,
        record.conversationId,
        record.tenantId,
        record.userPrincipalId,
        record.role,
        record.content,
        record.sourceContentSha256,
        record.correlationId,
        record.causationId,
        record.idempotencyKey,
        record.promptInjectionDetected,
        record.redactionCount,
        record.createdAt,
      ],
    );
    if (inserted.rows[0]) return { record: mapMessage(inserted.rows[0]), duplicate: false };
    const existing = await this.pool.query<MessageRow>(
      `select * from ag01_message_records where tenant_id = $1 and idempotency_key = $2`,
      [record.tenantId, record.idempotencyKey],
    );
    const row = existing.rows[0];
    if (!row) throw new Error('AG01_MESSAGE_IDEMPOTENCY_STATE_INVALID');
    const duplicate = mapMessage(row);
    if (
      duplicate.conversationId !== record.conversationId ||
      duplicate.sourceContentSha256 !== record.sourceContentSha256
    ) {
      throw new Error('AG01_MESSAGE_IDEMPOTENCY_CONFLICT');
    }
    return { record: duplicate, duplicate: true };
  }

  async listMessages(
    tenantId: string,
    conversationId: string,
    limit: number,
  ): Promise<readonly MessageRecord[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500)
      throw new Error('AG01_MESSAGE_LIMIT_INVALID');
    const result = await this.pool.query<MessageRow>(
      `select * from (
         select * from ag01_message_records
         where tenant_id = $1 and conversation_id = $2
         order by created_at desc, message_id desc
         limit $3
       ) recent
       order by created_at asc, message_id asc`,
      [tenantId, conversationId, limit],
    );
    return result.rows.map(mapMessage);
  }

  async updateConversation(
    input: Parameters<ConversationStore['updateConversation']>[0],
  ): Promise<ConversationRecord> {
    const result = await this.pool.query<ConversationRow>(
      `update ag01_conversations set
         status = $4, human_reason = $5, route_id = $6, primary_agent = $7, sop_id = $8, template_id = $9,
         context_summary = $10, summarized_message_count = $11, checkpoint = $12::jsonb,
         updated_at = $13::timestamptz, version = version + 1
       where tenant_id = $1 and conversation_id = $2 and version = $3
       returning *`,
      [
        input.tenantId,
        input.conversationId,
        input.expectedVersion,
        input.status,
        input.humanReason,
        input.routeId,
        input.primaryAgent,
        input.sopId,
        input.templateId,
        input.contextSummary,
        input.summarizedMessageCount,
        input.checkpoint ? json(input.checkpoint) : null,
        input.now,
      ],
    );
    if (!result.rows[0]) {
      const current = await this.getConversation(input.tenantId, input.conversationId);
      if (!current) throw new Error('AG01_CONVERSATION_NOT_FOUND');
      throw new Error('AG01_CONVERSATION_VERSION_CONFLICT');
    }
    return mapConversation(result.rows[0]);
  }

  async getCircuit(
    tenantId: string,
    capabilityId: string,
  ): Promise<CircuitBreakerState | undefined> {
    const result = await this.pool.query<CircuitRow>(
      `select * from ag01_runtime_circuits where tenant_id = $1 and capability_id = $2`,
      [tenantId, capabilityId],
    );
    return result.rows[0] ? mapCircuit(result.rows[0]) : undefined;
  }

  async recordCircuitFailure(
    input: Parameters<ConversationStore['recordCircuitFailure']>[0],
  ): Promise<CircuitBreakerState> {
    const result = await this.pool.query<CircuitRow>(
      `insert into ag01_runtime_circuits (
         tenant_id, capability_id, failure_count, opened_until, last_failure_code, updated_at
       ) values ($1, $2, 1, case when $4 <= 1 then $5::timestamptz else null end, $3, $6::timestamptz)
       on conflict (tenant_id, capability_id) do update set
         failure_count = ag01_runtime_circuits.failure_count + 1,
         opened_until = case
           when ag01_runtime_circuits.failure_count + 1 >= $4 then $5::timestamptz
           else ag01_runtime_circuits.opened_until
         end,
         last_failure_code = $3,
         updated_at = $6::timestamptz
       returning *`,
      [
        input.tenantId,
        input.capabilityId,
        input.errorCode,
        input.threshold,
        input.openedUntil,
        input.now,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('AG01_CIRCUIT_UPDATE_FAILED');
    return mapCircuit(row);
  }

  async resetCircuit(tenantId: string, capabilityId: string, now: string): Promise<void> {
    await this.pool.query(
      `update ag01_runtime_circuits set
         failure_count = 0, opened_until = null, last_failure_code = null, updated_at = $3::timestamptz
       where tenant_id = $1 and capability_id = $2`,
      [tenantId, capabilityId, now],
    );
  }
}

function mapConversation(row: ConversationRow): ConversationRecord {
  if (!ORCHESTRATOR_CONVERSATION_STATUSES.includes(row.status as ConversationRecord['status']))
    throw new Error(`AG01_CONVERSATION_STATUS_INVALID:${row.status}`);
  const routeId = row.route_id;
  if (routeId !== null && !isRouteId(routeId)) throw new Error(`AG01_ROUTE_INVALID:${routeId}`);
  return {
    conversationId: row.conversation_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    userPrincipalId: row.user_principal_id,
    correlationId: row.correlation_id,
    status: row.status as ConversationRecord['status'],
    humanReason: row.human_reason,
    routeId,
    primaryAgent: row.primary_agent,
    sopId: row.sop_id,
    templateId: row.template_id,
    contextSummary: row.context_summary,
    summarizedMessageCount: row.summarized_message_count,
    checkpoint: (row.checkpoint as OrchestratorCheckpoint | null) ?? null,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    version: row.version,
  };
}

function mapMessage(row: MessageRow): MessageRecord {
  return {
    messageId: row.message_id,
    conversationId: row.conversation_id,
    tenantId: row.tenant_id,
    userPrincipalId: row.user_principal_id,
    role: row.role,
    content: row.content,
    sourceContentSha256: row.source_content_sha256,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    idempotencyKey: row.idempotency_key,
    promptInjectionDetected: row.prompt_injection_detected,
    redactionCount: row.redaction_count,
    createdAt: timestamp(row.created_at),
  };
}

function mapCircuit(row: CircuitRow): CircuitBreakerState {
  return {
    tenantId: row.tenant_id,
    capabilityId: row.capability_id,
    failureCount: row.failure_count,
    openedUntil: row.opened_until ? timestamp(row.opened_until) : null,
    lastFailureCode: row.last_failure_code,
    updatedAt: timestamp(row.updated_at),
  };
}

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
