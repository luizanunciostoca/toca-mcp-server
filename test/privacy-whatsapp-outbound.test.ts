import { describe, expect, it } from 'vitest';
import type { CrmCoreStore } from '../src/crm/crm-records.js';
import type { MessageRecord } from '../src/crm/sales-engine.js';
import type {
  OutboundEligibilityContext,
  ProviderMessageReadback,
  ProviderSendReceipt,
  WhatsAppProviderAdapter,
} from '../src/omnichannel/contracts.js';
import type {
  OutboundPrivacyRevalidationInput,
  OutboundPrivacyRevalidationPort,
} from '../src/omnichannel/privacy-runtime-gate.js';
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
import type { PreparedWhatsAppPayloadResolver } from '../src/providers/whatsapp/whatsapp-cloud-adapter.js';

const scope = {
  tenantId: 'tenant-privacy-wa',
  workspaceId: 'workspace-privacy-wa',
  organizationId: 'organization-privacy-wa',
} as const;

const now = '2026-08-20T12:00:00.000Z';

const message: MessageRecord = {
  ...scope,
  messageId: 'message-wa-1',
  conversationId: 'conversation-wa-1',
  contactId: 'contact-wa-1',
  leadId: null,
  direction: 'OUTBOUND',
  channel: 'WHATSAPP',
  language: 'pt-BR',
  contentRef: 'prepared:wa:followup-1',
  contentSha256: 'a'.repeat(64),
  providerMessageRef: null,
  intent: 'FOLLOW_UP',
  urgency: null,
  occurredAt: now,
  evidence: ['test:privacy-whatsapp'],
  createdAt: now,
};

const eligibility: OutboundEligibilityContext = {
  ...scope,
  correlationId: 'correlation-wa-1',
  channel: 'WHATSAPP',
  contact: {
    ...scope,
    correlationId: 'correlation-wa-1',
    contactRecordId: message.contactId,
    resolutionId: 'resolution-wa-1',
    status: 'RESOLVED',
  },
  privacy: {
    ...scope,
    correlationId: 'correlation-wa-1',
    executionId: 'privacy-snapshot-before-suppression',
    subjectRef: 'subject:wa:contact-1',
    decision: {
      state: 'ALLOWED',
      blocked: false,
      reasons: [],
      purposeId: 'reservation-followup',
      channel: 'WHATSAPP',
    },
  },
  policy: {
    ...scope,
    correlationId: 'correlation-wa-1',
    decisionId: 'policy-wa-1',
    allowed: true,
  },
  approval: {
    ...scope,
    correlationId: 'correlation-wa-1',
    approvalId: 'approval-wa-1',
    status: 'APPROVED',
  },
};

class MemoryWhatsAppStore {
  dispatch: WhatsAppDispatchRecord | undefined;

  readonly binding: WhatsAppConversationBinding = {
    ...scope,
    bindingId: 'binding-wa-1',
    conversationId: message.conversationId,
    contactId: message.contactId,
    metaAppId: 'meta-app-1',
    wabaId: 'waba-1',
    phoneNumberId: 'phone-number-1',
    recipientSha256: 'f'.repeat(64),
    lastInboundAt: '2026-08-20T11:30:00.000Z',
    lastOutboundAt: null,
    humanHandoffAt: null,
    humanHandoffReason: null,
    createdAt: '2026-08-20T11:00:00.000Z',
    updatedAt: '2026-08-20T11:30:00.000Z',
  };

  createDispatch(input: {
    readonly dispatchId: string;
    readonly messageId: string;
    readonly conversationId: string;
    readonly contactId: string;
    readonly preparedPayloadRef: string;
    readonly purposeId: string;
    readonly idempotencyKey: string;
    readonly now?: string;
  }): Promise<WhatsAppDispatchRecord> {
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

  getBindingByConversation(): Promise<WhatsAppConversationBinding | undefined> {
    return Promise.resolve(this.binding);
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

  updateDispatch(input: UpdateWhatsAppDispatchInput): Promise<WhatsAppDispatchRecord> {
    if (!this.dispatch) throw new Error('TEST_DISPATCH_MISSING');
    if (this.dispatch.state !== input.expectedState)
      throw new Error('TEST_DISPATCH_STATE_MISMATCH');
    this.dispatch = {
      ...this.dispatch,
      state: input.state,
      providerMessageRef: input.providerMessageRef ?? this.dispatch.providerMessageRef,
      attemptCount: input.attemptCount,
      nextRetryAt: input.nextRetryAt ?? null,
      lastErrorCode: input.lastErrorCode ?? null,
      updatedAt: input.now ?? now,
    };
    return Promise.resolve(this.dispatch);
  }
}

class StubWhatsAppProvider implements WhatsAppProviderAdapter {
  readonly binding = {
    providerKey: 'META_WHATSAPP_CLOUD',
    bindingId: 'binding-provider-wa-1',
    state: 'PRODUCTION_VALIDATED' as const,
  };
  sendCount = 0;

  validateTemplate() {
    return Promise.resolve({ valid: true, evidence: ['test:template'] });
  }

  send(): Promise<ProviderSendReceipt> {
    this.sendCount += 1;
    return Promise.resolve({
      provider: 'META_WHATSAPP_CLOUD',
      providerMessageId: 'wamid.test',
      acceptedAt: now,
      state: 'ACCEPTED',
      evidence: ['test:provider-send'],
    });
  }

  readback(): Promise<ProviderMessageReadback> {
    return Promise.resolve({
      provider: 'META_WHATSAPP_CLOUD',
      providerMessageId: 'wamid.test',
      state: 'SENT',
      observedAt: now,
      evidence: ['test:provider-readback'],
    });
  }
}

class SuppressedPrivacy implements OutboundPrivacyRevalidationPort {
  readonly calls: OutboundPrivacyRevalidationInput[] = [];

  revalidate(input: OutboundPrivacyRevalidationInput): Promise<CommunicationPolicyDecision> {
    this.calls.push(input);
    return Promise.resolve({
      state: 'BLOCKED',
      allowed: false,
      blocked: true,
      reasons: ['SUPPRESSED:USER_OPT_OUT'],
      purposeId: input.purposeId,
      channel: input.privacyChannel,
      policyRef: 'policy:reservation-followup',
    });
  }
}

function sendInput(): WhatsAppOutboundSendInput {
  return {
    ...scope,
    message,
    preparedPayloadRef: 'prepared:wa:followup-1',
    purposeId: 'reservation-followup',
    eligibility,
    executionId: 'wa-followup-exec-1',
    correlationId: 'correlation-wa-1',
    actorPrincipalId: 'principal:wa-runtime',
    idempotencyKey: 'test-idem-1',
    evidence: ['test:scheduled-followup'],
    now,
  };
}

describe('WhatsApp outbound Privacy revalidation', () => {
  it('blocks a newly suppressed WhatsApp contact before provider execution', async () => {
    const store = new MemoryWhatsAppStore();
    const provider = new StubWhatsAppProvider();
    const privacy = new SuppressedPrivacy();
    const crm = {
      getContact() {
        return Promise.resolve({
          ...scope,
          contactId: message.contactId,
          status: 'ACTIVE',
        });
      },
      listContactChannels() {
        return Promise.resolve([
          {
            channelId: 'phone-wa-1',
            channelType: 'PHONE',
            provider: 'META_WHATSAPP_CLOUD',
            value: '5511999999999',
            verifiedAt: now,
            primary: true,
          },
        ]);
      },
    } as unknown as CrmCoreStore;
    const preparedPayloads: PreparedWhatsAppPayloadResolver = {
      resolve() {
        return Promise.resolve({
          kind: 'TEXT',
          to: '5511999999999',
          text: 'follow-up',
        });
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
      {
        throttleLimit: 10,
        throttleWindowSeconds: 60,
        maxAttempts: 3,
        retryDelaySeconds: 10,
      },
    );

    await expect(runtime.send(sendInput())).rejects.toThrow(
      'WHATSAPP_PRIVACY_REVALIDATION_BLOCKED',
    );

    expect(provider.sendCount).toBe(0);
    expect(store.dispatch).toMatchObject({
      state: 'FAILED',
      attemptCount: 0,
      lastErrorCode: 'WHATSAPP_PRIVACY_REVALIDATION_BLOCKED',
    });
    expect(privacy.calls).toHaveLength(1);
    expect(privacy.calls[0]).toMatchObject({
      channel: 'WHATSAPP',
      privacyChannel: 'WHATSAPP',
      subjectRef: 'subject:wa:contact-1',
      purposeId: 'reservation-followup',
      executionId: 'wa-followup-exec-1:privacy-pre-send:1',
    });
    expect(JSON.stringify(privacy.calls[0])).not.toContain('5511999999999');
  });
});
