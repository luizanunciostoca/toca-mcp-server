import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('DATABASE_URL_REQUIRED');

const tables = ['ag01_conversations', 'ag01_message_records'] as const;

type ColumnRow = { column_name: string; data_type: string };
type CountRow = { count: string };
type YearRow = { year: string | null; count: string };

function qi(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

async function main(): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const profiles: unknown[] = [];
    for (const table of tables) {
      const columnsResult = await client.query<ColumnRow>(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema='public' AND table_name=$1
        ORDER BY ordinal_position
      `, [table]);
      const columns = columnsResult.rows;
      const total = await client.query<CountRow>(`SELECT COUNT(*)::text AS count FROM public.${qi(table)}`);
      const timestampColumns = columns.filter((row) =>
        ['timestamp with time zone', 'timestamp without time zone', 'date'].includes(row.data_type),
      );
      const temporalCoverage: Array<{ column: string; years: YearRow[] }> = [];
      for (const column of timestampColumns) {
        const result = await client.query<YearRow>(`
          SELECT CASE WHEN ${qi(column.column_name)} IS NULL THEN NULL
                 ELSE EXTRACT(YEAR FROM ${qi(column.column_name)})::int::text END AS year,
                 COUNT(*)::text AS count
          FROM public.${qi(table)}
          GROUP BY 1 ORDER BY 1 NULLS LAST
        `);
        temporalCoverage.push({ column: column.column_name, years: result.rows });
      }
      const potentiallyContentBearingColumns = columns
        .filter((row) => /(text|content|body|message|prompt|response|summary|payload)/i.test(row.column_name))
        .map((row) => ({ columnName: row.column_name, dataType: row.data_type }));
      profiles.push({
        table,
        rowCount: Number(total.rows[0]?.count ?? 0),
        columns,
        temporalCoverage,
        potentiallyContentBearingColumns,
      });
    }
    await client.query('ROLLBACK');
    console.log(JSON.stringify({
      validation: 'ag01-history-profile',
      profiles,
      contentRead: false,
      identitiesPrinted: false,
      messageTextPrinted: false,
      writesEnabled: false,
    }));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  const text = error instanceof Error ? error.message : String(error);
  const code = text.match(/[A-Z][A-Z0-9_]{3,}/)?.[0] ?? 'UNKNOWN';
  console.log(JSON.stringify({
    validation: 'ag01-history-profile',
    status: 'FAILED',
    errorCode: code,
    contentRead: false,
    identitiesPrinted: false,
    messageTextPrinted: false,
    writesEnabled: false,
  }));
  process.exitCode = 1;
});
