import type pg from 'pg';
import type { CrmScope } from '../crm/crm-records.js';
import { createDomainEvent } from '../events/domain-events.js';
import { PostgresTransactionalOutbox } from '../events/postgres-transactional-outbox.js';
import type { TransactionalOutboxWriter } from '../events/transactional-outbox.js';
import type {
  ConsumeWhatsAppThrottleInput,
  CreateWhatsAppDispatchInput,
  EnsureWhatsAppBindingInput,
  MarkWhatsAppHandoffInput,
  RecordWhatsAppMediaInput,
  RecordWhatsAppProviderEventInput,
  TouchWhatsAppBindingInput,
  UpdateWhatsAppDispatchInput,
  WhatsAppConversationBinding,
  WhatsAppDispatchRecord,
  WhatsAppDispatchState,
  WhatsAppMediaRecord,
  WhatsAppProviderEventRecord,
  WhatsAppRuntimeStore,
  WhatsAppThrottleDecision,
} from '../omnichannel/whatsapp-runtime-contracts.js';
import { WHATSAPP_PROVIDER_KEY } from '../omnichannel/whatsapp-runtime-contracts.js';
import { appendInternalAuditLedgerEvent } from './postgres-internal-audit-ledger.js';

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
    validateMutation(input);
    assertSha256(input.recipientSha256, 'WHATSAPP_RECIPIENT_SHA256_INVALID');
    const now = normalizeNow(input.now);
    return this.#transaction(async (client) => {
      const inserted = await client.query<BindingRow>(
        `insert into whatsapp_conversation_bindings (
           binding_id,tenant_id,workspace_id,organization_id,conversation_id,contact_id,
           meta_app_id,waba_id,phone_number_id,recipient_sha256,last_inbound_at,last_outbound_at,
           human_handoff_at,human_handoff_reason,created_at,updated_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,null,null,null,null,$11::timestamptz,$11::timestamptz)
         on conflict (tenant_id,workspace_id,organization_id,conversation_id) do nothing
         returning *`,
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
      const row = inserted.rows[0]
        ? inserted.rows[0]
        : await selectBindingByConversation(client, input, input.conversationId);
      const record = bindingFromRow(row);
      assertBindingIdentity(record, input);
      if (inserted.rows[0]) {
        await this.#recordMutation(client, input, {
          operation: 'whatsapp.binding.created',
          aggregateId: record.bindingId,
          contactId: record.contactId,
          occurredAt: now,
          payload: {
            conversationId: record.conversationId,
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
    validateMutation(input);
    const occurredAt = normalizeTimestamp(input.occurredAt, 'WHATSAPP_ACTIVITY_AT_INVALID');
    const now = normalizeNow(input.now);
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
          requireText(input.conversationId, 'WHATSAPP_CONVERSATION_ID_REQUIRED'),
          input.direction,
          occurredAt,
          now,
        ],
      );
      const record = bindingFromRow(requiredRow(result.rows[0], 'WHATSAPP_BINDING_NOT_FOUND'));
      await this.#recordMutation(client, input, {
        operation: 'whatsapp.binding.activity',
        aggregateId: record.bindingId,
        contactId: record.contactId,
        occurredAt,
        payload: { conversationId: record.conversationId, direction: input.direction },
      });
      return record;
    });
  }

  async markHumanHandoff(input: MarkWhatsAppHandoffInput): Promise<WhatsAppConversationBinding> {
    validateMutation(input);
    const now = normalizeNow(input.now);
    return this.#transaction(async (client) => {
      const result = await client.query<BindingRow>(
        `update whatsapp_conversation_bindings set
           human_handoff_at=coalesce(human_handoff_at,$5::timestamptz),
           human_handoff_reason=coalesce(human_handoff_reason,$6),
           updated_at=greatest(updated_at,$5::timestamptz)
         where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and conversation_id=$4
         returning *`,
        [
          input.tenantId,
          input.workspaceId,
          input.organizationId,
          requireText(input.conversationId, 'WHATSAPP_CONVERSATION_ID_REQUIRED'),
          now,
          requireText(input.reason, 'WHATSAPP_HANDOFF_REASON_REQUIRED'),
        ],
      );
      const record = bindingFromRow(requiredRow(result.rows[0], 'WHATSAPP_BINDING_NOT_FOUND'));
      await this.#recordMutation(client, input, {
        operation: 'whatsapp.handoff.marked',
        aggregateId: record.bindingId,
        contactId: record.contactId,
        occurredAt: now,
        payload: { conversationId: record.conversationId, reason: record.humanHandoffReason },
      });
      return record;
    });
  }

  async recordMedia(input: RecordWhatsAppMediaInput): Promise<WhatsAppMediaRecord> {
    validateMutation(input);
    const evidence = requireEvidence(input.evidence);
    if (input.sha256) assertSha256(input.sha256, 'WHATSAPP_MEDIA_SHA256_INVALID');
    if (input.sizeBytes !== undefined && input.sizeBytes !== null) {
      if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0) {
        throw new Error('WHATSAPP_MEDIA_SIZE_INVALID');
      }
    }
    const now = normalizeNow(input.now);
    return this.#transaction(async (client) => {
      const inserted = await client.query<MediaRow>(
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
          nullableText(input.mimeType),
          nullableText(input.fileName),
          input.sha256 ?? null,
          input.sizeBytes ?? null,
          nullableText(input.storageRef),
          JSON.stringify(evidence),
          now,
        ],
      );
      const row = inserted.rows[0]
        ? inserted.rows[0]
        : await selectMedia(client, input, input.mediaRecordId);
      const record = mediaFromRow(row);
      if (
        record.messageId !== input.messageId ||
        record.providerMediaId !== input.providerMediaId
      ) {
        throw new Error('WHATSAPP_MEDIA_IDEMPOTENCY_CONFLICT');
      }
      if (inserted.rows[0]) {
        const contactId = await contactForMessage(client, input, input.messageId);
        await this.#recordMutation(client, input, {
          operation: 'whatsapp.media.recorded',
          aggregateId: record.mediaRecordId,
          contactId,
          occurredAt: now,
          payload: {
            messageId: record.messageId,
            direction: record.direction,
            providerMediaId: record.providerMediaId,
          },
        });
      }
      return record;
    });
  }

  async createDispatch(input: CreateWhatsAppDispatchInput): Promise<WhatsAppDispatchRecord> {
    validateMutation(input);
    const now = normalizeNow(input.now);
    return this.#transaction(async (client) => {
      const inserted = await client.query<DispatchRow>(
        `insert into whatsapp_dispatches (
           dispatch_id,tenant_id,workspace_id,organization_id,message_id,conversation_id,contact_id,
           provider,prepared_payload_ref,purpose_id,idempotency_key,provider_message_ref,state,
           attempt_count,next_retry_at,last_error_code,created_at,updated_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,null,'PREPARED',0,null,null,$12::timestamptz,$12::timestamptz)
         on conflict (tenant_id,workspace_id,organization_id,provider,idempotency_key) do nothing
         returning *`,
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
          requireText(input.idempotencyKey, 'WHATSAPP_IDEMPOTENCY_KEY_REQUIRED'),
          now,
        ],
      );
      const row = inserted.rows[0]
        ? inserted.rows[0]
        : await selectDispatchByIdempotency(client, input, input.idempotencyKey);
      const record = dispatchFromRow(row);
      assertDispatchIdentity(record, input);
      if (inserted.rows[0]) {
        await this.#recordMutation(client, input, {
          operation: 'whatsapp.dispatch.created',
          aggregateId: record.dispatchId,
          contactId: record.contactId,
          occurredAt: now,
          payload: {
            messageId: record.messageId,
            conversationId: record.conversationId,
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
    validateMutation(input);
    assertDispatchTransition(input.expectedState, input.state);
    if (!Number.isSafeInteger(input.attemptCount) || input.attemptCount < 0) {
      throw new Error('WHATSAPP_ATTEMPT_COUNT_INVALID');
    }
    if (input.state === 'FAILED_RETRYABLE' && !input.nextRetryAt) {
      throw new Error('WHATSAPP_RETRY_AT_REQUIRED');
    }
    const now = normalizeNow(input.now);
    return this.#transaction(async (client) => {
      const result = await client.query<DispatchRow>(
        `update whatsapp_dispatches set
           state=$5,provider_message_ref=coalesce($6,provider_message_ref),attempt_count=$7,
           next_retry_at=$8::timestamptz,last_error_code=$9,updated_at=$10::timestamptz
         where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and dispatch_id=$4 and state=$11
         returning *`,
        [
          input.tenantId,
          input.workspaceId,
          input.organizationId,
          requireText(input.dispatchId, 'WHATSAPP_DISPATCH_ID_REQUIRED'),
          input.state,
          nullableText(input.providerMessageRef),
          input.attemptCount,
          input.nextRetryAt ?? null,
          nullableText(input.lastErrorCode),
          now,
          input.expectedState,
        ],
      );
      const record = dispatchFromRow(
        requiredRow(result.rows[0], 'WHATSAPP_DISPATCH_STATE_CONFLICT'),
      );
      await this.#recordMutation(client, input, {
        operation: 'whatsapp.dispatch.updated',
        aggregateId: record.dispatchId,
        contactId: record.contactId,
        occurredAt: now,
        payload: {
          messageId: record.messageId,
          state: record.state,
          attemptCount: record.attemptCount,
          providerMessageRef: record.providerMessageRef,
          lastErrorCode: record.lastErrorCode,
        },
      });
      return record;
    });
  }

  async recordProviderEvent(
    input: RecordWhatsAppProviderEventInput,
  ): Promise<WhatsAppProviderEventRecord> {
    validateMutation(input);
    const evidence = requireEvidence(input.evidence);
    const observedAt = normalizeTimestamp(input.observedAt, 'WHATSAPP_PROVIDER_EVENT_AT_INVALID');
    const now = normalizeNow(input.now ?? observedAt);
    return this.#transaction(async (client) => {
      const dispatch = dispatchFromRow(
        await selectDispatchByProviderRefForUpdate(client, input, input.providerMessageRef),
      );
      const inserted = await client.query<ProviderEventRow>(
        `insert into whatsapp_provider_events (
           event_id,tenant_id,workspace_id,organization_id,message_id,provider_message_ref,
           provider_event_ref,status,error_code,error_title,observed_at,evidence,created_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz,$12::jsonb,$13::timestamptz)
         on conflict (tenant_id,workspace_id,organization_id,provider_event_ref) do nothing
         returning *`,
        [
          requireText(input.eventId, 'WHATSAPP_PROVIDER_EVENT_ID_REQUIRED'),
          input.tenantId,
          input.workspaceId,
          input.organizationId,
          dispatch.messageId,
          requireText(input.providerMessageRef, 'WHATSAPP_PROVIDER_MESSAGE_REF_REQUIRED'),
          requireText(input.providerEventRef, 'WHATSAPP_PROVIDER_EVENT_REF_REQUIRED'),
          input.status,
          nullableText(input.errorCode),
          nullableText(input.errorTitle),
          observedAt,
          JSON.stringify(evidence),
          now,
        ],
      );
      const row = inserted.rows[0]
        ? inserted.rows[0]
        : await selectProviderEvent(client, input, input.providerEventRef);
      const record = providerEventFromRow(row);
      if (
        record.providerMessageRef !== input.providerMessageRef ||
        record.status !== input.status
      ) {
        throw new Error('WHATSAPP_PROVIDER_EVENT_IDEMPOTENCY_CONFLICT');
      }
      if (inserted.rows[0]) {
        const targetState = stateForProviderStatus(input.status);
        if (shouldAdvanceDispatch(dispatch.state, targetState)) {
          await client.query(
            `update whatsapp_dispatches set state=$5,next_retry_at=null,
               last_error_code=case when $5='FAILED' then coalesce($6,last_error_code) else last_error_code end,
               updated_at=greatest(updated_at,$7::timestamptz)
             where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and dispatch_id=$4`,
            [
              input.tenantId,
              input.workspaceId,
              input.organizationId,
              dispatch.dispatchId,
              targetState,
              nullableText(input.errorCode),
              observedAt,
            ],
          );
        }
        await this.#recordMutation(client, input, {
          operation: 'whatsapp.provider_event.recorded',
          aggregateId: record.eventId,
          contactId: dispatch.contactId,
          occurredAt: observedAt,
          payload: {
            messageId: record.messageId,
            providerMessageRef: record.providerMessageRef,
            status: record.status,
            errorCode: record.errorCode,
          },
        });
      }
      return record;
    });
  }

  async consumeThrottle(input: ConsumeWhatsAppThrottleInput): Promise<WhatsAppThrottleDecision> {
    validateScope(input);
    if (!Number.isSafeInteger(input.windowSeconds) || input.windowSeconds < 1) {
      throw new Error('WHATSAPP_THROTTLE_WINDOW_INVALID');
    }
    if (!Number.isSafeInteger(input.limit) || input.limit < 1) {
      throw new Error('WHATSAPP_THROTTLE_LIMIT_INVALID');
    }
    const now = normalizeTimestamp(input.now, 'WHATSAPP_THROTTLE_NOW_INVALID');
    return this.#transaction(async (client) => {
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [
        `${input.tenantId}:${input.workspaceId}:${input.organizationId}:${input.contactId}:${WHATSAPP_PROVIDER_KEY}`,
      ]);
      const current = await client.query<ThrottleRow>(
        `select window_started_at,sent_count from whatsapp_throttle_buckets
         where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and contact_id=$4 and provider=$5
         for update`,
        [
          input.tenantId,
          input.workspaceId,
          input.organizationId,
          requireText(input.contactId, 'WHATSAPP_CONTACT_ID_REQUIRED'),
          WHATSAPP_PROVIDER_KEY,
        ],
      );
      const nowMs = Date.parse(now);
      const row = current.rows[0];
      if (!row || nowMs - Date.parse(iso(row.window_started_at)) >= input.windowSeconds * 1000) {
        await client.query(
          `insert into whatsapp_throttle_buckets (
             tenant_id,workspace_id,organization_id,contact_id,provider,window_started_at,sent_count,updated_at
           ) values ($1,$2,$3,$4,$5,$6::timestamptz,1,$6::timestamptz)
           on conflict (tenant_id,workspace_id,organization_id,contact_id,provider)
           do update set window_started_at=excluded.window_started_at,sent_count=1,updated_at=excluded.updated_at`,
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

      const startedAt = iso(row.window_started_at);
      const elapsedSeconds = Math.max(0, Math.floor((nowMs - Date.parse(startedAt)) / 1000));
      const retryAfterSeconds = Math.max(0, input.windowSeconds - elapsedSeconds);
      if (row.sent_count >= input.limit) {
        return {
          allowed: false,
          count: row.sent_count,
          limit: input.limit,
          windowStartedAt: startedAt,
          retryAfterSeconds,
        };
      }
      const nextCount = row.sent_count + 1;
      await client.query(
        `update whatsapp_throttle_buckets set sent_count=$6,updated_at=$7::timestamptz
         where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and contact_id=$4 and provider=$5`,
        [
          input.tenantId,
          input.workspaceId,
          input.organizationId,
          input.contactId,
          WHATSAPP_PROVIDER_KEY,
          nextCount,
          now,
        ],
      );
      return {
        allowed: true,
        count: nextCount,
        limit: input.limit,
        windowStartedAt: startedAt,
        retryAfterSeconds: 0,
      };
    });
  }

  async #recordMutation(
    client: pg.PoolClient,
    input: WhatsAppMutationMetadataLike,
    event: {
      readonly operation: string;
      readonly aggregateId: string;
      readonly contactId: string;
      readonly occurredAt: string;
      readonly payload: Readonly<Record<string, unknown>>;
    },
  ): Promise<void> {
    const evidence = requireEvidence(input.evidence);
    await this.#outbox.enqueue(
      client,
      createDomainEvent({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        organizationId: input.organizationId,
        eventKey: `${event.operation}:${input.idempotencyKey}`,
        eventType: event.operation,
        aggregateType: 'WHATSAPP_TRANSPORT',
        aggregateId: event.aggregateId,
        aggregateVersion: 1,
        correlationId: input.correlationId,
        causationId: input.executionId,
        occurredAt: event.occurredAt,
        payload: event.payload,
        evidence,
      }),
    );
    await appendInternalAuditLedgerEvent(client, {
      operation: event.operation,
      recordType: 'CONTACT',
      recordId: event.contactId,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      organizationId: input.organizationId,
      executionId: input.executionId,
      correlationId: input.correlationId,
      actorPrincipalId: input.actorPrincipalId,
      evidence,
      createdAt: event.occurredAt,
    });
  }

  async #transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await work(client);
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

type WhatsAppMutationMetadataLike = CrmScope & {
  readonly executionId: string;
  readonly correlationId: string;
  readonly actorPrincipalId: string;
  readonly idempotencyKey: string;
  readonly evidence: readonly string[];
};

function validateScope(scope: CrmScope): void {
  requireText(scope.tenantId, 'WHATSAPP_TENANT_ID_REQUIRED');
  requireText(scope.workspaceId, 'WHATSAPP_WORKSPACE_ID_REQUIRED');
  requireText(scope.organizationId, 'WHATSAPP_ORGANIZATION_ID_REQUIRED');
}

function validateMutation(input: WhatsAppMutationMetadataLike): void {
  validateScope(input);
  requireText(input.executionId, 'WHATSAPP_EXECUTION_ID_REQUIRED');
  requireText(input.correlationId, 'WHATSAPP_CORRELATION_ID_REQUIRED');
  requireText(input.actorPrincipalId, 'WHATSAPP_ACTOR_PRINCIPAL_ID_REQUIRED');
  requireText(input.idempotencyKey, 'WHATSAPP_IDEMPOTENCY_KEY_REQUIRED');
  requireEvidence(input.evidence);
}

function assertBindingIdentity(
  record: WhatsAppConversationBinding,
  input: EnsureWhatsAppBindingInput,
): void {
  if (
    record.bindingId !== input.bindingId ||
    record.contactId !== input.contactId ||
    record.metaAppId !== input.metaAppId ||
    record.wabaId !== input.wabaId ||
    record.phoneNumberId !== input.phoneNumberId ||
    record.recipientSha256 !== input.recipientSha256
  ) {
    throw new Error('WHATSAPP_BINDING_IDEMPOTENCY_CONFLICT');
  }
}

function assertDispatchIdentity(
  record: WhatsAppDispatchRecord,
  input: CreateWhatsAppDispatchInput,
): void {
  if (
    record.dispatchId !== input.dispatchId ||
    record.messageId !== input.messageId ||
    record.conversationId !== input.conversationId ||
    record.contactId !== input.contactId ||
    record.preparedPayloadRef !== input.preparedPayloadRef ||
    record.purposeId !== input.purposeId
  ) {
    throw new Error('WHATSAPP_DISPATCH_IDEMPOTENCY_CONFLICT');
  }
}

function assertDispatchTransition(
  current: WhatsAppDispatchState,
  next: WhatsAppDispatchState,
): void {
  if (current === next) return;
  const transitions: Readonly<Record<WhatsAppDispatchState, readonly WhatsAppDispatchState[]>> = {
    PREPARED: ['SUBMITTED', 'FAILED_RETRYABLE', 'FAILED', 'DEAD_LETTER'],
    SUBMITTED: ['SENT', 'DELIVERED', 'READ', 'FAILED', 'DEAD_LETTER'],
    SENT: ['DELIVERED', 'READ', 'FAILED'],
    DELIVERED: ['READ'],
    READ: [],
    FAILED_RETRYABLE: ['PREPARED', 'FAILED', 'DEAD_LETTER'],
    FAILED: [],
    DEAD_LETTER: [],
  };
  if (!transitions[current].includes(next)) {
    throw new Error(`WHATSAPP_DISPATCH_TRANSITION_INVALID:${current}->${next}`);
  }
}

function shouldAdvanceDispatch(
  current: WhatsAppDispatchState,
  target: WhatsAppDispatchState,
): boolean {
  if (current === 'READ' || current === 'DEAD_LETTER') return false;
  if (target === 'FAILED') return current !== 'DELIVERED';
  const rank: Readonly<Record<WhatsAppDispatchState, number>> = {
    PREPARED: 0,
    FAILED_RETRYABLE: 0,
    SUBMITTED: 1,
    SENT: 2,
    DELIVERED: 3,
    READ: 4,
    FAILED: 5,
    DEAD_LETTER: 6,
  };
  return rank[target] > rank[current];
}

function stateForProviderStatus(
  status: WhatsAppProviderEventRecord['status'],
): WhatsAppDispatchState {
  switch (status) {
    case 'SENT':
      return 'SENT';
    case 'DELIVERED':
      return 'DELIVERED';
    case 'READ':
      return 'READ';
    case 'FAILED':
      return 'FAILED';
  }
}

async function selectBindingByConversation(
  client: pg.PoolClient,
  scope: CrmScope,
  conversationId: string,
): Promise<BindingRow> {
  const result = await client.query<BindingRow>(
    `select * from whatsapp_conversation_bindings
     where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and conversation_id=$4`,
    [scope.tenantId, scope.workspaceId, scope.organizationId, conversationId],
  );
  return requiredRow(result.rows[0], 'WHATSAPP_BINDING_REPLAY_MISSING');
}

async function selectDispatchByIdempotency(
  client: pg.PoolClient,
  scope: CrmScope,
  idempotencyKey: string,
): Promise<DispatchRow> {
  const result = await client.query<DispatchRow>(
    `select * from whatsapp_dispatches
     where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and provider=$4 and idempotency_key=$5`,
    [
      scope.tenantId,
      scope.workspaceId,
      scope.organizationId,
      WHATSAPP_PROVIDER_KEY,
      idempotencyKey,
    ],
  );
  return requiredRow(result.rows[0], 'WHATSAPP_DISPATCH_REPLAY_MISSING');
}

async function selectDispatchByProviderRefForUpdate(
  client: pg.PoolClient,
  scope: CrmScope,
  providerMessageRef: string,
): Promise<DispatchRow> {
  const result = await client.query<DispatchRow>(
    `select * from whatsapp_dispatches
     where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and provider=$4 and provider_message_ref=$5
     for update`,
    [
      scope.tenantId,
      scope.workspaceId,
      scope.organizationId,
      WHATSAPP_PROVIDER_KEY,
      providerMessageRef,
    ],
  );
  return requiredRow(result.rows[0], 'WHATSAPP_DISPATCH_PROVIDER_REF_NOT_FOUND');
}

async function selectProviderEvent(
  client: pg.PoolClient,
  scope: CrmScope,
  providerEventRef: string,
): Promise<ProviderEventRow> {
  const result = await client.query<ProviderEventRow>(
    `select * from whatsapp_provider_events
     where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and provider_event_ref=$4`,
    [scope.tenantId, scope.workspaceId, scope.organizationId, providerEventRef],
  );
  return requiredRow(result.rows[0], 'WHATSAPP_PROVIDER_EVENT_REPLAY_MISSING');
}

async function selectMedia(
  client: pg.PoolClient,
  scope: CrmScope,
  mediaRecordId: string,
): Promise<MediaRow> {
  const result = await client.query<MediaRow>(
    `select * from whatsapp_message_media
     where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and media_record_id=$4`,
    [scope.tenantId, scope.workspaceId, scope.organizationId, mediaRecordId],
  );
  return requiredRow(result.rows[0], 'WHATSAPP_MEDIA_REPLAY_MISSING');
}

async function contactForMessage(
  client: pg.PoolClient,
  scope: CrmScope,
  messageId: string,
): Promise<string> {
  const result = await client.query<{ contact_id: string }>(
    `select contact_id from crm_messages
     where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and message_id=$4`,
    [scope.tenantId, scope.workspaceId, scope.organizationId, messageId],
  );
  return requiredRow(result.rows[0], 'WHATSAPP_MESSAGE_NOT_FOUND').contact_id;
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
    lastInboundAt: isoOrNull(row.last_inbound_at),
    lastOutboundAt: isoOrNull(row.last_outbound_at),
    humanHandoffAt: isoOrNull(row.human_handoff_at),
    humanHandoffReason: row.human_handoff_reason,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
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
    nextRetryAt: isoOrNull(row.next_retry_at),
    lastErrorCode: row.last_error_code,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
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
    observedAt: iso(row.observed_at),
    evidence: strings(row.evidence),
    createdAt: iso(row.created_at),
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
    evidence: strings(row.evidence),
    createdAt: iso(row.created_at),
  };
}

function requireEvidence(value: readonly string[]): readonly string[] {
  const normalized = value.map((item) => item.trim()).filter(Boolean);
  if (normalized.length === 0) throw new Error('WHATSAPP_EVIDENCE_REQUIRED');
  return [...new Set(normalized)];
}

function assertSha256(value: string, code: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(code);
}

function normalizeNow(value: string | undefined): string {
  return normalizeTimestamp(value ?? new Date().toISOString(), 'WHATSAPP_NOW_INVALID');
}

function normalizeTimestamp(value: string, code: string): string {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(code);
  return new Date(ms).toISOString();
}

function nullableText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.trim();
  return normalized || null;
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
  return new Date(value).toISOString();
}

function isoOrNull(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

function requiredRow<T>(value: T | undefined, code: string): T {
  if (!value) throw new Error(code);
  return value;
}
