import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL_REQUIRED');

const client = new Client({ connectionString });
await client.connect();
try {
  await client.query('BEGIN READ ONLY');
  const tables = await client.query(`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_type = 'BASE TABLE'
      AND table_schema NOT IN ('pg_catalog', 'information_schema')
      AND (
        table_name ILIKE '%instagram%' OR
        table_name ILIKE '%webhook%' OR
        table_name ILIKE '%message%' OR
        table_name ILIKE '%conversation%' OR
        table_name ILIKE '%engagement%'
      )
    ORDER BY table_schema, table_name
  `);

  const columns = await client.query(`
    SELECT table_schema, table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      AND (
        column_name ILIKE '%sender%' OR
        column_name ILIKE '%user_id%' OR
        column_name ILIKE '%conversation%' OR
        column_name ILIKE '%message%' OR
        column_name ILIKE '%instagram%' OR
        column_name ILIKE '%webhook%'
      )
    ORDER BY table_schema, table_name, ordinal_position
  `);

  const counts: Array<{ tableSchema: string; tableName: string; rowCount: string }> = [];
  for (const row of tables.rows as Array<{ table_schema: string; table_name: string }>) {
    const schema = row.table_schema.replaceAll('"', '""');
    const table = row.table_name.replaceAll('"', '""');
    const result = await client.query(`SELECT COUNT(*)::bigint AS count FROM "${schema}"."${table}"`);
    counts.push({ tableSchema: row.table_schema, tableName: row.table_name, rowCount: String(result.rows[0]?.count ?? '0') });
  }

  console.log(JSON.stringify({
    validation: 'instagram-history-store-inventory',
    candidateTables: tables.rows.map((row: { table_schema: string; table_name: string }) => ({ tableSchema: row.table_schema, tableName: row.table_name })),
    matchingColumns: columns.rows.map((row: { table_schema: string; table_name: string; column_name: string; data_type: string }) => ({
      tableSchema: row.table_schema,
      tableName: row.table_name,
      columnName: row.column_name,
      dataType: row.data_type,
    })),
    rowCounts: counts,
    contentRead: false,
    piiPrinted: false,
  }));
  await client.query('ROLLBACK');
} finally {
  await client.end();
}
