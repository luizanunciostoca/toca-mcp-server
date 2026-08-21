import { describe, expect, it } from 'vitest';
import { createTrustedServiceExecutionIdentity } from '../src/core/identity.js';
import type { ApprovalRecord } from '../src/governance/approval-governance.js';
import {
  MarketingAutopilotClosedLoopRunner,
  type MarketingAutopilotClosedLoopAdapters,
} from '../src/learning/marketing-autopilot-closed-loop.js';
import type { CoreCapabilityGateway } from '../src/orchestrator/contracts.js';
import { InMemoryWorkflowStore } from '../src/workflow/in-memory-workflow-store.js';
import type { WorkflowSnapshot, WorkflowStepClaim } from '../src/workflow/workflow-contracts.js';

const identity = createTrustedServiceExecutionIdentity({
  principalId: 'service:marketing-autopilot-test',
  tenantId: 'toca',
  workspaceId: 'toca',
  organizationId: 'toca',
  roles: ['ADMIN', 'APPROVER'],
  allowedRouteIds: ['R31'],
  evidence: ['test://identity'],
  now: '2026-08-20T20:00:00.000Z',
});

class FakeCoreGateway implements CoreCapabilityGateway {
  approvalRequired = false;
  providerFailure = false;
  providerReadbackVerified = true;
  executeCalls = 0;
  requestApprovalCalls = 0;
  readonly approvals = new Map<string, ApprovalRecord>();

  inspect(): ReturnType<CoreCapabilityGateway['inspect']> {
    return {
      canonicalCapabilityId: 'instagram.content.publish',
      routeId: 'R20',
      sideEffects: true,
      approvalRequired: this.approvalRequired,
      idempotent: true,
    };
  }

  async execute(input: Parameters<CoreCapabilityGateway['execute']>[0]) {
    this.executeCalls += 1;
    if (this.providerFailure) throw new Error('provider unavailable');
    return {
      executionId: `core-execution-${this.executeCalls}`,
      capabilityId: input.capabilityId,
      result: { providerId: `media-${this.executeCalls}` },
      providerReadbackVerified: this.providerReadbackVerified,
    };
  }

  async requestApproval(input: Parameters<CoreCapabilityGateway['requestApproval']>[0]) {
    this.requestApprovalCalls += 1;
    const approval = approvalRecord(`approval-${this.requestApprovalCalls}`, input, 'REQUESTED');
    this.approvals.set(approval.approvalId, approval);
    return approval;
  }

  getApproval(approvalId: string): Promise<ApprovalRecord | undefined> {
    return Promise.resolve(this.approvals.get(approvalId));
  }

  approve(approvalId: string): void {
    const current = this.approvals.get(approvalId);
    if (!current) throw new Error('approval not found');
    this.approvals.set(approvalId, {
      ...current,
      status: 'APPROVED',
      approver: 'human:approver',
      issuedAt: '2026-08-20T20:20:00.000Z',
      version: current.version + 1,
      evidence: [...current.evidence, 'test://approval/approved'],
    });
  }
}

function approvalRecord(
  approvalId: string,
  input: Parameters<CoreCapabilityGateway['requestApproval']>[0],
  status: ApprovalRecord['status'],
): ApprovalRecord {
  return {
    approvalId,
    requester: input.identity.principal.principalId,
    approver: null,
    routeId: 'R31',
    capabilityId: input.capabilityId,
    descriptorSha256: 'a'.repeat(64),
    targetAccount: 'toca',
    scope: ['publish'],
    financialCeiling: null,
    requestedAt: '2026-08-20T20:10:00.000Z',
    issuedAt: null,
    expiresAt: input.expiresAt,
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
    status,
    evidence: [...input.evidence, `test://approval/${approvalId}`],
    correlationId: input.correlationId,
    version: 1,
  };
}

function baseAdapters(
  overrides: Partial<MarketingAutopilotClosedLoopAdapters> = {},
): MarketingAutopilotClosedLoopAdapters {
  const sideEffect = {
    capabilityId: 'instagram.content.publish',
    payload: { contentItemId: 'content-1', idempotencyKey: 'publish-content-1' },
    approvalExpiresAt: '2026-08-21T20:00:00.000Z',
  };
  return {
    observe: async () => ({ output: { observed: true }, evidenceRefs: ['observe://evidence'] }),
    diagnose: async () => ({ output: { diagnosed: true }, evidenceRefs: ['diagnose://evidence'] }),
    decidePlan: async () => ({ output: { planned: true }, evidenceRefs: ['plan://evidence'] }),
    creativeTruth: async () => ({
      output: { valid: true },
      evidenceRefs: ['creative-truth://evidence'],
    }),
    asset: async () => ({ output: { assetId: 'asset-1' }, evidenceRefs: ['asset://asset-1'] }),
    gates: async () => ({
      sideEffect,
      output: { sideEffect, gatesPassed: true },
      evidenceRefs: ['gates://passed'],
    }),
    readback: async () => ({
      providerBacked: true,
      output: { providerBacked: true, providerId: 'media-1' },
      evidenceRefs: ['provider://readback/media-1'],
    }),
    measure: async () => ({
      revenue: 1200,
      revenueProviderBacked: true,
      output: { revenue: 1200, revenueProviderBacked: true },
      evidenceRefs: ['measurement://provider-backed/revenue'],
    }),
    learn: async () => ({
      actionRequested: false,
      output: { recommendationId: 'rec-1' },
      evidenceRefs: ['r31://learning/rec-1'],
    }),
    nextRecommendation: async () => ({
      output: { recommendationId: 'rec-1' },
      evidenceRefs: ['r31://recommendation/rec-1'],
    }),
    ...overrides,
  };
}

function clock() {
  let tick = 0;
  return () => new Date(Date.parse('2026-08-20T20:00:00.000Z') + tick++ * 1000).toISOString();
}

async function startRunner(input: {
  adapters?: MarketingAutopilotClosedLoopAdapters;
  core?: FakeCoreGateway;
  store?: InMemoryWorkflowStore;
}) {
  const store = input.store ?? new InMemoryWorkflowStore();
  const core = input.core ?? new FakeCoreGateway();
  const runner = new MarketingAutopilotClosedLoopRunner({
    workflowStore: store,
    core,
    adapters: input.adapters ?? baseAdapters(),
  });
  const now = clock();
  const started = await runner.start(
    {
      idempotencyKey: 'cycle-2026-08-20',
      correlationId: 'corr-cycle-2026-08-20',
      identity,
      asOf: '2026-08-20T20:00:00.000Z',
      campaignScope: 'sunset',
    },
    now(),
  );
  return { runner, store, core, now, started };
}

async function claimNext(
  store: InMemoryWorkflowStore,
  workerId: string,
  now: string,
): Promise<WorkflowStepClaim> {
  const claims = await store.claimReadySteps({ workerId, now, limit: 1 });
  expect(claims).toHaveLength(1);
  return claims[0]!;
}

async function runSteps(input: {
  runner: MarketingAutopilotClosedLoopRunner;
  store: InMemoryWorkflowStore;
  now: () => string;
  count: number;
}): Promise<WorkflowSnapshot> {
  let snapshot: WorkflowSnapshot | undefined;
  for (let index = 0; index < input.count; index += 1) {
    const claim = await claimNext(input.store, `worker-${index}`, input.now());
    snapshot = await input.runner.handleClaim(claim, input.now());
  }
  if (!snapshot) throw new Error('no steps executed');
  return snapshot;
}

describe('Marketing Autopilot closed loop', () => {
  it('starts idempotently with one durable workflow identity', async () => {
    const { runner, started, now } = await startRunner({});
    const duplicate = await runner.start(
      {
        idempotencyKey: 'cycle-2026-08-20',
        correlationId: 'corr-cycle-2026-08-20',
        identity,
        asOf: '2026-08-20T20:00:00.000Z',
        campaignScope: 'sunset',
      },
      now(),
    );
    expect(duplicate.instance.workflowId).toBe(started.instance.workflowId);
    expect(duplicate.events.filter((event) => event.eventType === 'WORKFLOW_CREATED')).toHaveLength(
      1,
    );
  });

  it('continues from the persisted checkpoint after runner restart', async () => {
    let observeCalls = 0;
    const adapters = baseAdapters({
      observe: async () => {
        observeCalls += 1;
        return { output: { observed: true }, evidenceRefs: ['observe://restart-checkpoint'] };
      },
    });
    const { runner, store, core, now, started } = await startRunner({ adapters });
    const observeClaim = await claimNext(store, 'worker-before-restart', now());
    await runner.handleClaim(observeClaim, now());

    const restartedRunner = new MarketingAutopilotClosedLoopRunner({
      workflowStore: store,
      core,
      adapters,
    });
    const diagnoseClaim = await claimNext(store, 'worker-after-restart', now());
    expect(diagnoseClaim.stepId).toBe('02-diagnose');
    const afterRestart = await restartedRunner.handleClaim(diagnoseClaim, now());

    expect(observeCalls).toBe(1);
    expect(afterRestart.steps.find((step) => step.stepId === '01-observe')).toMatchObject({
      status: 'SUCCEEDED',
      evidence: ['observe://restart-checkpoint'],
    });
    expect(afterRestart.instance.workflowId).toBe(started.instance.workflowId);
  });

  it('waits for formal approval and resumes only when both durable task and Core approval are complete', async () => {
    const core = new FakeCoreGateway();
    core.approvalRequired = true;
    const { runner, store, now } = await startRunner({ core });
    await runSteps({ runner, store, now, count: 6 });

    const approvalClaim = await claimNext(store, 'approval-worker', now());
    const waiting = await runner.handleClaim(approvalClaim, now());
    expect(waiting.instance.status).toBe('WAITING');
    expect(waiting.steps.find((step) => step.stepId === '07-approval')?.status).toBe(
      'WAITING_HUMAN',
    );
    expect(waiting.humanTasks[0]?.status).toBe('OPEN');
    expect(core.requestApprovalCalls).toBe(1);

    const task = waiting.humanTasks[0]!;
    const approvalId = (task.payload as { approvalId: string }).approvalId;
    core.approve(approvalId);
    await store.claimHumanTask({
      taskId: task.taskId,
      principalId: 'human:approver',
      principalRoles: ['APPROVER'],
      evidence: ['test://human/claimed'],
      now: now(),
    });
    await store.completeHumanTask({
      taskId: task.taskId,
      principalId: 'human:approver',
      completion: { approved: true },
      evidence: ['test://human/approved'],
      now: now(),
    });

    const resumedClaim = await claimNext(store, 'approval-resume-worker', now());
    expect(resumedClaim.stepId).toBe('07-approval');
    const resumed = await runner.handleClaim(resumedClaim, now());
    expect(resumed.steps.find((step) => step.stepId === '07-approval')?.status).toBe('SUCCEEDED');

    const sideEffectClaim = await claimNext(store, 'side-effect-worker', now());
    await runner.handleClaim(sideEffectClaim, now());
    expect(core.executeCalls).toBe(1);
  });

  it('checkpoints provider failure and never advances to readback or learning', async () => {
    const core = new FakeCoreGateway();
    core.providerFailure = true;
    let readbackCalls = 0;
    let learnCalls = 0;
    const adapters = baseAdapters({
      readback: async () => {
        readbackCalls += 1;
        return {
          providerBacked: true,
          output: { providerBacked: true },
          evidenceRefs: ['provider://ok'],
        };
      },
      learn: async () => {
        learnCalls += 1;
        return { output: {}, evidenceRefs: ['r31://unexpected'] };
      },
    });
    const { runner, store, now, started } = await startRunner({ core, adapters });
    await runSteps({ runner, store, now, count: 7 });
    const claim = await claimNext(store, 'provider-failure-worker', now());
    await expect(runner.handleClaim(claim, now())).rejects.toThrow('provider unavailable');

    const failed = await store.get(started.instance.workflowId);
    expect(failed?.instance.status).toBe('BLOCKED');
    expect(failed?.steps.find((step) => step.stepId === '08-schedule-or-publish')).toMatchObject({
      status: 'FAILED',
      errorCode: 'MARKETING_AUTOPILOT_SCHEDULE_OR_PUBLISH_FAILED',
    });
    expect(readbackCalls).toBe(0);
    expect(learnCalls).toBe(0);
  });

  it('halts a partial cycle at the exact checkpoint without unlocking downstream stages', async () => {
    const adapters = baseAdapters({
      diagnose: async () => ({
        partial: true,
        output: { partial: true },
        evidenceRefs: ['diagnose://partial'],
      }),
    });
    const { runner, store, now, started } = await startRunner({ adapters });
    await runSteps({ runner, store, now, count: 2 });
    const snapshot = await store.get(started.instance.workflowId);
    expect(snapshot?.instance.status).toBe('BLOCKED');
    expect(snapshot?.steps.find((step) => step.stepId === '02-diagnose')).toMatchObject({
      status: 'FAILED',
      errorCode: 'MARKETING_AUTOPILOT_PARTIAL_CYCLE',
    });
    expect(snapshot?.steps.find((step) => step.stepId === '03-decide-plan')?.status).toBe(
      'PENDING',
    );
  });

  it('rejects duplicate wakeup before executing a stage twice', async () => {
    let observeCalls = 0;
    const adapters = baseAdapters({
      observe: async () => {
        observeCalls += 1;
        return { output: {}, evidenceRefs: ['observe://once'] };
      },
    });
    const { runner, store, now } = await startRunner({ adapters });
    const claim = await claimNext(store, 'duplicate-worker', now());
    await runner.handleClaim(claim, now());
    await expect(runner.handleClaim(claim, now())).rejects.toThrow(
      'MARKETING_AUTOPILOT_STALE_OR_DUPLICATE_WAKEUP',
    );
    expect(observeCalls).toBe(1);
  });

  it('requires independent provider readback before measurement or R31 learning', async () => {
    let measureCalls = 0;
    let learnCalls = 0;
    const adapters = baseAdapters({
      readback: async () => ({
        providerBacked: false,
        output: { providerBacked: false },
        evidenceRefs: ['provider://readback/absent'],
      }),
      measure: async () => {
        measureCalls += 1;
        return {
          revenue: null,
          revenueProviderBacked: false,
          output: {},
          evidenceRefs: ['measurement://x'],
        };
      },
      learn: async () => {
        learnCalls += 1;
        return { output: {}, evidenceRefs: ['r31://x'] };
      },
    });
    const { runner, store, now, started } = await startRunner({ adapters });
    await runSteps({ runner, store, now, count: 8 });
    const readbackClaim = await claimNext(store, 'readback-worker', now());
    await runner.handleClaim(readbackClaim, now());

    const snapshot = await store.get(started.instance.workflowId);
    expect(snapshot?.instance.status).toBe('BLOCKED');
    expect(snapshot?.steps.find((step) => step.stepId === '09-readback')?.errorCode).toBe(
      'MARKETING_AUTOPILOT_PROVIDER_READBACK_REQUIRED',
    );
    expect(measureCalls).toBe(0);
    expect(learnCalls).toBe(0);
  });

  it('rejects non-provider-backed revenue before learning', async () => {
    let learnCalls = 0;
    const adapters = baseAdapters({
      measure: async () => ({
        revenue: 900,
        revenueProviderBacked: false,
        output: { revenue: 900 },
        evidenceRefs: ['measurement://unbacked-revenue'],
      }),
      learn: async () => {
        learnCalls += 1;
        return { output: {}, evidenceRefs: ['r31://unexpected'] };
      },
    });
    const { runner, store, now, started } = await startRunner({ adapters });
    await runSteps({ runner, store, now, count: 9 });
    const measureClaim = await claimNext(store, 'measure-worker', now());
    await runner.handleClaim(measureClaim, now());

    const snapshot = await store.get(started.instance.workflowId);
    expect(snapshot?.steps.find((step) => step.stepId === '10-measure')?.errorCode).toBe(
      'MARKETING_AUTOPILOT_REVENUE_NOT_PROVIDER_BACKED',
    );
    expect(learnCalls).toBe(0);
  });

  it('fails closed when the learning stage produces no evidence', async () => {
    const adapters = baseAdapters({
      learn: async () => ({
        actionRequested: false,
        output: { recommendation: 'x' },
        evidenceRefs: [],
      }),
    });
    const { runner, store, now, started } = await startRunner({ adapters });
    await runSteps({ runner, store, now, count: 10 });
    const learnClaim = await claimNext(store, 'learning-worker', now());
    await expect(runner.handleClaim(learnClaim, now())).rejects.toThrow(
      'MARKETING_AUTOPILOT_LEARN_EVIDENCE_REQUIRED',
    );

    const snapshot = await store.get(started.instance.workflowId);
    expect(snapshot?.instance.status).toBe('BLOCKED');
    expect(snapshot?.steps.find((step) => step.stepId === '11-learn')?.status).toBe('FAILED');
  });

  it('completes the full loop with evidence on every stage and Core as the only side-effect boundary', async () => {
    const { runner, store, core, now } = await startRunner({});
    const completed = await runSteps({ runner, store, now, count: 12 });
    expect(completed.instance.status).toBe('SUCCEEDED');
    expect(completed.steps).toHaveLength(12);
    expect(completed.steps.every((step) => step.status === 'SUCCEEDED')).toBe(true);
    expect(completed.steps.every((step) => step.evidence.length > 0)).toBe(true);
    expect(core.executeCalls).toBe(1);
    expect(
      completed.steps.find((step) => step.stepId === '12-next-recommendation')?.output,
    ).toEqual({
      recommendationId: 'rec-1',
    });
  });
});
