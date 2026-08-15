import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL_REQUIRED');

const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  const migrationRegistry = await pool.query<{ registry: string | null }>(
    `select to_regclass('public.schema_migrations')::text as registry`,
  );
  const registryExists = Boolean(migrationRegistry.rows[0]?.registry);
  const migrations = registryExists
    ? (
        await pool.query<{ version: string; applied_at: Date | string }>(
          `select version, applied_at from schema_migrations order by version`,
        )
      ).rows.map((row) => ({
        version: row.version,
        appliedAt:
          row.applied_at instanceof Date
            ? row.applied_at.toISOString()
            : new Date(row.applied_at).toISOString(),
      }))
    : [];
  const tables = (
    await pool.query<{ table_name: string }>(
      `select table_name
       from information_schema.tables
       where table_schema = 'public'
       order by table_name`,
    )
  ).rows.map((row) => row.table_name);

  const dailyControl = tables.includes('operational_signals')
    ? (
        await pool.query<{
          name: string;
          value: number;
          attributes: Record<string, unknown>;
          evidence: string[];
          occurred_at: Date | string;
        }>(
          `select name, value, attributes, evidence, occurred_at
           from operational_signals
           where name = 'foundation.daily_control.completed'
             and attributes->>'dayKey' = '2026-08-15'
           order by occurred_at desc
           limit 1`,
        )
      ).rows.map((row) => ({
        name: row.name,
        value: row.value,
        attributes: row.attributes,
        evidence: row.evidence,
        occurredAt:
          row.occurred_at instanceof Date
            ? row.occurred_at.toISOString()
            : new Date(row.occurred_at).toISOString(),
      }))
    : [];

  console.log(
    `PRODUCTION_SCHEMA_AUDIT=${JSON.stringify({
      registryExists,
      migrations,
      tables,
      required: {
        scheduled_jobs: tables.includes('scheduled_jobs'),
        event_outbox: tables.includes('event_outbox'),
        audit_ledger_events: tables.includes('audit_ledger_events'),
        audit_ledger_heads: tables.includes('audit_ledger_heads'),
        operational_signals: tables.includes('operational_signals'),
        event_records: tables.includes('event_records'),
      },
      dailyControl,
    })}`,
  );
} finally {
  await pool.end();
}
