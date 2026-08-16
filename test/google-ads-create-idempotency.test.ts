import { describe, expect, it } from 'vitest';
import { InMemoryAuditSink } from '../src/core/audit.js';
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

const capabilityId = 'google_ads.campaign.create_paused';
const targetAccount = '1234567890';
const descriptor = {
  customerId: targetAccount,
  currencyCode: 'BRL',
  campaignName: 'TOCA deterministic create',
  dailyBudgetMicros: 50_000_000,
  targeting: { locationCriterionIds: ['2076'], languageCriterionIds: ['1014'] },
};
const executionId = `google-ads:create-paused:${hashApprovalDescriptor(descriptor)}`;

const tool: ToolDefinition = {
  name: capabilityId,
  version: '1.1.0',
  provider: 'Google Ads API',
  riskClass: 'WRITE_EXTERNAL',
  requiredScopes: ['https://www.googleapis.com/auth/adwords'],
  capabilityStatus: 'PRODUCTION_VALIDATED',
  sideEffects: true,
  idempotent: false,
};

const identity = createTrustedServiceExecutionIdentity({
  principalId: 'service:test-google-ads-writer',
  tenantId: 'toca-do-morcego',
  roles: ['EXTERNAL_WRITER'],
  allowedRouteIds: ['R28'],
  allowedCapabilityIds: [capabilityId],
  allowedTargetAccounts: [targetAccount],
  evidence: ['test://google-ads/create-idempotency'],
  now: '2026-08-15T05:00:00Z',
});

function approvedRecord(approvalId: string, correlationId: string): ApprovalRecord {
  const requested = requestApproval(
    {
      requester: identity.principal.principalId,
      routeId: 'R28',
      capabilityId,
      descriptor,
      targetAccount,
      scope: [capabilityId],
      financialCeiling: { amountMinor: 5_000, currency: 'BRL' },
      expiresAt: '2026-08-16T05:00:00Z',
      evidence: ['test://google-ads/approval-request'],
      correlationId,
    },
    { now: '2026-08-15T05:01:00Z', createId: () => approvalId },
  );
  return issueApproval(requested, {
    authority: {
      approver: 'luiz',
      allowedRouteIds: ['R28'],
      allowedCapabilityIds: [capabilityId],
      allowedTargetAccounts: [targetAccount],
      maxFinancialCeiling: { amountMinor: 5_000, currency: 'BRL' },
      validatedAt: '2026-08-15T05:02:00Z',
      evidence: ['test://google-ads/approval-authority'],
    },
    evidence: ['test://google-ads/approved'],
    now: '2026-08-15T05:03:00Z',
  });
}

async function putApproved(store: InMemoryApprovalStore, record: ApprovalRecord): Promise<void> {
  await store.put({
    ...record,
    status: 'REQUESTED',
    approver: null,
    issuedAt: null,
    version: 1,
  });
  await store.put(record, 1);
}

function policyContext() {
  return {
    identity,
    connectedAccount: targetAccount,
    descriptorSha256: hashApprovalDescriptor(descriptor),
    requiredApprovalScope: [capabilityId],
    financialAmountMinor: 5_000,
    currency: 'BRL',
    now: '2026-08-15T06:00:00Z',
  };
}

describe('Google Ads create_paused durable idempotency', () => {
  it('prevents a duplicate campaign intent even when a second approval is issued', async () => {
    const store = new InMemoryApprovalStore();
    await putApproved(store, approvedRecord('approval-google-1', 'corr-approval-google-1'));
    await putApproved(store, approvedRecord('approval-google-2', 'corr-approval-google-2'));
    const auditSink = new InMemoryAuditSink();
    let actionCalls = 0;

    const execute = (approvalId: string) =>
      executeTool({
        tool,
        policyContext: policyContext(),
        auditSink,
        correlationId: executionId,
        createExecutionId: () => executionId,
        action: () => {
          actionCalls += 1;
          return Promise.resolve({
            campaignResourceName: 'customers/1234567890/campaigns/456',
            status: 'PAUSED' as const,
          });
        },
        approvalExecution: {
          approvalId,
          store,
          now: () => '2026-08-15T06:00:00Z',
          providerReadback: (output) =>
            Promise.resolve({
              verified: output.status === 'PAUSED',
              externalResourceId: output.campaignResourceName,
              evidence: [`google-ads://${output.campaignResourceName}:status=PAUSED`],
            }),
        },
      });

    await expect(execute('approval-google-1')).resolves.toMatchObject({ status: 'PAUSED' });
    await expect(execute('approval-google-2')).rejects.toMatchObject({
      code: 'DUPLICATE_PREVENTED',
      retryable: false,
    });
    expect(actionCalls).toBe(1);
  });
});
