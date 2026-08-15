import { describe, expect, it } from 'vitest';
import { InMemoryWorkflowStore } from '../src/workflow/in-memory-workflow-store.js';
import type { WorkflowBlueprint } from '../src/workflow/workflow-contracts.js';

const createIdFactory = () => {
  let value = 0;
  return () => `resume-generated-${++value}`;
};

const blueprint = (stepId: string): WorkflowBlueprint => ({
  workflowId: `workflow-${stepId}`,
  routeId: 'R20',
  definitionId: 'durable-wait-attempt-semantics',
  definitionVersion: '1.0.0',
  idempotencyKey: `idem-${stepId}`,
  correlationId: `corr-${stepId}`,
  tenantId: 'toca-do-morcego',
  workspaceId: 'toca-do-morcego',
  organizationId: 'toca-do-morcego',
  requesterPrincipalId: 'service:test-workflow',
  steps: [{ stepId, name: stepId, maxAttempts: 1 }],
});

describe('M-FOUND-06 durable wait attempt semantics', () => {
  it('resumes a human wait without consuming another attempt', async () => {
    const store = new InMemoryWorkflowStore({ createId: createIdFactory() });
    await store.create(blueprint('human'), '2026-08-14T20:00:00Z');

    const [firstClaim] = await store.claimReadySteps({
      workerId: 'worker-human-1',
      now: '2026-08-14T20:01:00Z',
      limit: 1,
    });
    expect((await store.get('workflow-human'))?.steps[0]?.attempts).toBe(1);

    await store.openHumanTask({
      taskId: 'human-task-1',
      workflowId: 'workflow-human',
      stepId: 'human',
      executionId: firstClaim!.executionId,
      requiredRole: 'APPROVER',
      evidence: ['test://human/open'],
      now: '2026-08-14T20:02:00Z',
    });
    await store.claimHumanTask({
      taskId: 'human-task-1',
      principalId: 'luiz',
      evidence: ['test://human/claim'],
      now: '2026-08-14T20:03:00Z',
    });
    await store.completeHumanTask({
      taskId: 'human-task-1',
      principalId: 'luiz',
      completion: { approved: true },
      evidence: ['test://human/complete'],
      now: '2026-08-14T20:04:00Z',
    });

    const [resumeClaim] = await store.claimReadySteps({
      workerId: 'worker-human-2',
      now: '2026-08-14T20:05:00Z',
      limit: 1,
    });
    const resumed = await store.get('workflow-human');
    expect(resumeClaim).toBeDefined();
    expect(resumed?.steps[0]).toMatchObject({
      status: 'RUNNING',
      attempts: 1,
    });

    const completed = await store.completeStep({
      workflowId: 'workflow-human',
      stepId: 'human',
      executionId: resumeClaim!.executionId,
      evidence: ['test://human/success'],
      now: '2026-08-14T20:06:00Z',
    });
    expect(completed.instance.status).toBe('SUCCEEDED');
    expect(completed.steps[0]?.attempts).toBe(1);
  });

  it('resumes a timer wait without consuming another attempt', async () => {
    const store = new InMemoryWorkflowStore({ createId: createIdFactory() });
    await store.create(blueprint('timer'), '2026-08-14T21:00:00Z');

    const [firstClaim] = await store.claimReadySteps({
      workerId: 'worker-timer-1',
      now: '2026-08-14T21:01:00Z',
      limit: 1,
    });
    await store.scheduleTimer({
      timerId: 'timer-wait-1',
      workflowId: 'workflow-timer',
      stepId: 'timer',
      executionId: firstClaim!.executionId,
      fireAt: '2026-08-14T21:10:00Z',
      evidence: ['test://timer/schedule'],
      now: '2026-08-14T21:02:00Z',
    });
    await store.fireDueTimers({ now: '2026-08-14T21:10:00Z', limit: 1 });

    const [resumeClaim] = await store.claimReadySteps({
      workerId: 'worker-timer-2',
      now: '2026-08-14T21:11:00Z',
      limit: 1,
    });
    const resumed = await store.get('workflow-timer');
    expect(resumeClaim).toBeDefined();
    expect(resumed?.steps[0]).toMatchObject({
      status: 'RUNNING',
      attempts: 1,
    });

    const completed = await store.completeStep({
      workflowId: 'workflow-timer',
      stepId: 'timer',
      executionId: resumeClaim!.executionId,
      evidence: ['test://timer/success'],
      now: '2026-08-14T21:12:00Z',
    });
    expect(completed.instance.status).toBe('SUCCEEDED');
    expect(completed.steps[0]?.attempts).toBe(1);
  });
});
