import { readdir } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import './migrate.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL_REQUIRED');

const migrationsDir = path.resolve(
  process.cwd(),
  process.env.MIGRATIONS_DIR ?? 'migrations',
);
const expected = (await readdir(migrationsDir))
  .filter((fileName) => fileName.endsWith('.sql'))
  .sort();

const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  const result = await pool.query<{ version: string }>(
    'select version from schema_migrations order by version',
  );
  const applied = result.rows.map((row) => row.version);
  if (JSON.stringify(applied) !== JSON.stringify(expected)) {
    throw new Error(
      `PRODUCTION_SCHEMA_MIGRATION_DRIFT:${JSON.stringify({ expected, applied })}`,
    );
  }
  console.log(`PRODUCTION_SCHEMA_MIGRATIONS_CURRENT=${expected.length}`);
} finally {
  await pool.end();
}
