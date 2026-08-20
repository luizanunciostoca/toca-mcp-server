import type pg from 'pg';
import type { CrmScope } from '../crm/crm-records.js';
import { createDomainEvent } from '../events/domain-events.js';
import { PostgresTransactionalOutbox } from '../events/postgres-transactional-outbox.js';
import type { TransactionalOutboxWriter } from '../events/transactional-outbox.js';
import {
  WHATSAPP_PROVIDER_KEY,
  type ConsumeWhatsAppThrottleInput,
  type CreateWhatsAppDispatchInput,
  type EnsureWhatsAppBindingInput,
  type MarkWhatsAppHandoffInput,
  type RecordWhatsAppMediaInput,
  type RecordWhatsAppProviderEventInput,
  type TouchWhatsAppBindingInput,
  type UpdateWhatsAppDispatchInput,
  type WhatsAppConversationBinding,
  type WhatsAppDispatchRecord,
  type WhatsAppDispatchState,
  type WhatsAppMediaRecord,
  type WhatsAppProviderEventRecord,
  type WhatsAppRuntimeStore,
  type WhatsAppThrottleDecision,
} from '../omnichannel/whatsapp-runtime-contracts.js';

interface BindingRow {
  readonly binding_id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly conversation_id: string;
  readonly contact_id: string;
  readonly meta_app_id: string;
  readonly waba_id: string;
  readonly phone_number_id: string;
  readonly recipient_sha256: string;
  readonly last_inbound_at: Date | string | null;
  readonly last_outbound_at: Date | string | null;
  readonly human_handoff_at: Date | string | null;
  readonly human_handoff_reason: string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface DispatchRow {
  readonly dispatch_id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly message_id: string;
  readonly conversation_id: string;
  readonly contact_id: string;
  readonly provider: typeof WHATSAPP_PROVIDER_KEY;
  readonly prepared_payload_ref: string;
  readonly purpose_id: string;
  readonly idempotency_key: string;
  readonly provider_message_ref: string | null;
  readonly state: WhatsAppDispatchState;
  readonly attempt_count: number;
  readonly next_retry_at: Date | string | null;
  readonly last_error_code: string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface ProviderEventRow {
  readonly event_id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly message_id: string;
  readonly provider_message_ref: string;
  readonly provider_event_ref: string;
  readonly status: WhatsAppProviderEventRecord['status'];
  readonly error_code: string | null;
  readonly error_title: string | null;
  readonly observed_at: Date | string;
  readonly evidence: unknown;
  readonly created_at: Date | string;
}

interface MediaRow {
  readonly media_record_id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly message_id: string;
  readonly direction: WhatsAppMediaRecord['direction'];
  readonly provider_media_id: string;
  readonly mime_type: string | null;
  readonly file_name: string | null;
  readonly sha256: string | null;
  readonly size_bytes: number | string | null;
  readonly storage_ref: string | null;
  readonly evidence: unknown;
  readonly created_at: Date | string;
}

interface ThrottleRow {
  readonly window_started_at: Date | string;
  readonly sent_count: number;
}

export interface PostgresWhatsAppRuntimeStoreOptions {
  readonly outbox?: TransactionalOutboxWriter;
}

export class PostgresWhatsAppRuntimeStore implements WhatsAppRuntimeStore {
  readonly #outbox: TransactionalOutboxWriter;

  constructor(
    private readonly pool: pg.Pool,
    options: PostgresWhatsAppRuntimeStoreOptions = {},
  ) {
    this.#outbox = options.outbox ?? new PostgresTransactionalOutbox(pool);
  }

  async getBindingByRecipient(
    input: CrmScope & { readonly phoneNumberId: string; readonly recipientSha256: string },
  ): Promise<WhatsAppConversationBinding | undefined> {
    validateScope(input);
    assertSha256(input.recipientSha256, 'WHATSAPP_RECIPIENT_SHA256_INVALID');
    const result = await this.pool.query<BindingRow>(
      `select * from whatsapp_conversation_bindings
       where tenant_id=$1 and workspace_id=$2 and organization_id=$3
         and phone_number_id=$4 and recipient_sha256=$5`,
      [
        input.tenantId,
        input.workspaceId,
        input.organizationId,
        requireText(input.phoneNumberId, 'WHATSAPP_PHONE_NUMBER_ID_REQUIRED'),
        input.recipientSha256,
      ],
    );
    return result.rows[0] ? bindingFromRow(result.rows[0]) : undefined;
  }

  async getBindingByConversation(
    input: CrmScope & { readonly conversationId: string },
  ): Promise<WhatsAppConversationBinding | undefined> {
    validateScope(input);
    const result = await this.pool.query<BindingRow>(
      `select * from whatsapp_conversation_bindings
       where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and conversation_id=$4`,
      [
        input.tenantId,
        input.workspaceId,
        input.organizationId,
        requireText(input.conversationId, 'WHATSAPP_CONVERSATION_ID_REQUIRED'),
      ],
    );
    return result.rows[0] ? bindingFromRow(result.rows[0]) : undefined;
  }

  async ensureBinding(input: EnsureWhatsAppBindingInput): Promise<WhatsAppConversationBinding> {
    validateScope(input);
    const evidence = normalizeEvidence(input.evidence);
    const now = normalizeNow(input.now);
    assertSha256(input.recipientSha256, 'WHATSAPP_RECIPIENT_SHA256_INVALID');

    return this.#transaction(async (client) => {
      const result = await client.query<BindingRow>(
        `insert into whatsapp_conversation_bindings (
           binding_id,tenant_id,workspace_id,organization_id,conversation_id,contact_id,
           meta_app_id,waba_id,phone_number_id,recipient_sha256,last_inbound_at,last_outbound_at,
           human_handoff_at,human_handoff_reason,created_at,updated_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,null,null,null,null,$11::timestamptz,$11::timestamptz)
         on conflict (tenant_id,workspace_id,organization_id,phone_number_id,recipient_sha256)
         do nothing returning *`,
        [
          requireText(input.bindingId, 'WHATSAPP_BINDING_ID_REQUIRED'),
          input.tenantId,
          input.workspaceId,
          input.organizationId,
          requireText(input.conversationId, 'WHATSAPP_CONVERSATION_ID_REQUIRED'),
          requireText(input.contactId, 'WHATSAPP_CONTACT_ID_REQUIRED'),
          requireText(input.metaAppId, 'WHATSAPP_META_APP_ID_REQUIRED'),
          requireText(input.wabaId, 'WHATSAPP_WABA_ID_REQUIRED'),
          requireText(input.phoneNumberId, 'WHATSAPP_PHONE_NUMBER_ID_REQUIRED'),
          input.recipientSha256,
          now,
        ],
      );

      let record: WhatsAppConversationBinding;
      let created = false;
      if (result.rows[0]) {
        record = bindingFromRow(result.rows[0]);
        created = true;
      } else {
        const replay = await client.query<BindingRow>(
          `select * from whatsapp_conversation_bindings
           where tenant_id=$1 and workspace_id=$2 and organization_id=$3
             and phone_number_id=$4 and recipient_sha256=$5 for update`,
          [
            input.tenantId,
            input.workspaceId,
            input.organizationId,
            input.phoneNumberId,
            input.recipientSha256,
          ],
        );
        record = bindingFromRow(requiredRow(replay.rows[0], 'WHATSAPP_BINDING_REPLAY_MISSING'));
        if (
          record.conversationId !== input.conversationId ||
          record.contactId !== input.contactId ||
          record.metaAppId !== input.metaAppId ||
          record.wabaId !== input.wabaId
        ) {
          throw new Error('WHATSAPP_BINDING_IDEMPOTENCY_CONFLICT');
        }
      }

      if (created) {
        await this.#enqueue(client, {
          eventKey: `whatsapp.binding.created:${input.idempotencyKey}`,
          eventType: 'whatsapp.binding.created',
          aggregateType: 'WHATSAPP_BINDING',
          aggregateId: record.bindingId,
          aggregateVersion: 1,
          scope: record,
          correlationId: input.correlationId,
          causationId: input.executionId,
          occurredAt: now,
          evidence,
          payload: {
            conversationId: record.conversationId,
            contactId: record.contactId,
            metaAppId: record.metaAppId,
            wabaId: record.wabaId,
            phoneNumberId: record.phoneNumberId,
          },
        });
      }
      return record;
    });
  }

  async touchBinding(input: TouchWhatsAppBindingInput): Promise<WhatsAppConversationBinding> {
    validateScope(input);
    const evidence = normalizeEvidence(input.evidence);
    const now = normalizeNow(input.now);
    const occurredAt = normalizeTimestamp(input.occurredAt, 'WHATSAPP_ACTIVITY_AT_INVALID');

    return this.#transaction(async (client) => {
      const result = await client.query<BindingRow>(
        `update whatsapp_conversation_bindings set
           last_inbound_at=case when $5='INBOUND' then greatest(coalesce(last_inbound_at,$6::timestamptz),$6::timestamptz) else last_inbound_at end,
           last_outbound_at=case when $5='OUTBOUND' then greatest(coalesce(last_outbound_at,$6::timestamptz),$6::timestamptz) else last_outbound_at end,
           updated_at=greatest(updated_at,$7::timestamptz)
         where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and conversation_id=$4
         returning *`,
        [
          input.tenantId,
          input.workspaceId,
          input.organizationId,
          input.conversationId,
          input.direction,
          occurredAt,
          now,
        ],
      );
      const record = bindingFromRow(requiredRow(result.rows[0], 'WHATSAPP_BINDING_NOT_FOUND'));
      await this.#enqueue(client, {
        eventKey: `whatsapp.binding.activity:${input.idempotencyKey}`,
        eventType: 'whatsapp.binding.activity',
        aggregateType: 'WHATSAPP_BINDING',
        aggregateId: record.bindingId,
        aggregateVersion: activityVersion(record),
        scope: record,
        correlationId: input.correlationId,
        causationId: input.executionId,
        occurredAt,
        evidence,
        payload: { conversationId: record.conversationId, direction: input.direction },
      });
      return record;
    });
  }

  async markHumanHandoff(input: MarkWhatsAppHandoffInput): Promise<WhatsAppConversationBinding> {
    validateScope(input);
    const evidence = normalizeEvidence(input.evidence);
    const now = normalizeNow(input.now);
    const reason = requireText(input.reason, 'WHATSAPP_HANDOFF_REASON_REQUIRED');

    return this.#transaction(async (client) => {
      const result = await client.query<BindingRow>(
        `update whatsapp_conversation_bindings set
           human_handoff_at=coalesce(human_handoff_at,$5::timestamptz),
           human_handoff_reason=coalesce(human_handoff_reason,$6),
           updated_at=case when human_handoff_at is null then $5::timestamptz else updated_at end
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
      const record = bindingFromRow(requiredRow(result.rows[0], 'WHATSAPP_BINDING_NOT_FOUND'));
      await this.#enqueue(client, {
        eventKey: `whatsapp.binding.handoff:${input.idempotencyKey}`,
        eventType: 'whatsapp.binding.human_handoff',
        aggregateType: 'WHATSAPP_BINDING',
        aggregateId: record.bindingId,
        aggregateVersion: activityVersion(record),
        scope: record,
        correlationId: input.correlationId,
        causationId: input.executionId,
        occurredAt: now,
        evidence,
        payload: { conversationId: record.conversationId, reason: record.humanHandoffReason },
      });
      return record;
    });
  }

  async recordMedia(input: RecordWhatsAppMediaInput): Promise<WhatsAppMediaRecord> {
    validateScope(input);
    const evidence = normalizeEvidence(input.evidence);
    const now = normalizeNow(input.now);
    if (input.sha256) assertSha256(input.sha256, 'WHATSAPP_MEDIA_SHA256_INVALID');
    if (input.sizeBytes !== undefined && input.sizeBytes !== null) {
      if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0) {
        throw new Error('WHATSAPP_MEDIA_SIZE_INVALID');
      }
    }

    return this.#transaction(async (client) => {
      const result = await client.query<MediaRow>(
        `insert into whatsapp_message_media (
           media_record_id,tenant_id,workspace_id,organization_id,message_id,direction,
           provider_media_id,mime_type,file_name,sha256,size_bytes,storage_ref,evidence,created_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::timestamptz)
         on conflict (media_record_id) do nothing returning *`,
        [
          requireText(input.mediaRecordId, 'WHATSAPP_MEDIA_RECORD_ID_REQUIRED'),
          input.tenantId,
          input.workspaceId,
          input.organizationId,
          requireText(input.messageId, 'WHATSAPP_MESSAGE_ID_REQUIRED'),
          input.direction,
          requireText(input.providerMediaId, 'WHATSAPP_PROVIDER_MEDIA_ID_REQUIRED'),
          input.mimeType ?? null,
          input.fileName ?? null,
          input.sha256 ?? null,
          input.sizeBytes ?? null,
          input.storageRef ?? null,
          JSON.stringify(evidence),
          now,
        ],
      );
      let record: WhatsAppMediaRecord;
      let created = false;
      if (result.rows[0]) {
        record = mediaFromRow(result.rows[0]);
        created = true;
      } else {
        const replay = await client.query<MediaRow>(
          `select * from whatsapp_message_media
           where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and media_record_id=$4`,
          [input.tenantId, input.workspaceId, input.organizationId, input.mediaRecordId],
        );
        record = mediaFromRow(requiredRow(replay.rows[0], 'WHATSAPP_MEDIA_REPLAY_MISSING'));
        if (
          record.messageId !== input.messageId ||
          record.providerMediaId !== input.providerMediaId
        ) {
          throw new Error('WHATSAPP_MEDIA_IDEMPOTENCY_CONFLICT');
        }
      }
      if (created) {
        await this.#enqueue(client, {
          eventKey: `whatsapp.media.recorded:${input.idempotencyKey}`,
          eventType: 'whatsapp.media.recorded',
          aggregateType: 'CRM_MESSAGE',
          aggregateId: record.messageId,
          aggregateVersion: 1,
          scope: record,
          correlationId: input.correlationId,
          causationId: input.executionId,
          occurredAt: now,
          evidence,
          payload: {
            mediaRecordId: record.mediaRecordId,
            direction: record.direction,
            providerMediaId: record.providerMediaId,
            mimeType: record.mimeType,
          },
        });
      }
      return record;
    });
  }

  async createDispatch(input: CreateWhatsAppDispatchInput): Promise<WhatsAppDispatchRecord> {
    validateScope(input);
    const evidence = normalizeEvidence(input.evidence);
    const now = normalizeNow(input.now);
    const idempotencyKey = requireText(input.idempotencyKey, 'WHATSAPP_IDEMPOTENCY_KEY_REQUIRED');

    return this.#transaction(async (client) => {
      const result = await client.query<DispatchRow>(
        `insert into whatsapp_dispatches (
           dispatch_id,tenant_id,workspace_id,organization_id,message_id,conversation_id,contact_id,
           provider,prepared_payload_ref,purpose_id,idempotency_key,provider_message_ref,state,
           attempt_count,next_retry_at,last_error_code,created_at,updated_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,null,'PREPARED',0,null,null,$12::timestamptz,$12::timestamptz)
         on conflict (tenant_id,workspace_id,organization_id,provider,idempotency_key)
         do nothing returning *`,
        [
          requireText(input.dispatchId, 'WHATSAPP_DISPATCH_ID_REQUIRED'),
          input.tenantId,
          input.workspaceId,
          input.organizationId,
          requireText(input.messageId, 'WHATSAPP_MESSAGE_ID_REQUIRED'),
          requireText(input.conversationId, 'WHATSAPP_CONVERSATION_ID_REQUIRED'),
          requireText(input.contactId, 'WHATSAPP_CONTACT_ID_REQUIRED'),
          WHATSAPP_PROVIDER_KEY,
          requireText(input.preparedPayloadRef, 'WHATSAPP_PREPARED_PAYLOAD_REF_REQUIRED'),
          requireText(input.purposeId, 'WHATSAPP_PURPOSE_ID_REQUIRED'),
          idempotencyKey,
          now,
        ],
      );

      let record: WhatsAppDispatchRecord;
      let created = false;
      if (result.rows[0]) {
        record = dispatchFromRow(result.rows[0]);
        created = true;
      } else {
        const replay = await client.query<DispatchRow>(
          `select * from whatsapp_dispatches
           where tenant_id=$1 and workspace_id=$2 and organization_id=$3
             and provider=$4 and idempotency_key=$5 for update`,
          [
            input.tenantId,
            input.workspaceId,
            input.organizationId,
            WHATSAPP_PROVIDER_KEY,
            idempotencyKey,
          ],
        );
        record = dispatchFromRow(requiredRow(replay.rows[0], 'WHATSAPP_DISPATCH_REPLAY_MISSING'));
        if (
          record.messageId !== input.messageId ||
          record.conversationId !== input.conversationId ||
          record.preparedPayloadRef !== input.preparedPayloadRef ||
          record.purposeId !== input.purposeId
        ) {
          throw new Error('WHATSAPP_DISPATCH_IDEMPOTENCY_CONFLICT');
        }
      }

      if (created) {
        await this.#enqueue(client, {
          eventKey: `whatsapp.dispatch.prepared:${idempotencyKey}`,
          eventType: 'whatsapp.dispatch.prepared',
          aggregateType: 'WHATSAPP_DISPATCH',
          aggregateId: record.dispatchId,
          aggregateVersion: 1,
          scope: record,
          correlationId: input.correlationId,
          causationId: input.executionId,
          occurredAt: now,
          evidence,
          payload: {
            messageId: record.messageId,
            conversationId: record.conversationId,
            contactId: record.contactId,
            purposeId: record.purposeId,
          },
        });
      }
      return record;
    });
  }

  async getDispatchByIdempotencyKey(
    input: CrmScope & { readonly idempotencyKey: string },
  ): Promise<WhatsAppDispatchRecord | undefined> {
    validateScope(input);
    const result = await this.pool.query<DispatchRow>(
      `select * from whatsapp_dispatches
       where tenant_id=$1 and workspace_id=$2 and organization_id=$3
         and provider=$4 and idempotency_key=$5`,
      [
        input.tenantId,
        input.workspaceId,
        input.organizationId,
        WHATSAPP_PROVIDER_KEY,
        requireText(input.idempotencyKey, 'WHATSAPP_IDEMPOTENCY_KEY_REQUIRED'),
      ],
    );
    return result.rows[0] ? dispatchFromRow(result.rows[0]) : undefined;
  }

  async getDispatchByProviderMessageRef(
    input: CrmScope & { readonly providerMessageRef: string },
  ): Promise<WhatsAppDispatchRecord | undefined> {
    validateScope(input);
    const result = await this.pool.query<DispatchRow>(
      `select * from whatsapp_dispatches
       where tenant_id=$1 and workspace_id=$2 and organization_id=$3
         and provider=$4 and provider_message_ref=$5`,
      [
        input.tenantId,
        input.workspaceId,
        input.organizationId,
        WHATSAPP_PROVIDER_KEY,
        requireText(input.providerMessageRef, 'WHATSAPP_PROVIDER_MESSAGE_REF_REQUIRED'),
      ],
    );
    return result.rows[0] ? dispatchFromRow(result.rows[0]) : undefined;
  }

  async updateDispatch(input: UpdateWhatsAppDispatchInput): Promise<WhatsAppDispatchRecord> {
    validateScope(input);
    const evidence = normalizeEvidence(input.evidence);
    const now = normalizeNow(input.now);
    if (!Number.isSafeInteger(input.attemptCount) || input.attemptCount < 0) {
      throw new Error('WHATSAPP_ATTEMPT_COUNT_INVALID');
    }
    if (input.nextRetryAt) normalizeTimestamp(input.nextRetryAt, 'WHATSAPP_RETRY_AT_INVALID');

    return this.#transaction(async (client) => {
      const result = await client.query<DispatchRow>(
        `update whatsapp_dispatches set
           state=$6,
           provider_message_ref=coalesce($7,provider_message_ref),
           attempt_count=$8,
           next_retry_at=$9::timestamptz,
           last_error_code=$10,
           updated_at=$11::timestamptz
         where tenant_id=$1 and workspace_id=$2 and organization_id=$3
           and dispatch_id=$4 and state=$5
         returning *`,
        [
          input.tenantId,
          input.workspaceId,
          input.organizationId,
          requireText(input.dispatchId, 'WHATSAPP_DISPATCH_ID_REQUIRED'),
          input.expectedState,
          input.state,
          input.providerMessageRef ?? null,
          input.attemptCount,
          input.nextRetryAt ?? null,
          input.lastErrorCode ?? null,
          now,
        ],
      );
      const record = dispatchFromRow(
        requiredRow(result.rows[0], 'WHATSAPP_DISPATCH_CONCURRENT_UPDATE'),
      );
      await this.#enqueue(client, {
        eventKey: `whatsapp.dispatch.state:${input.idempotencyKey}:${input.state}`,
        eventType: 'whatsapp.dispatch.state_changed',
        aggregateType: 'WHATSAPP_DISPATCH',
        aggregateId: record.dispatchId,
        aggregateVersion: Math.max(1, record.attemptCount + 1),
        scope: record,
        correlationId: input.correlationId,
        causationId: input.executionId,
        occurredAt: now,
        evidence,
        payload: {
          messageId: record.messageId,
          state: record.state,
          providerMessageRef: record.providerMessageRef,
          attemptCount: record.attemptCount,
          nextRetryAt: record.nextRetryAt,
          lastErrorCode: record.lastErrorCode,
        },
      });
      return record;
    });
  }

  async recordProviderEvent(
    input: RecordWhatsAppProviderEventInput,
  ): Promise<WhatsAppProviderEventRecord> {
    validateScope(input);
    const evidence = normalizeEvidence(input.evidence);
    const now = normalizeNow(input.now);
    const observedAt = normalizeTimestamp(input.observedAt, 'WHATSAPP_PROVIDER_EVENT_AT_INVALID');
    const providerMessageRef = requireText(
      input.providerMessageRef,
      'WHATSAPP_PROVIDER_MESSAGE_REF_REQUIRED',
    );

    return this.#transaction(async (client) => {
      const dispatchResult = await client.query<DispatchRow>(
        `select * from whatsapp_dispatches
         where tenant_id=$1 and workspace_id=$2 and organization_id=$3
           and provider=$4 and provider_message_ref=$5 for update`,
        [
          input.tenantId,
          input.workspaceId,
          input.organizationId,
          WHATSAPP_PROVIDER_KEY,
          providerMessageRef,
        ],
      );
      const dispatch = dispatchFromRow(
        requiredRow(dispatchResult.rows[0], 'WHATSAPP_PROVIDER_EVENT_DISPATCH_NOT_FOUND'),
      );
      const insert = await client.query<ProviderEventRow>(
        `insert into whatsapp_provider_events (
           event_id,tenant_id,workspace_id,organization_id,message_id,provider_message_ref,
           provider_event_ref,status,error_code,error_title,observed_at,evidence,created_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz,$12::jsonb,$13::timestamptz)
         on conflict (tenant_id,workspace_id,organization_id,provider_event_ref)
         do nothing returning *`,
        [
          requireText(input.eventId, 'WHATSAPP_PROVIDER_EVENT_ID_REQUIRED'),
          input.tenantId,
          input.workspaceId,
          input.organizationId,
          dispatch.messageId,
          providerMessageRef,
          requireText(input.providerEventRef, 'WHATSAPP_PROVIDER_EVENT_REF_REQUIRED'),
          input.status,
          input.errorCode ?? null,
          input.errorTitle ?? null,
          observedAt,
          JSON.stringify(evidence),
          now,
        ],
      );

      if (!insert.rows[0]) {
        const replay = await client.query<ProviderEventRow>(
          `select * from whatsapp_provider_events
           where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and provider_event_ref=$4`,
          [input.tenantId, input.workspaceId, input.organizationId, input.providerEventRef],
        );
        return providerEventFromRow(
          requiredRow(replay.rows[0], 'WHATSAPP_PROVIDER_EVENT_REPLAY_MISSING'),
        );
      }

      const event = providerEventFromRow(insert.rows[0]);
      const nextState = deliveryState(dispatch.state, event.status);
      await client.query(
        `update whatsapp_dispatches set
           state=$6,
           last_error_code=case when $7::text is null then last_error_code else $7 end,
           next_retry_at=case when $6 in ('SENT','DELIVERED','READ','FAILED') then null else next_retry_at end,
           updated_at=greatest(updated_at,$8::timestamptz)
         where tenant_id=$1 and workspace_id=$2 and organization_id=$3
           and dispatch_id=$4 and provider=$5`,
        [
          input.tenantId,
          input.workspaceId,
          input.organizationId,
          dispatch.dispatchId,
          WHATSAPP_PROVIDER_KEY,
          nextState,
          event.errorCode,
          observedAt,
        ],
      );
      await this.#enqueue(client, {
        eventKey: `whatsapp.provider.event:${event.providerEventRef}`,
        eventType: `whatsapp.provider.${event.status.toLowerCase()}`,
        aggregateType: 'CRM_MESSAGE',
        aggregateId: dispatch.messageId,
        aggregateVersion: Math.max(1, dispatch.attemptCount + 1),
        scope: dispatch,
        correlationId: input.correlationId,
        causationId: input.executionId,
        occurredAt: observedAt,
        evidence,
        payload: {
          dispatchId: dispatch.dispatchId,
          providerMessageRef,
          status: event.status,
          errorCode: event.errorCode,
        },
      });
      return event;
    });
  }

  async consumeThrottle(input: ConsumeWhatsAppThrottleInput): Promise<WhatsAppThrottleDecision> {
    validateScope(input);
    const now = normalizeTimestamp(input.now, 'WHATSAPP_THROTTLE_NOW_INVALID');
    assertPositiveInteger(input.windowSeconds, 'WHATSAPP_THROTTLE_WINDOW_INVALID');
    assertPositiveInteger(input.limit, 'WHATSAPP_THROTTLE_LIMIT_INVALID');

    return this.#transaction(async (client) => {
      const result = await client.query<ThrottleRow>(
        `select window_started_at,sent_count from whatsapp_throttle_buckets
         where tenant_id=$1 and workspace_id=$2 and organization_id=$3
           and contact_id=$4 and provider=$5 for update`,
        [
          input.tenantId,
          input.workspaceId,
          input.organizationId,
          requireText(input.contactId, 'WHATSAPP_CONTACT_ID_REQUIRED'),
          WHATSAPP_PROVIDER_KEY,
        ],
      );
      const row = result.rows[0];
      if (!row) {
        await client.query(
          `insert into whatsapp_throttle_buckets (
             tenant_id,workspace_id,organization_id,contact_id,provider,window_started_at,sent_count,updated_at
           ) values ($1,$2,$3,$4,$5,$6::timestamptz,1,$6::timestamptz)`,
          [
            input.tenantId,
            input.workspaceId,
            input.organizationId,
            input.contactId,
            WHATSAPP_PROVIDER_KEY,
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
      const elapsedSeconds = Math.max(
        0,
        Math.floor((Date.parse(now) - Date.parse(windowStartedAt)) / 1000),
      );
      if (elapsedSeconds >= input.windowSeconds) {
        await client.query(
          `update whatsapp_throttle_buckets set
             window_started_at=$6::timestamptz,sent_count=1,updated_at=$6::timestamptz
           where tenant_id=$1 and workspace_id=$2 and organization_id=$3
             and contact_id=$4 and provider=$5`,
          [
            input.tenantId,
            input.workspaceId,
            input.organizationId,
            input.contactId,
            WHATSAPP_PROVIDER_KEY,
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
        `update whatsapp_throttle_buckets set sent_count=$6,updated_at=$7::timestamptz
         where tenant_id=$1 and workspace_id=$2 and organization_id=$3
           and contact_id=$4 and provider=$5`,
        [
          input.tenantId,
          input.workspaceId,
          input.organizationId,
          input.contactId,
          WHATSAPP_PROVIDER_KEY,
          count,
          now,
        ],
      );
      return {
        allowed: true,
        count,
        limit: input.limit,
        windowStartedAt,
        retryAfterSeconds: 0,
      };
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
      readonly causationId: string;
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
        causationId: input.causationId,
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

function bindingFromRow(row: BindingRow): WhatsAppConversationBinding {
  return {
    bindingId: row.binding_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    conversationId: row.conversation_id,
    contactId: row.contact_id,
    metaAppId: row.meta_app_id,
    wabaId: row.waba_id,
    phoneNumberId: row.phone_number_id,
    recipientSha256: row.recipient_sha256,
    lastInboundAt: nullableIso(row.last_inbound_at),
    lastOutboundAt: nullableIso(row.last_outbound_at),
    humanHandoffAt: nullableIso(row.human_handoff_at),
    humanHandoffReason: row.human_handoff_reason,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function dispatchFromRow(row: DispatchRow): WhatsAppDispatchRecord {
  return {
    dispatchId: row.dispatch_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    messageId: row.message_id,
    conversationId: row.conversation_id,
    contactId: row.contact_id,
    provider: row.provider,
    preparedPayloadRef: row.prepared_payload_ref,
    purposeId: row.purpose_id,
    idempotencyKey: row.idempotency_key,
    providerMessageRef: row.provider_message_ref,
    state: row.state,
    attemptCount: row.attempt_count,
    nextRetryAt: nullableIso(row.next_retry_at),
    lastErrorCode: row.last_error_code,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function providerEventFromRow(row: ProviderEventRow): WhatsAppProviderEventRecord {
  return {
    eventId: row.event_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    messageId: row.message_id,
    providerMessageRef: row.provider_message_ref,
    providerEventRef: row.provider_event_ref,
    status: row.status,
    errorCode: row.error_code,
    errorTitle: row.error_title,
    observedAt: toIso(row.observed_at),
    evidence: stringArray(row.evidence),
    createdAt: toIso(row.created_at),
  };
}

function mediaFromRow(row: MediaRow): WhatsAppMediaRecord {
  return {
    mediaRecordId: row.media_record_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    messageId: row.message_id,
    direction: row.direction,
    providerMediaId: row.provider_media_id,
    mimeType: row.mime_type,
    fileName: row.file_name,
    sha256: row.sha256,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    storageRef: row.storage_ref,
    evidence: stringArray(row.evidence),
    createdAt: toIso(row.created_at),
  };
}

function deliveryState(
  current: WhatsAppDispatchState,
  status: WhatsAppProviderEventRecord['status'],
): WhatsAppDispatchState {
  if (status === 'FAILED') {
    return current === 'DELIVERED' || current === 'READ' ? current : 'FAILED';
  }
  const rank: Readonly<Record<WhatsAppDispatchState, number>> = {
    PREPARED: 0,
    SUBMITTED: 1,
    SENT: 2,
    DELIVERED: 3,
    READ: 4,
    FAILED_RETRYABLE: 0,
    FAILED: 0,
    DEAD_LETTER: 5,
  };
  return rank[status] > rank[current] ? status : current;
}

function activityVersion(record: WhatsAppConversationBinding): number {
  return Math.max(
    1,
    record.lastInboundAt ? Math.floor(Date.parse(record.lastInboundAt) / 1000) : 0,
    record.lastOutboundAt ? Math.floor(Date.parse(record.lastOutboundAt) / 1000) : 0,
    record.humanHandoffAt ? Math.floor(Date.parse(record.humanHandoffAt) / 1000) : 0,
  );
}

function validateScope(scope: CrmScope): void {
  requireText(scope.tenantId, 'WHATSAPP_TENANT_ID_REQUIRED');
  requireText(scope.workspaceId, 'WHATSAPP_WORKSPACE_ID_REQUIRED');
  requireText(scope.organizationId, 'WHATSAPP_ORGANIZATION_ID_REQUIRED');
}

function normalizeEvidence(evidence: readonly string[]): readonly string[] {
  const normalized = [...new Set(evidence.map((value) => value.trim()).filter(Boolean))].sort();
  if (normalized.length === 0) throw new Error('WHATSAPP_EVIDENCE_REQUIRED');
  return normalized;
}

function normalizeNow(value: string | undefined): string {
  return normalizeTimestamp(value ?? new Date().toISOString(), 'WHATSAPP_NOW_INVALID');
}

function normalizeTimestamp(value: string, errorCode: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error(errorCode);
  return new Date(value).toISOString();
}

function requireText(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}

function assertSha256(value: string, errorCode: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(errorCode);
}

function assertPositiveInteger(value: number, errorCode: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(errorCode);
}

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('WHATSAPP_TIMESTAMP_INVALID');
  return date.toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error('WHATSAPP_EVIDENCE_INVALID');
  }
  return value;
}

function requiredRow<T>(value: T | undefined, errorCode: string): T {
  if (value === undefined) throw new Error(errorCode);
  return value;
}
