import { describe, expect, it } from 'vitest';
import { PostgresWhatsAppRuntimeStore } from '../src/persistence/postgres-whatsapp-runtime-store.js';
import { createPostgresPool } from '../src/persistence/postgres.js';

const DATABASE_URL = process.env.DATABASE_URL;
const postgresDescribe = DATABASE_URL ? describe : describe.skip;

function databaseUrl(): string {
  if (!DATABASE_URL) throw new Error('WHATSAPP_DATABASE_URL_REQUIRED');
  return DATABASE_URL;
}

postgresDescribe('WhatsApp provider runtime PostgreSQL E2E', () => {
  it('preserves binding, callback, retry, throttle and outbox idempotency across restart', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const scope = {
      tenantId: `wa-tenant-${suffix}`,
      workspaceId: `wa-workspace-${suffix}`,
      organizationId: `wa-org-${suffix}`,
    } as const;
    const contactId = `wa-contact-${suffix}`;
    const conversationId = `wa-conversation-${suffix}`;
    const messageId = `wa-message-${suffix}`;
    const retryMessageId = `wa-retry-message-${suffix}`;
    const providerMessageRef = `wamid.${suffix}`;
    const evidence = [`test:whatsapp:${suffix}`] as const;
    const now = '2026-08-20T05:00:00.000Z';
    const hash = 'a'.repeat(64);

    const pool1 = createPostgresPool({ connectionString: databaseUrl(), max: 4 });
    try {
      await pool1.query(
        `insert into crm_contacts (
           contact_id,tenant_id,workspace_id,organization_id,contact_type,display_name,status,
           attributes,version,created_at,updated_at
         ) values ($1,$2,$3,$4,'PERSON','WhatsApp E2E','ACTIVE','{}'::jsonb,1,$5::timestamptz,$5::timestamptz)`,
        [contactId, scope.tenantId, scope.workspaceId, scope.organizationId, now],
      );
      await pool1.query(
        `insert into crm_conversations (
           conversation_id,tenant_id,workspace_id,organization_id,contact_id,lead_id,channel,
           language,status,started_at,last_message_at,closed_at,attributes,version,created_at,updated_at
         ) values ($1,$2,$3,$4,$5,null,'WHATSAPP','pt-BR','OPEN',$6::timestamptz,null,null,'{}'::jsonb,1,$6::timestamptz,$6::timestamptz)`,
        [conversationId, scope.tenantId, scope.workspaceId, scope.organizationId, contactId, now],
      );
      for (const currentMessageId of [messageId, retryMessageId]) {
        await pool1.query(
          `insert into crm_messages (
             message_id,conversation_id,tenant_id,workspace_id,organization_id,contact_id,lead_id,
             direction,channel,language,content_ref,content_sha256,provider_message_ref,intent,urgency,
             occurred_at,evidence,created_at
           ) values ($1,$2,$3,$4,$5,$6,null,'OUTBOUND','WHATSAPP','pt-BR',$7,$8,null,null,null,
             $9::timestamptz,$10::jsonb,$9::timestamptz)`,
          [
            currentMessageId,
            conversationId,
            scope.tenantId,
            scope.workspaceId,
            scope.organizationId,
            contactId,
            `prepared:${currentMessageId}`,
            hash,
            now,
            JSON.stringify(evidence),
          ],
        );
      }

      const store = new PostgresWhatsAppRuntimeStore(pool1);
      const bindingInput = {
        ...scope,
        bindingId: `binding-${suffix}`,
        conversationId,
        contactId,
        metaAppId: 'app-e2e',
        wabaId: 'waba-e2e',
        phoneNumberId: 'phone-e2e',
        recipientSha256: hash,
        executionId: `binding-exec-${suffix}`,
        correlationId: `corr-${suffix}`,
        actorPrincipalId: 'ag-01',
        idempotencyKey: `binding-${suffix}`,
        evidence,
        now,
      } as const;
      const binding = await store.ensureBinding(bindingInput);
      await expect(store.ensureBinding(bindingInput)).resolves.toEqual(binding);

      await store.touchBinding({
        ...scope,
        conversationId,
        direction: 'INBOUND',
        occurredAt: now,
        executionId: `touch-${suffix}`,
        correlationId: `corr-${suffix}`,
        actorPrincipalId: 'ag-01',
        idempotencyKey: `touch-${suffix}`,
        evidence,
        now,
      });

      const mediaInput = {
        ...scope,
        mediaRecordId: `media-${suffix}`,
        messageId,
        direction: 'OUTBOUND' as const,
        providerMediaId: `provider-media-${suffix}`,
        mimeType: 'image/jpeg',
        fileName: 'image.jpg',
        sha256: hash,
        sizeBytes: 42,
        storageRef: null,
        executionId: `media-exec-${suffix}`,
        correlationId: `corr-${suffix}`,
        actorPrincipalId: 'ag-01',
        idempotencyKey: `media-${suffix}`,
        evidence,
        now,
      };
      const media = await store.recordMedia(mediaInput);
      await expect(store.recordMedia(mediaInput)).resolves.toEqual(media);

      const dispatchInput = {
        ...scope,
        dispatchId: `dispatch-${suffix}`,
        messageId,
        conversationId,
        contactId,
        preparedPayloadRef: `prepared:${messageId}`,
        purposeId: 'customer-service',
        executionId: `dispatch-exec-${suffix}`,
        correlationId: `corr-${suffix}`,
        actorPrincipalId: 'ag-01',
        idempotencyKey: `dispatch-${suffix}`,
        evidence,
        now,
      } as const;
      const dispatch = await store.createDispatch(dispatchInput);
      await expect(store.createDispatch(dispatchInput)).resolves.toEqual(dispatch);
      await store.updateDispatch({
        ...scope,
        dispatchId: dispatch.dispatchId,
        expectedState: 'PREPARED',
        state: 'SUBMITTED',
        providerMessageRef,
        attemptCount: 1,
        nextRetryAt: null,
        lastErrorCode: null,
        executionId: `submitted-${suffix}`,
        correlationId: `corr-${suffix}`,
        actorPrincipalId: 'ag-01',
        idempotencyKey: `submitted-${suffix}`,
        evidence,
        now,
      });

      const callbackInput = {
        ...scope,
        eventId: `provider-event-${suffix}`,
        providerMessageRef,
        providerEventRef: `provider-event-ref-${suffix}`,
        status: 'DELIVERED' as const,
        observedAt: '2026-08-20T05:00:05.000Z',
        executionId: `callback-exec-${suffix}`,
        correlationId: `corr-${suffix}`,
        actorPrincipalId: 'ag-01',
        idempotencyKey: `callback-${suffix}`,
        evidence,
        now: '2026-08-20T05:00:05.000Z',
      };
      const callback = await store.recordProviderEvent(callbackInput);
      await expect(store.recordProviderEvent(callbackInput)).resolves.toEqual(callback);

      const retryDispatch = await store.createDispatch({
        ...dispatchInput,
        dispatchId: `retry-dispatch-${suffix}`,
        messageId: retryMessageId,
        preparedPayloadRef: `prepared:${retryMessageId}`,
        idempotencyKey: `retry-dispatch-${suffix}`,
      });
      await store.updateDispatch({
        ...scope,
        dispatchId: retryDispatch.dispatchId,
        expectedState: 'PREPARED',
        state: 'SUBMITTED',
        attemptCount: 1,
        nextRetryAt: null,
        lastErrorCode: null,
        executionId: `retry-submitted-${suffix}`,
        correlationId: `corr-${suffix}`,
        actorPrincipalId: 'ag-01',
        idempotencyKey: `retry-submitted-${suffix}`,
        evidence,
        now,
      });
      await store.updateDispatch({
        ...scope,
        dispatchId: retryDispatch.dispatchId,
        expectedState: 'SUBMITTED',
        state: 'FAILED_RETRYABLE',
        attemptCount: 1,
        nextRetryAt: '2026-08-20T05:00:10.000Z',
        lastErrorCode: 'WHATSAPP_PROVIDER_RATE_LIMITED:429',
        executionId: `retry-failed-${suffix}`,
        correlationId: `corr-${suffix}`,
        actorPrincipalId: 'ag-01',
        idempotencyKey: `retry-failed-${suffix}`,
        evidence,
        now,
      });
      await expect(
        store.updateDispatch({
          ...scope,
          dispatchId: retryDispatch.dispatchId,
          expectedState: 'FAILED_RETRYABLE',
          state: 'SUBMITTED',
          attemptCount: 2,
          nextRetryAt: null,
          lastErrorCode: null,
          executionId: `retry-second-${suffix}`,
          correlationId: `corr-${suffix}`,
          actorPrincipalId: 'ag-01',
          idempotencyKey: `retry-second-${suffix}`,
          evidence,
          now: '2026-08-20T05:00:10.000Z',
        }),
      ).resolves.toMatchObject({ state: 'SUBMITTED', attemptCount: 2 });

      const firstThrottle = await store.consumeThrottle({
        ...scope,
        contactId,
        windowSeconds: 60,
        limit: 1,
        now,
      });
      const blockedThrottle = await store.consumeThrottle({
        ...scope,
        contactId,
        windowSeconds: 60,
        limit: 1,
        now: '2026-08-20T05:00:01.000Z',
      });
      expect(firstThrottle.allowed).toBe(true);
      expect(blockedThrottle).toMatchObject({ allowed: false, count: 1, limit: 1 });

      const evidenceRows = await pool1.query<{ callback_count: number; outbox_count: number }>(
        `select
           (select count(*)::int from whatsapp_provider_events where message_id=$1) as callback_count,
           (select count(*)::int from event_outbox where aggregate_id in ($1,$2,$3)) as outbox_count`,
        [messageId, dispatch.dispatchId, binding.bindingId],
      );
      expect(evidenceRows.rows[0]?.callback_count).toBe(1);
      expect(evidenceRows.rows[0]?.outbox_count).toBeGreaterThanOrEqual(4);
    } finally {
      await pool1.end();
    }

    const pool2 = createPostgresPool({ connectionString: databaseUrl(), max: 4 });
    try {
      const restarted = new PostgresWhatsAppRuntimeStore(pool2);
      await expect(
        restarted.getDispatchByProviderMessageRef({ ...scope, providerMessageRef }),
      ).resolves.toMatchObject({
        messageId,
        conversationId,
        providerMessageRef,
        state: 'DELIVERED',
        attemptCount: 1,
      });
      await expect(
        restarted.getBindingByConversation({ ...scope, conversationId }),
      ).resolves.toMatchObject({
        conversationId,
        contactId,
        lastInboundAt: now,
      });
    } finally {
      await pool2.end();
    }
  });
});
