import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createPostgresPool } from '../../src/persistence/postgres.js';
import { PostgresWorkflowStore } from '../../src/persistence/postgres-workflow-store.js';

const databaseUrl = process.env.DATABASE_URL;
const evidenceDir = process.env.EVIDENCE_DIR;
const runId = process.env.GITHUB_RUN_ID;
if (!databaseUrl) throw new Error('STAGING_E2E_DATABASE_URL_REQUIRED');
if (!evidenceDir) throw new Error('STAGING_E2E_EVIDENCE_DIR_REQUIRED');
if (!runId) throw new Error('STAGING_E2E_RUN_ID_REQUIRED');

const suffix = `${runId}-${Date.now()}`;
const tenantId = `staging-e2e-workflow-${suffix}`;
const workspaceId = `staging-e2e-workspace-${suffix}`;
const organizationId = `staging-e2e-organization-${suffix}`;
const baseMs = Date.now();
const at = (offsetMs: number) => new Date(baseMs + offsetMs).toISOString();
const evidence = ['staging:e2e:durable-workflow'];

function blueprint(workflowId: string, kind: 'human' | 'timer') {
  return {
    workflowId,
    routeId: 'R01' as const,
    definitionId: `staging-e2e-${kind}`,
    definitionVersion: '1.0.0',
    idempotencyKey: `staging-e2e-${kind}-idempotency-${suffix}`,
    correlationId: `staging-e2e-${kind}-correlation-${suffix}`,
    tenantId,
    workspaceId,
    organizationId,
    requesterPrincipalId: 'staging:e2e:operator',
    input: { acceptance: true, kind },
    steps: [
      {
        stepId: kind,
        name: `Staging E2E ${kind}`,
        capabilityId: 'system.health',
        input: { acceptance: true },
        maxAttempts: 2,
      },
    ],
  };
}

const humanWorkflowId = `staging-e2e-human-${suffix}`;
const humanTaskId = `staging-e2e-human-task-${suffix}`;
const timerWorkflowId = `staging-e2e-timer-${suffix}`;
const timerId = `staging-e2e-timer-wait-${suffix}`;

let pool = createPostgresPool({ connectionString: databaseUrl, max: 3 });
try {
  let store = new PostgresWorkflowStore(pool);
  const humanBlueprint = blueprint(humanWorkflowId, 'human');
  const created = await store.create(humanBlueprint, at(0));
  const replay = await store.create(humanBlueprint, at(1));
  assert.equal(created.instance.workflowId, humanWorkflowId);
  assert.equal(replay.instance.workflowId, humanWorkflowId);

  const humanClaims = await store.claimReadySteps({
    workerId: 'staging-e2e-human-worker-a',
    workflowId: humanWorkflowId,
    now: at(100),
    limit: 1,
  });
  assert.equal(humanClaims.length, 1);
  await store.openHumanTask({
    taskId: humanTaskId,
    workflowId: humanWorkflowId,
    stepId: 'human',
    executionId: humanClaims[0]!.executionId,
    requiredRole: 'APPROVER',
    payload: { approval: 'synthetic-staging-acceptance' },
    evidence,
    now: at(200),
  });

  await pool.end();
  pool = createPostgresPool({ connectionString: databaseUrl, max: 3 });
  store = new PostgresWorkflowStore(pool);

  await assert.rejects(
    store.claimHumanTask({
      taskId: humanTaskId,
      principalId: 'staging:e2e:operator',
      principalRoles: ['OPERATOR'],
      evidence: ['staging:e2e:wrong-role-rejected'],
      now: at(300),
    }),
    /WORKFLOW_HUMAN_TASK_ROLE_REQUIRED/,
  );
  await store.claimHumanTask({
    taskId: humanTaskId,
    principalId: 'staging:e2e:approver',
    principalRoles: ['APPROVER'],
    evidence: ['staging:e2e:human-claimed'],
    now: at(400),
  });
  await store.completeHumanTask({
    taskId: humanTaskId,
    principalId: 'staging:e2e:approver',
    completion: { approved: true },
    evidence: ['staging:e2e:human-completed'],
    now: at(500),
  });
  const resumedHumanClaims = await store.claimReadySteps({
    workerId: 'staging-e2e-human-worker-b',
    workflowId: humanWorkflowId,
    now: at(600),
    limit: 1,
  });
  assert.equal(resumedHumanClaims.length, 1);
  const humanDone = await store.completeStep({
    workflowId: humanWorkflowId,
    stepId: 'human',
    executionId: resumedHumanClaims[0]!.executionId,
    output: { resumedAfterApproval: true },
    evidence: ['staging:e2e:human-workflow-succeeded'],
    now: at(700),
  });
  assert.equal(humanDone.instance.status, 'SUCCEEDED');
  assert.equal(humanDone.steps[0]?.attempts, 1);

  const timerBlueprint = blueprint(timerWorkflowId, 'timer');
  await store.create(timerBlueprint, at(800));
  const timerClaims = await store.claimReadySteps({
    workerId: 'staging-e2e-timer-worker-a',
    workflowId: timerWorkflowId,
    now: at(900),
    limit: 1,
  });
  assert.equal(timerClaims.length, 1);
  await store.scheduleTimer({
    timerId,
    workflowId: timerWorkflowId,
    stepId: 'timer',
    executionId: timerClaims[0]!.executionId,
    fireAt: at(1_100),
    payload: { synthetic: true },
    evidence: ['staging:e2e:timer-scheduled'],
    now: at(1_000),
  });

  await pool.end();
  pool = createPostgresPool({ connectionString: databaseUrl, max: 3 });
  store = new PostgresWorkflowStore(pool);

  const fired = await store.fireDueTimers({ now: at(1_200), limit: 1 });
  assert.deepEqual(fired, [timerId]);
  const resumedTimerClaims = await store.claimReadySteps({
    workerId: 'staging-e2e-timer-worker-b',
    workflowId: timerWorkflowId,
    now: at(1_300),
    limit: 1,
  });
  assert.equal(resumedTimerClaims.length, 1);
  const timerDone = await store.completeStep({
    workflowId: timerWorkflowId,
    stepId: 'timer',
    executionId: resumedTimerClaims[0]!.executionId,
    output: { resumedAfterTimer: true },
    evidence: ['staging:e2e:timer-workflow-succeeded'],
    now: at(1_400),
  });
  assert.equal(timerDone.instance.status, 'SUCCEEDED');
  assert.equal(timerDone.steps[0]?.attempts, 1);

  const summary = {
    schemaVersion: 'toca.staging.e2e.durable-workflow.v1',
    tenantId,
    human: {
      workflowId: humanWorkflowId,
      taskId: humanTaskId,
      wrongRoleRejected: true,
      resumedAfterRestart: true,
      attempts: humanDone.steps[0]?.attempts,
      status: humanDone.instance.status,
    },
    timer: {
      workflowId: timerWorkflowId,
      timerId,
      resumedAfterRestart: true,
      attempts: timerDone.steps[0]?.attempts,
      status: timerDone.instance.status,
    },
    idempotencyReplay: true,
    providerMutation: 'NO',
    result: 'PASS',
  };
  await writeFile(
    join(evidenceDir, 'durable-workflow.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  console.log(JSON.stringify(summary));
} finally {
  await pool.end().catch(() => undefined);
}
