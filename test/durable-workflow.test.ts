import { describe, expect, it } from 'vitest';
import { InMemoryWorkflowStore } from '../src/workflow/in-memory-workflow-store.js';
import {
  validateWorkflowBlueprint,
  type WorkflowBlueprint,
} from '../src/workflow/workflow-contracts.js';

const baseBlueprint = (overrides: Partial<WorkflowBlueprint> = {}): WorkflowBlueprint => ({
  workflowId: 'workflow-1',
  routeId: 'R20',
  definitionId: 'marketing-content-publication',
  definitionVersion: '1.0.0',
  idempotencyKey: 'idem-workflow-1',
  correlationId: 'corr-workflow-1',
  tenantId: 'toca-do-morcego',
  workspaceId: 'toca-do-morcego',
  organizationId: 'toca-do-morcego',
  requesterPrincipalId: 'service:test-workflow',
  input: { event: 'sunset' },
  steps: [
    { stepId: 'prepare', name: 'Prepare content', maxAttempts: 2 },
    { stepId: 'publish', name: 'Publish content', dependsOn: ['prepare'], maxAttempts: 2 },
  ],
  ...overrides,
});

const createIdFactory = () => {
  let value = 0;
  return () => `generated-${++value}`;
};

describe('M-FOUND-06 workflow blueprint validation', () => {
  it('rejects unknown dependencies and dependency cycles before persistence', () => {
    expect(() =>
      validateWorkflowBlueprint(
        baseBlueprint({
          steps: [{ stepId: 'a', name: 'A', dependsOn: ['missing'] }],
        }),
      ),
    ).toThrow('WORKFLOW_DEPENDENCY_UNKNOWN');

    expect(() =>
      validateWorkflowBlueprint(
        baseBlueprint({
          steps: [
            { stepId: 'a', name: 'A', dependsOn: ['b'] },
            { stepId: 'b', name: 'B', dependsOn: ['a'] },
          ],
        }),
      ),
    ).toThrow('WORKFLOW_DEPENDENCY_CYCLE');
  });
});

describe('M-FOUND-06 durable workflow lifecycle', () => {
  it('creates idempotently and unlocks DAG dependencies only after success', async () => {
    const store = new InMemoryWorkflowStore({ createId: createIdFactory() });
    const created = await store.create(baseBlueprint(), '2026-08-14T20:00:00Z');
    expect(created.instance).toMatchObject({ status: 'RUNNING', version: 1 });
    expect(created.steps.map((step) => [step.stepId, step.status])).toEqual([
      ['prepare', 'READY'],
      ['publish', 'PENDING'],
    ]);

    const duplicate = await store.create(baseBlueprint(), '2026-08-14T20:00:01Z');
    expect(duplicate.instance.workflowId).toBe('workflow-1');
    await expect(
      store.create(baseBlueprint({ workflowId: 'workflow-conflict' }), '2026-08-14T20:00:02Z'),
    ).rejects.toThrow('WORKFLOW_IDEMPOTENCY_CONFLICT');

    const firstClaim = await store.claimReadySteps({
      workerId: 'worker-a',
      now: '2026-08-14T20:01:00Z',
      limit: 10,
    });
    expect(firstClaim).toHaveLength(1);
    expect(firstClaim[0]?.stepId).toBe('prepare');

    const afterPrepare = await store.completeStep({
      workflowId: 'workflow-1',
      stepId: 'prepare',
      executionId: firstClaim[0]!.executionId,
      output: { assetId: 'asset-1' },
      evidence: ['workflow://prepare/success'],
      now: '2026-08-14T20:02:00Z',
    });
    expect(afterPrepare.steps.find((step) => step.stepId === 'publish')?.status).toBe('READY');

    const secondClaim = await store.claimReadySteps({
      workerId: 'worker-b',
      now: '2026-08-14T20:03:00Z',
      limit: 10,
    });
    expect(secondClaim.map((claim) => claim.stepId)).toEqual(['publish']);
    const completed = await store.completeStep({
      workflowId: 'workflow-1',
      stepId: 'publish',
      executionId: secondClaim[0]!.executionId,
      output: { providerId: 'media-1' },
      evidence: ['provider://instagram/media-1'],
      now: '2026-08-14T20:04:00Z',
    });
    expect(completed.instance).toMatchObject({
      status: 'SUCCEEDED',
      completedAt: '2026-08-14T20:04:00Z',
    });
    expect(completed.events.map((event) => event.eventType)).toContain('STEP_SUCCEEDED');
  });

  it('blocks stale claims and supports bounded explicit retry after failure', async () => {
    const store = new InMemoryWorkflowStore({ createId: createIdFactory() });
    await store.create(
      baseBlueprint({ steps: [{ stepId: 'execute', name: 'Execute', maxAttempts: 2 }] }),
      '2026-08-14T21:00:00Z',
    );
    const [claim] = await store.claimReadySteps({
      workerId: 'worker-a',
      now: '2026-08-14T21:01:00Z',
      limit: 1,
    });
    await expect(
      store.completeStep({
        workflowId: 'workflow-1',
        stepId: 'execute',
        executionId: 'stale-execution',
        evidence: ['test://stale'],
        now: '2026-08-14T21:01:30Z',
      }),
    ).rejects.toThrow('WORKFLOW_STEP_CLAIM_MISMATCH');

    const failed = await store.failStep({
      workflowId: 'workflow-1',
      stepId: 'execute',
      executionId: claim!.executionId,
      errorCode: 'PROVIDER_UNAVAILABLE',
      evidence: ['provider://failure'],
      now: '2026-08-14T21:02:00Z',
    });
    expect(failed.instance.status).toBe('BLOCKED');

    const retried = await store.retryStep({
      workflowId: 'workflow-1',
      stepId: 'execute',
      evidence: ['operator://retry-approved'],
      now: '2026-08-14T21:03:00Z',
    });
    expect(retried.instance.status).toBe('RUNNING');
    expect(retried.steps[0]?.status).toBe('READY');

    const [retryClaim] = await store.claimReadySteps({
      workerId: 'worker-b',
      now: '2026-08-14T21:04:00Z',
      limit: 1,
    });
    expect(retryClaim?.executionId).not.toBe(claim?.executionId);
    const success = await store.completeStep({
      workflowId: 'workflow-1',
      stepId: 'execute',
      executionId: retryClaim!.executionId,
      evidence: ['provider://success'],
      now: '2026-08-14T21:05:00Z',
    });
    expect(success.instance.status).toBe('SUCCEEDED');
    expect(success.steps[0]?.attempts).toBe(2);
    await expect(
      store.retryStep({
        workflowId: 'workflow-1',
        stepId: 'execute',
        evidence: ['operator://invalid-retry'],
        now: '2026-08-14T21:06:00Z',
      }),
    ).rejects.toThrow('WORKFLOW_STEP_NOT_FAILED');
  });

  it('persists human waits and resumes only after the assigned principal completes the task', async () => {
    const store = new InMemoryWorkflowStore({ createId: createIdFactory() });
    await store.create(
      baseBlueprint({ steps: [{ stepId: 'review', name: 'Human review', maxAttempts: 2 }] }),
      '2026-08-14T22:00:00Z',
    );
    const [claim] = await store.claimReadySteps({
      workerId: 'worker-review',
      now: '2026-08-14T22:01:00Z',
      limit: 1,
    });
    const waiting = await store.openHumanTask({
      taskId: 'task-1',
      workflowId: 'workflow-1',
      stepId: 'review',
      executionId: claim!.executionId,
      requiredRole: 'APPROVER',
      payload: { question: 'Approve content?' },
      evidence: ['workflow://human-task/opened'],
      now: '2026-08-14T22:02:00Z',
    });
    expect(waiting.instance.status).toBe('WAITING');
    expect(waiting.steps[0]?.status).toBe('WAITING_HUMAN');

    await expect(
      store.claimHumanTask({
        taskId: 'task-1',
        principalId: 'luiz',
        evidence: ['identity://luiz/no-role'],
        now: '2026-08-14T22:02:30Z',
      }),
    ).rejects.toThrow('WORKFLOW_HUMAN_TASK_ROLE_REQUIRED');

    await store.claimHumanTask({
      taskId: 'task-1',
      principalId: 'luiz',
      principalRoles: ['APPROVER'],
      evidence: ['identity://luiz'],
      now: '2026-08-14T22:03:00Z',
    });
    await expect(
      store.completeHumanTask({
        taskId: 'task-1',
        principalId: 'other-principal',
        evidence: ['test://wrong-principal'],
        now: '2026-08-14T22:04:00Z',
      }),
    ).rejects.toThrow('WORKFLOW_HUMAN_TASK_PRINCIPAL_MISMATCH');

    const resumed = await store.completeHumanTask({
      taskId: 'task-1',
      principalId: 'luiz',
      completion: { approved: true },
      evidence: ['chatgpt://approval/human-task-1'],
      now: '2026-08-14T22:05:00Z',
    });
    expect(resumed.instance.status).toBe('RUNNING');
    expect(resumed.steps[0]?.status).toBe('READY');
    expect(resumed.humanTasks[0]).toMatchObject({
      status: 'COMPLETED',
      assignedPrincipalId: 'luiz',
    });
  });

  it('persists timers and wakes the exact waiting step when due', async () => {
    const store = new InMemoryWorkflowStore({ createId: createIdFactory() });
    await store.create(
      baseBlueprint({ steps: [{ stepId: 'delay', name: 'Delay', maxAttempts: 2 }] }),
      '2026-08-14T23:00:00Z',
    );
    const [claim] = await store.claimReadySteps({
      workerId: 'worker-timer',
      now: '2026-08-14T23:01:00Z',
      limit: 1,
    });
    const waiting = await store.scheduleTimer({
      timerId: 'timer-1',
      workflowId: 'workflow-1',
      stepId: 'delay',
      executionId: claim!.executionId,
      fireAt: '2026-08-14T23:10:00Z',
      evidence: ['workflow://timer/scheduled'],
      now: '2026-08-14T23:02:00Z',
    });
    expect(waiting.instance.status).toBe('WAITING');
    expect(await store.fireDueTimers({ now: '2026-08-14T23:09:59Z', limit: 10 })).toEqual([]);
    expect(await store.fireDueTimers({ now: '2026-08-14T23:10:00Z', limit: 10 })).toEqual([
      'timer-1',
    ]);
    const resumed = await store.get('workflow-1');
    expect(resumed?.instance.status).toBe('RUNNING');
    expect(resumed?.steps[0]?.status).toBe('READY');
    expect(resumed?.timers[0]?.status).toBe('FIRED');
  });

  it('registers compensations for succeeded work and activates them after downstream failure', async () => {
    const store = new InMemoryWorkflowStore({ createId: createIdFactory() });
    await store.create(baseBlueprint(), '2026-08-15T00:00:00Z');
    const [prepareClaim] = await store.claimReadySteps({
      workerId: 'worker-a',
      now: '2026-08-15T00:01:00Z',
      limit: 1,
    });
    await store.completeStep({
      workflowId: 'workflow-1',
      stepId: 'prepare',
      executionId: prepareClaim!.executionId,
      evidence: ['workflow://prepare/succeeded'],
      now: '2026-08-15T00:02:00Z',
    });
    const withCompensation = await store.registerCompensation({
      compensationId: 'comp-1',
      workflowId: 'workflow-1',
      stepId: 'prepare',
      orderIndex: 10,
      capabilityId: 'state.transition',
      payload: { target: 'previous-state' },
      evidence: ['workflow://compensation/registered'],
      now: '2026-08-15T00:03:00Z',
    });
    expect(withCompensation.compensations[0]?.status).toBe('PENDING');

    const [publishClaim] = await store.claimReadySteps({
      workerId: 'worker-b',
      now: '2026-08-15T00:04:00Z',
      limit: 1,
    });
    await store.failStep({
      workflowId: 'workflow-1',
      stepId: 'publish',
      executionId: publishClaim!.executionId,
      errorCode: 'QUALITY_GATE_FAILED',
      evidence: ['workflow://publish/failed'],
      now: '2026-08-15T00:05:00Z',
    });
    const activated = await store.activateCompensations({
      workflowId: 'workflow-1',
      evidence: ['workflow://compensation/activated'],
      now: '2026-08-15T00:06:00Z',
    });
    expect(activated.instance.status).toBe('BLOCKED');
    expect(activated.compensations[0]?.status).toBe('READY');
  });
});
