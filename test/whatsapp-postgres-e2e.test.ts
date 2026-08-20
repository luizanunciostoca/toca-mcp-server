import { describe, expect, it } from 'vitest';
import { PostgresCrmCoreStore } from '../src/persistence/postgres-crm-core-store.js';
import { PostgresCrmSalesStore } from '../src/persistence/postgres-crm-sales-store.js';
import { PostgresWhatsAppRuntimeStore } from '../src/persistence/postgres-whatsapp-runtime-store.js';
import { createPostgresPool } from '../src/persistence/postgres.js';

const DATABASE_URL = process.env.DATABASE_URL;
const postgresDescribe = DATABASE_URL ? describe : describe.skip;

const TENANT = 'whatsapp-e2e-tenant';
const WORKSPACE = 'whatsapp-e2e-workspace';
const ORGANIZATION = 'whatsapp-e2e-organization';
const ACTOR = 'whatsapp:e2e';

function databaseUrl(): string {
  if (!DATABASE_URL) throw new Error('WHATSAPP_DATABASE_URL_REQUIRED');
  return DATABASE_URL;
}

function mutation(suffix: string, operation: string, now: string) {
  return {
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    organizationId: ORGANIZATION,
    idempotencyKey: `${operation}-idempotency-${suffix}`,
    executionId: `${operation}-execution-${suffix}`,
    correlationId: `whatsapp-correlation-${suffix}`,
    actorPrincipalId: ACTOR,
    evidence: [`whatsapp:e2e:${operation}`],
    now,
  } as const;
}

postgresDescribe('WhatsApp transport PostgreSQL E2E', () => {
  it('reuses canonical CRM records and survives callback replay and process restart', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const contactId = `wa-contact-${suffix}`;
    const conversationId = `wa-conversation-${suffix}`;
    const messageId = `wa-message-${suffix}`;
    const dispatchId = `wa-dispatch-${suffix}`;
    const providerMessageRef = `wamid.${suffix}`;
    const recipientSha256 = 'a'.repeat(64);

    const pool1 = createPostgresPool({ connectionString: databaseUrl(), max: 4 });
    const core1 = new PostgresCrmCoreStore(pool1);
    const sales1 = new PostgresCrmSalesStore(pool1);
    const whatsapp1 = new PostgresWhatsAppRuntimeStore(pool1);

    await core1.createContact({
      ...mutation(suffix, 'contact-create', '2026-08-20T12:00:00.000Z'),
      contactId,
      contactType: 'PERSON',
      displayName: 'WhatsApp E2E',
      channels: [
        {
          channelId: `wa-phone-${suffix}`,
          channelType: 'PHONE',
          value: '5511888888888',
          verifiedAt: '2026-08-20T12:00:00.000Z',
          primary: true,
        },
      ],
    });

    await sales1.createConversation({
      ...mutation(suffix, 'conversation-create', '2026-08-20T12:01:00.000Z'),
      conversationId,
      contactId,
      channel: 'WHATSAPP',
      language: 'pt-br',
      attributes: { phone_number_id: 'phone-1' },
    });

    await sales1.appendMessage({
      ...mutation(suffix, 'message-append', '2026-08-20T12:02:00.000Z'),
      messageId,
      conversationId,
      contactId,
      direction: 'OUTBOUND',
      channel: 'WHATSAPP',
      language: 'pt-br',
      contentRef: 'prepared:customer-service-1',
      contentSha256: 'b'.repeat(64),
      occurredAt: '2026-08-20T12:02:00.000Z',
    });

    const bindingInput = {
      ...mutation(suffix, 'binding', '2026-08-20T12:03:00.000Z'),
      bindingId: `wa-binding-${suffix}`,
      conversationId,
      contactId,
      metaAppId: 'app-1',
      wabaId: 'waba-1',
      phoneNumberId: 'phone-1',
      recipientSha256,
    } as const;
    const binding = await whatsapp1.ensureBinding(bindingInput);
    expect(await whatsapp1.ensureBinding(bindingInput)).toEqual(binding);

    await whatsapp1.touchBinding({
      ...mutation(suffix, 'inbound-touch', '2026-08-20T12:04:00.000Z'),
      conversationId,
      direction: 'INBOUND',
      occurredAt: '2026-08-20T12:04:00.000Z',
    });

    const dispatchInput = {
      ...mutation(suffix, 'dispatch', '2026-08-20T12:05:00.000Z'),
      dispatchId,
      messageId,
      conversationId,
      contactId,
      preparedPayloadRef: 'prepared:customer-service-1',
      purposeId: 'customer-service',
    } as const;
    const dispatch = await whatsapp1.createDispatch(dispatchInput);
    expect(await whatsapp1.createDispatch(dispatchInput)).toEqual(dispatch);

    await whatsapp1.updateDispatch({
      ...mutation(suffix, 'submitted', '2026-08-20T12:05:01.000Z'),
      dispatchId,
      expectedState: 'PREPARED',
      state: 'SUBMITTED',
      providerMessageRef,
      attemptCount: 1,
    });

    const providerEventInput = {
      ...mutation(suffix, 'callback', '2026-08-20T12:05:03.000Z'),
      eventId: `wa-event-${suffix}`,
      providerMessageRef,
      providerEventRef: `callback-${suffix}`,
      status: 'DELIVERED' as const,
      observedAt: '2026-08-20T12:05:03.000Z',
    };
    const providerEvent = await whatsapp1.recordProviderEvent(providerEventInput);
    expect(await whatsapp1.recordProviderEvent(providerEventInput)).toEqual(providerEvent);

    const firstThrottle = await whatsapp1.consumeThrottle({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      organizationId: ORGANIZATION,
      contactId,
      windowSeconds: 60,
      limit: 2,
      now: '2026-08-20T12:06:00.000Z',
    });
    const secondThrottle = await whatsapp1.consumeThrottle({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      organizationId: ORGANIZATION,
      contactId,
      windowSeconds: 60,
      limit: 2,
      now: '2026-08-20T12:06:01.000Z',
    });
    const thirdThrottle = await whatsapp1.consumeThrottle({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      organizationId: ORGANIZATION,
      contactId,
      windowSeconds: 60,
      limit: 2,
      now: '2026-08-20T12:06:02.000Z',
    });
    expect(firstThrottle.allowed).toBe(true);
    expect(secondThrottle.allowed).toBe(true);
    expect(thirdThrottle).toMatchObject({ allowed: false, count: 2, limit: 2 });
    await pool1.end();

    const pool2 = createPostgresPool({ connectionString: databaseUrl(), max: 4 });
    try {
      const whatsapp2 = new PostgresWhatsAppRuntimeStore(pool2);
      const persistedDispatch = await whatsapp2.getDispatchByProviderMessageRef({
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        organizationId: ORGANIZATION,
        providerMessageRef,
      });
      expect(persistedDispatch).toMatchObject({
        dispatchId,
        messageId,
        conversationId,
        contactId,
        state: 'DELIVERED',
        attemptCount: 1,
      });

      const persistedBinding = await whatsapp2.getBindingByConversation({
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        organizationId: ORGANIZATION,
        conversationId,
      });
      expect(persistedBinding).toMatchObject({
        contactId,
        lastInboundAt: '2026-08-20T12:04:00.000Z',
      });

      const callbackRows = await pool2.query<{ count: string }>(
        `select count(*)::text as count from whatsapp_provider_events
         where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and provider_event_ref=$4`,
        [TENANT, WORKSPACE, ORGANIZATION, providerEventInput.providerEventRef],
      );
      expect(callbackRows.rows[0]?.count).toBe('1');

      const canonicalMessageRows = await pool2.query<{ count: string }>(
        `select count(*)::text as count from crm_messages
         where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and message_id=$4`,
        [TENANT, WORKSPACE, ORGANIZATION, messageId],
      );
      expect(canonicalMessageRows.rows[0]?.count).toBe('1');

      const outboxRows = await pool2.query<{ count: string }>(
        `select count(*)::text as count from event_outbox
         where aggregate_type='WHATSAPP_TRANSPORT' and aggregate_id in ($1,$2,$3)`,
        [binding.bindingId, dispatchId, providerEvent.eventId],
      );
      expect(Number(outboxRows.rows[0]?.count ?? '0')).toBeGreaterThanOrEqual(3);

      const auditRows = await pool2.query<{ count: string }>(
        `select count(*)::text as count from audit_ledger_events
         where tenant_id=$1 and workspace_id=$2 and organization_id=$3
           and tool_name like 'core.crm.whatsapp.%'`,
        [TENANT, WORKSPACE, ORGANIZATION],
      );
      expect(Number(auditRows.rows[0]?.count ?? '0')).toBeGreaterThanOrEqual(3);
    } finally {
      await pool2.end();
    }
  });
});
