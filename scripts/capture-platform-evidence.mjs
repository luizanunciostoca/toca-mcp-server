import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import pg from 'pg';

const outputPath = resolve(process.argv[2] ?? 'platform-evidence/database-runtime.json');
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('DATABASE_URL_REQUIRED_FOR_EVIDENCE');

const pool = new pg.Pool({
  connectionString: databaseUrl,
  ...(process.env.DATABASE_SSL === 'true' ? { ssl: { rejectUnauthorized: true } } : {}),
  max: 1,
});

try {
  const [migrations, audit, outbox, workflow, privacy] = await Promise.all([
    pool.query('select version from schema_migrations order by version'),
    pool.query(`select event_id, execution_id, correlation_id, event_hash, status, created_at
                  from audit_ledger_events
                 order by created_at desc, sequence desc
                 limit 20`),
    pool.query(`select
                  status,
                  count(*)::int as count,
                  min(available_at) as oldest_available_at
                from event_outbox
               group by status
               order by status`),
    pool.query(`select status, count(*)::int as count
                  from workflow_instances
                 group by status
                 order by status`),
    pool.query(`select count(*)::int as event_count, max(ledger_sequence)::text as latest_sequence
                  from privacy_ledger_events`),
  ]);

  const evidence = {
    schemaVersion: 'toca.platform.evidence.database-runtime.v1',
    capturedAt: new Date().toISOString(),
    releaseSha: process.env.TOCA_RELEASE_SHA ?? null,
    environment: process.env.TOCA_DEPLOY_ENVIRONMENT ?? null,
    migrations: migrations.rows.map((row) => String(row.version)),
    auditRefs: audit.rows.map((row) => ({
      eventId: row.event_id,
      executionId: row.execution_id,
      correlationId: row.correlation_id,
      eventHash: row.event_hash,
      status: row.status,
      createdAt: row.created_at,
    })),
    outboxRefs: outbox.rows.map((row) => ({
      status: row.status,
      count: Number(row.count),
      oldestAvailableAt: row.oldest_available_at,
    })),
    workflowStates: workflow.rows.map((row) => ({ status: row.status, count: Number(row.count) })),
    privacy: {
      eventCount: Number(privacy.rows[0]?.event_count ?? 0),
      latestLedgerSequence: privacy.rows[0]?.latest_sequence ?? null,
    },
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`PLATFORM_EVIDENCE_WRITTEN=${outputPath}`);
} finally {
  await pool.end();
}
