import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import pg from 'pg';

const outputTarget = process.argv[2] ?? 'platform-evidence/database-runtime.json';
const emitToStdout = outputTarget === '-';
const outputPath = emitToStdout ? null : resolve(outputTarget);
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('DATABASE_URL_REQUIRED_FOR_EVIDENCE');

const pool = new pg.Pool({
  connectionString: databaseUrl,
  ...(process.env.DATABASE_SSL === 'true' ? { ssl: { rejectUnauthorized: true } } : {}),
  max: 1,
});

try {
  const [
    migrations,
    audit,
    outbox,
    workflow,
    privacy,
    tables,
    tenants,
    tenantConfigurations,
    tenantColumns,
  ] = await Promise.all([
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
    pool.query(`select table_name
                  from information_schema.tables
                 where table_schema = 'public'
                   and table_type = 'BASE TABLE'
                 order by table_name`),
    pool.query(`select tenant_id, status, display_name
                  from tenants
                 order by tenant_id`),
    pool.query(`select tenant_id, workspace_id, organization_id, config_version
                  from tenant_configurations
                 order by tenant_id`),
    pool.query(`select table_name
                  from information_schema.columns
                 where table_schema = 'public'
                   and column_name = 'tenant_id'
                 order by table_name`),
  ]);

  const migrationVersions = migrations.rows.map((row) => String(row.version));
  const publicTables = tables.rows.map((row) => String(row.table_name));
  const tenantScopedTables = tenantColumns.rows.map((row) => String(row.table_name));

  const evidence = {
    schemaVersion: 'toca.platform.evidence.database-runtime.v2',
    capturedAt: new Date().toISOString(),
    releaseSha: process.env.TOCA_RELEASE_SHA ?? null,
    environment: process.env.TOCA_DEPLOY_ENVIRONMENT ?? null,
    migrations: migrationVersions,
    migrationSummary: {
      count: migrationVersions.length,
      maximum: migrationVersions.at(-1) ?? null,
      migration027Present: migrationVersions.some((version) => version.startsWith('027')),
    },
    schema: {
      publicTableCount: publicTables.length,
      publicTables,
      tenantScopedTableCount: tenantScopedTables.length,
      tenantScopedTables,
    },
    tenants: tenants.rows.map((row) => ({
      tenantId: row.tenant_id,
      status: row.status,
      displayName: row.display_name,
    })),
    tenantConfigurations: tenantConfigurations.rows.map((row) => ({
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      organizationId: row.organization_id,
      configVersion: Number(row.config_version),
    })),
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

  const serializedEvidence = `${JSON.stringify(evidence, null, 2)}\n`;
  if (emitToStdout) {
    console.log(
      `PLATFORM_EVIDENCE_BASE64=${Buffer.from(serializedEvidence, 'utf8').toString('base64')}`,
    );
  } else {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, serializedEvidence, 'utf8');
    console.log(`PLATFORM_EVIDENCE_WRITTEN=${outputPath}`);
  }
} finally {
  await pool.end();
}
