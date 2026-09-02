import { loadConfig } from '../config.js';
import { createPostgresPool } from '../persistence/postgres.js';

const REQUIRED_MIGRATION = '037_instagram_engagement_tiered_knowledge.sql';
const REQUIRED_TABLES = [
  'instagram_engagement_knowledge_documents',
  'instagram_engagement_knowledge_chunks',
  'instagram_engagement_actions',
] as const;

interface QueryResultLike<Row = Record<string, unknown>> {
  readonly rows: readonly Row[];
}

interface ReadOnlyDbClient {
  query<Row = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<QueryResultLike<Row>>;
}

export interface InstagramKnowledgeDbPreflightResult {
  readonly validation: 'instagram-engagement-knowledge-db-readonly-preflight';
  readonly status: 'PASS';
  readonly migrationPresent: true;
  readonly requiredTableCount: number;
  readonly selectPrivilegeVerified: true;
  readonly schemaVerified: true;
  readonly documentCount: number;
  readonly chunkCount: number;
  readonly activeDocumentCount: number;
  readonly activeChunkCount: number;
  readonly transactionReadOnly: true;
  readonly databaseMutationsUsed: false;
  readonly providerWritesUsed: false;
  readonly externalReplyWritesUsed: false;
  readonly contentPrinted: false;
}

export async function runInstagramKnowledgeDbReadOnlyPreflight(
  client: ReadOnlyDbClient,
): Promise<InstagramKnowledgeDbPreflightResult> {
  await client.query('begin transaction read only');
  try {
    const readonly = await client.query<{ transaction_read_only: string }>(
      'show transaction_read_only',
    );
    if (readonly.rows[0]?.transaction_read_only !== 'on') {
      throw new Error('INSTAGRAM_ENGAGEMENT_KB_DB_TRANSACTION_NOT_READ_ONLY');
    }

    const migration = await client.query<{ present: boolean }>(
      'select exists(select 1 from schema_migrations where version = $1) as present',
      [REQUIRED_MIGRATION],
    );
    if (!migration.rows[0]?.present) {
      throw new Error('INSTAGRAM_ENGAGEMENT_KB_MIGRATION_NOT_APPLIED');
    }

    const tableRows = await client.query<{ table_name: string }>(
      `select table_name
         from information_schema.tables
        where table_schema = current_schema()
          and table_name = any($1::text[])`,
      [[...REQUIRED_TABLES]],
    );
    const presentTables = new Set(tableRows.rows.map((row) => row.table_name));
    for (const table of REQUIRED_TABLES) {
      if (!presentTables.has(table)) {
        throw new Error(`INSTAGRAM_ENGAGEMENT_KB_DB_TABLE_MISSING:${table}`);
      }
    }

    const privileges = await client.query<{ table_name: string; can_select: boolean }>(
      `select table_name,
              has_table_privilege(current_user, quote_ident(current_schema()) || '.' || quote_ident(table_name), 'SELECT') as can_select
         from information_schema.tables
        where table_schema = current_schema()
          and table_name = any($1::text[])`,
      [[...REQUIRED_TABLES]],
    );
    if (
      privileges.rows.length !== REQUIRED_TABLES.length ||
      privileges.rows.some((row) => row.can_select !== true)
    ) {
      throw new Error('INSTAGRAM_ENGAGEMENT_KB_DB_SELECT_PRIVILEGE_MISSING');
    }

    const columns = await client.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name
         from information_schema.columns
        where table_schema = current_schema()
          and (
            (table_name = 'instagram_engagement_knowledge_documents' and column_name in ('document_id','source_id','source_sha256','active','synced_at'))
            or
            (table_name = 'instagram_engagement_knowledge_chunks' and column_name in ('chunk_id','document_id','search_vector','risk','autonomy','active','synced_at'))
            or
            (table_name = 'instagram_engagement_actions' and column_name in ('knowledge_tier','knowledge_chunk_id'))
          )`,
    );
    const requiredColumns = new Set([
      'instagram_engagement_knowledge_documents.document_id',
      'instagram_engagement_knowledge_documents.source_id',
      'instagram_engagement_knowledge_documents.source_sha256',
      'instagram_engagement_knowledge_documents.active',
      'instagram_engagement_knowledge_documents.synced_at',
      'instagram_engagement_knowledge_chunks.chunk_id',
      'instagram_engagement_knowledge_chunks.document_id',
      'instagram_engagement_knowledge_chunks.search_vector',
      'instagram_engagement_knowledge_chunks.risk',
      'instagram_engagement_knowledge_chunks.autonomy',
      'instagram_engagement_knowledge_chunks.active',
      'instagram_engagement_knowledge_chunks.synced_at',
      'instagram_engagement_actions.knowledge_tier',
      'instagram_engagement_actions.knowledge_chunk_id',
    ]);
    const presentColumns = new Set(
      columns.rows.map((row) => `${row.table_name}.${row.column_name}`),
    );
    for (const column of requiredColumns) {
      if (!presentColumns.has(column)) {
        throw new Error(`INSTAGRAM_ENGAGEMENT_KB_DB_COLUMN_MISSING:${column}`);
      }
    }

    const counts = await client.query<{
      documents: string;
      chunks: string;
      active_documents: string;
      active_chunks: string;
    }>(
      `select
         (select count(*)::text from instagram_engagement_knowledge_documents) as documents,
         (select count(*)::text from instagram_engagement_knowledge_chunks) as chunks,
         (select count(*)::text from instagram_engagement_knowledge_documents where active = true) as active_documents,
         (select count(*)::text from instagram_engagement_knowledge_chunks where active = true) as active_chunks`,
    );
    const row = counts.rows[0];
    if (!row) throw new Error('INSTAGRAM_ENGAGEMENT_KB_DB_COUNT_QUERY_EMPTY');

    return {
      validation: 'instagram-engagement-knowledge-db-readonly-preflight',
      status: 'PASS',
      migrationPresent: true,
      requiredTableCount: REQUIRED_TABLES.length,
      selectPrivilegeVerified: true,
      schemaVerified: true,
      documentCount: Number(row.documents),
      chunkCount: Number(row.chunks),
      activeDocumentCount: Number(row.active_documents),
      activeChunkCount: Number(row.active_chunks),
      transactionReadOnly: true,
      databaseMutationsUsed: false,
      providerWritesUsed: false,
      externalReplyWritesUsed: false,
      contentPrinted: false,
    };
  } finally {
    await client.query('rollback');
  }
}

export function sanitizeInstagramKnowledgeDbPreflightError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const known = raw.match(
    /(INSTAGRAM_ENGAGEMENT_KB_[A-Z0-9_]+(?::[A-Za-z0-9._-]+)?)/,
  )?.[1];
  if (known) return known;
  if (/password authentication failed/i.test(raw)) return 'DATABASE_AUTHENTICATION_FAILED';
  if (/permission denied/i.test(raw)) return 'DATABASE_PERMISSION_DENIED';
  if (/connect|connection|timeout|ECONNREFUSED|ENOTFOUND/i.test(raw)) {
    return 'DATABASE_CONNECTION_FAILED';
  }
  return 'INSTAGRAM_ENGAGEMENT_KB_DB_PREFLIGHT_UNCLASSIFIED_FAILURE';
}

if (process.argv[1]?.endsWith('preflight-instagram-engagement-knowledge-db.js')) {
  const config = loadConfig();
  if (!config.DATABASE_URL) throw new Error('INSTAGRAM_ENGAGEMENT_DATABASE_URL_REQUIRED');
  const pool = createPostgresPool({ connectionString: config.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    const result = await runInstagramKnowledgeDbReadOnlyPreflight(client);
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(
      JSON.stringify({
        validation: 'instagram-engagement-knowledge-db-readonly-preflight',
        status: 'FAIL',
        safeErrorCode: sanitizeInstagramKnowledgeDbPreflightError(error),
        databaseMutationsUsed: false,
        providerWritesUsed: false,
        externalReplyWritesUsed: false,
        contentPrinted: false,
      }),
    );
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}
