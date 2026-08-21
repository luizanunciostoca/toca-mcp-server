import { describe, expect, it } from 'vitest';
import type { CrmCoreStore } from '../src/crm/crm-records.js';
import type { MessageRecord } from '../src/crm/sales-engine.js';
import type {
  OutboundEligibilityContext,
  ProviderMessageReadback,
  ProviderSendReceipt,
  WhatsAppProviderAdapter,
} from '../src/omnichannel/contracts.js';
import type { OutboundPrivacyRevalidationPort } from '../src/omnichannel/privacy-runtime-gate.js';
import {
  WhatsAppOutboundRuntime,
  type WhatsAppOutboundSendInput,
} from '../src/omnichannel/whatsapp-runtime.js';
import type {
  UpdateWhatsAppDispatchInput,
  WhatsAppConversationBinding,
  WhatsAppDispatchRecord,
  WhatsAppRuntimeStore,
} from '../src/omnichannel/whatsapp-runtime-contracts.js';
import type { CommunicationPolicyDecision } from '../src/privacy/contracts.js';
import { MetaApiError } from '../src/providers/meta/meta-api-client.js';
import type {
  PreparedWhatsAppMessage,
  PreparedWhatsAppPayloadResolver,
} from '../src/providers/whatsapp/whatsapp-cloud-adapter.js';

const now = '2026-08-21T12:00:00.000Z';
const scope = {
  tenantId: 'tenant-wa-runtime',
  workspaceId: 'workspace-wa-runtime',
  organizationId: 'organization-wa-runtime',
} as const;
const recipient = '5511999999999';

const canonicalMessage: MessageRecord = {
  ...scope,
  messageId: 'message-wa-runtime-1',
  conversationId: 'conversation-wa-runtime-1',
  contactId: 'contact-wa-runtime-1',
  leadId: null,
  direction: 'OUTBOUND',
  channel: 'WHATSAPP',
  language: 'pt-br',
  contentRef: 'prepared:wa:runtime-1',
  contentSha256: 'b'.repeat(64),
  providerMessageRef: null,
  intent: 'FOLLOW_UP',
  urgency: null,
  occurredAt: now,
  evidence: ['test:whatsapp-runtime'],
  createdAt: now,
};

const eligibility: OutboundEligibilityContext = {
  ...scope,
  correlationId: 'correlation-wa-runtime-1',
  channel: 'WHATSAPP',
  contact: {
    ...scope,
    correlationId: 'correlation-wa-runtime-1',
    contactRecordId: canonicalMessage.contactId,
    resolutionId: 'resolution-wa-runtime-1',
    status: 'RESOLVED',
  },
  privacy: {
    ...scope,
    correlationId: 'correlation-wa-runtime-1',
    executionId: 'privacy-wa-runtime-1',
    subjectRef: 'subject:wa:runtime-1',
    decision: {
      state: 'ALLOWED',
      blocked: false,
      reasons: [],
      purposeId: 'customer-service',
      channel: 'WHATSAPP',
    },
  },
  policy: {
    ...scope,
    correlationId: 'correlation-wa-runtime-1',
    decisionId: 'policy-wa-runtime-1',
    allowed: true,
  },
  approval: {
    ...scope,
    correlationId: 'correlation-wa-runtime-1',
    approvalId: 'approval-wa-runtime-1',
    status: 'APPROVED',
  },
};

class MemoryStore {
  binding: WhatsAppConversationBinding = {
    ...scope,
    bindingId: 'binding-wa-runtime-1',
    conversationId: canonicalMessage.conversationId,
    contactId: canonicalMessage.contactId,
    metaAppId: 'meta-app-1',
    wabaId: 'waba-1',
    phoneNumberId: 'phone-number-1',
    recipientSha256: 'f'.repeat(64),
    lastInboundAt: '2026-08-21T11:30:00.000Z',
    lastOutboundAt: null,
    humanHandoffAt: null,
    humanHandoffReason: null,
    createdAt: '2026-08-20T12:00:00.000Z',
    updatedAt: '2026-08-21T11:30:00.000Z',
  };
  dispatch: WhatsAppDispatchRecord | undefined;
  throttleAllowed = true;
  submittedBeforeProvider = false;
  handoffReason: string | null = null;

  getBindingByConversation() {
    return Promise.resolve(this.binding);
  }

  createDispatch(input: {
    readonly dispatchId: string;
    readonly messageId: string;
    readonly conversationId: string;
    readonly contactId: string;
    readonly preparedPayloadRef: string;
    readonly purposeId: string;
    readonly idempotencyKey: string;
    readonly now?: string;
  }) {
    if (this.dispatch && this.dispatch.idempotencyKey === input.idempotencyKey) {
      return Promise.resolve(this.dispatch);
    }
    this.dispatch = {
      ...scope,
      dispatchId: input.dispatchId,
      messageId: input.messageId,
      conversationId: input.conversationId,
      contactId: input.contactId,
      provider: 'META_WHATSAPP_CLOUD',
      preparedPayloadRef: input.preparedPayloadRef,
      purposeId: input.purposeId,
      idempotencyKey: input.idempotencyKey,
      providerMessageRef: null,
      state: 'PREPARED',
      attemptCount: 0,
      nextRetryAt: null,
      lastErrorCode: null,
      createdAt: input.now ?? now,
      updatedAt: input.now ?? now,
    };
    return Promise.resolve(this.dispatch);
  }

  getDispatchByIdempotencyKey() {
    return Promise.resolve(this.dispatch);
  }

  consumeThrottle() {
    return Promise.resolve({
      allowed: this.throttleAllowed,
      count: this.throttleAllowed ? 1 : 10,
      limit: 10,
      windowStartedAt: now,
      retryAfterSeconds: this.throttleAllowed ? 0 : 42,
    });
  }

  updateDispatch(input: UpdateWhatsAppDispatchInput) {
    if (!this.dispatch) throw new Error('TEST_DISPATCH_MISSING');
    if (this.dispatch.state !== input.expectedState)
      throw new Error('TEST_DISPATCH_STATE_MISMATCH');
    this.dispatch = {
      ...this.dispatch,
      state: input.state,
      providerMessageRef:
        input.providerMessageRef === undefined
          ? this.dispatch.providerMessageRef
          : input.providerMessageRef,
      attemptCount: input.attemptCount,
      nextRetryAt: input.nextRetryAt === undefined ? this.dispatch.nextRetryAt : input.nextRetryAt,
      lastErrorCode:
        input.lastErrorCode === undefined ? this.dispatch.lastErrorCode : input.lastErrorCode,
      updatedAt: input.now ?? now,
    };
    if (input.state === 'SUBMITTED' && this.dispatch.providerMessageRef === null) {
      this.submittedBeforeProvider = true;
    }
    return Promise.resolve(this.dispatch);
  }

  touchBinding(input: { readonly occurredAt: string }) {
    this.binding = { ...this.binding, lastOutboundAt: input.occurredAt, updatedAt: now };
    return Promise.resolve(this.binding);
  }

  markHumanHandoff(input: { readonly reason: string }) {
    this.handoffReason = input.reason;
    this.binding = {
      ...this.binding,
      humanHandoffAt: now,
      humanHandoffReason: input.reason,
      updatedAt: now,
    };
    return Promise.resolve(this.binding);
  }

  recordMedia() {
    return Promise.reject(new Error('TEST_MEDIA_NOT_EXPECTED'));
  }
}

class StubProvider implements WhatsAppProviderAdapter {
  readonly binding = {
    providerKey: 'META_WHATSAPP_CLOUD',
    bindingId: 'provider-binding-wa-runtime-1',
    state: 'PRODUCTION_VALIDATED' as const,
  };
  sendCount = 0;
  readbackCount = 0;
  templateValid = true;
  sendOutcomes: Array<ProviderSendReceipt | Error> = [];
  onSend?: () => void;

  validateTemplate() {
    return Promise.resolve({ valid: this.templateValid, evidence: ['test:template-validation'] });
  }

  send(): Promise<ProviderSendReceipt> {
    this.sendCount += 1;
    this.onSend?.();
    const outcome = this.sendOutcomes.shift();
    if (outcome instanceof Error) return Promise.reject(outcome);
    return Promise.resolve(
      outcome ?? {
        provider: 'META_WHATSAPP_CLOUD',
        providerMessageId: 'wamid.runtime-1',
        acceptedAt: now,
        state: 'ACCEPTED',
        evidence: ['meta:wamid:wamid.runtime-1'],
      },
    );
  }

  readback(providerMessageId: string): Promise<ProviderMessageReadback> {
    this.readbackCount += 1;
    return Promise.resolve({
      provider: 'META_WHATSAPP_CLOUD',
      providerMessageId,
      state: 'SENT',
      observedAt: now,
      evidence: [`provider:readback:${providerMessageId}`],
    });
  }
}

class AllowPrivacy implements OutboundPrivacyRevalidationPort {
  calls = 0;

  revalidate(input: { readonly purposeId: string; readonly privacyChannel: string }) {
    this.calls += 1;
    const decision: CommunicationPolicyDecision = {
      state: 'ALLOWED',
      allowed: true,
      blocked: false,
      reasons: [],
      purposeId: input.purposeId,
      channel: input.privacyChannel,
      policyRef: 'policy:customer-service',
    };
    return Promise.resolve(decision);
  }
}

function fixture(
  prepared: PreparedWhatsAppMessage = { kind: 'TEXT', to: recipient, text: 'hello' },
) {
  const store = new MemoryStore();
  const provider = new StubProvider();
  const privacy = new AllowPrivacy();
  const crm = {
    getContact() {
      return Promise.resolve({ ...scope, contactId: canonicalMessage.contactId, status: 'ACTIVE' });
    },
    listContactChannels() {
      return Promise.resolve([
        {
          channelId: 'phone-wa-runtime-1',
          channelType: 'PHONE',
          provider: 'META_WHATSAPP_CLOUD',
          value: recipient,
          verifiedAt: now,
          primary: true,
        },
      ]);
    },
  } as unknown as CrmCoreStore;
  const preparedPayloads: PreparedWhatsAppPayloadResolver = {
    resolve() {
      return Promise.resolve(prepared);
    },
  };
  const runtime = new WhatsAppOutboundRuntime(
    {
      crm,
      transport: store as unknown as WhatsAppRuntimeStore,
      provider,
      preparedPayloads,
      privacyRevalidation: privacy,
    },
    { throttleLimit: 10, throttleWindowSeconds: 60, maxAttempts: 3, retryDelaySeconds: 10 },
  );
  return { runtime, store, provider, privacy, crm };
}

function input(message: MessageRecord = canonicalMessage): WhatsAppOutboundSendInput {
  return {
    ...scope,
    message,
    preparedPayloadRef: 'prepared:wa:runtime-1',
    purposeId: 'customer-service',
    eligibility,
    executionId: 'execution-wa-runtime-1',
    correlationId: 'correlation-wa-runtime-1',
    actorPrincipalId: 'principal:wa-runtime',
    idempotencyKey: 'idempotency-wa-runtime-1',
    evidence: ['test:whatsapp-runtime'],
    now,
  };
}

describe('WhatsAppOutboundRuntime transport guardrails', () => {
  it('requires canonical OUTBOUND + WHATSAPP MessageRecord before provider call', async () => {
    const { runtime, provider } = fixture();
    await expect(
      runtime.send(input({ ...canonicalMessage, direction: 'INBOUND' })),
    ).rejects.toThrow('WHATSAPP_CANONICAL_MESSAGE_INVALID');
    expect(provider.sendCount).toBe(0);
  });

  it('rejects a prepared recipient that does not match the verified ContactRecord phone', async () => {
    const { runtime, provider } = fixture({ kind: 'TEXT', to: '5511888888888', text: 'hello' });
    await expect(runtime.send(input())).rejects.toThrow('WHATSAPP_RECIPIENT_CONTACT_MISMATCH');
    expect(provider.sendCount).toBe(0);
  });

  it('enforces the 24h customer-service window and permits templates outside it', async () => {
    const textFixture = fixture();
    textFixture.store.binding = {
      ...textFixture.store.binding,
      lastInboundAt: '2026-08-20T11:59:59.000Z',
    };
    await expect(textFixture.runtime.send(input())).rejects.toThrow(
      'WHATSAPP_CUSTOMER_SERVICE_WINDOW_CLOSED',
    );
    expect(textFixture.provider.sendCount).toBe(0);

    const templateFixture = fixture({
      kind: 'TEMPLATE',
      to: recipient,
      templateKey: 'reservation_followup',
      locale: 'pt_BR',
      variables: [{ name: '1', value: 'Luiz' }],
    });
    templateFixture.store.binding = {
      ...templateFixture.store.binding,
      lastInboundAt: '2026-08-19T12:00:00.000Z',
    };
    await expect(templateFixture.runtime.send(input())).resolves.toMatchObject({ state: 'SENT' });
    expect(templateFixture.provider.sendCount).toBe(1);
  });

  it('requires provider-approved template/locale/variables before provider send', async () => {
    const { runtime, provider } = fixture({
      kind: 'TEMPLATE',
      to: recipient,
      templateKey: 'reservation_followup',
      locale: 'pt_BR',
      variables: [{ name: '1', value: 'Luiz' }],
    });
    provider.templateValid = false;
    await expect(runtime.send(input())).rejects.toThrow('WHATSAPP_TEMPLATE_NOT_APPROVED');
    expect(provider.sendCount).toBe(0);
  });

  it('uses existing throttle before dispatch/provider execution', async () => {
    const { runtime, store, provider } = fixture();
    store.throttleAllowed = false;
    await expect(runtime.send(input())).rejects.toThrow('WHATSAPP_THROTTLED:42');
    expect(store.dispatch).toBeUndefined();
    expect(provider.sendCount).toBe(0);
  });

  it('persists SUBMITTED before provider, stores wamid, and replays idempotently without a second send', async () => {
    const { runtime, store, provider } = fixture();
    provider.onSend = () => {
      expect(store.submittedBeforeProvider).toBe(true);
      expect(store.dispatch?.state).toBe('SUBMITTED');
      expect(store.dispatch?.providerMessageRef).toBeNull();
    };

    await expect(runtime.send(input())).resolves.toMatchObject({
      providerMessageId: 'wamid.runtime-1',
      state: 'SENT',
    });
    expect(store.dispatch).toMatchObject({
      state: 'SUBMITTED',
      providerMessageRef: 'wamid.runtime-1',
      attemptCount: 1,
    });
    expect(provider.sendCount).toBe(1);

    await expect(runtime.send(input())).resolves.toMatchObject({
      providerMessageId: 'wamid.runtime-1',
    });
    expect(provider.sendCount).toBe(1);
    expect(provider.readbackCount).toBe(2);
  });

  it('uses bounded retry for 429 and succeeds through retry() without losing idempotency', async () => {
    const { runtime, store, provider } = fixture();
    provider.sendOutcomes.push(new MetaApiError(429, 'META_HTTP_429', { providerCode: 4 }));

    await expect(runtime.send(input())).rejects.toThrow('META_HTTP_429');
    expect(store.dispatch).toMatchObject({
      state: 'FAILED_RETRYABLE',
      attemptCount: 1,
      lastErrorCode: 'WHATSAPP_PROVIDER_RATE_LIMITED:4',
      nextRetryAt: '2026-08-21T12:00:10.000Z',
    });

    await expect(
      runtime.retry({ ...input(), now: '2026-08-21T12:00:10.000Z' }),
    ).resolves.toMatchObject({
      providerMessageId: 'wamid.runtime-1',
      state: 'SENT',
    });
    expect(provider.sendCount).toBe(2);
    expect(store.dispatch).toMatchObject({
      state: 'SUBMITTED',
      providerMessageRef: 'wamid.runtime-1',
      attemptCount: 2,
    });
  });

  it('dead-letters uncertain provider outcome and creates human handoff', async () => {
    const { runtime, store, provider } = fixture();
    provider.sendOutcomes.push(new Error('network outcome unknown'));

    await expect(runtime.send(input())).rejects.toThrow('network outcome unknown');
    expect(store.dispatch).toMatchObject({
      state: 'DEAD_LETTER',
      attemptCount: 1,
      lastErrorCode: 'WHATSAPP_PROVIDER_OUTCOME_UNCERTAIN',
    });
    expect(store.handoffReason).toBe('WHATSAPP_PROVIDER_OUTCOME_UNCERTAIN');
  });
});
