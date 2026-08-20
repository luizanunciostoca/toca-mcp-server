import { describe, expect, it } from 'vitest';
import type { CrmScope } from '../src/crm/crm-records.js';
import type { MessageRecord } from '../src/crm/sales-engine.js';
import type {
  EmailProviderAdapter,
  ProviderMessageReadback,
  ProviderSendReceipt,
} from '../src/omnichannel/contracts.js';
import {
  EmailDispatchCoordinator,
  EmailProviderEventProcessor,
  hashEmailProviderSubject,
  type EmailDispatchOrchestrationStore,
  type EmailEngagementAuthorizationPort,
  type EmailProviderEventContextPort,
} from '../src/omnichannel/email-orchestrator.js';
import type {
  EmailDispatchRecord,
  EmailPrivacyReconciliationPort,
  EmailProviderEventRecord,
  EmailRateLimitDecision,
  EmailRateLimitPolicy,
  EmailThreadBinding,
} from '../src/omnichannel/email-runtime.js';

const scope = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  organizationId: 'org-1',
} as const;

const message: MessageRecord = {
  ...scope,
  messageId: 'msg-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  leadId: null,
  direction: 'OUTBOUND',
  channel: 'EMAIL',
  language: 'pt-BR',
  contentRef: 'gcs://private/email/msg-1',
  contentSha256: 'a'.repeat(64),
  providerMessageRef: null,
  intent: null,
  urgency: null,
  occurredAt: '2026-08-20T05:00:00.000Z',
  evidence: ['email:test'],
  createdAt: '2026-08-20T05:00:00.000Z',
};

class MemoryEmailStore implements EmailDispatchOrchestrationStore {
  readonly dispatches = new Map<string, EmailDispatchRecord>();
  readonly threadBindings = new Map<string, EmailThreadBinding>();
  readonly events = new Map<string, EmailProviderEventRecord>();
  rateLimitDecision: EmailRateLimitDecision = { allowed: true, remaining: 9, retryAt: null };

  findDispatchByIdempotencyKey(
    queryScope: CrmScope,
    idempotencyKey: string,
  ): Promise<EmailDispatchRecord | undefined> {
    return Promise.resolve(
      [...this.dispatches.values()].find(
        (record) => sameScope(record, queryScope) && record.idempotencyKey === idempotencyKey,
      ),
    );
  }

  findDispatchByProviderMessageRef(
    queryScope: CrmScope,
    provider: string,
    providerMessageRef: string,
  ): Promise<EmailDispatchRecord | undefined> {
    return Promise.resolve(
      [...this.dispatches.values()].find(
        (record) =>
          sameScope(record, queryScope) &&
          record.provider === provider &&
          record.providerMessageRef === providerMessageRef,
      ),
    );
  }

  saveDispatch(record: EmailDispatchRecord): Promise<void> {
    this.dispatches.set(record.dispatchId, record);
    return Promise.resolve();
  }

  findThreadBindingByInternetMessageIds(
    queryScope: CrmScope,
    messageIds: readonly string[],
  ): Promise<EmailThreadBinding | undefined> {
    return Promise.resolve(
      [...this.threadBindings.values()].find(
        (record) => sameScope(record, queryScope) && messageIds.includes(record.internetMessageId),
      ),
    );
  }

  persistThreadBinding(binding: EmailThreadBinding): Promise<void> {
    this.threadBindings.set(binding.bindingId, binding);
    return Promise.resolve();
  }

  hasProviderEvent(queryScope: CrmScope, providerEventId: string): Promise<boolean> {
    return Promise.resolve(
      [...this.events.values()].some(
        (event) => sameScope(event, queryScope) && event.providerEventId === providerEventId,
      ),
    );
  }

  appendProviderEvent(event: EmailProviderEventRecord): Promise<void> {
    this.events.set(event.eventId, event);
    return Promise.resolve();
  }

  consumeRateLimit(
    scopeInput: CrmScope,
    bucketKey: string,
    policy: EmailRateLimitPolicy,
    now: string,
  ): Promise<EmailRateLimitDecision> {
    void scopeInput;
    void bucketKey;
    void policy;
    void now;
    return Promise.resolve(this.rateLimitDecision);
  }
}

class StubProvider implements EmailProviderAdapter {
  readonly binding = {
    providerKey: 'twilio-sendgrid',
    bindingId: 'sendgrid-prod-1',
    state: 'PRODUCTION_VALIDATED' as const,
  };
  sendCount = 0;
  sendError: Error | null = null;
  receipt: ProviderSendReceipt = {
    provider: 'twilio-sendgrid',
    providerMessageId: 'sg-msg-1',
    acceptedAt: '2026-08-20T05:00:01.000Z',
    state: 'ACCEPTED',
    evidence: ['sendgrid:accepted'],
  };
  readbackResult: ProviderMessageReadback = {
    provider: 'twilio-sendgrid',
    providerMessageId: 'sg-msg-1',
    state: 'DELIVERED',
    observedAt: '2026-08-20T05:01:00.000Z',
    evidence: ['sendgrid:readback'],
  };

  sendCampaign(): Promise<ProviderSendReceipt> {
    this.sendCount += 1;
    if (this.sendError) return Promise.reject(this.sendError);
    return Promise.resolve(this.receipt);
  }

  readback(): Promise<ProviderMessageReadback> {
    return Promise.resolve(this.readbackResult);
  }
}

function buildSendInput(now = '2026-08-20T05:00:00.000Z') {
  return {
    ...scope,
    correlationId: 'corr-1',
    message,
    preparedCampaignRef: 'prepared-1',
    eligibilitySnapshot: {
      ...scope,
      correlationId: 'corr-1',
      snapshotId: 'audience-1',
      purposeId: 'reservation-followup',
      resolvedContactCount: 1,
      ambiguousContactCount: 0,
      unresolvedContactCount: 0,
      privacyUnknownBlockedCount: 0,
      privacySuppressedCount: 0,
      policyDeniedCount: 0,
    },
    approval: {
      ...scope,
      correlationId: 'corr-1',
      approvalId: 'approval-1',
      status: 'APPROVED' as const,
    },
    idempotencyKey: 'idem-1',
    internetMessageId: '<msg-1@mail.example.com>',
    rateLimitBucketKey: 'outbound-default',
    rateLimitPolicy: { capacity: 10, windowSeconds: 60 },
    now,
  };
}

describe('EmailDispatchCoordinator', () => {
  it('persists accepted dispatch and canonical conversation thread binding', async () => {
    const store = new MemoryEmailStore();
    const provider = new StubProvider();
    const coordinator = new EmailDispatchCoordinator(provider, store);
    const result = await coordinator.send(buildSendInput());
    expect(result.accepted).toBe(true);
    expect(result.reused).toBe(false);
    expect(result.dispatch.messageId).toBe(message.messageId);
    expect(result.dispatch.state).toBe('ACCEPTED');
    expect(provider.sendCount).toBe(1);
    const binding = [...store.threadBindings.values()][0];
    expect(binding?.conversationId).toBe(message.conversationId);
    expect(binding?.contactId).toBe(message.contactId);
    expect(binding?.providerMessageRef).toBe('sg-msg-1');
  });

  it('does not send twice for the same idempotency key', async () => {
    const store = new MemoryEmailStore();
    const provider = new StubProvider();
    const coordinator = new EmailDispatchCoordinator(provider, store);
    await coordinator.send(buildSendInput());
    const second = await coordinator.send(buildSendInput('2026-08-20T05:00:05.000Z'));
    expect(second.reused).toBe(true);
    expect(second.accepted).toBe(true);
    expect(provider.sendCount).toBe(1);
  });

  it('defers before provider execution when the durable rate limit is exhausted', async () => {
    const store = new MemoryEmailStore();
    store.rateLimitDecision = {
      allowed: false,
      remaining: 0,
      retryAt: '2026-08-20T05:01:00.000Z',
    };
    const provider = new StubProvider();
    const coordinator = new EmailDispatchCoordinator(provider, store);
    const result = await coordinator.send(buildSendInput());
    expect(result.dispatch.state).toBe('DEFERRED');
    expect(result.dispatch.nextRetryAt).toBe('2026-08-20T05:01:00.000Z');
    expect(provider.sendCount).toBe(0);
  });

  it('schedules bounded retry for transient SendGrid failures', async () => {
    const store = new MemoryEmailStore();
    const provider = new StubProvider();
    provider.sendError = Object.assign(
      new Error('SENDGRID_MAIL_SEND_FAILED:429:provider-rejected'),
      {
        retryAfterMs: 5_000,
      },
    );
    const coordinator = new EmailDispatchCoordinator(provider, store);
    const result = await coordinator.send(buildSendInput());
    expect(result.dispatch.state).toBe('DEFERRED');
    expect(result.dispatch.attemptCount).toBe(1);
    expect(result.dispatch.nextRetryAt).toBe('2026-08-20T05:00:05.000Z');
  });

  it('falls back to exponential retry when provider Retry-After is absent', async () => {
    const store = new MemoryEmailStore();
    const provider = new StubProvider();
    provider.sendError = new Error('SENDGRID_MAIL_SEND_FAILED:500:provider-rejected');
    const coordinator = new EmailDispatchCoordinator(provider, store);
    const result = await coordinator.send(buildSendInput());
    expect(result.dispatch.state).toBe('DEFERRED');
    expect(result.dispatch.nextRetryAt).toBe('2026-08-20T05:00:01.000Z');
  });

  it('reconciles independent provider readback into the dispatch state', async () => {
    const store = new MemoryEmailStore();
    const provider = new StubProvider();
    const coordinator = new EmailDispatchCoordinator(provider, store);
    await coordinator.send(buildSendInput());
    const result = await coordinator.readback({
      ...scope,
      providerMessageRef: 'sg-msg-1',
      now: '2026-08-20T05:02:00.000Z',
    });
    expect(result.readback.state).toBe('DELIVERED');
    expect(result.dispatch.state).toBe('DELIVERED');
  });
});

describe('EmailProviderEventProcessor', () => {
  it('reconciles complaint into canonical Privacy and stores only signed provider evidence', async () => {
    const store = new MemoryEmailStore();
    const provider = new StubProvider();
    const coordinator = new EmailDispatchCoordinator(provider, store);
    await coordinator.send(buildSendInput());

    const reconciled: unknown[] = [];
    const privacy: EmailPrivacyReconciliationPort = {
      reconcileProviderSignal(input) {
        reconciled.push(input);
        return Promise.resolve();
      },
    };
    const context: EmailProviderEventContextPort = {
      resolvePrivacyContext() {
        return Promise.resolve({
          subjectRef: 'contact-1',
          providerSubjectRef: hashEmailProviderSubject('guest@example.com'),
        });
      },
    };
    const authorization: EmailEngagementAuthorizationPort = {
      authorize() {
        return Promise.resolve({ privacyAllowed: true, policyAllowed: true, evidence: ['ok'] });
      },
    };
    const processor = new EmailProviderEventProcessor(store, privacy, context, authorization);
    const result = await processor.process({
      ...scope,
      provider: 'twilio-sendgrid',
      event: {
        providerEventId: 'event-complaint-1',
        providerMessageRef: 'sg-msg-1',
        eventType: 'spamreport',
        deliveryState: 'COMPLAINT',
        privacySignal: 'COMPLAINT',
        occurredAt: '2026-08-20T05:03:00.000Z',
      },
      rawPayloadSha256: 'b'.repeat(64),
      signatureEvidence: ['sendgrid:event-webhook:ecdsa-valid'],
      executionId: 'exec-1',
      correlationId: 'corr-1',
    });
    expect(result.privacyReconciled).toBe(true);
    expect(reconciled).toHaveLength(1);
    expect(JSON.stringify(reconciled[0])).not.toContain('guest@example.com');
    expect([...store.events.values()][0]?.deliveryState).toBe('COMPLAINT');
  });

  it('drops open/click engagement evidence when Privacy or Policy does not authorize tracking', async () => {
    const store = new MemoryEmailStore();
    const provider = new StubProvider();
    await new EmailDispatchCoordinator(provider, store).send(buildSendInput());
    const privacy: EmailPrivacyReconciliationPort = {
      reconcileProviderSignal() {
        return Promise.resolve();
      },
    };
    const context: EmailProviderEventContextPort = {
      resolvePrivacyContext() {
        return Promise.resolve({ subjectRef: 'contact-1', providerSubjectRef: 'sha256:opaque' });
      },
    };
    const authorization: EmailEngagementAuthorizationPort = {
      authorize() {
        return Promise.resolve({
          privacyAllowed: false,
          policyAllowed: true,
          evidence: ['privacy:block'],
        });
      },
    };
    const processor = new EmailProviderEventProcessor(store, privacy, context, authorization);
    const result = await processor.process({
      ...scope,
      provider: 'twilio-sendgrid',
      event: {
        providerEventId: 'event-open-1',
        providerMessageRef: 'sg-msg-1',
        eventType: 'open',
        deliveryState: null,
        privacySignal: null,
        occurredAt: '2026-08-20T05:03:00.000Z',
      },
      rawPayloadSha256: 'c'.repeat(64),
      signatureEvidence: ['sendgrid:event-webhook:ecdsa-valid'],
      executionId: 'exec-1',
      correlationId: 'corr-1',
    });
    expect(result.ignored).toBe(true);
    expect(result.reason).toContain('PRIVACY_NOT_ALLOWED');
    expect(store.events.size).toBe(0);
  });

  it('deduplicates provider events using provider event IDs', async () => {
    const store = new MemoryEmailStore();
    const provider = new StubProvider();
    await new EmailDispatchCoordinator(provider, store).send(buildSendInput());
    const privacy: EmailPrivacyReconciliationPort = {
      reconcileProviderSignal() {
        return Promise.resolve();
      },
    };
    const context: EmailProviderEventContextPort = {
      resolvePrivacyContext() {
        return Promise.resolve({ subjectRef: 'contact-1', providerSubjectRef: 'sha256:opaque' });
      },
    };
    const authorization: EmailEngagementAuthorizationPort = {
      authorize() {
        return Promise.resolve({ privacyAllowed: true, policyAllowed: true, evidence: ['ok'] });
      },
    };
    const processor = new EmailProviderEventProcessor(store, privacy, context, authorization);
    const input = {
      ...scope,
      provider: 'twilio-sendgrid',
      event: {
        providerEventId: 'event-delivered-1',
        providerMessageRef: 'sg-msg-1',
        eventType: 'delivered',
        deliveryState: 'DELIVERED' as const,
        privacySignal: null,
        occurredAt: '2026-08-20T05:03:00.000Z',
      },
      rawPayloadSha256: 'd'.repeat(64),
      signatureEvidence: ['sendgrid:event-webhook:ecdsa-valid'],
      executionId: 'exec-1',
      correlationId: 'corr-1',
    };
    expect((await processor.process(input)).duplicate).toBe(false);
    expect((await processor.process(input)).duplicate).toBe(true);
    expect(store.events.size).toBe(1);
  });
});

function sameScope(left: CrmScope, right: CrmScope): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.workspaceId === right.workspaceId &&
    left.organizationId === right.organizationId
  );
}
