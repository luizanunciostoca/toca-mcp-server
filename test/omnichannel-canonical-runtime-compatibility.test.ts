import { describe, expect, it } from 'vitest';
import {
  InMemoryApprovalStore,
  hashApprovalDescriptor,
  type ApprovalRecord,
} from '../src/governance/approval-governance.js';
import { InMemoryWorkflowStore } from '../src/workflow/in-memory-workflow-store.js';
import {
  WORKFLOW_INSTANCE_STATUSES,
  type WorkflowBlueprint,
} from '../src/workflow/workflow-contracts.js';

const now = '2026-08-15T03:00:00.000Z';
const scope = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  organizationId: 'org-1',
} as const;

function nurtureBlueprint(workflowId = 'workflow:nurture:contact-1'): WorkflowBlueprint {
  return {
    workflowId,
    routeId: 'R10',
    definitionId: 'nurture:sequence:welcome',
    definitionVersion: '1',
    idempotencyKey: 'nurture:enroll:contact-1:welcome',
    correlationId: 'corr:nurture:contact-1',
    ...scope,
    requesterPrincipalId: 'principal:omnichannel',
    input: { contactRecordId: 'contact-1', subjectRef: 'subject:opaque:contact-1' },
    steps: [
      {
        stepId: 'eligibility',
        name: 'Recheck privacy eligibility',
        capabilityId: 'privacy.suppression.check',
        maxAttempts: 2,
      },
      {
        stepId: 'send',
        name: 'Governed outbound send',
        capabilityId: 'whatsapp.message.send',
        maxAttempts: 2,
        dependsOn: ['eligibility'],
      },
    ],
  };
}

function approvedOutboundRecord(): ApprovalRecord {
  const descriptor = {
    capabilityId: 'whatsapp.message.send',
    tenantId: scope.tenantId,
    contactRecordId: 'contact-1',
    preparedPayloadRef: 'prepared:message-1',
  };
  return {
    approvalId: 'approval:outbound-1',
    requester: 'principal:omnichannel',
    approver: 'principal:approver',
    routeId: 'R30',
    capabilityId: 'whatsapp.message.send',
    descriptorSha256: hashApprovalDescriptor(descriptor),
    targetAccount: scope.tenantId,
    scope: ['omnichannel:whatsapp:send'],
    financialCeiling: null,
    requestedAt: '2026-08-15T02:00:00.000Z',
    issuedAt: '2026-08-15T02:01:00.000Z',
    expiresAt: '2026-08-16T00:00:00.000Z',
    consumedAt: null,
    revokedAt: null,
    reservationExecutionId: null,
    reservationPrincipalId: null,
    reservationCorrelationId: null,
    reservedAt: null,
    executingAt: null,
    providerReadbackAt: null,
    providerReadbackEvidence: [],
    releasedAt: null,
    releaseReason: null,
    failedReviewAt: null,
    failureReason: null,
    status: 'APPROVED',
    evidence: ['approval:fixture'],
    correlationId: 'corr:outbound-1',
    version: 1,
  };
}

describe('canonical Durable Workflow Engine compatibility', () => {
  it('deduplicates nurture enrollment by the existing workflow idempotency key', async () => {
    const store = new InMemoryWorkflowStore();
    const blueprint = nurtureBlueprint();

    const first = await store.create(blueprint, now);
    const replay = await store.create(blueprint, now);

    expect(replay.instance.workflowId).toBe(first.instance.workflowId);
    expect(replay.events.filter((event) => event.eventType === 'WORKFLOW_CREATED')).toHaveLength(1);

    await expect(
      store.create(nurtureBlueprint('workflow:nurture:duplicate-contact-1'), now),
    ).rejects.toThrow('WORKFLOW_IDEMPOTENCY_CONFLICT');
  });

  it('reuses the canonical retry lifecycle rather than a nurture-specific retry loop', async () => {
    const store = new InMemoryWorkflowStore();
    await store.create(nurtureBlueprint(), now);
    const [claim] = await store.claimReadySteps({ workerId: 'worker-1', now, limit: 1 });
    expect(claim).toBeDefined();

    await store.failStep({
      workflowId: claim!.workflowId,
      stepId: claim!.stepId,
      executionId: claim!.executionId,
      errorCode: 'TEMPORARY_FAILURE',
      evidence: ['attempt:1:failed'],
      now: '2026-08-15T03:01:00.000Z',
    });
    await store.retryStep({
      workflowId: claim!.workflowId,
      stepId: claim!.stepId,
      evidence: ['retry:authorized'],
      now: '2026-08-15T03:02:00.000Z',
    });
    const [retryClaim] = await store.claimReadySteps({
      workerId: 'worker-1',
      now: '2026-08-15T03:03:00.000Z',
      limit: 1,
    });

    expect(retryClaim?.stepId).toBe(claim!.stepId);
    expect(retryClaim?.executionId).not.toBe(claim!.executionId);
  });

  it('records the current pause incompatibility instead of inventing a parallel scheduler state', () => {
    expect(WORKFLOW_INSTANCE_STATUSES).not.toContain('PAUSED');
  });
});

describe('canonical Approval Engine read-back invariant', () => {
  it('cannot consume outbound approval before provider read-back', async () => {
    const store = new InMemoryApprovalStore();
    const approval = approvedOutboundRecord();
    await store.put(approval);
    const descriptor = {
      capabilityId: approval.capabilityId,
      tenantId: scope.tenantId,
      contactRecordId: 'contact-1',
      preparedPayloadRef: 'prepared:message-1',
    };
    const executionId = 'exec:outbound-1';

    await store.transition(approval.approvalId, {
      type: 'RESERVE',
      expectation: {
        requester: approval.requester,
        routeId: 'R30',
        capabilityId: approval.capabilityId,
        descriptorSha256: hashApprovalDescriptor(descriptor),
        targetAccount: scope.tenantId,
        requiredScope: ['omnichannel:whatsapp:send'],
      },
      binding: {
        executionId,
        principalId: approval.requester,
        correlationId: approval.correlationId,
      },
      now,
    });
    await store.transition(approval.approvalId, {
      type: 'BEGIN_EXECUTION',
      executionId,
      evidence: ['execution:started'],
      now: '2026-08-15T03:01:00.000Z',
    });

    await expect(
      store.transition(approval.approvalId, {
        type: 'CONSUME',
        executionId,
        evidence: ['attempted:without-readback'],
        now: '2026-08-15T03:02:00.000Z',
      }),
    ).rejects.toThrow('APPROVAL_TRANSITION_INVALID');

    await store.transition(approval.approvalId, {
      type: 'PROVIDER_READBACK',
      executionId,
      evidence: ['provider:readback:verified'],
      now: '2026-08-15T03:03:00.000Z',
    });
    await store.transition(approval.approvalId, {
      type: 'CONSUME',
      executionId,
      evidence: ['provider:readback:verified'],
      now: '2026-08-15T03:04:00.000Z',
    });

    expect((await store.get(approval.approvalId))?.status).toBe('CONSUMED');
  });
});
