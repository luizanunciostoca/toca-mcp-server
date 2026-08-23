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
import type {
  PreparedWhatsAppMessage,
  PreparedWhatsAppPayloadResolver,
} from '../src/providers/whatsapp/whatsapp-cloud-adapter.js';

const now = '2026-08-22T20:00:00.000Z';
const scope = {
  tenantId: 'tenant-wa-timeout',
  workspaceId: 'workspace-wa-timeout',
  organizationId: 'org-wa-timeout',
} as const;
const recipient = '5511999999999';

const message: MessageRecord = {
  ...scope,
  messageId: 'message-wa-timeout-1',
  conversationId: 'conversation-wa-timeout-1',
  contactId: 'contact-wa-timeout-1',
  leadId: null,
  direction: 'OUTBOUND',
  channel: 'WHATSAPP',
  language: 'pt-BR',
  contentRef: 'prepared:wa:timeout-1',
  contentSha256: 'b'.repeat(64),
  providerMessageRef: null,
  intent: 'FOLLOW_UP',
  urgency: null,
  occurredAt: now,
  evidence: ['test:wa-timeout'],
  createdAt: now,
};

const eligibility: OutboundEligibilityContext = {
  ...scope,
  correlationId: 'corr-wa-timeout-1',
  channel: 'WHATSAPP',
  contact: {
    ...scope,
    correlationId: 'corr-wa-timeout-1',
    contactRecordId: message.contactId,
    resolutionId: 'resolution-wa-timeout-1',
    status: 'RESOLVED',
  },
  privacy: {
    ...scope,
    correlationId: 'corr-wa-timeout-1',
    executionId: 'privacy-wa-timeout-1',
    subjectRef: 'subject:wa-timeout-1',
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
    correlationId: 'corr-wa-timeout-1',
    decisionId: 'policy-wa-timeout-1',
    allowed: true,
  },
  approval: {
    ...scope,
    correlationId: 'corr-wa-timeout-1',
    approvalId: 'approval-wa-timeout-1',
    status: 'APPROVED',
  },
};

class DurableMemoryStore {
  binding: WhatsAppConversationBinding = {
    ...scope,
    bindingId: 'binding-wa-timeout-1',
    conversationId: message.conversationId,
    contactId: message.contactId,
    metaAppId: 'meta-app-fake',
    wabaId: 'waba-fake',
    phoneNumberId: 'phone-fake',
    recipientSha256: 'f'.repeat(64),
    lastInboundAt: '2026-08-22T19:30:00.000Z',
    lastOutboundAt: null,
    humanHandoffAt: null,
    humanHandoffReason: null,
    createdAt: '2026-08-22T19:00:00.000Z',
    updatedAt: '2026-08-22T19:30:00.000Z',
  };
  dispatch: WhatsAppDispatchRecord | undefined;
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
    if (this.dispatch?.idempotencyKey === input.idempotencyKey) {
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

  updateDispatch(input: UpdateWhatsAppDispatchInput) {
    if (!this.dispatch) throw new Error('TEST_DISPATCH_REQUIRED');
    if (this.dispatch.state !== input.expectedState) throw new Error('TEST_STATE_MISMATCH');
    this.dispatch = {
      ...this.dispatch,
      state: input.state,
      providerMessageRef:
        input.providerMessageRef === undefined
          ? this.dispatch.providerMessageRef
          : input.providerMessageRef,
      attemptCount: input.attemptCount,
      nextRetryAt:
        input.nextRetryAt === undefined ? this.dispatch.nextRetryAt : input.nextRetryAt,
      lastErrorCode:
        input.lastErrorCode === undefined ? this.dispatch.lastErrorCode : input.lastErrorCode,
      updatedAt: input.now ?? now,
    };
    return Promise.resolve(this.dispatch);
  }

  consumeThrottle() {
    return Promise.resolve({
      allowed: true,
      count: 1,
      limit: 10,
      windowStartedAt: now,
      retryAfterSeconds: 0,
    });
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

  touchBinding() {
    return Promise.resolve(this.binding);
  }

  recordMedia() {
    return Promise.reject(new Error('TEST_MEDIA_NOT_EXPECTED'));
  }
}

class TimeoutProvider implements WhatsAppProviderAdapter {
  readonly binding = {
    providerKey: 'META_WHATSAPP_CLOUD',
    bindingId: 'whatsapp-fake-only',
    state: 'PRODUCTION_VALIDATED' as const,
  };
  sendCount = 0;
  readbackCount = 0;

  validateTemplate() {
    return Promise.resolve({ valid: true, evidence: ['fake:template'] });
  }

  send(): Promise<ProviderSendReceipt> {
    this.sendCount += 1;
    return Promise.reject(new Error('UND_ERR_CONNECT_TIMEOUT: fake provider timeout'));
  }

  readback(providerMessageId: string): Promise<ProviderMessageReadback> {
    this.readbackCount += 1;
    return Promise.resolve({
      provider: 'META_WHATSAPP_CLOUD',
      providerMessageId,
      state: 'UNKNOWN',
      observedAt: now,
      evidence: ['fake:readback'],
    });
  }
}

class AllowPrivacy implements OutboundPrivacyRevalidationPort {
  revalidate(input: { readonly purposeId: string; readonly privacyChannel: string }) {
    const decision: CommunicationPolicyDecision = {
      state: 'ALLOWED',
      allowed: true,
      blocked: false,
      reasons: [],
      purposeId: input.purposeId,
      channel: input.privacyChannel,
      policyRef: 'policy:fake-wa-timeout',
    };
    return Promise.resolve(decision);
  }
}

function runtime(store: DurableMemoryStore, provider: TimeoutProvider) {
  const crm = {
    getContact() {
      return Promise.resolve({ ...scope, contactId: message.contactId, status: 'ACTIVE' });
    },
    listContactChannels() {
      return Promise.resolve([
        {
          channelId: 'phone-wa-timeout-1',
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
    resolve(): Promise<PreparedWhatsAppMessage> {
      return Promise.resolve({ kind: 'TEXT', to: recipient, text: 'fake timeout test' });
    },
  };
  return new WhatsAppOutboundRuntime(
    {
      crm,
      transport: store as unknown as WhatsAppRuntimeStore,
      provider,
      preparedPayloads,
      privacyRevalidation: new AllowPrivacy(),
    },
    {
      throttleLimit: 10,
      throttleWindowSeconds: 60,
      maxAttempts: 3,
      retryDelaySeconds: 10,
    },
  );
}

function input(): WhatsAppOutboundSendInput {
  return {
    ...scope,
    message,
    preparedPayloadRef: 'prepared:wa:timeout-1',
    purposeId: 'customer-service',
    eligibility,
    executionId: 'execution-wa-timeout-1',
    correlationId: 'corr-wa-timeout-1',
    actorPrincipalId: 'principal:wa-timeout-test',
    idempotencyKey: 'idempotency-wa-timeout-1',
    evidence: ['test:wa-timeout'],
    now,
  };
}

describe('WhatsApp fake timeout and restart boundary', () => {
  it('dead-letters an uncertain timeout and keeps restart fail-closed without another provider call', async () => {
    const store = new DurableMemoryStore();
    const provider = new TimeoutProvider();

    await expect(runtime(store, provider).send(input())).rejects.toThrow(
      'UND_ERR_CONNECT_TIMEOUT',
    );
    expect(store.dispatch).toMatchObject({
      state: 'DEAD_LETTER',
      attemptCount: 1,
      nextRetryAt: null,
      lastErrorCode: 'WHATSAPP_PROVIDER_OUTCOME_UNCERTAIN',
    });
    expect(store.handoffReason).toBe('WHATSAPP_PROVIDER_OUTCOME_UNCERTAIN');
    expect(provider.sendCount).toBe(1);

    const restarted = runtime(store, provider);
    await expect(restarted.send(input())).rejects.toThrow('WHATSAPP_HUMAN_HANDOFF_ACTIVE');

    expect(provider.sendCount).toBe(1);
    expect(provider.readbackCount).toBe(0);
  });
});
