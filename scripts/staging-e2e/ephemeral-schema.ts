import assert from 'node:assert/strict';
import { appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createPostgresPool } from '../../src/persistence/postgres.js';

const mode = process.argv[2];
const baseDatabaseUrl = process.env.BASE_DATABASE_URL ?? process.env.DATABASE_URL;
const evidenceDir = process.env.EVIDENCE_DIR;
const githubEnv = process.env.GITHUB_ENV;
const githubOutput = process.env.GITHUB_OUTPUT;
const runId = process.env.GITHUB_RUN_ID;
if (!baseDatabaseUrl) throw new Error('STAGING_E2E_BASE_DATABASE_URL_REQUIRED');
if (!evidenceDir) throw new Error('STAGING_E2E_EVIDENCE_DIR_REQUIRED');
if (!runId) throw new Error('STAGING_E2E_RUN_ID_REQUIRED');

const schemaName = `toca_e2e_${runId}`;
assert(/^toca_e2e_[0-9]+$/.test(schemaName), 'STAGING_E2E_SCHEMA_NAME_INVALID');

const pool = createPostgresPool({ connectionString: baseDatabaseUrl, max: 2 });
try {
  if (mode === 'create') {
    if (!githubEnv) throw new Error('STAGING_E2E_GITHUB_ENV_REQUIRED');
    if (!githubOutput) throw new Error('STAGING_E2E_GITHUB_OUTPUT_REQUIRED');
    await pool.query(`create schema "${schemaName}"`);
    const scoped = new URL(baseDatabaseUrl);
    scoped.searchParams.set('options', `-c search_path=${schemaName}`);
    const scopedDatabaseUrl = scoped.toString();
    console.log(`::add-mask::${scopedDatabaseUrl}`);
    await appendFile(githubEnv, `DATABASE_URL=${scopedDatabaseUrl}\n`);
    await appendFile(githubEnv, `ACCEPTANCE_SCHEMA=${schemaName}\n`);
    await appendFile(githubOutput, `created=yes\nschema=${schemaName}\n`);
    const summary = {
      schemaVersion: 'toca.staging.e2e.ephemeral-schema.v1',
      schemaName,
      isolatedFromRuntimeSchema: true,
      result: 'CREATED',
    };
    await writeFile(
      join(evidenceDir, 'ephemeral-schema-create.json'),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
    console.log(JSON.stringify(summary));
  } else if (mode === 'drop') {
    assert.equal(
      process.env.ACCEPTANCE_SCHEMA,
      schemaName,
      'STAGING_E2E_SCHEMA_DROP_TARGET_MISMATCH',
    );
    await pool.query(`drop schema if exists "${schemaName}" cascade`);
    const summary = {
      schemaVersion: 'toca.staging.e2e.ephemeral-schema.v1',
      schemaName,
      exactSyntheticTarget: true,
      result: 'DROPPED',
    };
    await writeFile(
      join(evidenceDir, 'ephemeral-schema-drop.json'),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
    console.log(JSON.stringify(summary));
  } else {
    throw new Error('STAGING_E2E_SCHEMA_MODE_INVALID');
  }
} finally {
  await pool.end();
}
