import { readdir } from 'node:fs/promises';
import { createPostgresPool } from '../src/persistence/postgres.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const expected = (await readdir('migrations')).filter((file) => file.endsWith('.sql')).sort();
const pool = createPostgresPool({
  connectionString,
  ssl: process.env.DATABASE_SSL === 'true',
});

try {
  const result = await pool.query<{ version: string }>(
    'select version from schema_migrations order by version asc',
  );
  const actual = result.rows.map((row) => row.version);

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `MIGRATION_STATE_DRIFT expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`,
    );
  }

  console.log(`MIGRATION_STATE_CURRENT=${expected.length}`);
} finally {
  await pool.end();
}
