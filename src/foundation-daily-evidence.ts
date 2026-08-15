import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL_REQUIRED');

const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  const result = await pool.query<{
    name: string;
    value: number;
    attributes: unknown;
    evidence: unknown;
    occurred_at: Date | string;
  }>(
    `select name, value, attributes, evidence, occurred_at
     from operational_signals
     where name = 'foundation.daily_control.completed'
       and attributes ->> 'dayKey' = '2026-08-15'
     order by occurred_at desc
     limit 1`,
  );
  const row = result.rows[0];
  if (!row) throw new Error('FOUNDATION_DAILY_CONTROL_SIGNAL_NOT_FOUND');
  console.log(
    `FOUNDATION_DAILY_CONTROL_DB_RESULT=${JSON.stringify({
      name: row.name,
      value: row.value,
      attributes: row.attributes,
      evidence: row.evidence,
      occurredAt:
        row.occurred_at instanceof Date
          ? row.occurred_at.toISOString()
          : new Date(row.occurred_at).toISOString(),
    })}`,
  );
} finally {
  await pool.end();
}
