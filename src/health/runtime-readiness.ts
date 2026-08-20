import { readdir } from 'node:fs/promises';
import type pg from 'pg';
import type { RuntimeConfig } from '../config.js';
import { checkDatabase } from '../persistence/postgres.js';
import type { ReadinessCheck } from './readiness.js';

const REQUIRED_TABLES = [
  'schema_migrations',
  'tenants',
  'tenant_configurations',
  'tenant_credential_bindings',
  'tenant_provider_bindings',
  'approval_records',
  'approval_record_history',
  'event_outbox',
  'audit_ledger_events',
  'audit_ledger_heads',
  'operational_signals',
  'crm_contacts',
  'crm_conversations',
  'crm_messages',
  'ag01_conversations',
  'ag01_message_records',
  'ag01_runtime_circuits',
  'email_dispatches',
  'email_provider_events',
  'whatsapp_dispatches',
  'whatsapp_provider_events',
] as const;

export interface RuntimeReadinessOptions {
  readonly pool?: pg.Pool;
  readonly config: RuntimeConfig;
  readonly env?: NodeJS.ProcessEnv;
  readonly migrationsDirectory?: string;
}

export function createRuntimeReadinessChecks(
  options: RuntimeReadinessOptions,
): readonly ReadinessCheck[] {
  const env = options.env ?? process.env;
  const migrationsDirectory = options.migrationsDirectory ?? 'migrations';

  return [
    namedCheck('db', async () => checkDatabase(requiredPool(options.pool))),
    namedCheck('migrations', async () => {
      const pool = requiredPool(options.pool);
      const repositoryMigrations = (await readdir(migrationsDirectory))
        .filter((file) => file.endsWith('.sql'))
        .sort();
      const applied = await pool.query<{ readonly version: string }>(
        'select version from schema_migrations order by version',
      );
      const appliedVersions = new Set(applied.rows.map((row) => row.version));
      const missing = repositoryMigrations.filter((version) => !appliedVersions.has(version));
      if (missing.length > 0) throw new Error(`READINESS_MIGRATIONS_PENDING:${missing.join(',')}`);
    }),
    namedCheck('schema', async () => {
      const pool = requiredPool(options.pool);
      const result = await pool.query<{
        readonly table_name: string;
        readonly relation: string | null;
      }>(
        `select required.table_name, to_regclass(required.table_name)::text as relation
           from unnest($1::text[]) as required(table_name)`,
        [REQUIRED_TABLES],
      );
      const missing = result.rows.filter((row) => row.relation === null).map((row) => row.table_name);
      if (missing.length > 0) throw new Error(`READINESS_SCHEMA_MISSING:${missing.join(',')}`);
    }),
    namedCheck('audit', async () => {
      const pool = requiredPool(options.pool);
      const mismatch = await pool.query(
        `select h.execution_id
           from audit_ledger_heads h
           left join lateral (
             select e.sequence, e.event_hash
               from audit_ledger_events e
              where e.execution_id = h.execution_id
              order by e.sequence desc
              limit 1
           ) latest on true
          where latest.sequence is null
             or latest.sequence <> h.last_sequence
             or latest.event_hash <> h.head_hash
          limit 1`,
      );
      if ((mismatch.rowCount ?? 0) > 0) throw new Error('READINESS_AUDIT_HEAD_MISMATCH');
    }),
    namedCheck('outbox', async () => {
      const pool = requiredPool(options.pool);
      const maxLagSeconds = positiveInteger(env.TOCA_READY_OUTBOX_MAX_LAG_SECONDS, 300);
      const result = await pool.query<{
        readonly oldest_pending_age_seconds: number | string;
        readonly dead_letter_count: number | string;
      }>(
        `select
           coalesce(
             extract(epoch from (now() - min(available_at)))
               filter (where status in ('PENDING', 'FAILED_RETRYABLE')),
             0
           ) as oldest_pending_age_seconds,
           count(*) filter (where status = 'DEAD_LETTER') as dead_letter_count
         from event_outbox`,
      );
      const row = result.rows[0];
      if (!row) throw new Error('READINESS_OUTBOX_QUERY_EMPTY');
      const lag = Number(row.oldest_pending_age_seconds);
      const deadLetters = Number(row.dead_letter_count);
      if (!Number.isFinite(lag) || lag > maxLagSeconds) {
        throw new Error('READINESS_OUTBOX_LAG_EXCEEDED');
      }
      if (!Number.isFinite(deadLetters) || deadLetters > 0) {
        throw new Error('READINESS_OUTBOX_DEAD_LETTER_PRESENT');
      }
    }),
    namedCheck('approval_store', async () => {
      await requiredPool(options.pool).query(
        'select tenant_id, workspace_id, organization_id from approval_records limit 0',
      );
    }),
    namedCheck('crm', async () => {
      const pool = requiredPool(options.pool);
      await Promise.all([
        pool.query('select tenant_id, workspace_id, organization_id from crm_contacts limit 0'),
        pool.query('select tenant_id, workspace_id, organization_id from crm_conversations limit 0'),
        pool.query('select tenant_id, workspace_id, organization_id from crm_messages limit 0'),
      ]);
    }),
    namedCheck('ag01', async () => {
      const pool = requiredPool(options.pool);
      await Promise.all([
        pool.query('select tenant_id, workspace_id, organization_id from ag01_conversations limit 0'),
        pool.query('select tenant_id, conversation_id from ag01_message_records limit 0'),
        pool.query('select tenant_id, capability_id from ag01_runtime_circuits limit 0'),
      ]);
      if (booleanFlag(env.AG01_MODEL_ENABLED, false)) {
        requireProviderVerified(env, 'AG01_MODEL');
      }
    }),
    namedCheck('meta', async () => {
      if (!metaRequired(options.config, env)) return;
      requireProviderVerified(env, 'META');
      if (options.config.META_ENABLED) {
        requireText(options.config.META_APP_ID, 'READINESS_META_APP_ID_REQUIRED');
      }
    }),
    namedCheck('whatsapp', async () => {
      if (!booleanFlag(env.WHATSAPP_ENABLED, false)) return;
      requireProviderVerified(env, 'WHATSAPP');
      requireExact(
        env.WHATSAPP_BINDING_STATE,
        'PRODUCTION_VALIDATED',
        'READINESS_WHATSAPP_BINDING_NOT_PRODUCTION_VALIDATED',
      );
      requireText(env.WHATSAPP_META_APP_ID, 'READINESS_WHATSAPP_META_APP_ID_REQUIRED');
      requireText(env.WHATSAPP_WABA_ID, 'READINESS_WHATSAPP_WABA_ID_REQUIRED');
      requireText(env.WHATSAPP_PHONE_NUMBER_ID, 'READINESS_WHATSAPP_PHONE_NUMBER_ID_REQUIRED');
      requireText(env.WHATSAPP_BINDING_ID, 'READINESS_WHATSAPP_BINDING_ID_REQUIRED');
    }),
    namedCheck('email', async () => {
      if (!booleanFlag(env.EMAIL_SENDGRID_ENABLED, false)) return;
      requireProviderVerified(env, 'EMAIL_SENDGRID');
      requireExact(
        env.EMAIL_SENDGRID_BINDING_STATE,
        'PRODUCTION_VALIDATED',
        'READINESS_EMAIL_BINDING_NOT_PRODUCTION_VALIDATED',
      );
      requireText(env.EMAIL_SENDGRID_BINDING_ID, 'READINESS_EMAIL_BINDING_ID_REQUIRED');
      requireText(env.EMAIL_SENDGRID_SENDING_DOMAIN, 'READINESS_EMAIL_SENDING_DOMAIN_REQUIRED');
      requireText(env.EMAIL_SENDGRID_FROM_EMAIL, 'READINESS_EMAIL_FROM_REQUIRED');
    }),
    namedCheck('google_ads', async () => {
      if (options.config.GOOGLE_ADS_PHASE === 'OFF') return;
      requireProviderVerified(env, 'GOOGLE_ADS');
    }),
    namedCheck('provider_credentials', async () => {
      assertProviderCredentials(options.config, env);
    }),
    namedCheck('critical_configuration', async () => {
      requireText(options.config.DATABASE_URL, 'READINESS_DATABASE_URL_REQUIRED');
      if (options.config.NODE_ENV === 'production') {
        if (!options.config.MCP_ENABLED) throw new Error('READINESS_MCP_MUST_BE_ENABLED');
        requireText(env.TOCA_DEFAULT_TENANT_ID, 'READINESS_TENANT_ID_REQUIRED');
        requireText(env.TOCA_DEFAULT_WORKSPACE_ID, 'READINESS_WORKSPACE_ID_REQUIRED');
        requireText(env.TOCA_DEFAULT_ORGANIZATION_ID, 'READINESS_ORGANIZATION_ID_REQUIRED');
        requireText(env.TOCA_DEPLOY_ENVIRONMENT, 'READINESS_DEPLOY_ENVIRONMENT_REQUIRED');
        requireText(env.TOCA_RELEASE_SHA, 'READINESS_RELEASE_SHA_REQUIRED');
      }
    }),
  ];
}

function namedCheck(name: string, check: () => Promise<void>): ReadinessCheck {
  return { name, check };
}

function requiredPool(pool: pg.Pool | undefined): pg.Pool {
  if (!pool) throw new Error('READINESS_DATABASE_POOL_UNAVAILABLE');
  return pool;
}

function metaRequired(config: RuntimeConfig, env: NodeJS.ProcessEnv): boolean {
  return (
    config.META_ENABLED ||
    config.META_WEBHOOK_ENABLED ||
    config.INSTAGRAM_READ_ENABLED ||
    config.INSTAGRAM_ENGAGEMENT_WRITES_ENABLED ||
    config.INSTAGRAM_PUBLICATION_WRITES_ENABLED ||
    config.META_ADS_READ_ENABLED ||
    config.META_ADS_WRITE_ENABLED ||
    booleanFlag(env.WHATSAPP_ENABLED, false)
  );
}

function assertProviderCredentials(config: RuntimeConfig, env: NodeJS.ProcessEnv): void {
  if (metaRequired(config, env)) {
    if (config.META_ACCESS_TOKEN_ENV_KEY) {
      requireReferencedSecret(env, config.META_ACCESS_TOKEN_ENV_KEY, 'META_ACCESS_TOKEN_ENV_KEY');
    }
    if (config.META_ENABLED && config.META_APP_SECRET_PROVIDER === 'env') {
      requireReferencedSecret(env, config.META_APP_SECRET_KEY, 'META_APP_SECRET_KEY');
    }
    if (config.META_WEBHOOK_ENABLED) {
      requireReferencedSecret(env, config.META_WEBHOOK_VERIFY_TOKEN_KEY, 'META_WEBHOOK_VERIFY_TOKEN_KEY');
    }
  }

  if (booleanFlag(env.WHATSAPP_ENABLED, false)) {
    const accessTokenKey = env.WHATSAPP_ACCESS_TOKEN_ENV_KEY ?? config.META_ACCESS_TOKEN_ENV_KEY;
    requireReferencedSecret(env, accessTokenKey, 'WHATSAPP_ACCESS_TOKEN_ENV_KEY');
  }

  if (booleanFlag(env.EMAIL_SENDGRID_ENABLED, false)) {
    requireReferencedSecret(
      env,
      env.EMAIL_SENDGRID_API_KEY_SECRET_KEY,
      'EMAIL_SENDGRID_API_KEY_SECRET_KEY',
    );
  }

  if (config.GOOGLE_ADS_PHASE !== 'OFF') {
    requireReferencedSecret(
      env,
      config.GOOGLE_ADS_DEVELOPER_TOKEN_ENV_KEY,
      'GOOGLE_ADS_DEVELOPER_TOKEN_ENV_KEY',
    );
    if (config.GOOGLE_ADS_ACCESS_TOKEN_ENV_KEY) {
      requireReferencedSecret(env, config.GOOGLE_ADS_ACCESS_TOKEN_ENV_KEY, 'GOOGLE_ADS_ACCESS_TOKEN_ENV_KEY');
    } else {
      requireReferencedSecret(
        env,
        config.GOOGLE_ADS_OAUTH_CLIENT_ID_ENV_KEY,
        'GOOGLE_ADS_OAUTH_CLIENT_ID_ENV_KEY',
      );
      requireReferencedSecret(
        env,
        config.GOOGLE_ADS_OAUTH_CLIENT_SECRET_ENV_KEY,
        'GOOGLE_ADS_OAUTH_CLIENT_SECRET_ENV_KEY',
      );
      requireReferencedSecret(
        env,
        config.GOOGLE_ADS_OAUTH_REFRESH_TOKEN_ENV_KEY,
        'GOOGLE_ADS_OAUTH_REFRESH_TOKEN_ENV_KEY',
      );
    }
  }

  if (booleanFlag(env.AG01_MODEL_ENABLED, false)) {
    requireProviderVerified(env, 'AG01_MODEL');
    requireReferencedSecret(env, env.AG01_MODEL_API_KEY_ENV_KEY, 'AG01_MODEL_API_KEY_ENV_KEY');
  }
}

function requireProviderVerified(env: NodeJS.ProcessEnv, prefix: string): void {
  if (!booleanFlag(env[`${prefix}_PROVIDER_VERIFIED`], false)) {
    throw new Error(`READINESS_${prefix}_PROVIDER_NOT_VERIFIED`);
  }
}

function requireReferencedSecret(
  env: NodeJS.ProcessEnv,
  key: string | undefined,
  source: string,
): void {
  const normalizedKey = requireText(key, `READINESS_${source}_REQUIRED`);
  if (!env[normalizedKey]?.trim()) throw new Error(`READINESS_SECRET_MISSING:${source}:${normalizedKey}`);
}

function requireExact(value: string | undefined, expected: string, errorCode: string): void {
  if (value?.trim() !== expected) throw new Error(errorCode);
}

function requireText(value: string | undefined, errorCode: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}

function booleanFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`READINESS_BOOLEAN_INVALID:${value}`);
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error('READINESS_POSITIVE_INTEGER_INVALID');
  return parsed;
}
