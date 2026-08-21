import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import type { SecretResolver } from '../src/core/secrets.js';
import type { CrmScope } from '../src/crm/crm-records.js';
import type { MessageRecord } from '../src/crm/sales-engine.js';
import type { ApprovalRecord } from '../src/governance/approval-governance.js';
import type {
  EmailProviderAdapter,
  ProviderMessageReadback,
  ProviderSendReceipt,
} from '../src/omnichannel/contracts.js';
import {
  EmailCampaignSendService,
  PostgresEmailCampaignSendRuntime,
  type EmailCampaignSendInput,
} from '../src/omnichannel/email-campaign-send-runtime.js';
import type { EmailDispatchOrchestrationStore } from '../src/omnichannel/email-orchestrator.js';
import type {
  EmailDispatchRecord,
  EmailProviderEventRecord,
  EmailRateLimitDecision,
  EmailThreadBinding,
} from '../src/omnichannel/email-runtime.js';
import {
  buildOmnichannelPreparedContentRecord,
  type OmnichannelPreparedContentRecord,
  type OmnichannelPreparedContentStore,
} from '../src/omnichannel/prepared-content.js';
import type {
  OutboundPrivacyRevalidationInput,
  OutboundPrivacyRevalidationPort,
} from '../src/omnichannel/privacy-runtime-gate.js';
import type { CommunicationPolicyDecision } from '../src/privacy/contracts.js';
import {
  SendGridEmailProvider,
  type SendGridPreparedCampaignResolver,
} from '../src/providers/sendgrid/email-provider.js';

const scope = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  organizationId: 'org-1',
} as const;
const execution = {
  actorPrincipalId: 'principal:email-runtime',
  executionId: 'exec-email-1',
  correlationId: 'corr-email-1',
} as const;

function preparedRecord(scopeOverride: CrmScope = scope): OmnichannelPreparedContentRecord {
  return buildOmnichannelPreparedContentRecord({
    ...scopeOverride,
    contentKind: 'EMAIL_CAMPAIGN',
    payload: {
      to: ['guest@example.com'],
      subject: 'Reservation follow-up',
      text: 'Hello from Toca.',
      internet_message_id: '<msg-1@toca.example>',
      metadata: {},
      open_tracking_requested: false,
      click_tracking_requested: false,
      privacy_tracking_allowed: false,
      policy_tracking_allowed: false,
    },
    evidence: ['email:test:prepared'],
    now: '2026-08-21T05:00:00.000Z',
  });
}

function canonicalMessage(
  prepared: OmnichannelPreparedContentRecord,
  scopeOverride: CrmScope = scope,
): MessageRecord {
  return {
    ...scopeOverride,
    messageId: 'msg-1',
    conversationId: 'conv-1',
    contactId: 'contact-1',
    leadId: null,
    direction: 'OUTBOUND',
    channel: 'EMAIL',
    language: 'pt-BR',
    contentRef: prepared.preparedContentRef,
    contentSha256: prepared.contentSha256,
    providerMessageRef: null,
    intent: null,
    urgency: null,
    occurredAt: '2026-08-21T05:00:00.000Z',
    evidence: ['email:test:message'],
    createdAt: '2026-08-21T05:00:00.000Z',
  };
}

function input(prepared: OmnichannelPreparedContentRecord): EmailCampaignSendInput {
  return {
    ...scope,
    correlationId: execution.correlationId,
    audienceSnapshotId: 'audience-1',
    privacyPurposeId: 'reservation-followup',
    resolvedContactCount: 1,
    ambiguousContactCount: 0,
    unresolvedContactCount: 0,
    privacyUnknownBlockedCount: 0,
    privacySuppressedCount: 0,
    policyDeniedCount: 0,
    approvalId: 'approval-1',
    messageId: 'msg-1',
    preparedCampaignRef: prepared.preparedContentRef,
    idempotencyKey: 'email-send-idem-1',
  };
}

function reservedApproval(overrides: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    approvalId: 'approval-1',
    requester: execution.actorPrincipalId,
    approver: 'principal:approver',
    routeId: 'R07',
    capabilityId: 'email.campaign.send',
    descriptorSha256: 'a'.repeat(64),
    targetAccount: 'sendgrid-prod-1',
    scope: ['email.campaign.send'],
    financialCeiling: null,
    requestedAt: '2026-08-21T04:59:00.000Z',
    issuedAt: '2026-08-21T04:59:10.000Z',
    expiresAt: '2026-08-21T06:00:00.000Z',
    consumedAt: null,
    revokedAt: null,
    reservationExecutionId: execution.executionId,
    reservationPrincipalId: execution.actorPrincipalId,
    reservationCorrelationId: execution.correlationId,
    reservedAt: '2026-08-21T05:00:00.000Z',
    executingAt: '2026-08-21T05:00:00.100Z',
    providerReadbackAt: null,
    providerReadbackEvidence: [],
    releasedAt: null,
    releaseReason: null,
    failedReviewAt: null,
    failureReason: null,
    status: 'EXECUTING',
    evidence: ['approval:test'],
    correlationId: execution.correlationId,
    version: 4,
    ...overrides,
  };
}

class MemoryDispatchStore implements EmailDispatchOrchestrationStore {
  readonly dispatches = new Map<string, EmailDispatchRecord>();
  readonly threads = new Map<string, EmailThreadBinding>();
  readonly events = new Map<string, EmailProviderEventRecord>();
  readonly saveHistory: EmailDispatchRecord[] = [];
  rateLimitDecision: EmailRateLimitDecision = { allowed: true, remaining: 9, retryAt: null };

  findDispatchByIdempotencyKey(queryScope: CrmScope, key: string) {
    return Promise.resolve(
      [...this.dispatches.values()].find(
        (record) => sameScope(record, queryScope) && record.idempotencyKey === key,
      ),
    );
  }

  findDispatchByProviderMessageRef(queryScope: CrmScope, provider: string, ref: string) {
    return Promise.resolve(
      [...this.dispatches.values()].find(
        (record) =>
          sameScope(record, queryScope) &&
          record.provider === provider &&
          record.providerMessageRef === ref,
      ),
    );
  }

  saveDispatch(record: EmailDispatchRecord) {
    this.dispatches.set(record.dispatchId, record);
    this.saveHistory.push(record);
    return Promise.resolve();
  }

  findThreadBindingByInternetMessageIds(queryScope: CrmScope, ids: readonly string[]) {
    return Promise.resolve(
      [...this.threads.values()].find(
        (binding) => sameScope(binding, queryScope) && ids.includes(binding.internetMessageId),
      ),
    );
  }

  persistThreadBinding(binding: EmailThreadBinding) {
    this.threads.set(binding.bindingId, binding);
    return Promise.resolve();
  }

  hasProviderEvent(queryScope: CrmScope, providerEventId: string) {
    return Promise.resolve(
      [...this.events.values()].some(
        (event) => sameScope(event, queryScope) && event.providerEventId === providerEventId,
      ),
    );
  }

  appendProviderEvent(event: EmailProviderEventRecord) {
    this.events.set(event.eventId, event);
    return Promise.resolve();
  }

  consumeRateLimit() {
    return Promise.resolve(this.rateLimitDecision);
  }
}

class MemoryPreparedStore implements OmnichannelPreparedContentStore {
  constructor(public record: OmnichannelPreparedContentRecord | undefined) {}

  put() {
    if (!this.record) throw new Error('TEST_PREPARED_RECORD_MISSING');
    return Promise.resolve(this.record);
  }

  get() {
    return Promise.resolve(this.record);
  }
}

class FixedPreparedResolver implements SendGridPreparedCampaignResolver {
  resolve() {
    return Promise.resolve({
      to: ['guest@example.com'],
      subject: 'Reservation follow-up',
      text: 'Hello from Toca.',
      internetMessageId: '<msg-1@toca.example>',
      customArgs: {},
      openTrackingRequested: false,
      clickTrackingRequested: false,
      privacyTrackingAllowed: false,
      policyTrackingAllowed: false,
    });
  }
}

class StubProvider implements EmailProviderAdapter {
  readonly binding = {
    providerKey: 'twilio-sendgrid',
    bindingId: 'sendgrid-prod-1',
    state: 'PRODUCTION_VALIDATED' as const,
  };
  sendCount = 0;
  readbackCount = 0;
  readbackError: Error | null = null;
  readbackResult: ProviderMessageReadback = {
    provider: 'twilio-sendgrid',
    providerMessageId: 'sg-msg-1',
    state: 'DELIVERED',
    observedAt: '2026-08-21T05:01:00.000Z',
    evidence: ['sendgrid:email-activity:delivered'],
  };

  sendCampaign(): Promise<ProviderSendReceipt> {
    this.sendCount += 1;
    return Promise.resolve({
      provider: 'twilio-sendgrid',
      providerMessageId: 'sg-msg-1',
      acceptedAt: '2026-08-21T05:00:01.000Z',
      state: 'ACCEPTED',
      evidence: ['sendgrid:mail-send:202'],
    });
  }

  readback() {
    this.readbackCount += 1;
    return this.readbackError
      ? Promise.reject(this.readbackError)
      : Promise.resolve(this.readbackResult);
  }
}

class StubPrivacy implements OutboundPrivacyRevalidationPort {
  readonly calls: OutboundPrivacyRevalidationInput[] = [];
  state: CommunicationPolicyDecision['state'] = 'ALLOWED';
  reasons: readonly string[] = [];

  revalidate(value: OutboundPrivacyRevalidationInput): Promise<CommunicationPolicyDecision> {
    this.calls.push(value);
    const allowed = this.state === 'ALLOWED';
    return Promise.resolve({
      state: this.state,
      allowed,
      blocked: !allowed,
      reasons: this.reasons,
      purposeId: value.purposeId,
      channel: value.privacyChannel,
      policyRef: 'policy:reservation-followup',
    });
  }
}

function fixture(
  options: {
    prepared?: OmnichannelPreparedContentRecord;
    message?: MessageRecord;
    approval?: ApprovalRecord;
    privacyState?: CommunicationPolicyDecision['state'];
    privacyReasons?: readonly string[];
  } = {},
) {
  const prepared = options.prepared ?? preparedRecord();
  const message = options.message ?? canonicalMessage(prepared);
  const provider = new StubProvider();
  const dispatchStore = new MemoryDispatchStore();
  const privacy = new StubPrivacy();
  privacy.state = options.privacyState ?? 'ALLOWED';
  privacy.reasons = options.privacyReasons ?? [];
  const preparedStore = new MemoryPreparedStore(prepared);
  const service = new EmailCampaignSendService({
    provider,
    preparedResolver: new FixedPreparedResolver(),
    dispatchStore,
    privacy,
    messages: { getMessage: () => Promise.resolve(message) },
    preparedContent: preparedStore,
    approvals: { get: () => Promise.resolve(options.approval ?? reservedApproval()) },
  });
  return { service, provider, dispatchStore, privacy };
}

describe('email.campaign.send final composition', () => {
  it('provider disabled performs zero secret/db work', async () => {
    let secretCalls = 0;
    let dbQueries = 0;
    const secretResolver: SecretResolver = {
      resolve() {
        secretCalls += 1;
        return Promise.reject(new Error('MUST_NOT_RESOLVE_SECRET'));
      },
    };
    const pool = {
      query() {
        dbQueries += 1;
        throw new Error('MUST_NOT_QUERY_DATABASE');
      },
    } as unknown as pg.Pool;
    const runtime = new PostgresEmailCampaignSendRuntime({
      pool,
      env: { EMAIL_SENDGRID_ENABLED: 'false' },
      secretResolver,
    });
    await expect(runtime.send(input(preparedRecord()), execution)).rejects.toThrow(
      'EMAIL_SENDGRID_RUNTIME_DISABLED',
    );
    expect(secretCalls).toBe(0);
    expect(dbQueries).toBe(0);
  });

  it('non-production SendGrid binding performs zero external call', async () => {
    let fetchCalls = 0;
    let resolverCalls = 0;
    const fetchImpl: typeof fetch = () => {
      fetchCalls += 1;
      return Promise.reject(new Error('MUST_NOT_FETCH'));
    };
    const provider = new SendGridEmailProvider(
      {
        apiKey: 'secret-test-key',
        sendingDomain: 'mail.example.com',
        fromEmail: 'hello@mail.example.com',
        fromName: 'Toca',
        bindingId: 'sendgrid-int-1',
        bindingState: 'INTEGRATION_VALIDATED',
      },
      {
        resolve() {
          resolverCalls += 1;
          return Promise.reject(new Error('MUST_NOT_RESOLVE_PREPARED'));
        },
      },
      fetchImpl,
    );
    await expect(
      provider.sendCampaign({
        ...scope,
        correlationId: execution.correlationId,
        preparedCampaignRef: 'prepared-1',
        eligibilitySnapshot: {
          ...scope,
          correlationId: execution.correlationId,
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
          correlationId: execution.correlationId,
          approvalId: 'approval-1',
          status: 'APPROVED',
        },
        idempotencyKey: 'idem-1',
      }),
    ).rejects.toThrow();
    expect(fetchCalls).toBe(0);
    expect(resolverCalls).toBe(0);
  });

  it('blocks cross-scope CRM and prepared content before provider', async () => {
    const prepared = preparedRecord();
    const crossMessage = fixture({
      message: canonicalMessage(prepared, { ...scope, tenantId: 'tenant-2' }),
    });
    await expect(crossMessage.service.send(input(prepared), execution)).rejects.toThrow(
      'EMAIL_CANONICAL_MESSAGE_SCOPE_MISMATCH',
    );
    expect(crossMessage.provider.sendCount).toBe(0);

    const foreignPrepared = preparedRecord({ ...scope, tenantId: 'tenant-2' });
    const crossPrepared = fixture({
      prepared: foreignPrepared,
      message: canonicalMessage(foreignPrepared),
    });
    await expect(crossPrepared.service.send(input(foreignPrepared), execution)).rejects.toThrow(
      'OMNICHANNEL_PREPARED_CONTENT_SCOPE_MISMATCH',
    );
    expect(crossPrepared.provider.sendCount).toBe(0);
  });

  it('blocks prepared hash mismatch and non-exact Approval reservation', async () => {
    const prepared = preparedRecord();
    const corrupted = { ...prepared, contentSha256: 'b'.repeat(64) };
    const badHash = fixture({ prepared: corrupted, message: canonicalMessage(corrupted) });
    await expect(badHash.service.send(input(corrupted), execution)).rejects.toThrow(
      'OMNICHANNEL_PREPARED_CONTENT_HASH_MISMATCH',
    );
    expect(badHash.provider.sendCount).toBe(0);

    const badApproval = fixture({
      approval: reservedApproval({ reservationExecutionId: 'different-execution' }),
    });
    await expect(badApproval.service.send(input(prepared), execution)).rejects.toThrow(
      'EMAIL_APPROVAL_EXECUTION_MISMATCH',
    );
    expect(badApproval.provider.sendCount).toBe(0);
  });

  it.each(['CONSENT_REVOKED', 'PROVIDER_UNSUBSCRIBED', 'PROVIDER_COMPLAINT'])(
    'fresh Privacy blocks %s with zero provider call',
    async (reason) => {
      const prepared = preparedRecord();
      const blocked = fixture({ privacyState: 'BLOCKED', privacyReasons: [reason] });
      await expect(blocked.service.send(input(prepared), execution)).rejects.toThrow(
        'EMAIL_CAMPAIGN_SEND_NOT_ACCEPTED:EMAIL_PRIVACY_REVALIDATION_BLOCKED',
      );
      expect(blocked.provider.sendCount).toBe(0);
      expect(blocked.privacy.calls).toHaveLength(1);
    },
  );

  it('is idempotent and persists SUBMITTED before provider ID', async () => {
    const prepared = preparedRecord();
    const value = fixture();
    const first = await value.service.send(input(prepared), execution);
    const replay = await value.service.send(input(prepared), execution);
    expect(first).toEqual(replay);
    expect(value.provider.sendCount).toBe(1);
    expect(value.dispatchStore.saveHistory.map((record) => record.state)).toEqual([
      'SUBMITTED',
      'ACCEPTED',
    ]);
    expect(value.dispatchStore.saveHistory[0]?.providerMessageRef).toBeNull();
    expect(value.dispatchStore.saveHistory[1]?.providerMessageRef).toBe('sg-msg-1');
  });

  it('requires authoritative Email Activity readback and never equates acceptance with verification', async () => {
    const prepared = preparedRecord();
    const value = fixture();
    const accepted = await value.service.send(input(prepared), execution);
    value.provider.readbackError = new Error('SENDGRID_EMAIL_ACTIVITY_READBACK_NOT_ENABLED');
    const missing = await value.service.readback(accepted, input(prepared));
    expect(missing.verified).toBe(false);
    expect(missing.externalResourceId).toBe('sg-msg-1');

    value.provider.readbackError = null;
    const verified = await value.service.readback(accepted, input(prepared));
    expect(verified.verified).toBe(true);
    expect(verified.evidence).toContain('sendgrid:email-activity:delivered');
  });
});

function sameScope(left: CrmScope, right: CrmScope): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.workspaceId === right.workspaceId &&
    left.organizationId === right.organizationId
  );
}
