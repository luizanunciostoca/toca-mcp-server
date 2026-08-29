import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('DATABASE_URL_REQUIRED');

interface ColumnRow {
  column_name: string;
  data_type: string;
}

interface YearCountRow {
  year: string | null;
  count: string;
  sender_rows: string;
  message_ref_rows: string;
}

function qi(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

async function main(): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const columns = await client.query<ColumnRow>(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'meta_webhook_events'
      ORDER BY ordinal_position
    `);

    const columnNames = new Set(columns.rows.map((row) => row.column_name));
    const timestampColumns = columns.rows
      .filter((row) => ['timestamp with time zone', 'timestamp without time zone', 'date'].includes(row.data_type))
      .map((row) => row.column_name);

    const total = await client.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM public.meta_webhook_events');
    const distinctSenders = columnNames.has('sender_scoped_id')
      ? await client.query<{ count: string }>(
          `SELECT COUNT(DISTINCT NULLIF(BTRIM(sender_scoped_id), ''))::text AS count FROM public.meta_webhook_events`,
        )
      : { rows: [{ count: '0' }] };
    const distinctMessages = columnNames.has('provider_message_id')
      ? await client.query<{ count: string }>(
          `SELECT COUNT(DISTINCT NULLIF(BTRIM(provider_message_id), ''))::text AS count FROM public.meta_webhook_events`,
        )
      : { rows: [{ count: '0' }] };

    const temporalCoverage: Array<{ column: string; years: YearCountRow[] }> = [];
    for (const column of timestampColumns) {
      const senderExpr = columnNames.has('sender_scoped_id')
        ? `COUNT(*) FILTER (WHERE NULLIF(BTRIM(sender_scoped_id), '') IS NOT NULL)::text`
        : `'0'::text`;
      const messageExpr = columnNames.has('provider_message_id')
        ? `COUNT(*) FILTER (WHERE NULLIF(BTRIM(provider_message_id), '') IS NOT NULL)::text`
        : `'0'::text`;
      const result = await client.query<YearCountRow>(`
        SELECT
          CASE WHEN ${qi(column)} IS NULL THEN NULL ELSE EXTRACT(YEAR FROM ${qi(column)})::int::text END AS year,
          COUNT(*)::text AS count,
          ${senderExpr} AS sender_rows,
          ${messageExpr} AS message_ref_rows
        FROM public.meta_webhook_events
        GROUP BY 1
        ORDER BY 1 NULLS LAST
      `);
      temporalCoverage.push({ column, years: result.rows });
    }

    await client.query('ROLLBACK');
    console.log(
      JSON.stringify({
        validation: 'meta-webhook-history-profile',
        rowCount: Number(total.rows[0]?.count ?? 0),
        distinctSenderScopedIds: Number(distinctSenders.rows[0]?.count ?? 0),
        distinctProviderMessageIds: Number(distinctMessages.rows[0]?.count ?? 0),
        columns: columns.rows,
        temporalCoverage,
        payloadRead: false,
        identitiesPrinted: false,
        messageTextPrinted: false,
        writesEnabled: false,
      }),
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  const text = error instanceof Error ? error.message : String(error);
  const code = text.match(/[A-Z][A-Z0-9_]{3,}/)?.[0] ?? 'UNKNOWN';
  console.log(
    JSON.stringify({
      validation: 'meta-webhook-history-profile',
      status: 'FAILED',
      errorCode: code,
      payloadRead: false,
      identitiesPrinted: false,
      messageTextPrinted: false,
      writesEnabled: false,
    }),
  );
  process.exitCode = 1;
});
