import type { Pool } from 'pg';

export const AG01_REQUIRED_TABLES = [
  'ag01_conversations',
  'ag01_message_records',
  'ag01_runtime_circuits',
] as const;

export async function assertAg01PersistenceReady(database: Pick<Pool, 'query'>): Promise<void> {
  const result = await database.query<{ table_name: string }>(
    `select table_name
       from information_schema.tables
      where table_schema = 'public'
        and table_name = any($1::text[])`,
    [[...AG01_REQUIRED_TABLES]],
  );

  const available = new Set(result.rows.map((row) => row.table_name));
  const missing = AG01_REQUIRED_TABLES.filter((table) => !available.has(table));
  if (missing.length > 0) {
    throw new Error(`AG01_PERSISTENCE_NOT_READY:${missing.join(',')}`);
  }
}
