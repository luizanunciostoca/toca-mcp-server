import { describe, expect, it } from 'vitest';
import { createTrustedServiceExecutionIdentity } from '../src/core/identity.js';
import type { ApprovalRecord } from '../src/governance/approval-governance.js';
import {
  MarketingAutopilotClosedLoopRunner,
  type MarketingAutopilotStageContext,
  type MarketingAutopilotStageExecutor,
  type MarketingAutopilotStageResult,
} from '../src/learning/marketing-autopilot-closed-loop-runner.js';
import type { MarketingAutopilotClosedLoopStage } from '../src/learning/marketing-autopilot-cycle.js';
import type { RevenueEvidenceRecord } from '../src/measurement/attribution-revenue-contracts.js';
import type { CoreCapabilityGateway } from '../src/orchestrator/contracts.js';
import { InMemoryWorkflowStore } from '../src/workflow/in-memory-workflow-store.js';

const NOW = '2026-08-20T23:30:00.000Z';
const identity = createTrustedServiceExecutionIdentity({
  principalId: 'autopilot-test-service',
  tenantId: 'toca',
  workspaceId: 'toca-marketing',
  organizationId: 'toca',
  roles: ['ADMIN'],
  evidence: ['test:autopilot:identity'],
  now: NOW,
});

class FakeCore implements CoreCapabilityGateway {
  executeCalls = 0;
  requestApprovalCalls = 0;
  approval: ApprovalRecord | undefined;
  approvalRequired = false;
  sideEffects = true;
  idempotent = true;
  failExecuteCalls = 0;

  inspect(input: Parameters<CoreCapabilityGateway['inspect']>[0]) {
    return {
      canonicalCapabilityId: input.capabilityId,
      routeId: 'R31' as const,
      sideEffects: this.sideEffects,
      approvalRequired: this.approvalRequired,
      idempotent: this.idempotent,
    };
  }

  execute(input: Parameters<CoreCapabilityGateway['execute']>[0]) {
    this.executeCalls += 1;
    if (this.executeCalls <= this.failExecuteCalls) {
      return Promise.reject(new Error('PROVIDER_TEMPORARY_FAILURE'));
    }
    return Promise.resolve({
      executionId: `core-execution-${this.executeCalls}`,
      capabilityId: input.capabilityId,
      result: { ok: true },
      providerReadbackVerified: true,
    });
  }

  requestApproval(input: Parameters<CoreCapabilityGateway['requestApproval']>[0]) {
    this.requestApprovalCalls += 1;
    this.approval = approvalRecord(input.capabilityId, input.correlationId);
    return Promise.resolve(this.approval);
  }

  getApproval(): Promise<ApprovalRecord | undefined> {
    return Promise.resolve(this.approval);
  }

  approve(): void {
    if (!this.approval) throw new Error('TEST_APPROVAL_MISSING');
    this.approval = {
      ...this.approval,
      approver: identity.principal.principalId,
      issuedAt: NOW,
      status: 'APPROVED',
      evidence: [...this.approval.evidence, 'test:approval:approved'],
      version: this.approval.version + 1,
    };
  }
}

class RecordingStages implements MarketingAutopilotStageExecutor {
  readonly calls: MarketingAutopilotClosedLoopStage[] = [];
  readonly overrides = new Map<MarketingAutopilotClosedLoopStage, MarketingAutopilotStageResult>();
  blockObserve: Promise<void> | undefined;

  async execute(input: MarketingAutopilotStageContext): Promise<MarketingAutopilotStageResult> {
    this.calls.push(input.stage);
    if (input.stage === 'OBSERVE' && this.blockObserve) await this.blockObserve;
    const override = this.overrides.get(input.stage);
    if (override) return override;
    return defaultStageResult(input.stage);
  }
}

function defaultStageResult(
  stage: MarketingAutopilotStageContext['stage'],
): MarketingAutopilotStageResult {
  if (stage === 'PLAN') {
    return {
      output: {
        plannedAction: {
          capabilityId: 'instagram.schedule.create',
          payload: { idempotencyKey: 'autopilot-side-effect-1', contentItemId: 'content-1' },
        },
      },
      evidence: ['stage:PLAN:plan-1'],
    };
  }
  if (stage === 'READBACK') {
    return {
      output: { providerBacked: true, providerReadbackRefs: ['provider:readback:1'] },
      evidence: ['provider:readback:1'],
    };
  }
  if (stage === 'MEASURE') {
    return {
      output: { measurementRefs: ['measurement:1'], revenueEvidence: [] },
      evidence: ['measurement:1'],
    };
  }
  if (stage === 'LEARN') {
    return { output: { learningOutcomeId: 'learning:1' }, evidence: ['learning:outcome:1'] };
  }
  if (stage === 'NEXT_RECOMMENDATION') {
    return { output: { recommendationId: 'recommendation:1' }, evidence: ['recommendation:1'] };
  }
  return { output: { stage }, evidence: [`stage:${stage}:evidence`] };
}

function createRunner(input: {
  readonly store?: InMemoryWorkflowStore;
  readonly core?: FakeCore;
  readonly stages?: RecordingStages;
  readonly staleClaimAfterMs?: number;
}) {
  const store = input.store ?? new InMemoryWorkflowStore();
  const core = input.core ?? new FakeCore();
  const stages = input.stages ?? new RecordingStages();
  const runner = new MarketingAutopilotClosedLoopRunner({
    workflowStore: store,
    coreGateway: core,
    stageExecutor: stages,
    workerId: 'autopilot-test-worker',
    now: () => NOW,
    ...(input.staleClaimAfterMs === undefined
      ? {}
      : { staleClaimAfterMs: input.staleClaimAfterMs }),
  });
  return { runner, store, core, stages };
}

async function start(runner: MarketingAutopilotClosedLoopRunner, key = 'cycle-1') {
  return runner.start({
    idempotencyKey: key,
    correlationId: `correlation:${key}`,
    identity,
    input: { campaignId: 'campaign-1' },
    now: NOW,
  });
}

function approvalRecord(capabilityId: string, correlationId: string): ApprovalRecord {
  return {
    approvalId: 'approval-autopilot-1',
    requester: identity.principal.principalId,
    approver: null,
    routeId: 'R31',
    capabilityId,
    descriptorSha256: 'a'.repeat(64),
    targetAccount: 'toca-marketing',
    scope: [capabilityId],
    financialCeiling: null,
    requestedAt: NOW,
    issuedAt: null,
    expiresAt: '2026-08-21T23:30:00.000Z',
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
    status: 'REQUESTED',
    evidence: ['test:approval:requested'],
    correlationId,
    version: 1,
  };
}

function count(
  calls: readonly MarketingAutopilotClosedLoopStage[],
  stage: MarketingAutopilotClosedLoopStage,
) {
  return calls.filter((item) => item === stage).length;
}

describe('MarketingAutopilotClosedLoopRunner', () => {
  it('resumes from the durable checkpoint after runner restart', async () => {
    const first = createRunner({});
    const checkpoint = await start(first.runner, 'restart');
    const partial = await first.runner.wake({
      workflowId: checkpoint.workflowId,
      identity,
      now: NOW,
      maxStages: 4,
    });
    expect(partial.stage).toBe('CREATIVE_TRUTH');

    const restarted = createRunner({ store: first.store, core: first.core, stages: first.stages });
    const completed = await restarted.runner.wake({
      workflowId: checkpoint.workflowId,
      identity,
      now: NOW,
    });

    expect(completed.status).toBe('SUCCEEDED');
    expect(count(first.stages.calls, 'OBSERVE')).toBe(1);
    expect(count(first.stages.calls, 'PLAN')).toBe(1);
    expect(count(first.stages.calls, 'LEARN')).toBe(1);
  });

  it('waits for canonical approval and resumes without requesting a duplicate', async () => {
    const setup = createRunner({});
    setup.core.approvalRequired = true;
    const checkpoint = await start(setup.runner, 'approval');

    const waiting = await setup.runner.wake({
      workflowId: checkpoint.workflowId,
      identity,
      now: NOW,
    });
    expect(waiting.status).toBe('WAITING');
    expect(waiting.stage).toBe('APPROVAL');
    expect(waiting.waitingApprovalId).toBe('approval-autopilot-1');
    expect(setup.core.requestApprovalCalls).toBe(1);
    expect(setup.core.executeCalls).toBe(0);

    setup.core.approve();
    const completed = await setup.runner.wake({
      workflowId: checkpoint.workflowId,
      identity,
      now: NOW,
    });
    expect(completed.status).toBe('SUCCEEDED');
    expect(setup.core.requestApprovalCalls).toBe(1);
    expect(setup.core.executeCalls).toBe(1);
  });

  it('persists provider failure and retries only the failed Core stage on the next wake', async () => {
    const setup = createRunner({});
    setup.core.failExecuteCalls = 1;
    const checkpoint = await start(setup.runner, 'provider-failure');

    await expect(
      setup.runner.wake({ workflowId: checkpoint.workflowId, identity, now: NOW }),
    ).rejects.toThrow('PROVIDER_TEMPORARY_FAILURE');
    const failed = await setup.store.get(checkpoint.workflowId);
    expect(failed?.steps.find((step) => step.name === 'SCHEDULE_OR_PUBLISH')?.status).toBe(
      'FAILED',
    );
    expect(count(setup.stages.calls, 'READBACK')).toBe(0);
    expect(count(setup.stages.calls, 'LEARN')).toBe(0);

    const completed = await setup.runner.wake({
      workflowId: checkpoint.workflowId,
      identity,
      now: NOW,
    });
    expect(completed.status).toBe('SUCCEEDED');
    expect(setup.core.executeCalls).toBe(2);
    expect(count(setup.stages.calls, 'PLAN')).toBe(1);
  });

  it('keeps a partial cycle durable and leaves later stages untouched', async () => {
    const setup = createRunner({});
    const checkpoint = await start(setup.runner, 'partial');
    const partial = await setup.runner.wake({
      workflowId: checkpoint.workflowId,
      identity,
      now: NOW,
      maxStages: 3,
    });
    const snapshot = await setup.store.get(checkpoint.workflowId);

    expect(partial.stage).toBe('PLAN');
    expect(snapshot?.steps.find((step) => step.name === 'OBSERVE')?.evidence).toEqual([
      'stage:OBSERVE:evidence',
    ]);
    expect(snapshot?.steps.find((step) => step.name === 'PLAN')?.status).toBe('READY');
    expect(snapshot?.steps.find((step) => step.name === 'LEARN')?.status).toBe('PENDING');
  });

  it('does not double-execute a stage under duplicate concurrent wakeups', async () => {
    const setup = createRunner({});
    let release: (() => void) | undefined;
    setup.stages.blockObserve = new Promise<void>((resolve) => {
      release = resolve;
    });
    const checkpoint = await start(setup.runner, 'duplicate-wakeup');

    const firstWake = setup.runner.wake({ workflowId: checkpoint.workflowId, identity, now: NOW });
    await Promise.resolve();
    const duplicate = await setup.runner.wake({
      workflowId: checkpoint.workflowId,
      identity,
      now: NOW,
      maxStages: 1,
    });
    expect(duplicate.status).toBe('RUNNING');
    expect(count(setup.stages.calls, 'OBSERVE')).toBe(1);

    release?.();
    setup.stages.blockObserve = undefined;
    await firstWake;
    expect(count(setup.stages.calls, 'OBSERVE')).toBe(1);
  });

  it('keeps start and completed wake idempotent', async () => {
    const setup = createRunner({});
    const first = await start(setup.runner, 'idempotency');
    const duplicateStart = await start(setup.runner, 'idempotency');
    expect(duplicateStart.workflowId).toBe(first.workflowId);

    const completed = await setup.runner.wake({ workflowId: first.workflowId, identity, now: NOW });
    const duplicateWake = await setup.runner.wake({
      workflowId: first.workflowId,
      identity,
      now: NOW,
    });
    expect(completed.status).toBe('SUCCEEDED');
    expect(duplicateWake.status).toBe('SUCCEEDED');
    expect(setup.core.executeCalls).toBe(1);
  });

  it('blocks LEARN when provider readback is absent', async () => {
    const setup = createRunner({});
    setup.stages.overrides.set('READBACK', {
      output: { providerBacked: false, providerReadbackRefs: [] },
      evidence: ['readback:attempted'],
    });
    const checkpoint = await start(setup.runner, 'readback-absent');

    await expect(
      setup.runner.wake({ workflowId: checkpoint.workflowId, identity, now: NOW }),
    ).rejects.toThrow('AUTOPILOT_PROVIDER_READBACK_NOT_BACKED');
    expect(count(setup.stages.calls, 'LEARN')).toBe(0);
  });

  it('blocks NEXT_RECOMMENDATION when LEARN returns no evidence', async () => {
    const setup = createRunner({});
    setup.stages.overrides.set('LEARN', {
      output: { learningOutcomeId: 'learning:no-evidence' },
      evidence: [],
    });
    const checkpoint = await start(setup.runner, 'learning-evidence-absent');

    await expect(
      setup.runner.wake({ workflowId: checkpoint.workflowId, identity, now: NOW }),
    ).rejects.toThrow('AUTOPILOT_LEARN_EVIDENCE_REQUIRED');
    expect(count(setup.stages.calls, 'NEXT_RECOMMENDATION')).toBe(0);
  });

  it('rejects revenue that is not backed by canonical provider evidence', async () => {
    const setup = createRunner({});
    const invalidRevenue = {
      tenantId: 'toca',
      workspaceId: 'toca-marketing',
      organizationId: 'toca',
      revenueEvidenceId: 'revenue-invalid',
      dedupeKey: 'revenue-invalid',
      opportunityId: 'opp-1',
      contactId: 'contact-1',
      leadId: null,
      conversationId: null,
      eventId: null,
      source: 'PAYMENT',
      provider: '',
      providerEventId: '',
      providerEvidenceRef: '',
      externalReference: '',
      status: 'CONFIRMED',
      providerReadbackAt: NOW,
      occurredAt: NOW,
      currency: 'BRL',
      grossRevenueMinor: 10000,
      netRevenueMinor: 10000,
      refundMinor: 0,
      costMinor: null,
      ticketReference: null,
      orderReference: null,
      paymentReference: null,
      checkoutReference: null,
      idempotencyKey: 'revenue-invalid',
      executionId: 'revenue-execution',
      correlationId: 'revenue-correlation',
      actorPrincipalId: identity.principal.principalId,
      evidence: ['test:invalid-revenue'],
      createdAt: NOW,
    } as RevenueEvidenceRecord;
    setup.stages.overrides.set('MEASURE', {
      output: {
        measurementRefs: ['measurement:invalid-revenue'],
        revenueEvidence: [invalidRevenue],
      },
      evidence: ['measurement:invalid-revenue'],
    });
    const checkpoint = await start(setup.runner, 'revenue-provider-backed');

    await expect(
      setup.runner.wake({ workflowId: checkpoint.workflowId, identity, now: NOW }),
    ).rejects.toThrow('REVENUE_PROVIDER_REQUIRED');
    expect(count(setup.stages.calls, 'LEARN')).toBe(0);
  });

  it('scopes ready-step claims to the requested workflow', async () => {
    const setup = createRunner({});
    await setup.store.create(
      {
        workflowId: 'aaa-unrelated-workflow',
        routeId: 'R31',
        definitionId: 'unrelated',
        definitionVersion: '1',
        idempotencyKey: 'unrelated',
        correlationId: 'unrelated-correlation',
        tenantId: 'toca',
        workspaceId: 'toca-marketing',
        organizationId: 'toca',
        requesterPrincipalId: identity.principal.principalId,
        steps: [{ stepId: '01_READY', name: 'unrelated' }],
      },
      NOW,
    );
    const checkpoint = await start(setup.runner, 'claim-scope');
    await setup.runner.wake({
      workflowId: checkpoint.workflowId,
      identity,
      now: NOW,
      maxStages: 1,
    });

    const unrelated = await setup.store.get('aaa-unrelated-workflow');
    expect(unrelated?.steps[0]?.status).toBe('READY');
    expect(count(setup.stages.calls, 'OBSERVE')).toBe(1);
  });
});
