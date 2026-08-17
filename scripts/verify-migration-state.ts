import { readdir } from 'node:fs/promises';
import { createPostgresPool } from '../src/persistence/postgres.js';

const EXPECTED_POSTGRES_MAJOR = 18;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const expected = (await readdir('migrations')).filter((file) => file.endsWith('.sql')).sort();
const pool = createPostgresPool({
  connectionString,
  ssl: process.env.DATABASE_SSL === 'true',
});

try {
  const versionResult = await pool.query<{ server_version_num: string }>(
    "select current_setting('server_version_num') as server_version_num",
  );
  const serverVersionNum = Number.parseInt(versionResult.rows[0]?.server_version_num ?? '', 10);
  const serverMajor = Math.floor(serverVersionNum / 10_000);
  if (!Number.isInteger(serverVersionNum) || serverMajor !== EXPECTED_POSTGRES_MAJOR) {
    throw new Error(
      `POSTGRES_VERSION_MISMATCH expected_major=${EXPECTED_POSTGRES_MAJOR} actual_num=${String(
        versionResult.rows[0]?.server_version_num ?? 'unknown',
      )}`,
    );
  }
  console.log(`POSTGRES_VERSION_VERIFIED=${serverMajor}`);

  const result = await pool.query<{ version: string }>(
    'select version from schema_migrations order by version asc',
  );
  const actual = result.rows.map((row) => row.version);
  if (actual.length !== expected.length || actual.some((version, index) => version !== expected[index])) {
    throw new Error(
      `MIGRATION_STATE_DRIFT expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`,
    );
  }
  console.log(`MIGRATION_STATE_VERIFIED=${actual.length}`);
} finally {
  await pool.end();
}
