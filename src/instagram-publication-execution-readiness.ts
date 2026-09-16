import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPostgresPool } from './persistence/postgres.js';

const PRODUCTION_CLOUD_SQL_INSTANCE = 'toca-mcp-production:southamerica-east1:toca-mcp-db';

type ReadinessCapabilityRow = {
  readonly transaction_read_only: string;
  readonly provider_publications_regclass: string | null;
  readonly audit_events_regclass: string | null;
  readonly schema_usage: boolean;
  readonly provider_select: boolean;
  readonly provider_insert: boolean;
  readonly provider_update: boolean;
  readonly audit_insert: boolean;
  readonly audit_id_sequence_usage: boolean;
  readonly idempotency_unique: boolean;
  readonly is_superuser: boolean;
  readonly provider_tenant_default_toca: boolean;
  readonly audit_tenant_default_toca: boolean;
};

type SchemaColumnRow = {
  readonly table_name: string;
  readonly column_name: string;
};

type ReadinessQueryResult = {
  readonly rows: readonly unknown[];
};

export type InstagramPublicationExecutionReadinessClient = {
  query(sql: string): Promise<ReadinessQueryResult>;
  release(): void;
};

export type InstagramPublicationExecutionReadinessPool = {
  connect(): Promise<InstagramPublicationExecutionReadinessClient>;
  end(): Promise<void>;
};

type ReadinessOptions = {
  readonly databaseUrl?: string;
  readonly sourceSha?: string;
  readonly expectedCloudSqlInstance?: string;
  readonly poolFactory?: (connectionString: string) => InstagramPublicationExecutionReadinessPool;
  readonly log?: (message: string) => void;
};

function createRuntimePool(connectionString: string): InstagramPublicationExecutionReadinessPool {
  const pool = createPostgresPool({ connectionString, max: 1 });
  return {
    async connect() {
      const client = await pool.connect();
      return {
        async query(sql: string) {
          const result = await client.query(sql);
          return { rows: result.rows as readonly unknown[] };
        },
        release() {
          client.release();
        },
      };
    },
    async end() {
      await pool.end();
    },
  };
}

export async function runInstagramPublicationExecutionReadiness(
  options: ReadinessOptions = {},
): Promise<void> {
  const databaseUrl = options.databaseUrl?.trim() ?? process.env.DATABASE_URL?.trim();
  const sourceSha = options.sourceSha?.trim() ?? process.env.SOURCE_SHA?.trim();
  const expectedCloudSqlInstance =
    options.expectedCloudSqlInstance?.trim() ?? process.env.EXPECTED_CLOUD_SQL_INSTANCE?.trim();
  const poolFactory = options.poolFactory ?? createRuntimePool;
  const log = options.log ?? console.info;

  if (!databaseUrl) throw new Error('GCP_PUBLICATION_EXECUTION_READINESS_DATABASE_URL_REQUIRED');
  if (!sourceSha || !/^[a-f0-9]{40}$/.test(sourceSha)) {
    throw new Error('GCP_PUBLICATION_EXECUTION_READINESS_SOURCE_SHA_INVALID');
  }
  if (expectedCloudSqlInstance !== PRODUCTION_CLOUD_SQL_INSTANCE) {
    throw new Error('GCP_PUBLICATION_EXECUTION_READINESS_CLOUD_SQL_INSTANCE_MISMATCH');
  }

  let parsedDatabaseUrl: URL;
  try {
    parsedDatabaseUrl = new URL(databaseUrl);
  } catch {
    throw new Error('GCP_PUBLICATION_EXECUTION_READINESS_DATABASE_URL_INVALID');
  }
  if (!['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol)) {
    throw new Error('GCP_PUBLICATION_EXECUTION_READINESS_DATABASE_PROTOCOL_INVALID');
  }
  const expectedSocket = `/cloudsql/${expectedCloudSqlInstance}`;
  if (parsedDatabaseUrl.searchParams.get('host') !== expectedSocket) {
    throw new Error('GCP_PUBLICATION_EXECUTION_READINESS_DATABASE_TARGET_MISMATCH');
  }

  const pool = poolFactory(databaseUrl);
  const client = await pool.connect();
  let transactionOpen = false;

  try {
    await client.query('begin read only');
    transactionOpen = true;

    const heartbeat = await client.query('select 1 as ok');
    if ((heartbeat.rows[0] as { readonly ok?: number } | undefined)?.ok !== 1) {
      throw new Error('GCP_PUBLICATION_EXECUTION_READINESS_HEARTBEAT_FAILED');
    }

    const capabilityResult = await client.query(`
      select
        current_setting('transaction_read_only') as transaction_read_only,
        to_regclass('public.provider_publications')::text as provider_publications_regclass,
        to_regclass('public.audit_events')::text as audit_events_regclass,
        has_schema_privilege(current_user, 'public', 'USAGE') as schema_usage,
        has_table_privilege(current_user, 'public.provider_publications', 'SELECT') as provider_select,
        has_table_privilege(current_user, 'public.provider_publications', 'INSERT') as provider_insert,
        has_table_privilege(current_user, 'public.provider_publications', 'UPDATE') as provider_update,
        has_table_privilege(current_user, 'public.audit_events', 'INSERT') as audit_insert,
        coalesce(
          has_sequence_privilege(
            current_user,
            pg_get_serial_sequence('public.audit_events', 'id'),
            'USAGE'
          ),
          false
        ) as audit_id_sequence_usage,
        exists (
          select 1
          from pg_index i
          join pg_class table_class on table_class.oid = i.indrelid
          join pg_namespace table_namespace on table_namespace.oid = table_class.relnamespace
          join pg_attribute idempotency_attribute
            on idempotency_attribute.attrelid = table_class.oid
           and idempotency_attribute.attname = 'idempotency_key'
           and not idempotency_attribute.attisdropped
          where table_namespace.nspname = 'public'
            and table_class.relname = 'provider_publications'
            and i.indisunique = true
            and i.indisvalid = true
            and i.indisready = true
            and i.indnkeyatts = 1
            and i.indnatts = 1
            and i.indpred is null
            and i.indexprs is null
            and i.indkey[0] = idempotency_attribute.attnum
        ) as idempotency_unique,
        exists (
          select 1
          from pg_roles
          where rolname = current_user
            and rolsuper = true
        ) as is_superuser,
        coalesce((
          select pg_get_expr(attribute_default.adbin, attribute_default.adrelid) = '''toca''::text'
          from pg_attribute attribute
          join pg_attrdef attribute_default
            on attribute_default.adrelid = attribute.attrelid
           and attribute_default.adnum = attribute.attnum
          where attribute.attrelid = 'public.provider_publications'::regclass
            and attribute.attname = 'tenant_id'
            and not attribute.attisdropped
        ), false) as provider_tenant_default_toca,
        coalesce((
          select pg_get_expr(attribute_default.adbin, attribute_default.adrelid) = '''toca''::text'
          from pg_attribute attribute
          join pg_attrdef attribute_default
            on attribute_default.adrelid = attribute.attrelid
           and attribute_default.adnum = attribute.attnum
          where attribute.attrelid = 'public.audit_events'::regclass
            and attribute.attname = 'tenant_id'
            and not attribute.attisdropped
        ), false) as audit_tenant_default_toca
    `);

    const capability = capabilityResult.rows[0] as ReadinessCapabilityRow | undefined;
    if (!capability)
      throw new Error('GCP_PUBLICATION_EXECUTION_READINESS_CAPABILITY_RESULT_MISSING');
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
      throw new Error(
        'GCP_PUBLICATION_EXECUTION_READINESS_PROVIDER_PUBLICATIONS_PRIVILEGE_MISSING',
      );
    }
    if (!capability.audit_insert) {
      throw new Error('GCP_PUBLICATION_EXECUTION_READINESS_AUDIT_INSERT_PRIVILEGE_MISSING');
    }
    if (!capability.audit_id_sequence_usage) {
      throw new Error('GCP_PUBLICATION_EXECUTION_READINESS_AUDIT_SEQUENCE_PRIVILEGE_MISSING');
    }
    if (!capability.idempotency_unique) {
      throw new Error('GCP_PUBLICATION_EXECUTION_READINESS_IDEMPOTENCY_UNIQUE_MISSING');
    }
    if (capability.is_superuser) {
      throw new Error('GCP_PUBLICATION_EXECUTION_READINESS_DATABASE_ROLE_TOO_BROAD');
    }
    if (!capability.provider_tenant_default_toca) {
      throw new Error('GCP_PUBLICATION_EXECUTION_READINESS_PROVIDER_TENANT_DEFAULT_MISSING');
    }
    if (!capability.audit_tenant_default_toca) {
      throw new Error('GCP_PUBLICATION_EXECUTION_READINESS_AUDIT_TENANT_DEFAULT_MISSING');
    }

    const columnsResult = await client.query(`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name in ('provider_publications', 'audit_events')
    `);
    const columns = new Map<string, Set<string>>();
    for (const value of columnsResult.rows) {
      const row = value as SchemaColumnRow;
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

    log(
      `GCP_PUBLICATION_EXECUTION_RUNTIME_READINESS=${JSON.stringify({
        schemaVersion: 1,
        sourceSha,
        cloudSqlConnected: true,
        databaseSecretMounted: true,
        databaseTargetVerified: true,
        transactionReadOnly: true,
        requiredTablesPresent: true,
        requiredColumnsPresent: true,
        idempotencyUnique: true,
        requiredPrivilegesPresent: true,
        auditSequencePrivilegePresent: true,
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
}

function isEntrypoint(): boolean {
  const scriptPath = process.argv[1];
  return scriptPath !== undefined && resolve(scriptPath) === fileURLToPath(import.meta.url);
}

if (isEntrypoint()) {
  await runInstagramPublicationExecutionReadiness();
}
