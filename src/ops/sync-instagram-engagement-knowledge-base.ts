import { loadConfig } from '../config.js';
import { EnvSecretResolver, type SecretReference, type SecretResolver } from '../core/secrets.js';
import { INSTAGRAM_ENGAGEMENT_CANONICAL_SPREADSHEET_ID } from '../instagram-engagement/knowledge-snapshot-current.js';
import {
  buildKnowledgeBaseChunks,
  knowledgeChunkId,
  knowledgeDocumentId,
  knowledgeDocumentSha256,
  parseCanonicalKnowledgeSourceRegistry,
} from '../instagram-engagement/knowledge-base-ingest.js';
import { normalizeKnowledgePrompt } from '../instagram-engagement/knowledge.js';
import { createPostgresPool } from '../persistence/postgres.js';
import {
  GOOGLE_SHEETS_READONLY_SCOPE,
  GOOGLE_WORKSPACE_SCOPED_TOKEN_PROVIDER,
  GcpGoogleWorkspaceTokenResolver,
} from '../providers/gcp/google-workspace-token-resolver.js';
import { GoogleDriveReadOnlyTextClient } from '../providers/google-drive/read-only-text-client.js';
import { GoogleSheetsRestClient } from '../providers/google-sheets/client.js';

const GOOGLE_DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const DEFAULT_SOURCE_IDS = ['SRC-OPS-001', 'SRC-MENU-002', 'SRC-LOC-001'] as const;
const MIGRATION = '037_instagram_engagement_tiered_knowledge.sql';

const config = loadConfig();
if (!config.DATABASE_URL) throw new Error('INSTAGRAM_ENGAGEMENT_DATABASE_URL_REQUIRED');

const spreadsheetId =
  process.env.INSTAGRAM_ENGAGEMENT_KNOWLEDGE_SPREADSHEET_ID?.trim() ||
  INSTAGRAM_ENGAGEMENT_CANONICAL_SPREADSHEET_ID;
if (spreadsheetId !== INSTAGRAM_ENGAGEMENT_CANONICAL_SPREADSHEET_ID) {
  throw new Error('INSTAGRAM_ENGAGEMENT_KNOWLEDGE_SPREADSHEET_MISMATCH');
}

const sourceIds = new Set(
  (process.env.INSTAGRAM_ENGAGEMENT_KB_SOURCE_IDS?.trim() || DEFAULT_SOURCE_IDS.join(','))
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);
if (sourceIds.size === 0) throw new Error('INSTAGRAM_ENGAGEMENT_KB_SOURCE_IDS_REQUIRED');

const auth = createKnowledgeSyncAuth(process.env, fetch);
const sheets = new GoogleSheetsRestClient(auth.resolver, { tokenReference: auth.tokenReference });
const drive = new GoogleDriveReadOnlyTextClient(auth.resolver, auth.tokenReference, fetch);
const registryValues = await sheets.readRange(spreadsheetId, 'FONTES_CANONICAS!A:H');
const registry = parseCanonicalKnowledgeSourceRegistry(registryValues).filter((source) =>
  sourceIds.has(source.sourceId),
);
if (registry.length !== sourceIds.size) {
  throw new Error('INSTAGRAM_ENGAGEMENT_KB_SOURCE_SET_MISMATCH');
}

const documents = [];
for (const source of registry) {
  const exported = await drive.readText(source.driveId);
  const sha256 = knowledgeDocumentSha256(exported.text);
  const chunks = buildKnowledgeBaseChunks(source, exported.text);
  if (chunks.length === 0) throw new Error(`INSTAGRAM_ENGAGEMENT_KB_NO_CHUNKS:${source.sourceId}`);
  documents.push({ source, exported, sha256, chunks });
}

const pool = createPostgresPool({ connectionString: config.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query('begin');
  const migration = await client.query<{ present: boolean }>(
    `select exists(select 1 from schema_migrations where version = $1) as present`,
    [MIGRATION],
  );
  if (!migration.rows[0]?.present) throw new Error('INSTAGRAM_ENGAGEMENT_KB_MIGRATION_NOT_APPLIED');

  for (const document of documents) {
    const documentId = knowledgeDocumentId(document.source.sourceId);
    await client.query(
      `update instagram_engagement_knowledge_chunks
          set active = false, synced_at = now()
        where document_id = $1`,
      [documentId],
    );
    await client.query(
      `insert into instagram_engagement_knowledge_documents (
         document_id, source_id, title, drive_id, scope, precedence, source_kind,
         source_status, source_sha256, source_modified_at, active, synced_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz,true,now())
       on conflict (document_id) do update set
         source_id = excluded.source_id,
         title = excluded.title,
         drive_id = excluded.drive_id,
         scope = excluded.scope,
         precedence = excluded.precedence,
         source_kind = excluded.source_kind,
         source_status = excluded.source_status,
         source_sha256 = excluded.source_sha256,
         source_modified_at = excluded.source_modified_at,
         active = true,
         synced_at = now()`,
      [
        documentId,
        document.source.sourceId,
        document.source.title,
        document.source.driveId,
        document.source.scope,
        document.source.precedence,
        document.source.kind,
        document.source.status,
        document.sha256,
        document.exported.modifiedTime ?? null,
      ],
    );

    for (const [sequence, chunk] of document.chunks.entries()) {
      const chunkId = knowledgeChunkId(document.source.sourceId, chunk.stableKey);
      const searchText = normalizeKnowledgePrompt(
        `${chunk.heading} ${chunk.searchText} ${chunk.content}`,
      );
      await client.query(
        `insert into instagram_engagement_knowledge_chunks (
           chunk_id, document_id, sequence, heading, content, search_text, intent_hints,
           risk, autonomy, source_reference, source_sha256, active, synced_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,now())
         on conflict (chunk_id) do update set
           document_id = excluded.document_id,
           sequence = excluded.sequence,
           heading = excluded.heading,
           content = excluded.content,
           search_text = excluded.search_text,
           intent_hints = excluded.intent_hints,
           risk = excluded.risk,
           autonomy = excluded.autonomy,
           source_reference = excluded.source_reference,
           source_sha256 = excluded.source_sha256,
           active = true,
           synced_at = now()`,
        [
          chunkId,
          documentId,
          sequence,
          chunk.heading,
          chunk.content,
          searchText,
          [...chunk.intentHints],
          chunk.risk,
          chunk.autonomy,
          chunk.sourceReference,
          document.sha256,
        ],
      );
    }
  }

  const verified = await client.query<{ documents: string; chunks: string; auto_reply: string }>(
    `select
       count(distinct d.document_id)::text as documents,
       count(c.chunk_id)::text as chunks,
       count(c.chunk_id) filter (where c.autonomy = 'AUTO_REPLY_ALLOWED' and c.risk = 'LOW')::text as auto_reply
       from instagram_engagement_knowledge_documents d
       join instagram_engagement_knowledge_chunks c on c.document_id = d.document_id
      where d.active = true and c.active = true and d.source_id = any($1::text[])`,
    [[...sourceIds]],
  );
  const row = verified.rows[0];
  if (Number(row?.documents ?? 0) !== sourceIds.size) {
    throw new Error('INSTAGRAM_ENGAGEMENT_KB_SYNC_DOCUMENT_COUNT_MISMATCH');
  }
  if (Number(row?.chunks ?? 0) < sourceIds.size) {
    throw new Error('INSTAGRAM_ENGAGEMENT_KB_SYNC_CHUNK_COUNT_INVALID');
  }
  if (Number(row?.auto_reply ?? 0) < 1) {
    throw new Error('INSTAGRAM_ENGAGEMENT_KB_SYNC_AUTO_REPLY_EMPTY');
  }
  await client.query('commit');

  console.log(
    JSON.stringify({
      validation: 'instagram-engagement-knowledge-base-sync',
      status: 'PASS',
      canonicalSpreadsheetMatched: true,
      sourceCount: sourceIds.size,
      documentCount: Number(row?.documents ?? 0),
      chunkCount: Number(row?.chunks ?? 0),
      autoReplyChunkCount: Number(row?.auto_reply ?? 0),
      rawPrivateMessagesUsed: false,
      sourceContentPrinted: false,
      authMode: auth.mode,
    }),
  );
} catch (error) {
  await client.query('rollback');
  throw error;
} finally {
  client.release();
  await pool.end();
}

function createKnowledgeSyncAuth(
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
): {
  readonly resolver: SecretResolver;
  readonly tokenReference: SecretReference;
  readonly mode: 'env' | 'gcp-iam';
} {
  const mode = env.INSTAGRAM_ENGAGEMENT_GOOGLE_SHEETS_AUTH_MODE?.trim().toLowerCase() || 'env';
  if (mode === 'env') {
    const key = requiredEnv(env, 'INSTAGRAM_ENGAGEMENT_GOOGLE_SHEETS_TOKEN_ENV_KEY');
    return {
      resolver: new EnvSecretResolver(env, 'env'),
      tokenReference: { provider: 'env', key },
      mode: 'env',
    };
  }
  if (mode === 'gcp-iam') {
    const serviceAccountEmail = requiredEnv(
      env,
      'INSTAGRAM_ENGAGEMENT_GOOGLE_SERVICE_ACCOUNT_EMAIL',
    );
    return {
      resolver: new GcpGoogleWorkspaceTokenResolver({
        serviceAccountEmail,
        scopes: [GOOGLE_SHEETS_READONLY_SCOPE, GOOGLE_DRIVE_READONLY_SCOPE],
        fetchImpl,
      }),
      tokenReference: { provider: GOOGLE_WORKSPACE_SCOPED_TOKEN_PROVIDER, key: 'kb-sync-readonly' },
      mode: 'gcp-iam',
    };
  }
  throw new Error('INSTAGRAM_ENGAGEMENT_KB_AUTH_MODE_INVALID');
}

function requiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key}_REQUIRED`);
  return value;
}
