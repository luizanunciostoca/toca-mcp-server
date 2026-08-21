import assert from 'node:assert/strict';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createPostgresPool } from './src/persistence/postgres.js';

const databaseUrl = process.env.DATABASE_URL;
const evidenceDir = process.env.EVIDENCE_DIR;
if (!databaseUrl) throw new Error('STAGING_E2E_DATABASE_URL_REQUIRED');
if (!evidenceDir) throw new Error('STAGING_E2E_EVIDENCE_DIR_REQUIRED');

const pool = createPostgresPool({ connectionString: databaseUrl, max: 2 });
try {
  const candidateMigrations = (await readdir('migrations'))
    .filter((file) => file.endsWith('.sql'))
    .sort();
  assert(candidateMigrations.length > 0, 'STAGING_E2E_MIGRATIONS_EMPTY');
  assert.equal(
    candidateMigrations.at(-1),
    '033_omnichannel_prepared_content.sql',
    'STAGING_E2E_MIGRATION_HEAD_MISMATCH',
  );
  assert(
    !candidateMigrations.some((file) => file.startsWith('027_')),
    'STAGING_E2E_RETIRED_MIGRATION_027_PRESENT',
  );

  const migrationRows = await pool.query<{ version: string }>(
    'select version from schema_migrations order by version asc',
  );
  const databaseMigrations = migrationRows.rows.map((row) => row.version);
  assert.deepEqual(databaseMigrations, candidateMigrations, 'STAGING_E2E_DATABASE_MIGRATION_DRIFT');

  const outboxRows = await pool.query<{ status: string; count: string }>(
    `select status, count(*)::text as count
       from event_outbox
      where status <> 'DELIVERED'
      group by status
      order by status`,
  );
  const nonterminalOutboxCount = outboxRows.rows.reduce(
    (total, row) => total + Number(row.count),
    0,
  );
  assert.equal(nonterminalOutboxCount, 0, 'STAGING_E2E_OUTBOX_NOT_QUIESCENT');

  const timerRows = await pool.query<{ count: string }>(
    `select count(*)::text as count
       from workflow_timers
      where status = 'SCHEDULED'`,
  );
  const scheduledTimerCount = Number(timerRows.rows[0]?.count ?? '0');
  assert.equal(scheduledTimerCount, 0, 'STAGING_E2E_TIMER_QUEUE_NOT_QUIESCENT');

  const claimableWorkflowRows = await pool.query<{ count: string }>(
    `select count(*)::text as count
       from workflow_steps s
       join workflow_instances w on w.workflow_id = s.workflow_id
      where s.status = 'READY'
        and (s.started_at is not null or s.attempts < s.max_attempts)
        and w.status in ('RUNNING', 'WAITING')`,
  );
  const claimableWorkflowStepCount = Number(claimableWorkflowRows.rows[0]?.count ?? '0');
  assert.equal(claimableWorkflowStepCount, 0, 'STAGING_E2E_WORKFLOW_QUEUE_NOT_QUIESCENT');

  const summary = {
    schemaVersion: 'toca.staging.e2e.database-preflight.v1',
    migrationCount: candidateMigrations.length,
    migrationHead: candidateMigrations.at(-1),
    migration027Present: false,
    migrationDrift: false,
    nonterminalOutboxCount,
    scheduledTimerCount,
    claimableWorkflowStepCount,
    result: 'PASS',
  };
  await writeFile(
    join(evidenceDir, 'database-preflight.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  console.log(JSON.stringify(summary));
} finally {
  await pool.end();
}
