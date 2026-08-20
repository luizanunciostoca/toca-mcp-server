import { describe, expect, it } from 'vitest';
import { PostgresCrmCommunicationStore } from '../src/persistence/postgres-crm-communication-store.js';
import { createPostgresPool } from '../src/persistence/postgres.js';

const DATABASE_URL = process.env.DATABASE_URL;
const postgresDescribe = DATABASE_URL ? describe : describe.skip;

function databaseUrl(): string {
  if (!DATABASE_URL) throw new Error('WHATSAPP_DATABASE_URL_REQUIRED');
  return DATABASE_URL;
}

postgresDescribe('WhatsApp CRM communication PostgreSQL E2E', () => {
  it('keeps message/status idempotency, outbox evidence, throttle and readback across restart', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const tenantId = `wa-tenant-${suffix}`;
    const workspaceId = `wa-workspace-${suffix}`;
    const organizationId = `wa-org-${suffix}`;
    const contactId = `wa-contact-${suffix}`;
    const conversationId = `wa-conversation-${suffix}`;
    const messageId = `wa-message-${suffix}`;
    const providerMessageId = `wamid.${suffix}`;
    const scope = { tenantId, workspaceId, organizationId } as const;
    const evidence = [`test:whatsapp:${suffix}`] as const;
    const now = '2026-08-20T04:00:00.000Z';

    const pool1 = createPostgresPool({ connectionString: databaseUrl(), max: 4 });
    try {
      await pool1.query(
        `insert into crm_contacts (
           contact_id, tenant_id, workspace_id, organization_id, contact_type,
           display_name, status, attributes, version, created_at, updated_at
         ) values ($1,$2,$3,$4,'PERSON','WhatsApp E2E','ACTIVE','{}'::jsonb,1,$5::timestamptz,$5::timestamptz)`,
        [contactId, tenantId, workspaceId, organizationId, now],
      );

      const store = new PostgresCrmCommunicationStore(pool1);
      const conversation = await store.resolveConversation({
        ...scope,
        conversationId,
        contactId,
        channel: 'WHATSAPP',
        provider: 'META_WHATSAPP_CLOUD',
        providerAccountRef: 'phone-number-id-e2e',
        direction: 'OUTBOUND',
        occurredAt: now,
        executionId: `exec-conversation-${suffix}`,
        correlationId: `corr-${suffix}`,
        actorPrincipalId: 'ag-01',
        idempotencyKey: `conversation:${suffix}`,
        evidence,
        now,
      });
      expect(conversation).toMatchObject({ conversationId, contactId, channel: 'WHATSAPP' });

      const input = {
        ...scope,
        messageId,
        conversationId,
        contactId,
        channel: 'WHATSAPP' as const,
        provider: 'META_WHATSAPP_CLOUD',
        direction: 'OUTBOUND' as const,
        contentType: 'TEXT' as const,
        status: 'PREPARED' as const,
        purposeId: 'customer-service',
        text: 'Mensagem de teste persistente',
        payload: { preparedPayloadRef: `prepared:${suffix}` },
        occurredAt: now,
        executionId: `exec-message-${suffix}`,
        correlationId: `corr-${suffix}`,
        actorPrincipalId: 'ag-01',
        idempotencyKey: `message:${suffix}`,
        evidence,
        now,
      };
      const first = await store.recordMessage(input);
      const replay = await store.recordMessage(input);
      expect(replay).toEqual(first);

      const submitted = await store.updateMessageTransport({
        ...scope,
        messageId,
        expectedStatus: 'PREPARED',
        status: 'SUBMITTED',
        providerMessageId,
        attemptCount: 1,
        nextRetryAt: null,
        lastErrorCode: null,
        executionId: `exec-submit-${suffix}`,
        correlationId: `corr-${suffix}`,
        actorPrincipalId: 'ag-01',
        idempotencyKey: `submit:${suffix}`,
        evidence,
        now,
      });
      expect(submitted.providerMessageId).toBe(providerMessageId);

      const deliveryInput = {
        ...scope,
        deliveryEventId: `delivery-${suffix}`,
        providerMessageId,
        providerEventId: `provider-delivery-${suffix}`,
        status: 'DELIVERED' as const,
        observedAt: '2026-08-20T04:00:05.000Z',
        executionId: `exec-delivery-${suffix}`,
        correlationId: `corr-${suffix}`,
        actorPrincipalId: 'ag-01',
        idempotencyKey: `delivery:${suffix}`,
        evidence,
        now: '2026-08-20T04:00:05.000Z',
      };
      const delivery = await store.recordDeliveryEvent(deliveryInput);
      const deliveryReplay = await store.recordDeliveryEvent(deliveryInput);
      expect(deliveryReplay).toEqual(delivery);

      const firstThrottle = await store.consumeThrottle({
        ...scope,
        contactId,
        channel: 'WHATSAPP',
        provider: 'META_WHATSAPP_CLOUD',
        windowSeconds: 60,
        limit: 1,
        now,
      });
      const blockedThrottle = await store.consumeThrottle({
        ...scope,
        contactId,
        channel: 'WHATSAPP',
        provider: 'META_WHATSAPP_CLOUD',
        windowSeconds: 60,
        limit: 1,
        now: '2026-08-20T04:00:01.000Z',
      });
      expect(firstThrottle.allowed).toBe(true);
      expect(blockedThrottle).toMatchObject({ allowed: false, count: 1, limit: 1 });

      const rows = await pool1.query<{
        message_count: number;
        delivery_count: number;
        outbox_count: number;
      }>(
        `select
           (select count(*)::int from crm_messages where message_id=$1) as message_count,
           (select count(*)::int from crm_message_delivery_events where message_id=$1) as delivery_count,
           (select count(*)::int from event_outbox where aggregate_id=$1) as outbox_count`,
        [messageId],
      );
      expect(rows.rows[0]).toMatchObject({ message_count: 1, delivery_count: 1 });
      expect(rows.rows[0]?.outbox_count).toBeGreaterThanOrEqual(3);
    } finally {
      await pool1.end();
    }

    const pool2 = createPostgresPool({ connectionString: databaseUrl(), max: 4 });
    try {
      const restarted = new PostgresCrmCommunicationStore(pool2);
      await expect(
        restarted.getMessageByProviderId({
          ...scope,
          provider: 'META_WHATSAPP_CLOUD',
          providerMessageId,
        }),
      ).resolves.toMatchObject({
        messageId,
        conversationId,
        providerMessageId,
        status: 'DELIVERED',
      });
      await expect(restarted.getConversation({ ...scope, conversationId })).resolves.toMatchObject({
        conversationId,
        contactId,
      });
    } finally {
      await pool2.end();
    }
  });
});
