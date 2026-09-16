import { createPostgresPool } from './persistence/postgres.js';

type ReadinessCapabilityRow = {
  readonly transaction_read_only: string;
  readonly provider_publications_regclass: string | null;
  readonly audit_events_regclass: string | null;
  readonly schema_usage: boolean;
  readonly provider_select: boolean;
  readonly provider_insert: boolean;
  readonly provider_update: boolean;
  readonly audit_insert: boolean;
  readonly idempotency_unique: boolean;
  readonly is_superuser: boolean;
  readonly provider_tenant_default: string | null;
  readonly audit_tenant_default: string | null;
};

type SchemaColumnRow = {
  readonly table_name: string;
  readonly column_name: string;
};

const databaseUrl = process.env.DATABASE_URL?.trim();
const sourceSha = process.env.SOURCE_SHA?.trim();

if (!databaseUrl) throw new Error('GCP_PUBLICATION_EXECUTION_READINESS_DATABASE_URL_REQUIRED');
if (!sourceSha || !/^[a-f0-9]{40}$/.test(sourceSha)) {
  throw new Error('GCP_PUBLICATION_EXECUTION_READINESS_SOURCE_SHA_INVALID');
}

const pool = createPostgresPool({ connectionString: databaseUrl, max: 1 });
const client = await pool.connect();
let transactionOpen = false;

try {
  await client.query('begin read only');
  transactionOpen = true;

  const heartbeat = await client.query<{ ok: number }>('select 1 as ok');
  if (heartbeat.rows[0]?.ok !== 1) {
    throw new Error('GCP_PUBLICATION_EXECUTION_READINESS_HEARTBEAT_FAILED');
  }

  const capabilityResult = await client.query<ReadinessCapabilityRow>(`
    select
      current_setting('transaction_read_only') as transaction_read_only,
      to_regclass('public.provider_publications')::text as provider_publications_regclass,
      to_regclass('public.audit_events')::text as audit_events_regclass,
      has_schema_privilege(current_user, 'public', 'USAGE') as schema_usage,
      has_table_privilege(current_user, 'public.provider_publications', 'SELECT') as provider_select,
      has_table_privilege(current_user, 'public.provider_publications', 'INSERT') as provider_insert,
      has_table_privilege(current_user, 'public.provider_publications', 'UPDATE') as provider_update,
      has_table_privilege(current_user, 'public.audit_events', 'INSERT') as audit_insert,
      exists (
        select 1
        from pg_indexes
        where schemaname = 'public'
          and tablename = 'provider_publications'
          and indexdef ilike '%unique%'
          and indexdef like '%(idempotency_key)%'
      ) as idempotency_unique,
      exists (
        select 1
        from pg_roles
        where rolname = current_user
          and rolsuper = true
      ) as is_superuser,
      (
        select column_default
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'provider_publications'
          and column_name = 'tenant_id'
      ) as provider_tenant_default,
      (
        select column_default
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'audit_events'
          and column_name = 'tenant_id'
      ) as audit_tenant_default
  `);

  const capability = capabilityResult.rows[0];
  if (!capability) throw new Error('GCP_PUBLICATION_EXECUTION_READINESS_CAPABILITY_RESULT_MISSING');
  if (capability.transaction_read_only !== 'on') {
    throw new Error('GCP_PUBLICATION_EXECUTION_READINESS_TRANSACTION_NOT_READ_ONLY');
  }
  if (!capability.provider_publications_regclass || !capability.audit_events_regclass) {
    throw new Error('GCP_PUBLICATION_EXECUTION_READINESS_REQUIRED_TABLE_MISSING');
  }
  if (!capability.schema_usage) {
    throw new Error('GCP_PUBLICATION_EXECUTION_READINESS_SCHEMA_USAGE_MISSING');
  }
  if (!capability.provider_select || !capability.provider_insert || !capability.provider_update) {
    throw new Error('GCP_PUBLICATION_EXECUTION_READINESS_PROVIDER_PUBLICATIONS_PRIVILEGE_MISSING');
  }
  if (!capability.audit_insert) {
    throw new Error('GCP_PUBLICATION_EXECUTION_READINESS_AUDIT_INSERT_PRIVILEGE_MISSING');
  }
  if (!capability.idempotency_unique) {
    throw new Error('GCP_PUBLICATION_EXECUTION_READINESS_IDEMPOTENCY_UNIQUE_MISSING');
  }
  if (capability.is_superuser) {
    throw new Error('GCP_PUBLICATION_EXECUTION_READINESS_DATABASE_ROLE_TOO_BROAD');
  }
  if (!capability.provider_tenant_default?.includes('toca')) {
    throw new Error('GCP_PUBLICATION_EXECUTION_READINESS_PROVIDER_TENANT_DEFAULT_MISSING');
  }
  if (!capability.audit_tenant_default?.includes('toca')) {
    throw new Error('GCP_PUBLICATION_EXECUTION_READINESS_AUDIT_TENANT_DEFAULT_MISSING');
  }

  const columnsResult = await client.query<SchemaColumnRow>(`
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('provider_publications', 'audit_events')
  `);
  const columns = new Map<string, Set<string>>();
  for (const row of columnsResult.rows) {
    const tableColumns = columns.get(row.table_name) ?? new Set<string>();
    tableColumns.add(row.column_name);
    columns.set(row.table_name, tableColumns);
  }

  const requiredProviderColumns = [
    'correlation_id',
    'provider',
    'account_id',
    'external_resource_id',
    'state',
    'idempotency_key',
    'payload',
    'last_error',
    'created_at',
    'updated_at',
    'tenant_id',
  ];
  const requiredAuditColumns = [
    'id',
    'correlation_id',
    'actor_id',
    'tool_name',
    'risk_class',
    'decision',
    'normalized_payload',
    'provider_result',
    'created_at',
    'tenant_id',
  ];

  for (const column of requiredProviderColumns) {
    if (!columns.get('provider_publications')?.has(column)) {
      throw new Error(`GCP_PUBLICATION_EXECUTION_READINESS_PROVIDER_COLUMN_MISSING_${column}`);
    }
  }
  for (const column of requiredAuditColumns) {
    if (!columns.get('audit_events')?.has(column)) {
      throw new Error(`GCP_PUBLICATION_EXECUTION_READINESS_AUDIT_COLUMN_MISSING_${column}`);
    }
  }

  console.info(
    `GCP_PUBLICATION_EXECUTION_RUNTIME_READINESS=${JSON.stringify({
      schemaVersion: 1,
      sourceSha,
      cloudSqlConnected: true,
      databaseSecretMounted: true,
      transactionReadOnly: true,
      requiredTablesPresent: true,
      requiredColumnsPresent: true,
      idempotencyUnique: true,
      requiredPrivilegesPresent: true,
      tenantDefaultsPresent: true,
      databaseRoleNonSuperuser: true,
      databaseMutationAttempted: false,
      providerCredentialsMounted: false,
      providerWriteAttempted: false,
      result: 'PASS',
    })}`,
  );

  await client.query('rollback');
  transactionOpen = false;
} finally {
  if (transactionOpen) {
    await client.query('rollback').catch(() => undefined);
  }
  client.release();
  await pool.end();
}
