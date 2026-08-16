import { describe, expect, it } from 'vitest';
import {
  InMemoryApprovalStore,
  applyApprovalAtomicTransition,
  consumeApproval,
  hashApprovalDescriptor,
  issueApproval,
  requestApproval,
  revokeApproval,
  toApprovalRecordWire,
  verifyApproval,
  type ApprovalRecord,
} from '../src/governance/approval-governance.js';

const descriptor = {
  campaign: 'TOCA | THE PARTY | 2026-08-15',
  dailyBudgetMinor: 17_000,
};

function approvedRecord(): ApprovalRecord {
  const requested = requestApproval(
    {
      requester: 'luiz',
      routeId: 'R28',
      capabilityId: 'meta_ads.campaign.create_paused',
      descriptor,
      targetAccount: 'act_311793958882290',
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
      allowedTargetAccounts: ['act_311793958882290'],
      maxFinancialCeiling: { amountMinor: 20_000, currency: 'BRL' },
      validatedAt: '2026-08-14T20:04:00Z',
      evidence: ['drive://approval-authority/luiz'],
    },
    evidence: ['chatgpt://approval/turn-1'],
    now: '2026-08-14T20:05:00Z',
  });
}

const expectation = {
  requester: 'luiz',
  routeId: 'R28' as const,
  capabilityId: 'meta_ads.campaign.create_paused',
  descriptorSha256: hashApprovalDescriptor(descriptor),
  targetAccount: 'act_311793958882290',
  requiredScope: ['meta_ads.campaign.create_paused'],
  financialAmountMinor: 17_000,
  currency: 'BRL',
};

const binding = (executionId: string) => ({
  executionId,
  principalId: 'luiz',
  correlationId: `corr-${executionId}`,
});

describe('R27 approval governance', () => {
  it('binds the immutable descriptor, target, scope and financial ceiling', () => {
    const approved = approvedRecord();
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
  });

  it('requires reserve -> executing -> provider readback -> consumed in order', async () => {
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

    const reserved = await store.transition('approval-1', {
      type: 'RESERVE',
      expectation,
      binding: binding('exec-1'),
      now: '2026-08-14T21:00:00Z',
    });
    expect(reserved).toMatchObject({
      status: 'RESERVED',
      reservationExecutionId: 'exec-1',
      reservationPrincipalId: 'luiz',
      version: 3,
    });

    const executing = await store.transition('approval-1', {
      type: 'BEGIN_EXECUTION',
      executionId: 'exec-1',
      evidence: ['provider://execution/started'],
      now: '2026-08-14T21:00:01Z',
    });
    expect(executing).toMatchObject({ status: 'EXECUTING', version: 4 });

    const readback = await store.transition('approval-1', {
      type: 'PROVIDER_READBACK',
      executionId: 'exec-1',
      evidence: ['meta://campaign/123:status=PAUSED'],
      now: '2026-08-14T21:00:02Z',
    });
    expect(readback).toMatchObject({
      status: 'PROVIDER_READBACK',
      providerReadbackEvidence: ['meta://campaign/123:status=PAUSED'],
      version: 5,
    });

    const consumed = await store.transition('approval-1', {
      type: 'CONSUME',
      executionId: 'exec-1',
      evidence: ['approval://consumed/exec-1'],
      now: '2026-08-14T21:00:03Z',
    });
    expect(consumed).toMatchObject({ status: 'CONSUMED', version: 6 });
    expect(toApprovalRecordWire(consumed)).toMatchObject({
      approval_id: 'approval-1',
      route_id: 'R28',
      descriptor_sha256: hashApprovalDescriptor(descriptor),
      reservation_execution_id: 'exec-1',
      status: 'CONSUMED',
    });
    expect(await store.history('approval-1')).toHaveLength(6);
    expect(verifyApproval(consumed, expectation, '2026-08-14T21:00:04Z').valid).toBe(false);
  });

  it('does not permit direct consumption before provider readback', () => {
    const approved = approvedRecord();
    const reserved = applyApprovalAtomicTransition(approved, {
      type: 'RESERVE',
      expectation,
      binding: binding('exec-direct'),
      now: '2026-08-14T21:10:00Z',
    });
    const executing = applyApprovalAtomicTransition(reserved, {
      type: 'BEGIN_EXECUTION',
      executionId: 'exec-direct',
      now: '2026-08-14T21:10:01Z',
    });
    expect(() =>
      consumeApproval(
        executing,
        'exec-direct',
        ['approval://invalid-consume'],
        '2026-08-14T21:10:02Z',
      ),
    ).toThrow('APPROVAL_TRANSITION_INVALID');
  });

  it('releases only before provider execution and permits a new execution claim', async () => {
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

    await store.transition('approval-1', {
      type: 'RESERVE',
      expectation,
      binding: binding('exec-release-1'),
      now: '2026-08-14T21:20:00Z',
    });
    const released = await store.transition('approval-1', {
      type: 'RELEASE',
      executionId: 'exec-release-1',
      reason: 'AUDIT_FAILED_BEFORE_PROVIDER_EXECUTION',
      evidence: ['audit://failed-before-provider'],
      now: '2026-08-14T21:20:01Z',
    });
    expect(released.status).toBe('RELEASED');
    expect(verifyApproval(released, expectation, '2026-08-14T21:20:02Z').valid).toBe(true);

    await expect(
      store.transition('approval-1', {
        type: 'RESERVE',
        expectation,
        binding: binding('exec-release-1'),
        now: '2026-08-14T21:20:03Z',
      }),
    ).rejects.toThrow('APPROVAL_EXECUTION_ID_ALREADY_CLAIMED');

    const reservedAgain = await store.transition('approval-1', {
      type: 'RESERVE',
      expectation,
      binding: binding('exec-release-2'),
      now: '2026-08-14T21:20:04Z',
    });
    expect(reservedAgain).toMatchObject({
      status: 'RESERVED',
      reservationExecutionId: 'exec-release-2',
      version: 5,
    });
  });

  it('blocks replay after provider execution becomes ambiguous', async () => {
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
    await store.transition('approval-1', {
      type: 'RESERVE',
      expectation,
      binding: binding('exec-ambiguous'),
      now: '2026-08-14T21:30:00Z',
    });
    await store.transition('approval-1', {
      type: 'BEGIN_EXECUTION',
      executionId: 'exec-ambiguous',
      now: '2026-08-14T21:30:01Z',
    });

    await expect(
      store.transition('approval-1', {
        type: 'RELEASE',
        executionId: 'exec-ambiguous',
        reason: 'UNSAFE_RELEASE',
        evidence: ['test://unsafe-release'],
        now: '2026-08-14T21:30:02Z',
      }),
    ).rejects.toThrow('APPROVAL_TRANSITION_INVALID');

    const failed = await store.transition('approval-1', {
      type: 'FAIL_REVIEW_REQUIRED',
      executionId: 'exec-ambiguous',
      reason: 'PROVIDER_RESULT_AMBIGUOUS',
      evidence: ['provider://ambiguous'],
      now: '2026-08-14T21:30:03Z',
    });
    expect(failed.status).toBe('FAILED_REVIEW_REQUIRED');
    expect(verifyApproval(failed, expectation, '2026-08-14T21:30:04Z').valid).toBe(false);
  });

  it('persists optimistic history and blocks stale direct writes', async () => {
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
          targetAccount: 'act_311793958882290',
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
