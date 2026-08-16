import { describe, expect, it } from 'vitest';
import { InMemoryAuditSink, type AuditSink } from '../src/core/audit.js';
import { executeTool } from '../src/core/executor.js';
import { createTrustedServiceExecutionIdentity } from '../src/core/identity.js';
import type { ToolDefinition } from '../src/core/tool-registry.js';
import {
  InMemoryApprovalStore,
  hashApprovalDescriptor,
  issueApproval,
  requestApproval,
  type ApprovalRecord,
} from '../src/governance/approval-governance.js';

const capabilityId = 'meta_ads.campaign.create_paused';
const targetAccount = 'act_311793958882290';
const descriptor = {
  campaign: 'TOCA | THE PARTY | atomicity',
  dailyBudgetMinor: 17_000,
};

const tool: ToolDefinition = {
  name: capabilityId,
  version: '1.1.0',
  provider: 'Meta Marketing API',
  riskClass: 'WRITE_EXTERNAL',
  requiredScopes: ['ads_management'],
  capabilityStatus: 'PRODUCTION_VALIDATED',
  sideEffects: true,
  idempotent: false,
};

const identity = createTrustedServiceExecutionIdentity({
  principalId: 'service:test-external-writer',
  tenantId: 'toca-do-morcego',
  roles: ['EXTERNAL_WRITER'],
  allowedRouteIds: ['R28'],
  allowedCapabilityIds: [capabilityId],
  allowedTargetAccounts: [targetAccount],
  evidence: ['test://approval-executor/external-writer'],
  now: '2026-08-14T20:00:00Z',
});

function approvedRecord(): ApprovalRecord {
  const requested = requestApproval(
    {
      requester: identity.principal.principalId,
      routeId: 'R28',
      capabilityId,
      descriptor,
      targetAccount,
      scope: [capabilityId],
      expiresAt: '2026-08-15T03:00:00Z',
      evidence: ['test://approval-executor/request'],
      correlationId: 'corr-atomic-approval',
    },
    { now: '2026-08-14T20:01:00Z', createId: () => 'approval-atomic-1' },
  );
  return issueApproval(requested, {
    authority: {
      approver: 'luiz',
      allowedRouteIds: ['R28'],
      allowedCapabilityIds: [capabilityId],
      allowedTargetAccounts: [targetAccount],
      maxFinancialCeiling: null,
      validatedAt: '2026-08-14T20:02:00Z',
      evidence: ['test://approval-executor/authority'],
    },
    evidence: ['test://approval-executor/approved'],
    now: '2026-08-14T20:03:00Z',
  });
}

async function seededStore(): Promise<InMemoryApprovalStore> {
  const store = new InMemoryApprovalStore();
  const approved = approvedRecord();
  await store.put({
    ...approved,
    status: 'REQUESTED',
    approver: null,
    issuedAt: null,
    version: 1,
  });
  await store.put(approved, 1);
  return store;
}

const policyContext = () => ({
  identity,
  connectedAccount: targetAccount,
  descriptorSha256: hashApprovalDescriptor(descriptor),
  requiredApprovalScope: [capabilityId],
  now: '2026-08-14T21:00:00Z',
});

const fixedNow = () => '2026-08-14T21:00:00Z';

describe('M-FOUND-05 atomic approval executor', () => {
  it('consumes only after a verified provider readback', async () => {
    const store = await seededStore();
    const auditSink = new InMemoryAuditSink();
    let actionCalls = 0;

    const result = await executeTool({
      tool,
      policyContext: policyContext(),
      auditSink,
      correlationId: 'corr-exec-success',
      createExecutionId: () => 'exec-success',
      action: () => {
        actionCalls += 1;
        return Promise.resolve({ campaignId: 'campaign-123', status: 'PAUSED' as const });
      },
      approvalExecution: {
        approvalId: 'approval-atomic-1',
        store,
        now: fixedNow,
        providerReadback: (output) =>
          Promise.resolve({
            verified: output.campaignId === 'campaign-123' && output.status === 'PAUSED',
            externalResourceId: output.campaignId,
            evidence: ['meta://campaign/campaign-123:status=PAUSED'],
          }),
      },
    });

    expect(result).toEqual({ campaignId: 'campaign-123', status: 'PAUSED' });
    expect(actionCalls).toBe(1);
    expect(await store.get('approval-atomic-1')).toMatchObject({
      status: 'CONSUMED',
      reservationExecutionId: 'exec-success',
      providerReadbackEvidence: ['meta://campaign/campaign-123:status=PAUSED'],
      version: 6,
    });
    expect(auditSink.list().map((event) => event.status)).toEqual(['STARTED', 'SUCCEEDED']);
    expect(auditSink.list().at(-1)?.externalResourceId).toBe('campaign-123');
  });

  it('blocks a formally approved write that bypasses the atomic ApprovalStore contract', async () => {
    const auditSink = new InMemoryAuditSink();
    let called = false;

    await expect(
      executeTool({
        tool,
        policyContext: { ...policyContext(), approval: approvedRecord() },
        auditSink,
        correlationId: 'corr-no-store',
        createExecutionId: () => 'exec-no-store',
        action: () => {
          called = true;
          return Promise.resolve('unsafe');
        },
      }),
    ).rejects.toMatchObject({ code: 'APPROVAL_ATOMICITY_REQUIRED', retryable: false });

    expect(called).toBe(false);
    expect(auditSink.list().map((event) => event.status)).toEqual(['DENIED']);
  });

  it('moves to FAILED_REVIEW_REQUIRED after a provider execution error and blocks replay', async () => {
    const store = await seededStore();
    const auditSink = new InMemoryAuditSink();
    let calls = 0;

    await expect(
      executeTool({
        tool,
        policyContext: policyContext(),
        auditSink,
        correlationId: 'corr-exec-failure',
        createExecutionId: () => 'exec-provider-failure',
        action: () => {
          calls += 1;
          return Promise.reject(new Error('provider connection dropped after request'));
        },
        approvalExecution: {
          approvalId: 'approval-atomic-1',
          store,
          now: fixedNow,
          providerReadback: () => Promise.resolve({ verified: true, evidence: ['unreachable'] }),
        },
      }),
    ).rejects.toMatchObject({ code: 'APPROVAL_REVIEW_REQUIRED', retryable: false });

    expect(calls).toBe(1);
    expect(await store.get('approval-atomic-1')).toMatchObject({
      status: 'FAILED_REVIEW_REQUIRED',
      reservationExecutionId: 'exec-provider-failure',
    });

    await expect(
      executeTool({
        tool,
        policyContext: policyContext(),
        auditSink,
        correlationId: 'corr-replay-blocked',
        createExecutionId: () => 'exec-replay',
        action: () => {
          calls += 1;
          return Promise.resolve({ campaignId: 'should-not-run' });
        },
        approvalExecution: {
          approvalId: 'approval-atomic-1',
          store,
          now: fixedNow,
          providerReadback: () => Promise.resolve({ verified: true, evidence: ['unreachable'] }),
        },
      }),
    ).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    expect(calls).toBe(1);
  });

  it('moves to FAILED_REVIEW_REQUIRED when readback cannot prove provider state', async () => {
    const store = await seededStore();
    const auditSink = new InMemoryAuditSink();

    await expect(
      executeTool({
        tool,
        policyContext: policyContext(),
        auditSink,
        correlationId: 'corr-readback-failure',
        createExecutionId: () => 'exec-readback-failure',
        action: () => Promise.resolve({ campaignId: 'campaign-ambiguous' }),
        approvalExecution: {
          approvalId: 'approval-atomic-1',
          store,
          now: fixedNow,
          providerReadback: () =>
            Promise.resolve({
              verified: false,
              reason: 'EXPECTED_PAUSED_STATE_NOT_CONFIRMED',
              evidence: ['meta://campaign/campaign-ambiguous:status=UNKNOWN'],
            }),
        },
      }),
    ).rejects.toMatchObject({ code: 'APPROVAL_REVIEW_REQUIRED', retryable: false });

    expect(await store.get('approval-atomic-1')).toMatchObject({
      status: 'FAILED_REVIEW_REQUIRED',
      failureReason: 'EXPECTED_PAUSED_STATE_NOT_CONFIRMED',
    });
  });

  it('releases the reservation if audit fails before provider execution begins', async () => {
    const store = await seededStore();
    let called = false;
    const failingAudit: AuditSink = {
      write: () => Promise.reject(new Error('audit unavailable')),
    };

    await expect(
      executeTool({
        tool,
        policyContext: policyContext(),
        auditSink: failingAudit,
        correlationId: 'corr-audit-failure',
        createExecutionId: () => 'exec-audit-failure',
        action: () => {
          called = true;
          return Promise.resolve({ campaignId: 'must-not-run' });
        },
        approvalExecution: {
          approvalId: 'approval-atomic-1',
          store,
          now: fixedNow,
          providerReadback: () => Promise.resolve({ verified: true, evidence: ['unreachable'] }),
        },
      }),
    ).rejects.toThrow('audit unavailable');

    expect(called).toBe(false);
    expect(await store.get('approval-atomic-1')).toMatchObject({
      status: 'RELEASED',
      reservationExecutionId: 'exec-audit-failure',
      releaseReason: 'AUDIT_START_FAILED_BEFORE_PROVIDER_EXECUTION',
    });
  });
});
