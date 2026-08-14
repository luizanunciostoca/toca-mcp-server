import { describe, expect, it } from 'vitest';
import {
  InMemoryApprovalStore,
  consumeApproval,
  hashApprovalDescriptor,
  issueApproval,
  requestApproval,
  revokeApproval,
  toApprovalRecordWire,
  verifyApproval,
} from '../src/governance/approval-governance.js';

const descriptor = {
  campaign: 'TOCA | THE PARTY | 2026-08-15',
  dailyBudgetMinor: 17_000,
};

function approvedRecord() {
  const requested = requestApproval(
    {
      requester: 'luiz',
      routeId: 'R28',
      capabilityId: 'meta_ads.campaign.create_paused',
      descriptor,
      targetAccount: 'act_394512749760530',
      scope: ['meta_ads.campaign.create_paused'],
      financialCeiling: { amountMinor: 17_000, currency: 'BRL' },
      expiresAt: '2026-08-15T03:00:00Z',
      evidence: ['chatgpt://request/turn-1'],
      correlationId: 'corr-approval-1',
    },
    { now: '2026-08-14T20:00:00Z', createId: () => 'approval-1' },
  );
  return issueApproval(requested, {
    authority: {
      approver: 'luiz',
      allowedRouteIds: ['R28'],
      allowedCapabilityIds: ['meta_ads.campaign.create_paused'],
      allowedTargetAccounts: ['act_394512749760530'],
      maxFinancialCeiling: { amountMinor: 20_000, currency: 'BRL' },
      validatedAt: '2026-08-14T20:04:00Z',
      evidence: ['drive://approval-authority/luiz'],
    },
    evidence: ['chatgpt://approval/turn-1'],
    now: '2026-08-14T20:05:00Z',
  });
}

describe('R27 approval governance', () => {
  it('binds the immutable descriptor, target, scope and financial ceiling', () => {
    const approved = approvedRecord();
    const expectation = {
      requester: 'luiz',
      routeId: 'R28' as const,
      capabilityId: 'meta_ads.campaign.create_paused',
      descriptorSha256: hashApprovalDescriptor(descriptor),
      targetAccount: 'act_394512749760530',
      requiredScope: ['meta_ads.campaign.create_paused'],
      financialAmountMinor: 17_000,
      currency: 'BRL',
    };
    expect(verifyApproval(approved, expectation, '2026-08-14T21:00:00Z')).toEqual({
      valid: true,
      reasons: [],
    });
    expect(
      verifyApproval(
        approved,
        { ...expectation, financialAmountMinor: 17_001 },
        '2026-08-14T21:00:00Z',
      ).reasons,
    ).toContain('FINANCIAL_CEILING_EXCEEDED');

    const consumed = consumeApproval(approved, expectation, '2026-08-14T21:00:00Z');
    expect(consumed).toMatchObject({ status: 'CONSUMED', version: 3 });
    expect(toApprovalRecordWire(consumed)).toMatchObject({
      approval_id: 'approval-1',
      route_id: 'R28',
      descriptor_sha256: hashApprovalDescriptor(descriptor),
      status: 'CONSUMED',
    });
  });

  it('persists optimistic history and blocks stale writes', async () => {
    const store = new InMemoryApprovalStore();
    const approved = approvedRecord();
    const requested = {
      ...approved,
      status: 'REQUESTED' as const,
      approver: null,
      issuedAt: null,
      version: 1,
    };
    await store.put(requested);
    await store.put(approved, 1);
    await expect(store.put(revokeApproval(approved, ['revoked']), 1)).rejects.toThrow(
      'APPROVAL_VERSION_CONFLICT',
    );
    expect(await store.history('approval-1')).toHaveLength(2);
  });

  it('rejects unknown capabilities and unauthorized approvers', () => {
    expect(() =>
      requestApproval(
        {
          requester: 'luiz',
          routeId: 'R28',
          capabilityId: 'meta_ads.unknown.execute',
          descriptor,
          targetAccount: 'act_394512749760530',
          scope: ['meta_ads.unknown.execute'],
          expiresAt: '2026-08-15T03:00:00Z',
          evidence: ['chatgpt://request/unknown'],
          correlationId: 'corr-approval-unknown',
        },
        { now: '2026-08-14T20:00:00Z' },
      ),
    ).toThrow('APPROVAL_CAPABILITY_UNKNOWN');

    const requested = { ...approvedRecord(), status: 'REQUESTED' as const, version: 1 };
    expect(() =>
      issueApproval(requested, {
        authority: {
          approver: 'unauthorized',
          allowedRouteIds: ['R27'],
          allowedCapabilityIds: ['approval.issue'],
          allowedTargetAccounts: ['other-account'],
          maxFinancialCeiling: null,
          validatedAt: '2026-08-14T20:04:00Z',
          evidence: ['drive://approval-authority/unauthorized'],
        },
        evidence: ['chatgpt://approval/unauthorized'],
        now: '2026-08-14T20:05:00Z',
      }),
    ).toThrow('APPROVAL_APPROVER_ROUTE_NOT_ALLOWED');
  });
});
