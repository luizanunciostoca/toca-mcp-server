import { describe, expect, it } from 'vitest';
import { applyApprovalAtomicTransition } from '../src/governance/approval-governance.js';
import {
  issueApprovalBatch,
  refreshApprovalBatch,
  requestApprovalBatch,
  summarizeApprovalBatch,
} from '../src/governance/approval-batch.js';

const now = '2026-08-26T22:00:00Z';
const authority = {
  approver: 'operator:marketing',
  allowedRouteIds: ['R02' as const],
  allowedCapabilityIds: ['instagram.publish.image'],
  allowedTargetAccounts: ['instagram-account-1'],
  maxFinancialCeiling: null,
  validatedAt: '2026-08-26T21:59:00Z',
  evidence: ['drive://approval-authority/marketing'],
};
const requests = [
  {
    requester: 'service:autopilot',
    routeId: 'R02' as const,
    capabilityId: 'instagram.publish.image',
    descriptor: { contentItemId: 'item-1', caption: 'A' },
    targetAccount: 'instagram-account-1',
    scope: ['instagram.publish.image'],
    expiresAt: '2026-08-27T01:00:00Z',
    evidence: ['content:item-1'],
    correlationId: 'corr-item-1',
  },
  {
    requester: 'service:autopilot',
    routeId: 'R02' as const,
    capabilityId: 'instagram.publish.image',
    descriptor: { contentItemId: 'item-2', caption: 'B' },
    targetAccount: 'instagram-account-1',
    scope: ['instagram.publish.image'],
    expiresAt: '2026-08-27T01:00:00Z',
    evidence: ['content:item-2'],
    correlationId: 'corr-item-2',
  },
];

describe('approval batch', () => {
  it('creates one independent ApprovalRecord per item while exposing one batch summary', () => {
    const batch = requestApprovalBatch(requests, {
      now,
      createBatchId: () => 'batch-1',
      createApprovalId: (index) => `approval-${index + 1}`,
      evidence: ['approval-ui:batch-review'],
    });
    expect(batch.status).toBe('REQUESTED');
    expect(batch.approvals.map((approval) => approval.approvalId)).toEqual([
      'approval-1',
      'approval-2',
    ]);
    expect(new Set(batch.approvals.map((approval) => approval.descriptorSha256)).size).toBe(2);
    expect(summarizeApprovalBatch(batch)).toMatchObject({
      total: 2,
      requested: 2,
      approved: 0,
    });
  });

  it('supports partial or full UX selection without broadening any item scope', () => {
    const requested = requestApprovalBatch(requests, {
      now,
      createBatchId: () => 'batch-2',
      createApprovalId: (index) => `approval-${index + 1}`,
    });
    const partial = issueApprovalBatch(requested, {
      authority,
      selectedApprovalIds: ['approval-1'],
      evidence: ['operator:batch-selection:approval-1'],
      now: '2026-08-26T22:01:00Z',
    });
    expect(partial.status).toBe('PARTIALLY_APPROVED');
    expect(partial.approvals.map((approval) => approval.status)).toEqual(['APPROVED', 'REQUESTED']);
    expect(partial.approvals[0]!.scope).toEqual(['instagram.publish.image']);
  });

  it('tracks consumption independently after provider readback', () => {
    const approved = issueApprovalBatch(
      requestApprovalBatch(requests, {
        now,
        createBatchId: () => 'batch-3',
        createApprovalId: (index) => `approval-${index + 1}`,
      }),
      {
        authority,
        selectedApprovalIds: 'ALL',
        evidence: ['operator:batch-approve-all'],
        now: '2026-08-26T22:01:00Z',
      },
    );
    const first = approved.approvals[0]!;
    const expectation = {
      requester: first.requester,
      routeId: first.routeId,
      capabilityId: first.capabilityId,
      descriptorSha256: first.descriptorSha256,
      targetAccount: first.targetAccount,
      requiredScope: first.scope,
    };
    const reserved = applyApprovalAtomicTransition(first, {
      type: 'RESERVE',
      expectation,
      binding: {
        executionId: 'exec-1',
        principalId: first.requester,
        correlationId: first.correlationId,
      },
      now: '2026-08-26T22:02:00Z',
    });
    const executing = applyApprovalAtomicTransition(reserved, {
      type: 'BEGIN_EXECUTION',
      executionId: 'exec-1',
      now: '2026-08-26T22:02:01Z',
    });
    const readback = applyApprovalAtomicTransition(executing, {
      type: 'PROVIDER_READBACK',
      executionId: 'exec-1',
      evidence: ['provider:instagram:ig_1'],
      now: '2026-08-26T22:02:02Z',
    });
    const consumed = applyApprovalAtomicTransition(readback, {
      type: 'CONSUME',
      executionId: 'exec-1',
      evidence: ['approval:consumed:exec-1'],
      now: '2026-08-26T22:02:03Z',
    });
    const refreshed = refreshApprovalBatch(approved, [consumed, approved.approvals[1]!]);
    expect(refreshed.status).toBe('PARTIALLY_CONSUMED');
    expect(summarizeApprovalBatch(refreshed)).toMatchObject({ consumed: 1, approved: 1 });
  });

  it('rejects duplicate descriptor bindings inside one batch', () => {
    expect(() =>
      requestApprovalBatch([requests[0]!, { ...requests[0]!, correlationId: 'corr-duplicate' }], {
        now,
        createApprovalId: (index) => `approval-${index}`,
      }),
    ).toThrow('APPROVAL_BATCH_ITEM_BINDING_DUPLICATE');
  });
});
