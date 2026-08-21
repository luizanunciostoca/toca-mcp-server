import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createPostgresPool } from './src/persistence/postgres.js';
import { PostgresWorkflowStore } from './src/persistence/postgres-workflow-store.js';

const databaseUrl = process.env.DATABASE_URL;
const evidenceDir = process.env.EVIDENCE_DIR;
if (!databaseUrl) throw new Error('STAGING_E2E_DATABASE_URL_REQUIRED');
if (!evidenceDir) throw new Error('STAGING_E2E_EVIDENCE_DIR_REQUIRED');

interface ClaimableRow {
  workflow_id: string;
  tenant_id: string;
  definition_id: string;
  step_id: string;
  step_status: 'READY' | 'RUNNING';
  claim_execution_id: string | null;
}

function recoverableSynthetic(row: ClaimableRow): boolean {
  return row.tenant_id === 'm12-tenant' && row.definition_id === 'm-found-12-postgres-restart';
}

const pool = createPostgresPool({ connectionString: databaseUrl, max: 3 });
const store = new PostgresWorkflowStore(pool);
try {
  const result = await pool.query<ClaimableRow>(
    `select w.workflow_id, w.tenant_id, w.definition_id,
            s.step_id, s.status as step_status, s.claim_execution_id
       from workflow_steps s
       join workflow_instances w on w.workflow_id = s.workflow_id
      where s.status in ('READY', 'RUNNING')
        and (s.status <> 'READY' or s.started_at is not null or s.attempts < s.max_attempts)
        and w.status in ('RUNNING', 'WAITING')
      order by w.workflow_id, s.step_id`,
  );
  const unexpected = result.rows.filter((row) => !recoverableSynthetic(row));
  assert.deepEqual(unexpected, [], 'STAGING_E2E_UNEXPECTED_CLAIMABLE_WORKFLOW_FAIL_CLOSED');

  const recovered: Array<{
    workflowId: string;
    stepId: string;
    priorStatus: string;
  }> = [];
  for (const row of result.rows.filter((entry) => entry.step_status === 'RUNNING')) {
    assert(row.claim_execution_id, 'STAGING_E2E_RUNNING_STEP_WITHOUT_EXECUTION_ID');
    await store.failStep({
      workflowId: row.workflow_id,
      stepId: row.step_id,
      executionId: row.claim_execution_id,
      errorCode: 'STAGING_E2E_INTERRUPTED_TEST_RECOVERED',
      evidence: ['staging:e2e:prior-synthetic-workflow-recovered'],
      now: new Date().toISOString(),
    });
    recovered.push({
      workflowId: row.workflow_id,
      stepId: row.step_id,
      priorStatus: row.step_status,
    });
  }

  const readyWorkflowIds = [
    ...new Set(
      result.rows
        .filter((entry) => entry.step_status === 'READY')
        .map((entry) => entry.workflow_id),
    ),
  ];
  for (const workflowId of readyWorkflowIds) {
    const expected = result.rows.filter(
      (entry) => entry.workflow_id === workflowId && entry.step_status === 'READY',
    );
    const claims = await store.claimReadySteps({
      workflowId,
      workerId: 'staging-e2e-prior-synthetic-recovery',
      now: new Date().toISOString(),
      limit: 100,
    });
    assert.equal(claims.length, expected.length, 'STAGING_E2E_SYNTHETIC_RECOVERY_CLAIM_MISMATCH');
    for (const claim of claims) {
      await store.failStep({
        workflowId: claim.workflowId,
        stepId: claim.stepId,
        executionId: claim.executionId,
        errorCode: 'STAGING_E2E_INTERRUPTED_TEST_RECOVERED',
        evidence: ['staging:e2e:prior-synthetic-workflow-recovered'],
        now: new Date().toISOString(),
      });
      recovered.push({
        workflowId: claim.workflowId,
        stepId: claim.stepId,
        priorStatus: 'READY',
      });
    }
  }

  const remaining = await pool.query<{ count: string }>(
    `select count(*)::text as count
       from workflow_steps s
       join workflow_instances w on w.workflow_id = s.workflow_id
      where s.status = 'READY'
        and (s.started_at is not null or s.attempts < s.max_attempts)
        and w.status in ('RUNNING', 'WAITING')`,
  );
  const remainingClaimable = Number(remaining.rows[0]?.count ?? '0');
  assert.equal(remainingClaimable, 0, 'STAGING_E2E_SYNTHETIC_WORKFLOW_RECOVERY_INCOMPLETE');

  const summary = {
    schemaVersion: 'toca.staging.e2e.synthetic-workflow-recovery.v1',
    recovered,
    recoveredCount: recovered.length,
    remainingClaimable,
    providerMutation: 'NO',
    result: 'PASS',
  };
  await writeFile(
    join(evidenceDir, 'synthetic-workflow-recovery.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  console.log(JSON.stringify(summary));
} finally {
  await pool.end();
}
