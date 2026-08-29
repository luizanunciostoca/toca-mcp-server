import { loadConfig } from './config.js';
import { EnvSecretResolver } from './core/secrets.js';
import { createInstagramEngagementGoogleSheetsAuth } from './instagram-engagement/google-sheets-auth.js';
import {
  INSTAGRAM_ENGAGEMENT_CANONICAL_SPREADSHEET_ID,
  INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE,
} from './instagram-engagement/knowledge-snapshot-current.js';
import { createPostgresPool } from './persistence/postgres.js';
import { GoogleSheetsRestClient } from './providers/google-sheets/client.js';
import { MetaApiClient } from './providers/meta/meta-api-client.js';

const REQUIRED_FAQ_HEADERS = [
  'faq_id',
  'pergunta_canonica',
  'intent',
  'autonomy_default',
  'resposta_oficial',
  'fonte_resposta_toca_os',
  'status',
  'validade_operacional',
] as const;

const REQUIRED_TABLES = [
  'meta_webhook_events',
  'event_outbox',
  'event_outbox_delivery_attempts',
  'instagram_engagement_actions',
] as const;

const ENGAGEMENT_MIGRATION = '035_instagram_engagement_e2e.sql';
const KNOWLEDGE_MIGRATION = '036_instagram_engagement_knowledge.sql';
const config = loadConfig();

if (!isTrue(process.env.INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED)) {
  throw new Error('INSTAGRAM_ENGAGEMENT_RUNTIME_DISABLED');
}
if (!config.DATABASE_URL) throw new Error('INSTAGRAM_ENGAGEMENT_DATABASE_URL_REQUIRED');

const tenantId = requiredEnv('INSTAGRAM_ENGAGEMENT_TENANT_ID');
const workspaceId = process.env.INSTAGRAM_ENGAGEMENT_WORKSPACE_ID?.trim() || tenantId;
const organizationId = process.env.INSTAGRAM_ENGAGEMENT_ORGANIZATION_ID?.trim() || tenantId;
requiredEnv('INSTAGRAM_ENGAGEMENT_PAGE_ID');
const spreadsheetId = requiredEnv('INSTAGRAM_ENGAGEMENT_KNOWLEDGE_SPREADSHEET_ID');
if (spreadsheetId !== INSTAGRAM_ENGAGEMENT_CANONICAL_SPREADSHEET_ID) {
  throw new Error('INSTAGRAM_ENGAGEMENT_KNOWLEDGE_SPREADSHEET_MISMATCH');
}
const knowledgeSource =
  process.env.INSTAGRAM_ENGAGEMENT_KNOWLEDGE_SOURCE?.trim().toLowerCase() || 'google-sheets';
const instagramUserId =
  config.INSTAGRAM_BUSINESS_ACCOUNT_ID ?? requiredEnv('INSTAGRAM_BUSINESS_ACCOUNT_ID');

const pool = createPostgresPool({ connectionString: config.DATABASE_URL });
try {
  const requiredTables =
    knowledgeSource === 'postgres'
      ? [...REQUIRED_TABLES, 'instagram_engagement_knowledge']
      : [...REQUIRED_TABLES];
  const tableRows = await pool.query<{ table_name: string; present: boolean }>(
    `select requested.table_name,
            to_regclass('public.' || requested.table_name) is not null as present
       from unnest($1::text[]) as requested(table_name)
       order by requested.table_name`,
    [requiredTables],
  );
  const missingTables = tableRows.rows.filter((row) => !row.present).map((row) => row.table_name);
  if (missingTables.length > 0) {
    throw new Error(`INSTAGRAM_ENGAGEMENT_SCHEMA_MISSING:${missingTables.join(',')}`);
  }

  const migrations = await pool.query<{ version: string }>(
    `select version from schema_migrations where version = any($1::text[])`,
    [[ENGAGEMENT_MIGRATION, KNOWLEDGE_MIGRATION]],
  );
  const applied = new Set(migrations.rows.map((row) => row.version));
  if (!applied.has(ENGAGEMENT_MIGRATION))
    throw new Error('INSTAGRAM_ENGAGEMENT_MIGRATION_NOT_APPLIED');

  let knowledgeMode: 'postgres' | 'google-sheets:env' | 'google-sheets:gcp-iam';
  if (knowledgeSource === 'postgres') {
    if (!applied.has(KNOWLEDGE_MIGRATION)) {
      throw new Error('INSTAGRAM_ENGAGEMENT_KNOWLEDGE_MIGRATION_NOT_APPLIED');
    }
    const snapshot = await pool.query<{ count: string; hashes: number; approved: string }>(
      `select count(*)::text as count,
              count(distinct source_snapshot_sha256)::int as hashes,
              count(*) filter (where status = 'APROVADO')::text as approved
         from instagram_engagement_knowledge
        where active = true and source_spreadsheet_id = $1`,
      [spreadsheetId],
    );
    const row = snapshot.rows[0];
    if (Number(row?.count ?? 0) !== INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE.length) {
      throw new Error('INSTAGRAM_ENGAGEMENT_KNOWLEDGE_SNAPSHOT_COUNT_INVALID');
    }
    if (Number(row?.approved ?? 0) !== INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE.length) {
      throw new Error('INSTAGRAM_ENGAGEMENT_KNOWLEDGE_SNAPSHOT_STATUS_INVALID');
    }
    if (row?.hashes !== 1) throw new Error('INSTAGRAM_ENGAGEMENT_KNOWLEDGE_SNAPSHOT_HASH_INVALID');
    knowledgeMode = 'postgres';
  } else if (knowledgeSource === 'google-sheets') {
    const sheetsAuth = createInstagramEngagementGoogleSheetsAuth();
    const sheetsClient = new GoogleSheetsRestClient(sheetsAuth.resolver, {
      tokenReference: sheetsAuth.tokenReference,
    });
    const values = await sheetsClient.readRange(
      spreadsheetId,
      process.env.INSTAGRAM_ENGAGEMENT_KNOWLEDGE_RANGE?.trim() || 'FAQ_IA!A1:T20',
    );
    validateCanonicalSheetSnapshot(values);
    knowledgeMode = `google-sheets:${sheetsAuth.mode}`;
  } else {
    throw new Error('INSTAGRAM_ENGAGEMENT_KNOWLEDGE_SOURCE_INVALID');
  }

  let providerReadVerified = false;
  if (config.INSTAGRAM_ENGAGEMENT_WRITES_ENABLED) {
    if (!config.META_ENABLED) throw new Error('META_ENABLED_REQUIRED');
    if (!isTrue(process.env.META_PROVIDER_VERIFIED)) throw new Error('META_PROVIDER_NOT_VERIFIED');
    if (!config.META_ACCESS_TOKEN_ENV_KEY) throw new Error('META_ACCESS_TOKEN_ENV_KEY_REQUIRED');
    const metaSecrets = new EnvSecretResolver(process.env, 'env');
    const meta = new MetaApiClient(
      { graphBaseUrl: config.META_GRAPH_BASE_URL, apiVersion: config.META_GRAPH_API_VERSION },
      metaSecrets,
      { provider: 'env', key: config.META_ACCESS_TOKEN_ENV_KEY },
    );
    await meta.get(instagramUserId, { fields: 'id' });
    providerReadVerified = true;
  }

  console.log(
    JSON.stringify({
      validation: 'instagram-engagement-readiness',
      status: 'PASS',
      writesEnabled: config.INSTAGRAM_ENGAGEMENT_WRITES_ENABLED,
      providerReadVerified,
      databaseSchemaVerified: true,
      migrationVerified: true,
      knowledgeReadable: true,
      knowledgeSchemaVerified: true,
      knowledgeSnapshotVerified: true,
      knowledgeAuthMode: knowledgeMode,
      scopeConfigured: Boolean(tenantId && workspaceId && organizationId),
      identitiesPrinted: false,
      secretsPrinted: false,
    }),
  );
} finally {
  await pool.end();
}

function validateCanonicalSheetSnapshot(values: readonly (readonly unknown[])[]): void {
  const header = (values[0] ?? []).map((value) => safeCell(value).trim().toLowerCase());
  const missingHeaders = REQUIRED_FAQ_HEADERS.filter((required) => !header.includes(required));
  if (missingHeaders.length > 0) {
    throw new Error(`INSTAGRAM_ENGAGEMENT_FAQ_SCHEMA_INVALID:${missingHeaders.join(',')}`);
  }

  const index = new Map(header.map((name, position) => [name, position] as const));
  const faqIdIndex = requiredColumn(index, 'faq_id');
  const body = values.slice(1).filter((row) => safeCell(row[faqIdIndex]).trim().length > 0);

  if (body.length !== INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE.length) {
    throw new Error('INSTAGRAM_ENGAGEMENT_KNOWLEDGE_SNAPSHOT_COUNT_INVALID');
  }

  const expectedById = new Map(
    INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE.map((row) => [row.faqId, row] as const),
  );
  const seen = new Set<string>();

  for (const row of body) {
    const faqId = sheetCell(row, index, 'faq_id');
    if (seen.has(faqId)) throw new Error('INSTAGRAM_ENGAGEMENT_KNOWLEDGE_DUPLICATE_FAQ_ID');
    seen.add(faqId);

    const expected = expectedById.get(faqId);
    if (!expected) throw new Error('INSTAGRAM_ENGAGEMENT_KNOWLEDGE_UNEXPECTED_FAQ_ID');

    if (sheetCell(row, index, 'pergunta_canonica') !== expected.canonicalQuestion) {
      throw new Error('INSTAGRAM_ENGAGEMENT_KNOWLEDGE_QUESTION_MISMATCH');
    }
    if (sheetCell(row, index, 'intent').toUpperCase() !== expected.intent) {
      throw new Error('INSTAGRAM_ENGAGEMENT_KNOWLEDGE_INTENT_MISMATCH');
    }
    if (sheetCell(row, index, 'autonomy_default').toUpperCase() !== expected.autonomy) {
      throw new Error('INSTAGRAM_ENGAGEMENT_KNOWLEDGE_AUTONOMY_MISMATCH');
    }
    if (sheetCell(row, index, 'resposta_oficial') !== expected.answer) {
      throw new Error('INSTAGRAM_ENGAGEMENT_KNOWLEDGE_ANSWER_MISMATCH');
    }
    if (sheetCell(row, index, 'fonte_resposta_toca_os') !== expected.source) {
      throw new Error('INSTAGRAM_ENGAGEMENT_KNOWLEDGE_SOURCE_MISMATCH');
    }
    if (sheetCell(row, index, 'status').toUpperCase() !== expected.status) {
      throw new Error('INSTAGRAM_ENGAGEMENT_KNOWLEDGE_STATUS_MISMATCH');
    }
    if (
      sheetCell(row, index, 'validade_operacional').toUpperCase() !== expected.operationalValidity
    ) {
      throw new Error('INSTAGRAM_ENGAGEMENT_KNOWLEDGE_VALIDITY_MISMATCH');
    }
  }

  if (seen.size !== expectedById.size) {
    throw new Error('INSTAGRAM_ENGAGEMENT_KNOWLEDGE_FAQ_SET_MISMATCH');
  }
}

function requiredColumn(index: ReadonlyMap<string, number>, key: string): number {
  const position = index.get(key);
  if (position === undefined) throw new Error(`INSTAGRAM_ENGAGEMENT_FAQ_SCHEMA_INVALID:${key}`);
  return position;
}

function sheetCell(
  row: readonly unknown[],
  index: ReadonlyMap<string, number>,
  key: string,
): string {
  const position = requiredColumn(index, key);
  return safeCell(row[position]).trim();
}

function requiredEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key}_REQUIRED`);
  return value;
}

function safeCell(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function isTrue(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}
