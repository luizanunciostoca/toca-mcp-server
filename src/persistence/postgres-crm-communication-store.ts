import type pg from 'pg';
import {
  assertCommunicationTimestamp,
  requireCommunicationEvidence,
  requireCommunicationText,
  validateCommunicationScope,
  validateConversationRecord,
  validateMessageRecord,
  type CommunicationThrottleDecision,
  type ConsumeCommunicationThrottleInput,
  type ConversationRecord,
  type CrmCommunicationStore,
  type MarkHumanHandoffInput,
  type MessageDeliveryEventRecord,
  type MessageRecord,
  type RecordCommunicationMessageInput,
  type RecordDeliveryEventInput,
  type ResolveConversationInput,
  type UpdateMessageTransportInput,
} from '../crm/communication-records.js';
import type { CrmScope } from '../crm/crm-records.js';
import { createDomainEvent } from '../events/domain-events.js';
import { PostgresTransactionalOutbox } from '../events/postgres-transactional-outbox.js';
import type { TransactionalOutboxWriter } from '../events/transactional-outbox.js';

interface ConversationRow {
  readonly conversation_id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly contact_id: string;
  readonly channel: ConversationRecord['channel'];
  readonly provider: string;
  readonly provider_account_ref: string;
  readonly status: ConversationRecord['status'];
  readonly last_inbound_at: Date | string | null;
  readonly last_outbound_at: Date | string | null;
  readonly human_handoff_at: Date | string | null;
  readonly human_handoff_reason: string | null;
  readonly version: number;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface MessageRow {
  readonly message_id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly conversation_id: string;
  readonly contact_id: string;
  readonly channel: MessageRecord['channel'];
  readonly provider: string;
  readonly direction: MessageRecord['direction'];
  readonly content_type: MessageRecord['contentType'];
  readonly status: MessageRecord['status'];
  readonly provider_message_id: string | null;
  readonly reply_to_provider_message_id: string | null;
  readonly template_key: string | null;
  readonly template_locale: string | null;
  readonly purpose_id: string | null;
  readonly body_text: string | null;
  readonly payload: unknown;
  readonly attempt_count: number;
  readonly next_retry_at: Date | string | null;
  readonly last_error_code: string | null;
  readonly occurred_at: Date | string;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface DeliveryRow {
  readonly delivery_event_id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly message_id: string;
  readonly provider_message_id: string;
  readonly provider_event_id: string;
  readonly status: MessageDeliveryEventRecord['status'];
  readonly error_code: string | null;
  readonly error_title: string | null;
  readonly observed_at: Date | string;
  readonly evidence: unknown;
  readonly created_at: Date | string;
}

interface ThrottleRow {
  readonly window_started_at: Date | string;
  readonly sent_count: number;
}

export interface PostgresCrmCommunicationStoreOptions {
  readonly outbox?: TransactionalOutboxWriter;
}

export class PostgresCrmCommunicationStore implements CrmCommunicationStore {
  readonly #outbox: TransactionalOutboxWriter;

  constructor(
    private readonly pool: pg.Pool,
    options: PostgresCrmCommunicationStoreOptions = {},
  ) {
    this.#outbox = options.outbox ?? new PostgresTransactionalOutbox(pool);
  }

  async resolveConversation(input: ResolveConversationInput): Promise<ConversationRecord> {
    validateCommunicationScope(input);
    const evidence = requireCommunicationEvidence(input.evidence);
    const now = normalizeNow(input.now);
    const occurredAt = assertCommunicationTimestamp(
      input.occurredAt,
      'CRM_CONVERSATION_ACTIVITY_AT_INVALID',
    );
    const provider = requireCommunicationText(
      input.provider,
      'CRM_COMMUNICATION_PROVIDER_REQUIRED',
    );
    const providerAccountRef = requireCommunicationText(
      input.providerAccountRef,
      'CRM_COMMUNICATION_PROVIDER_ACCOUNT_REQUIRED',
    );
    const conversationId = requireCommunicationText(
      input.conversationId,
      'CRM_CONVERSATION_ID_REQUIRED',
    );
    const contactId = requireCommunicationText(input.contactId, 'CRM_CONTACT_ID_REQUIRED');

    return this.#transaction(async (client) => {
      const result = await client.query<ConversationRow>(
        `insert into crm_conversations (
           conversation_id, tenant_id, workspace_id, organization_id, contact_id,
           channel, provider, provider_account_ref, status, last_inbound_at,
           last_outbound_at, human_handoff_at, human_handoff_reason, version,
           created_at, updated_at
         ) values (
           $1,$2,$3,$4,$5,$6,$7,$8,'OPEN',
           case when $9 = 'INBOUND' then $10::timestamptz else null end,
           case when $9 = 'OUTBOUND' then $10::timestamptz else null end,
           null,null,1,$11::timestamptz,$11::timestamptz
         )
         on conflict (tenant_id, workspace_id, organization_id, contact_id, channel, provider, provider_account_ref)
         do update set
           last_inbound_at = case
             when $9 = 'INBOUND' and (crm_conversations.last_inbound_at is null or $10::timestamptz > crm_conversations.last_inbound_at)
               then $10::timestamptz
             else crm_conversations.last_inbound_at
           end,
           last_outbound_at = case
             when $9 = 'OUTBOUND' and (crm_conversations.last_outbound_at is null or $10::timestamptz > crm_conversations.last_outbound_at)
               then $10::timestamptz
             else crm_conversations.last_outbound_at
           end,
           version = case
             when ($9 = 'INBOUND' and (crm_conversations.last_inbound_at is null or $10::timestamptz > crm_conversations.last_inbound_at))
               or ($9 = 'OUTBOUND' and (crm_conversations.last_outbound_at is null or $10::timestamptz > crm_conversations.last_outbound_at))
               then crm_conversations.version + 1
             else crm_conversations.version
           end,
           updated_at = greatest(crm_conversations.updated_at, $11::timestamptz)
         returning *`,
        [
          conversationId,
          input.tenantId,
          input.workspaceId,
          input.organizationId,
          contactId,
          input.channel,
          provider,
          providerAccountRef,
          input.direction,
          occurredAt,
          now,
        ],
      );
      const record = conversationFromRow(
        requiredRow(result.rows[0], 'CRM_CONVERSATION_UPSERT_FAILED'),
      );
      await this.#enqueue(client, {
        eventKey: `communication.conversation.activity:${input.idempotencyKey}`,
        eventType: 'crm.communication.conversation.activity',
        aggregateType: 'CRM_CONVERSATION',
        aggregateId: record.conversationId,
        aggregateVersion: record.version,
        scope: record,
        correlationId: input.correlationId,
        occurredAt,
        evidence,
        payload: {
          contactId: record.contactId,
          channel: record.channel,
          provider: record.provider,
          direction: input.direction,
        },
      });
      return record;
    });
  }

  async getConversation(
    input: CrmScope & { readonly conversationId: string },
  ): Promise<ConversationRecord | undefined> {
    validateCommunicationScope(input);
    const result = await this.pool.query<ConversationRow>(
      `select * from crm_conversations
       where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and conversation_id=$4`,
      [input.tenantId, input.workspaceId, input.organizationId, input.conversationId],
    );
    return result.rows[0] ? conversationFromRow(result.rows[0]) : undefined;
  }

  async recordMessage(input: RecordCommunicationMessageInput): Promise<MessageRecord> {
    validateCommunicationScope(input);
    const evidence = requireCommunicationEvidence(input.evidence);
    const now = normalizeNow(input.now);
    const occurredAt = assertCommunicationTimestamp(
      input.occurredAt,
      'CRM_MESSAGE_OCCURRED_AT_INVALID',
    );
    const messageId = requireCommunicationText(input.messageId, 'CRM_MESSAGE_ID_REQUIRED');
    const provider = requireCommunicationText(
      input.provider,
      'CRM_COMMUNICATION_PROVIDER_REQUIRED',
    );
    const idempotencyKey = requireCommunicationText(
      input.idempotencyKey,
      'CRM_MESSAGE_IDEMPOTENCY_KEY_REQUIRED',
    );
    const payload = input.payload ?? {};
    const attemptCount = input.attemptCount ?? 0;

    return this.#transaction(async (client) => {
      const inserted = await client.query<MessageRow>(
        `insert into crm_messages (
           message_id, tenant_id, workspace_id, organization_id, conversation_id, contact_id,
           channel, provider, direction, content_type, status, provider_message_id,
           reply_to_provider_message_id, template_key, template_locale, purpose_id, body_text,
           payload, idempotency_key, attempt_count, next_retry_at, last_error_code,
           occurred_at, created_at, updated_at
         ) values (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
           $18::jsonb,$19,$20,$21::timestamptz,$22,$23::timestamptz,$24::timestamptz,$24::timestamptz
         )
         on conflict (tenant_id, workspace_id, organization_id, provider, direction, idempotency_key)
         do nothing
         returning *`,
        [
          messageId,
          input.tenantId,
          input.workspaceId,
          input.organizationId,
          input.conversationId,
          input.contactId,
          input.channel,
          provider,
          input.direction,
          input.contentType,
          input.status,
          input.providerMessageId ?? null,
          input.replyToProviderMessageId ?? null,
          input.templateKey ?? null,
          input.templateLocale ?? null,
          input.purposeId ?? null,
          input.text ?? null,
          JSON.stringify(payload),
          idempotencyKey,
          attemptCount,
          input.nextRetryAt ?? null,
          input.lastErrorCode ?? null,
          occurredAt,
          now,
        ],
      );

      let record: MessageRecord;
      if (inserted.rows[0]) {
        record = messageFromRow(inserted.rows[0]);
        for (const attachment of input.attachments ?? []) {
          const attachmentEvidence = requireCommunicationEvidence(attachment.evidence);
          await client.query(
            `insert into crm_message_attachments (
               attachment_id, tenant_id, workspace_id, organization_id, message_id,
               provider_media_id, media_url, mime_type, file_name, sha256, size_bytes,
               evidence, created_at
             ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::timestamptz)
             on conflict (attachment_id) do nothing`,
            [
              attachment.attachmentId,
              input.tenantId,
              input.workspaceId,
              input.organizationId,
              record.messageId,
              attachment.providerMediaId,
              attachment.mediaUrl,
              attachment.mimeType,
              attachment.fileName,
              attachment.sha256,
              attachment.sizeBytes,
              JSON.stringify(attachmentEvidence),
              now,
            ],
          );
        }
        await this.#enqueue(client, {
          eventKey: `communication.message.recorded:${idempotencyKey}`,
          eventType: 'crm.communication.message.recorded',
          aggregateType: 'CRM_MESSAGE',
          aggregateId: record.messageId,
          aggregateVersion: 1,
          scope: record,
          correlationId: input.correlationId,
          occurredAt,
          evidence,
          payload: {
            conversationId: record.conversationId,
            contactId: record.contactId,
            channel: record.channel,
            provider: record.provider,
            direction: record.direction,
            contentType: record.contentType,
            status: record.status,
            providerMessageId: record.providerMessageId,
            attachmentCount: input.attachments?.length ?? 0,
          },
        });
      } else {
        const replay = await client.query<MessageRow>(
          `select * from crm_messages
           where tenant_id=$1 and workspace_id=$2 and organization_id=$3
             and provider=$4 and direction=$5 and idempotency_key=$6`,
          [
            input.tenantId,
            input.workspaceId,
            input.organizationId,
            provider,
            input.direction,
            idempotencyKey,
          ],
        );
        record = messageFromRow(
          requiredRow(replay.rows[0], 'CRM_MESSAGE_IDEMPOTENCY_REPLAY_MISSING'),
        );
        if (record.messageId !== messageId || record.conversationId !== input.conversationId) {
          throw new Error('CRM_MESSAGE_IDEMPOTENCY_CONFLICT');
        }
      }
      validateMessageRecord(record);
      return record;
    });
  }

  async getMessage(
    input: CrmScope & { readonly messageId: string },
  ): Promise<MessageRecord | undefined> {
    validateCommunicationScope(input);
    const result = await this.pool.query<MessageRow>(
      `select * from crm_messages
       where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and message_id=$4`,
      [input.tenantId, input.workspaceId, input.organizationId, input.messageId],
    );
    return result.rows[0] ? messageFromRow(result.rows[0]) : undefined;
  }

  async getMessageByProviderId(
    input: CrmScope & { readonly provider: string; readonly providerMessageId: string },
  ): Promise<MessageRecord | undefined> {
    validateCommunicationScope(input);
    const result = await this.pool.query<MessageRow>(
      `select * from crm_messages
       where tenant_id=$1 and workspace_id=$2 and organization_id=$3
         and provider=$4 and provider_message_id=$5`,
      [
        input.tenantId,
        input.workspaceId,
        input.organizationId,
        input.provider,
        input.providerMessageId,
      ],
    );
    return result.rows[0] ? messageFromRow(result.rows[0]) : undefined;
  }

  async recordDeliveryEvent(input: RecordDeliveryEventInput): Promise<MessageDeliveryEventRecord> {
    validateCommunicationScope(input);
    const evidence = requireCommunicationEvidence(input.evidence);
    const now = normalizeNow(input.now);
    const observedAt = assertCommunicationTimestamp(
      input.observedAt,
      'CRM_DELIVERY_OBSERVED_AT_INVALID',
    );

    return this.#transaction(async (client) => {
      const messageResult = await client.query<MessageRow>(
        `select * from crm_messages
         where tenant_id=$1 and workspace_id=$2 and organization_id=$3
           and provider_message_id=$4
         for update`,
        [input.tenantId, input.workspaceId, input.organizationId, input.providerMessageId],
      );
      const message = messageFromRow(
        requiredRow(messageResult.rows[0], 'CRM_DELIVERY_MESSAGE_NOT_FOUND'),
      );
      const inserted = await client.query<DeliveryRow>(
        `insert into crm_message_delivery_events (
           delivery_event_id, tenant_id, workspace_id, organization_id, message_id,
           provider_message_id, provider_event_id, status, error_code, error_title,
           observed_at, evidence, created_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz,$12::jsonb,$13::timestamptz)
         on conflict (tenant_id, workspace_id, organization_id, provider_event_id)
         do nothing
         returning *`,
        [
          input.deliveryEventId,
          input.tenantId,
          input.workspaceId,
          input.organizationId,
          message.messageId,
          input.providerMessageId,
          input.providerEventId,
          input.status,
          input.errorCode ?? null,
          input.errorTitle ?? null,
          observedAt,
          JSON.stringify(evidence),
          now,
        ],
      );

      if (!inserted.rows[0]) {
        const replay = await client.query<DeliveryRow>(
          `select * from crm_message_delivery_events
           where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and provider_event_id=$4`,
          [input.tenantId, input.workspaceId, input.organizationId, input.providerEventId],
        );
        return deliveryFromRow(
          requiredRow(replay.rows[0], 'CRM_DELIVERY_IDEMPOTENCY_REPLAY_MISSING'),
        );
      }

      const nextStatus = deliveryStatusToMessageStatus(message.status, input.status);
      await client.query(
        `update crm_messages set
           status=$5,
           last_error_code=case when $6::text is null then last_error_code else $6 end,
           updated_at=greatest(updated_at,$7::timestamptz)
         where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and message_id=$4`,
        [
          input.tenantId,
          input.workspaceId,
          input.organizationId,
          message.messageId,
          nextStatus,
          input.errorCode ?? null,
          observedAt,
        ],
      );

      const delivery = deliveryFromRow(inserted.rows[0]);
      await this.#enqueue(client, {
        eventKey: `communication.delivery:${input.providerEventId}`,
        eventType: `crm.communication.delivery.${input.status.toLowerCase()}`,
        aggregateType: 'CRM_MESSAGE',
        aggregateId: message.messageId,
        aggregateVersion: Math.max(1, message.attemptCount + 1),
        scope: message,
        correlationId: input.correlationId,
        occurredAt: observedAt,
        evidence,
        payload: {
          providerMessageId: input.providerMessageId,
          status: input.status,
          errorCode: input.errorCode ?? null,
        },
      });
      return delivery;
    });
  }

  async updateMessageTransport(input: UpdateMessageTransportInput): Promise<MessageRecord> {
    validateCommunicationScope(input);
    const evidence = requireCommunicationEvidence(input.evidence);
    const now = normalizeNow(input.now);
    if (!Number.isSafeInteger(input.attemptCount) || input.attemptCount < 0) {
      throw new Error('CRM_MESSAGE_ATTEMPT_COUNT_INVALID');
    }
    if (input.nextRetryAt !== undefined && input.nextRetryAt !== null) {
      assertCommunicationTimestamp(input.nextRetryAt, 'CRM_MESSAGE_NEXT_RETRY_INVALID');
    }

    return this.#transaction(async (client) => {
      const result = await client.query<MessageRow>(
        `update crm_messages set
           status=$6,
           provider_message_id=coalesce($7, provider_message_id),
           attempt_count=$8,
           next_retry_at=$9::timestamptz,
           last_error_code=$10,
           updated_at=$11::timestamptz
         where tenant_id=$1 and workspace_id=$2 and organization_id=$3
           and message_id=$4 and status=$5
         returning *`,
        [
          input.tenantId,
          input.workspaceId,
          input.organizationId,
          input.messageId,
          input.expectedStatus,
          input.status,
          input.providerMessageId ?? null,
          input.attemptCount,
          input.nextRetryAt ?? null,
          input.lastErrorCode ?? null,
          now,
        ],
      );
      const record = messageFromRow(
        requiredRow(result.rows[0], 'CRM_MESSAGE_STATUS_CONCURRENT_UPDATE'),
      );
      await this.#enqueue(client, {
        eventKey: `communication.message.transport:${input.idempotencyKey}:${input.status}`,
        eventType: 'crm.communication.message.transport_changed',
        aggregateType: 'CRM_MESSAGE',
        aggregateId: record.messageId,
        aggregateVersion: Math.max(1, record.attemptCount + 1),
        scope: record,
        correlationId: input.correlationId,
        occurredAt: now,
        evidence,
        payload: {
          status: record.status,
          providerMessageId: record.providerMessageId,
          attemptCount: record.attemptCount,
          nextRetryAt: record.nextRetryAt,
          lastErrorCode: record.lastErrorCode,
        },
      });
      return record;
    });
  }

  async markHumanHandoff(input: MarkHumanHandoffInput): Promise<ConversationRecord> {
    validateCommunicationScope(input);
    const evidence = requireCommunicationEvidence(input.evidence);
    const now = normalizeNow(input.now);
    const reason = requireCommunicationText(
      input.reason,
      'CRM_CONVERSATION_HANDOFF_REASON_REQUIRED',
    );

    return this.#transaction(async (client) => {
      const result = await client.query<ConversationRow>(
        `update crm_conversations set
           status='HUMAN_HANDOFF', human_handoff_at=coalesce(human_handoff_at,$5::timestamptz),
           human_handoff_reason=coalesce(human_handoff_reason,$6), version=version+1,
           updated_at=$5::timestamptz
         where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and conversation_id=$4
         returning *`,
        [
          input.tenantId,
          input.workspaceId,
          input.organizationId,
          input.conversationId,
          now,
          reason,
        ],
      );
      const record = conversationFromRow(requiredRow(result.rows[0], 'CRM_CONVERSATION_NOT_FOUND'));
      await this.#enqueue(client, {
        eventKey: `communication.conversation.handoff:${input.idempotencyKey}`,
        eventType: 'crm.communication.conversation.human_handoff',
        aggregateType: 'CRM_CONVERSATION',
        aggregateId: record.conversationId,
        aggregateVersion: record.version,
        scope: record,
        correlationId: input.correlationId,
        occurredAt: now,
        evidence,
        payload: { reason },
      });
      return record;
    });
  }

  async consumeThrottle(
    input: ConsumeCommunicationThrottleInput,
  ): Promise<CommunicationThrottleDecision> {
    validateCommunicationScope(input);
    const now = assertCommunicationTimestamp(input.now, 'CRM_COMMUNICATION_THROTTLE_NOW_INVALID');
    if (!Number.isSafeInteger(input.windowSeconds) || input.windowSeconds < 1) {
      throw new Error('CRM_COMMUNICATION_THROTTLE_WINDOW_INVALID');
    }
    if (!Number.isSafeInteger(input.limit) || input.limit < 1) {
      throw new Error('CRM_COMMUNICATION_THROTTLE_LIMIT_INVALID');
    }

    return this.#transaction(async (client) => {
      const result = await client.query<ThrottleRow>(
        `select window_started_at, sent_count from crm_communication_throttle_buckets
         where tenant_id=$1 and workspace_id=$2 and organization_id=$3
           and contact_id=$4 and channel=$5 and provider=$6
         for update`,
        [
          input.tenantId,
          input.workspaceId,
          input.organizationId,
          input.contactId,
          input.channel,
          input.provider,
        ],
      );
      const row = result.rows[0];
      const nowMs = Date.parse(now);
      if (!row) {
        await client.query(
          `insert into crm_communication_throttle_buckets (
             tenant_id, workspace_id, organization_id, contact_id, channel, provider,
             window_started_at, sent_count, updated_at
           ) values ($1,$2,$3,$4,$5,$6,$7::timestamptz,1,$7::timestamptz)`,
          [
            input.tenantId,
            input.workspaceId,
            input.organizationId,
            input.contactId,
            input.channel,
            input.provider,
            now,
          ],
        );
        return {
          allowed: true,
          count: 1,
          limit: input.limit,
          windowStartedAt: now,
          retryAfterSeconds: 0,
        };
      }

      const windowStartedAt = toIso(row.window_started_at);
      const elapsedSeconds = Math.max(0, Math.floor((nowMs - Date.parse(windowStartedAt)) / 1000));
      if (elapsedSeconds >= input.windowSeconds) {
        await client.query(
          `update crm_communication_throttle_buckets set
             window_started_at=$7::timestamptz, sent_count=1, updated_at=$7::timestamptz
           where tenant_id=$1 and workspace_id=$2 and organization_id=$3
             and contact_id=$4 and channel=$5 and provider=$6`,
          [
            input.tenantId,
            input.workspaceId,
            input.organizationId,
            input.contactId,
            input.channel,
            input.provider,
            now,
          ],
        );
        return {
          allowed: true,
          count: 1,
          limit: input.limit,
          windowStartedAt: now,
          retryAfterSeconds: 0,
        };
      }

      if (row.sent_count >= input.limit) {
        return {
          allowed: false,
          count: row.sent_count,
          limit: input.limit,
          windowStartedAt,
          retryAfterSeconds: Math.max(1, input.windowSeconds - elapsedSeconds),
        };
      }

      const count = row.sent_count + 1;
      await client.query(
        `update crm_communication_throttle_buckets set sent_count=$7, updated_at=$8::timestamptz
         where tenant_id=$1 and workspace_id=$2 and organization_id=$3
           and contact_id=$4 and channel=$5 and provider=$6`,
        [
          input.tenantId,
          input.workspaceId,
          input.organizationId,
          input.contactId,
          input.channel,
          input.provider,
          count,
          now,
        ],
      );
      return { allowed: true, count, limit: input.limit, windowStartedAt, retryAfterSeconds: 0 };
    });
  }

  async #enqueue(
    client: pg.PoolClient,
    input: {
      readonly eventKey: string;
      readonly eventType: string;
      readonly aggregateType: string;
      readonly aggregateId: string;
      readonly aggregateVersion: number;
      readonly scope: CrmScope;
      readonly correlationId: string;
      readonly occurredAt: string;
      readonly evidence: readonly string[];
      readonly payload: unknown;
    },
  ): Promise<void> {
    await this.#outbox.enqueue(
      client,
      createDomainEvent({
        eventKey: input.eventKey,
        eventType: input.eventType,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        aggregateVersion: input.aggregateVersion,
        tenantId: input.scope.tenantId,
        workspaceId: input.scope.workspaceId,
        organizationId: input.scope.organizationId,
        correlationId: input.correlationId,
        occurredAt: input.occurredAt,
        payload: input.payload,
        evidence: input.evidence,
      }),
    );
  }

  async #transaction<T>(operation: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await operation(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}

function conversationFromRow(row: ConversationRow): ConversationRecord {
  const record: ConversationRecord = {
    conversationId: row.conversation_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    contactId: row.contact_id,
    channel: row.channel,
    provider: row.provider,
    providerAccountRef: row.provider_account_ref,
    status: row.status,
    lastInboundAt: nullableIso(row.last_inbound_at),
    lastOutboundAt: nullableIso(row.last_outbound_at),
    humanHandoffAt: nullableIso(row.human_handoff_at),
    humanHandoffReason: row.human_handoff_reason,
    version: row.version,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
  validateConversationRecord(record);
  return record;
}

function messageFromRow(row: MessageRow): MessageRecord {
  const record: MessageRecord = {
    messageId: row.message_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    conversationId: row.conversation_id,
    contactId: row.contact_id,
    channel: row.channel,
    provider: row.provider,
    direction: row.direction,
    contentType: row.content_type,
    status: row.status,
    providerMessageId: row.provider_message_id,
    replyToProviderMessageId: row.reply_to_provider_message_id,
    templateKey: row.template_key,
    templateLocale: row.template_locale,
    purposeId: row.purpose_id,
    text: row.body_text,
    payload: jsonObject(row.payload),
    attemptCount: row.attempt_count,
    nextRetryAt: nullableIso(row.next_retry_at),
    lastErrorCode: row.last_error_code,
    occurredAt: toIso(row.occurred_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
  validateMessageRecord(record);
  return record;
}

function deliveryFromRow(row: DeliveryRow): MessageDeliveryEventRecord {
  return {
    deliveryEventId: row.delivery_event_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    messageId: row.message_id,
    providerMessageId: row.provider_message_id,
    providerEventId: row.provider_event_id,
    status: row.status,
    errorCode: row.error_code,
    errorTitle: row.error_title,
    observedAt: toIso(row.observed_at),
    evidence: jsonStringArray(row.evidence),
    createdAt: toIso(row.created_at),
  };
}

function deliveryStatusToMessageStatus(
  current: MessageRecord['status'],
  delivery: MessageDeliveryEventRecord['status'],
): MessageRecord['status'] {
  if (delivery === 'FAILED') {
    return current === 'DELIVERED' || current === 'READ' ? current : 'FAILED';
  }
  const desired = delivery;
  const rank: Readonly<Record<MessageRecord['status'], number>> = {
    RECEIVED: 0,
    PREPARED: 0,
    SUBMITTED: 1,
    SENT: 2,
    DELIVERED: 3,
    READ: 4,
    FAILED_RETRYABLE: 0,
    FAILED: 0,
    DEAD_LETTER: 0,
  };
  return rank[desired] > rank[current] ? desired : current;
}

function normalizeNow(value: string | undefined): string {
  const now = value ?? new Date().toISOString();
  return assertCommunicationTimestamp(now, 'CRM_COMMUNICATION_NOW_INVALID');
}

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('CRM_COMMUNICATION_TIMESTAMP_INVALID');
  return date.toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

function jsonObject(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('CRM_MESSAGE_PAYLOAD_INVALID');
  }
  return value as Readonly<Record<string, unknown>>;
}

function jsonStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error('CRM_COMMUNICATION_EVIDENCE_INVALID');
  }
  return value;
}

function requiredRow<T>(value: T | undefined, errorCode: string): T {
  if (value === undefined) throw new Error(errorCode);
  return value;
}
