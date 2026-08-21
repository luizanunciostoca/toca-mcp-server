import { describe, expect, it, vi } from 'vitest';
import { createTrustedServiceExecutionIdentity } from '../src/core/identity.js';
import type { ApprovalRecord } from '../src/governance/approval-governance.js';
import {
  resolveWhatsAppOutboundRuntimeBinding,
  type WhatsAppOutboundRuntimeBindingDependencies,
} from '../src/mcp/omnichannel-outbound-runtime.js';
import type { MessageRecord } from '../src/crm/sales-engine.js';

const now = '2026-08-21T05:00:00.000Z';
const scope = {
  tenantId: 'tenant-wa',
  workspaceId: 'workspace-wa',
  organizationId: 'organization-wa',
} as const;
const wireScope = {
  tenant_id: scope.tenantId,
  workspace_id: scope.workspaceId,
  organization_id: scope.organizationId,
} as const;
const executionId = 'exec-wa-1';
const correlationId = 'corr-wa-1';
const principalId = 'principal:whatsapp-test';

const identity = createTrustedServiceExecutionIdentity({
  principalId,
  ...scope,
  roles: ['EXTERNAL_WRITER'],
  allowedCapabilityIds: ['whatsapp.message.send'],
  allowedTargetAccounts: ['phone-number-1'],
  evidence: ['test:whatsapp-outbound-binding'],
  now,
});

const message: MessageRecord = {
  ...scope,
  messageId: 'message-wa-1',
  conversationId: 'conversation-wa-1',
  contactId: 'contact-wa-1',
  leadId: null,
  direction: 'OUTBOUND',
  channel: 'WHATSAPP',
  language: 'pt-br',
  contentRef: 'prepared:wa:1',
  contentSha256: 'a'.repeat(64),
  providerMessageRef: null,
  intent: 'FOLLOW_UP',
  urgency: null,
  occurredAt: now,
  evidence: ['test:message'],
  createdAt: now,
};

function payload(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    ...wireScope,
    correlation_id: correlationId,
    contact_record_id: message.contactId,
    contact_resolution_id: 'resolution-wa-1',
    contact_resolution_status: 'RESOLVED',
    privacy_execution_id: 'privacy-wa-1',
    privacy_subject_ref: 'subject:wa:1',
    privacy_state: 'ALLOWED',
    privacy_blocked: false,
    privacy_purpose_id: 'customer-service',
    privacy_channel: 'WHATSAPP',
    policy_decision_id: 'policy-wa-1',
    policy_allowed: true,
    approval_id: 'approval-wa-1',
    approval_status: 'APPROVED',
    message_id: message.messageId,
    prepared_message_id: message.contentRef,
    idempotency_key: 'idem-wa-1',
    ...overrides,
  };
}

function approval(overrides: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    approvalId: 'approval-wa-1',
    requester: principalId,
    approver: 'principal:approver',
    routeId: 'R10',
    capabilityId: 'whatsapp.message.send',
    descriptorSha256: 'a'.repeat(64),
    targetAccount: 'phone-number-1',
    scope: ['whatsapp.message.send'],
    financialCeiling: null,
    requestedAt: now,
    issuedAt: now,
    expiresAt: '2026-08-22T05:00:00.000Z',
    consumedAt: null,
    revokedAt: null,
    reservationExecutionId: executionId,
    reservationPrincipalId: principalId,
    reservationCorrelationId: correlationId,
    reservedAt: now,
    executingAt: now,
    providerReadbackAt: null,
    providerReadbackEvidence: [],
    releasedAt: null,
    releaseReason: null,
    failedReviewAt: null,
    failureReason: null,
    status: 'EXECUTING',
    evidence: ['test:approval'],
    correlationId,
    version: 4,
    ...overrides,
  };
}

function dependencies(
  options: {
    readonly message?: MessageRecord;
    readonly approval?: ApprovalRecord;
    readonly callback?: 'ABSENT' | 'DELIVERED' | 'FAILED';
  } = {},
) {
  const send = vi.fn().mockResolvedValue({
    provider: 'META_WHATSAPP_CLOUD',
    providerMessageId: 'wamid.core-binding-1',
    state: 'SENT',
    observedAt: now,
    evidence: ['runtime:local-dispatch'],
  });
  const getMessage = vi.fn().mockResolvedValue(options.message ?? message);
  const get = vi.fn().mockResolvedValue(options.approval ?? approval());
  const readWhatsApp = vi.fn().mockImplementation(() => {
    if (options.callback === 'DELIVERED') {
      return Promise.resolve({
        provider: 'META_WHATSAPP_CLOUD',
        providerMessageId: 'wamid.core-binding-1',
        state: 'DELIVERED',
        observedAt: now,
        evidence: ['whatsapp:provider-event:DELIVERED', 'meta:webhook:signed:test-1'],
      });
    }
    if (options.callback === 'FAILED') {
      return Promise.resolve({
        provider: 'META_WHATSAPP_CLOUD',
        providerMessageId: 'wamid.core-binding-1',
        state: 'FAILED',
        observedAt: now,
        evidence: ['whatsapp:provider-event:FAILED', 'meta:webhook:signed:test-1'],
      });
    }
    return Promise.resolve({
      provider: 'META_WHATSAPP_CLOUD',
      providerMessageId: 'wamid.core-binding-1',
      state: 'QUEUED',
      observedAt: now,
      evidence: ['whatsapp:dispatch-state:SUBMITTED'],
    });
  });
  const deps: WhatsAppOutboundRuntimeBindingDependencies = {
    runtime: { send },
    messages: { getMessage },
    approvalStore: { get },
    providerEventReadback: { readWhatsApp },
    targetAccount: 'phone-number-1',
  };
  return { deps, send, getMessage, get, readWhatsApp };
}

function context(identityOverride = identity) {
  return { identity: identityOverride, executionId, correlationId } as const;
}

describe('whatsapp.message.send Core runtime binding', () => {
  it('stays unbound when the deployment has no outbound composition', () => {
    expect(
      resolveWhatsAppOutboundRuntimeBinding('whatsapp.message.send', undefined),
    ).toBeUndefined();
  });

  it('fails cross-tenant before CRM or provider execution', async () => {
    const fixture = dependencies();
    const binding = resolveWhatsAppOutboundRuntimeBinding('whatsapp.message.send', fixture.deps)!;
    const foreignIdentity = createTrustedServiceExecutionIdentity({
      principalId,
      tenantId: 'other-tenant',
      workspaceId: scope.workspaceId,
      organizationId: scope.organizationId,
      roles: ['EXTERNAL_WRITER'],
      evidence: ['test:foreign-identity'],
      now,
    });

    await expect(binding.execute(payload(), context(foreignIdentity))).rejects.toThrow(
      'WHATSAPP_MESSAGE_SEND_SCOPE_MISMATCH',
    );
    expect(fixture.getMessage).not.toHaveBeenCalled();
    expect(fixture.send).not.toHaveBeenCalled();
  });

  it('requires the exact approval reserved by Core before runtime execution', async () => {
    const fixture = dependencies({
      approval: approval({ reservationExecutionId: 'different-execution' }),
    });
    const binding = resolveWhatsAppOutboundRuntimeBinding('whatsapp.message.send', fixture.deps)!;

    await expect(binding.execute(payload(), context())).rejects.toThrow(
      'WHATSAPP_APPROVAL_RESERVATION_MISMATCH',
    );
    expect(fixture.getMessage).not.toHaveBeenCalled();
    expect(fixture.send).not.toHaveBeenCalled();
  });

  it('binds message_id to the exact prepared-content authority ref', async () => {
    const fixture = dependencies();
    const binding = resolveWhatsAppOutboundRuntimeBinding('whatsapp.message.send', fixture.deps)!;

    await expect(
      binding.execute(payload({ prepared_message_id: 'prepared:wa:wrong' }), context()),
    ).rejects.toThrow('WHATSAPP_MESSAGE_PREPARED_REF_MISMATCH');
    expect(fixture.send).not.toHaveBeenCalled();
  });

  it('passes the canonical MessageRecord and reserved execution identity to WhatsAppOutboundRuntime', async () => {
    const fixture = dependencies();
    const binding = resolveWhatsAppOutboundRuntimeBinding('whatsapp.message.send', fixture.deps)!;

    const result = await binding.execute(payload(), context());

    expect(result).toMatchObject({
      provider_message_id: 'wamid.core-binding-1',
      provider: 'META_WHATSAPP_CLOUD',
      state: 'ACCEPTED',
    });
    expect(fixture.send).toHaveBeenCalledTimes(1);
    expect(fixture.send.mock.calls[0]?.[0]).toMatchObject({
      ...scope,
      message,
      preparedPayloadRef: 'prepared:wa:1',
      purposeId: 'customer-service',
      executionId,
      correlationId,
      actorPrincipalId: principalId,
      idempotencyKey: 'idem-wa-1',
    });
  });

  it('does not count local dispatch state as provider evidence when callback is absent', async () => {
    const fixture = dependencies({ callback: 'ABSENT' });
    const binding = resolveWhatsAppOutboundRuntimeBinding('whatsapp.message.send', fixture.deps)!;
    const readback = await binding.providerReadback!(
      {
        provider_message_id: 'wamid.core-binding-1',
        provider: 'META_WHATSAPP_CLOUD',
        state: 'ACCEPTED',
        accepted_at: now,
      },
      payload(),
    );

    expect(readback).toMatchObject({
      verified: false,
      evidence: [],
      externalResourceId: 'wamid.core-binding-1',
      reason: 'WHATSAPP_SIGNED_CALLBACK_NOT_OBSERVED',
    });
  });

  it('accepts independent signed provider callback evidence only for a successful provider state', async () => {
    const delivered = dependencies({ callback: 'DELIVERED' });
    const deliveredBinding = resolveWhatsAppOutboundRuntimeBinding(
      'whatsapp.message.send',
      delivered.deps,
    )!;
    const verified = await deliveredBinding.providerReadback!(
      {
        provider_message_id: 'wamid.core-binding-1',
        provider: 'META_WHATSAPP_CLOUD',
        state: 'ACCEPTED',
        accepted_at: now,
      },
      payload(),
    );
    expect(verified.verified).toBe(true);
    expect(verified.evidence).toContain('whatsapp:provider-event:DELIVERED');

    const failed = dependencies({ callback: 'FAILED' });
    const failedBinding = resolveWhatsAppOutboundRuntimeBinding(
      'whatsapp.message.send',
      failed.deps,
    )!;
    const rejected = await failedBinding.providerReadback!(
      {
        provider_message_id: 'wamid.core-binding-1',
        provider: 'META_WHATSAPP_CLOUD',
        state: 'ACCEPTED',
        accepted_at: now,
      },
      payload(),
    );
    expect(rejected).toMatchObject({
      verified: false,
      reason: 'WHATSAPP_PROVIDER_CALLBACK_STATE_NOT_SUCCESSFUL:FAILED',
    });
  });
});
