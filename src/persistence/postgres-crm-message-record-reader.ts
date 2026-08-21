import type pg from 'pg';
import type { CrmScope } from '../crm/crm-records.js';
import type { MessageRecord } from '../crm/sales-engine.js';

interface MessageRow {
  readonly message_id: string;
  readonly conversation_id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly contact_id: string;
  readonly lead_id: string | null;
  readonly direction: MessageRecord['direction'];
  readonly channel: MessageRecord['channel'];
  readonly language: string;
  readonly content_ref: string | null;
  readonly content_sha256: string;
  readonly provider_message_ref: string | null;
  readonly intent: string | null;
  readonly urgency: MessageRecord['urgency'];
  readonly occurred_at: Date | string;
  readonly evidence: unknown;
  readonly created_at: Date | string;
}

export interface CrmMessageRecordReader {
  getMessage(input: CrmScope & { readonly messageId: string }): Promise<MessageRecord | undefined>;
}

/**
 * Read-only projection over the canonical CRM MessageRecord table.
 *
 * This adapter intentionally owns no message state. Tenant/workspace/organization
 * are part of every lookup so an outbound binding can never resolve a message
 * from another scope.
 */
export class PostgresCrmMessageRecordReader implements CrmMessageRecordReader {
  constructor(private readonly pool: pg.Pool) {}

  async getMessage(
    input: CrmScope & { readonly messageId: string },
  ): Promise<MessageRecord | undefined> {
    validateScope(input);
    const messageId = requireText(input.messageId, 'CRM_MESSAGE_ID_REQUIRED');
    const result = await this.pool.query<MessageRow>(
      `select message_id, conversation_id, tenant_id, workspace_id, organization_id,
              contact_id, lead_id, direction, channel, language, content_ref,
              content_sha256, provider_message_ref, intent, urgency, occurred_at,
              evidence, created_at
         from crm_messages
        where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and message_id=$4
        limit 1`,
      [input.tenantId, input.workspaceId, input.organizationId, messageId],
    );
    return result.rows[0] ? messageFromRow(result.rows[0]) : undefined;
  }
}

function messageFromRow(row: MessageRow): MessageRecord {
  return {
    messageId: row.message_id,
    conversationId: row.conversation_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    contactId: row.contact_id,
    leadId: row.lead_id,
    direction: row.direction,
    channel: row.channel,
    language: row.language,
    contentRef: row.content_ref,
    contentSha256: row.content_sha256,
    providerMessageRef: row.provider_message_ref,
    intent: row.intent,
    urgency: row.urgency,
    occurredAt: iso(row.occurred_at),
    evidence: strings(row.evidence),
    createdAt: iso(row.created_at),
  };
}

function validateScope(scope: CrmScope): void {
  requireText(scope.tenantId, 'CRM_TENANT_ID_REQUIRED');
  requireText(scope.workspaceId, 'CRM_WORKSPACE_ID_REQUIRED');
  requireText(scope.organizationId, 'CRM_ORGANIZATION_ID_REQUIRED');
}

function requireText(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function strings(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function iso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('CRM_MESSAGE_TIMESTAMP_INVALID');
  return date.toISOString();
}
