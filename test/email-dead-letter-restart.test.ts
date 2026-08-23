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
  type EmailDispatchOrchestrationStore,
} from '../src/omnichannel/email-orchestrator.js';
import type {
  EmailDispatchRecord,
  EmailProviderEventRecord,
  EmailRateLimitDecision,
  EmailThreadBinding,
} from '../src/omnichannel/email-runtime.js';
import type {
  OutboundPrivacyRevalidationInput,
  OutboundPrivacyRevalidationPort,
} from '../src/omnichannel/privacy-runtime-gate.js';
import type { CommunicationPolicyDecision } from '../src/privacy/contracts.js';

const scope = {
  tenantId: 'tenant-email-dlq',
  workspaceId: 'workspace-email-dlq',
  organizationId: 'org-email-dlq',
} as const;

const message: MessageRecord = {
  ...scope,
  messageId: 'message-email-dlq-1',
  conversationId: 'conversation-email-dlq-1',
  contactId: 'contact-email-dlq-1',
  leadId: null,
  direction: 'OUTBOUND',
  channel: 'EMAIL',
  language: 'pt-BR',
  contentRef: 'prepared:email:dlq-1',
  contentSha256: 'a'.repeat(64),
  providerMessageRef: null,
  intent: null,
  urgency: null,
  occurredAt: '2026-08-22T20:00:00.000Z',
  evidence: ['test:email-dlq'],
  createdAt: '2026-08-22T20:00:00.000Z',
};

class MemoryStore implements EmailDispatchOrchestrationStore {
  dispatch: EmailDispatchRecord | undefined;
  readonly threads: EmailThreadBinding[] = [];
  readonly events: EmailProviderEventRecord[] = [];

  findDispatchByIdempotencyKey(queryScope: CrmScope, idempotencyKey: string) {
    if (!this.dispatch) return Promise.resolve(undefined);
    if (!sameScope(this.dispatch, queryScope) || this.dispatch.idempotencyKey !== idempotencyKey) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(this.dispatch);
  }

  findDispatchByProviderMessageRef(queryScope: CrmScope, provider: string, ref: string) {
    if (
      this.dispatch &&
      sameScope(this.dispatch, queryScope) &&
      this.dispatch.provider === provider &&
      this.dispatch.providerMessageRef === ref
    ) {
      return Promise.resolve(this.dispatch);
    }
    return Promise.resolve(undefined);
  }

  saveDispatch(record: EmailDispatchRecord) {
    this.dispatch = record;
    return Promise.resolve();
  }

  findThreadBindingByInternetMessageIds() {
    return Promise.resolve(undefined);
  }

  persistThreadBinding(binding: EmailThreadBinding) {
    this.threads.push(binding);
    return Promise.resolve();
  }

  hasProviderEvent() {
    return Promise.resolve(false);
  }

  appendProviderEvent(event: EmailProviderEventRecord) {
    this.events.push(event);
    return Promise.resolve();
  }

  consumeRateLimit(): Promise<EmailRateLimitDecision> {
    return Promise.resolve({ allowed: true, remaining: 9, retryAt: null });
  }
}

class FakeProvider implements EmailProviderAdapter {
  readonly binding = {
    providerKey: 'twilio-sendgrid',
    bindingId: 'sendgrid-fake-only',
    state: 'PRODUCTION_VALIDATED' as const,
  };
  sendCount = 0;
  sendError: Error | null = null;

  sendCampaign(): Promise<ProviderSendReceipt> {
    this.sendCount += 1;
    if (this.sendError) return Promise.reject(this.sendError);
    return Promise.resolve({
      provider: 'twilio-sendgrid',
      providerMessageId: 'sg-fake-message-1',
      acceptedAt: '2026-08-22T20:00:10.000Z',
      state: 'ACCEPTED',
      evidence: ['fake:sendgrid:202'],
    });
  }

  readback(): Promise<ProviderMessageReadback> {
    return Promise.resolve({
      provider: 'twilio-sendgrid',
      providerMessageId: 'sg-fake-message-1',
      state: 'DELIVERED',
      observedAt: '2026-08-22T20:01:00.000Z',
      evidence: ['fake:sendgrid:delivered'],
    });
  }
}

class AllowPrivacy implements OutboundPrivacyRevalidationPort {
  revalidate(input: OutboundPrivacyRevalidationInput): Promise<CommunicationPolicyDecision> {
    return Promise.resolve({
      state: 'ALLOWED',
      allowed: true,
      blocked: false,
      reasons: [],
      purposeId: input.purposeId,
      channel: input.privacyChannel,
      policyRef: 'policy:fake-email-dlq',
    });
  }
}

function sendInput(now: string, maximumAttempts: number) {
  return {
    ...scope,
    correlationId: 'correlation-email-dlq-1',
    message,
    preparedCampaignRef: 'prepared:email:dlq-1',
    eligibilitySnapshot: {
      ...scope,
      correlationId: 'correlation-email-dlq-1',
      snapshotId: 'audience-email-dlq-1',
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
      correlationId: 'correlation-email-dlq-1',
      approvalId: 'approval-email-dlq-1',
      status: 'APPROVED' as const,
    },
    privacySubjectRef: 'contact-email-dlq-1',
    privacyChannel: 'EMAIL',
    executionId: 'execution-email-dlq-1',
    actorPrincipalId: 'principal:email-dlq-test',
    idempotencyKey: 'email-dlq-idempotency-1',
    internetMessageId: '<email-dlq-1@example.test>',
    rateLimitBucketKey: 'email.campaign.send:reservation-followup',
    rateLimitPolicy: { capacity: 10, windowSeconds: 60 },
    retryPolicy: { baseDelayMs: 1_000, maximumDelayMs: 10_000, maximumAttempts },
    now,
  };
}

describe('Email logical DLQ and restart safety', () => {
  it('persists retry exhaustion as a terminal logical dead letter and never resends after restart', async () => {
    const store = new MemoryStore();
    const provider = new FakeProvider();
    provider.sendError = new Error('SENDGRID_MAIL_SEND_FAILED:500:fake-provider-error');

    const firstRuntime = new EmailDispatchCoordinator(provider, store, new AllowPrivacy());
    const first = await firstRuntime.send(sendInput('2026-08-22T20:00:00.000Z', 1));

    expect(first.accepted).toBe(false);
    expect(first.dispatch).toMatchObject({
      state: 'FAILED',
      attemptCount: 1,
      nextRetryAt: null,
      lastError: 'EMAIL_DEAD_LETTER:SENDGRID_MAIL_SEND_FAILED:500:fake-provider-error',
    });
    expect(provider.sendCount).toBe(1);

    provider.sendError = null;
    const restartedRuntime = new EmailDispatchCoordinator(provider, store, new AllowPrivacy());
    const replay = await restartedRuntime.send(sendInput('2026-08-22T20:05:00.000Z', 1));

    expect(replay.reused).toBe(true);
    expect(replay.accepted).toBe(false);
    expect(replay.dispatch.lastError).toContain('EMAIL_DEAD_LETTER:');
    expect(provider.sendCount).toBe(1);
  });

  it('resumes a durable deferred retry through a new coordinator instance', async () => {
    const store = new MemoryStore();
    const provider = new FakeProvider();
    provider.sendError = new Error('SENDGRID_MAIL_SEND_FAILED:500:fake-provider-error');

    const firstRuntime = new EmailDispatchCoordinator(provider, store, new AllowPrivacy());
    const first = await firstRuntime.send(sendInput('2026-08-22T20:00:00.000Z', 2));
    expect(first.dispatch).toMatchObject({
      state: 'DEFERRED',
      attemptCount: 1,
      nextRetryAt: '2026-08-22T20:00:01.000Z',
    });

    provider.sendError = null;
    const restartedRuntime = new EmailDispatchCoordinator(provider, store, new AllowPrivacy());
    const resumed = await restartedRuntime.send(sendInput('2026-08-22T20:00:01.000Z', 2));

    expect(resumed.accepted).toBe(true);
    expect(resumed.dispatch).toMatchObject({ state: 'ACCEPTED', attemptCount: 2 });
    expect(provider.sendCount).toBe(2);
  });
});

function sameScope(left: CrmScope, right: CrmScope): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.workspaceId === right.workspaceId &&
    left.organizationId === right.organizationId
  );
}
