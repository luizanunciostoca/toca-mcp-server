import { describe, expect, it, vi } from 'vitest';

import {
  runInstagramPublicationExecutionReadiness,
  type InstagramPublicationExecutionReadinessClient,
  type InstagramPublicationExecutionReadinessPool,
} from '../src/instagram-publication-execution-readiness.js';

const sourceSha = 'a'.repeat(40);
const cloudSqlInstance = 'toca-mcp-production:southamerica-east1:toca-mcp-db';
const databaseUrl =
  'postgresql://toca_mcp_app:test@localhost/toca_mcp?host=/cloudsql/toca-mcp-production:southamerica-east1:toca-mcp-db';

const providerColumns = [
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
const auditColumns = [
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

const passingCapability = {
  transaction_read_only: 'on',
  provider_publications_regclass: 'provider_publications',
  audit_events_regclass: 'audit_events',
  schema_usage: true,
  provider_select: true,
  provider_insert: true,
  provider_update: true,
  audit_insert: true,
  audit_id_sequence_usage: true,
  idempotency_unique: true,
  is_superuser: false,
  provider_tenant_default_toca: true,
  audit_tenant_default_toca: true,
};

type Capability = typeof passingCapability;

function createMockDatabase(capability: Capability = passingCapability) {
  const release = vi.fn();
  const end = vi.fn(async () => undefined);
  const query = vi.fn(async (sql: string) => {
    if (sql === 'begin read only' || sql === 'rollback') return { rows: [] };
    if (sql === 'select 1 as ok') return { rows: [{ ok: 1 }] };
    if (sql.includes("current_setting('transaction_read_only')")) {
      return { rows: [capability] };
    }
    if (sql.includes('from information_schema.columns')) {
      return {
        rows: [
          ...providerColumns.map((column_name) => ({
            table_name: 'provider_publications',
            column_name,
          })),
          ...auditColumns.map((column_name) => ({ table_name: 'audit_events', column_name })),
        ],
      };
    }
    throw new Error(`UNEXPECTED_TEST_SQL:${sql}`);
  });
  const client: InstagramPublicationExecutionReadinessClient = { query, release };
  const pool: InstagramPublicationExecutionReadinessPool = {
    connect: vi.fn(async () => client),
    end,
  };
  return { pool, query, release, end };
}

describe('runInstagramPublicationExecutionReadiness', () => {
  it('passes only after exercising the read-only probe and always closes the database resources', async () => {
    const database = createMockDatabase();
    const log = vi.fn();

    await runInstagramPublicationExecutionReadiness({
      databaseUrl,
      sourceSha,
      expectedCloudSqlInstance: cloudSqlInstance,
      poolFactory: () => database.pool,
      log,
    });

    expect(database.query).toHaveBeenCalledWith('begin read only');
    expect(database.query).toHaveBeenCalledWith('select 1 as ok');
    expect(database.query).toHaveBeenCalledWith('rollback');
    expect(database.release).toHaveBeenCalledTimes(1);
    expect(database.end).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);

    const marker = String(log.mock.calls[0]?.[0]);
    expect(marker).toContain('GCP_PUBLICATION_EXECUTION_RUNTIME_READINESS=');
    const evidence = JSON.parse(marker.split('=', 2)[1] ?? '{}') as Record<string, unknown>;
    expect(evidence).toMatchObject({
      cloudSqlConnected: true,
      databaseSecretMounted: true,
      databaseTargetVerified: true,
      transactionReadOnly: true,
      idempotencyUnique: true,
      auditSequencePrivilegePresent: true,
      tenantDefaultsPresent: true,
      databaseMutationAttempted: false,
      providerCredentialsMounted: false,
      providerWriteAttempted: false,
      result: 'PASS',
    });
  });

  it.each([
    ['idempotency index', { idempotency_unique: false }, 'IDEMPOTENCY_UNIQUE_MISSING'],
    ['audit sequence', { audit_id_sequence_usage: false }, 'AUDIT_SEQUENCE_PRIVILEGE_MISSING'],
    [
      'provider tenant default',
      { provider_tenant_default_toca: false },
      'PROVIDER_TENANT_DEFAULT_MISSING',
    ],
  ] as const)(
    'fails closed when %s readiness is missing and still rolls back and closes resources',
    async (_label, override, errorSuffix) => {
      const database = createMockDatabase({ ...passingCapability, ...override });

      await expect(
        runInstagramPublicationExecutionReadiness({
          databaseUrl,
          sourceSha,
          expectedCloudSqlInstance: cloudSqlInstance,
          poolFactory: () => database.pool,
          log: vi.fn(),
        }),
      ).rejects.toThrow(`GCP_PUBLICATION_EXECUTION_READINESS_${errorSuffix}`);

      expect(database.query).toHaveBeenCalledWith('rollback');
      expect(database.release).toHaveBeenCalledTimes(1);
      expect(database.end).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects a DATABASE_URL targeting any other Cloud SQL socket before opening a pool', async () => {
    const poolFactory = vi.fn(() => createMockDatabase().pool);
    const wrongUrl =
      'postgresql://toca_mcp_app:test@localhost/toca_mcp?host=/cloudsql/other-project:southamerica-east1:other-db';

    await expect(
      runInstagramPublicationExecutionReadiness({
        databaseUrl: wrongUrl,
        sourceSha,
        expectedCloudSqlInstance: cloudSqlInstance,
        poolFactory,
        log: vi.fn(),
      }),
    ).rejects.toThrow('GCP_PUBLICATION_EXECUTION_READINESS_DATABASE_TARGET_MISMATCH');

    expect(poolFactory).not.toHaveBeenCalled();
  });
});
