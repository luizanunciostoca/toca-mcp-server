import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createPostgresPool } from '../src/persistence/postgres.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const pool = createPostgresPool({ connectionString, ssl: process.env.DATABASE_SSL === 'true' });
try {
  await pool.query(
    `create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())`,
  );
  const files = (await readdir('migrations')).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    const exists = await pool.query('select 1 from schema_migrations where version = $1', [file]);
    if (exists.rowCount) continue;
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(await readFile(join('migrations', file), 'utf8'));
      await client.query('insert into schema_migrations(version) values ($1)', [file]);
      await client.query('commit');
      console.log(`Applied migration ${file}`);
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
