import { createHash } from 'node:crypto';
import { loadConfig } from '../config.js';
import {
  INSTAGRAM_ENGAGEMENT_CANONICAL_SPREADSHEET_ID,
  INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE,
} from '../instagram-engagement/knowledge-snapshot-current.js';
import { createPostgresPool } from '../persistence/postgres.js';

const EXPECTED_FAQ_COUNT = 36;
const MIGRATION = '043_instagram_engagement_knowledge_source_kinds.sql';
const EXPECTED_KB_SOURCE_IDS = [
  'SRC-OPS-001',
  'SRC-MENU-002',
  'SRC-LOC-001',
  'SRC-BRAND-001',
  'SRC-PROD-001',
] as const;
const EXPECTED_FAQ_SNAPSHOT_SHA256 = createHash('sha256')
  .update(JSON.stringify(INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE), 'utf8')
  .digest('hex');

const config = loadConfig();
if (!config.DATABASE_URL) throw new Error('INSTAGRAM_ENGAGEMENT_DATABASE_URL_REQUIRED');

const pool = createPostgresPool({ connectionString: config.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query('begin read only');

  const migration = await client.query<{ present: boolean }>(
    `select exists(select 1 from schema_migrations where version = $1) as present`,
    [MIGRATION],
  );
  if (!migration.rows[0]?.present) {
    throw new Error('INSTAGRAM_FAQ_EXPANSION_MIGRATION_043_NOT_APPLIED');
  }

  const faq = await client.query<{
    count: string;
    hashes: number;
    snapshot_sha256: string | null;
  }>(
    `select
       count(*)::text as count,
       count(distinct source_snapshot_sha256)::int as hashes,
       min(source_snapshot_sha256) as snapshot_sha256
       from instagram_engagement_knowledge
      where active = true and source_spreadsheet_id = $1`,
    [INSTAGRAM_ENGAGEMENT_CANONICAL_SPREADSHEET_ID],
  );
  const faqCount = Number(faq.rows[0]?.count ?? 0);
  const faqHashCount = faq.rows[0]?.hashes ?? 0;
  const faqSnapshotSha256 = faq.rows[0]?.snapshot_sha256 ?? '';
  if (faqCount !== EXPECTED_FAQ_COUNT) {
    throw new Error('INSTAGRAM_FAQ_EXPANSION_ACTIVE_COUNT_MISMATCH');
  }
  if (faqHashCount !== 1 || !/^[0-9a-f]{64}$/.test(faqSnapshotSha256)) {
    throw new Error('INSTAGRAM_FAQ_EXPANSION_SNAPSHOT_HASH_INVALID');
  }
  if (faqSnapshotSha256 !== EXPECTED_FAQ_SNAPSHOT_SHA256) {
    throw new Error('INSTAGRAM_FAQ_EXPANSION_CANONICAL_SNAPSHOT_HASH_MISMATCH');
  }

  const knowledgeBase = await client.query<{ sources: string; chunks: string }>(
    `select
       count(distinct d.source_id)::text as sources,
       count(c.chunk_id)::text as chunks
       from instagram_engagement_knowledge_documents d
       join instagram_engagement_knowledge_chunks c on c.document_id = d.document_id
      where d.active = true
        and c.active = true
        and d.source_id = any($1::text[])`,
    [[...EXPECTED_KB_SOURCE_IDS]],
  );
  const kbSourceCount = Number(knowledgeBase.rows[0]?.sources ?? 0);
  const kbChunkCount = Number(knowledgeBase.rows[0]?.chunks ?? 0);
  if (kbSourceCount !== EXPECTED_KB_SOURCE_IDS.length) {
    throw new Error('INSTAGRAM_FAQ_EXPANSION_KB_SOURCE_COUNT_MISMATCH');
  }
  if (kbChunkCount < EXPECTED_KB_SOURCE_IDS.length) {
    throw new Error('INSTAGRAM_FAQ_EXPANSION_KB_CHUNK_COUNT_INVALID');
  }

  await client.query('commit');
  console.log(
    JSON.stringify({
      validation: 'instagram-faq-expansion-production',
      status: 'PASS',
      migration043Applied: true,
      faqCount,
      faqSnapshotSha256,
      canonicalSnapshotHashMatched: true,
      kbSourceCount,
      kbChunkCount,
      rawAnswerContentPrinted: false,
      rawSourceContentPrinted: false,
      providerWriteAttempted: false,
    }),
  );
} catch (error) {
  await client.query('rollback');
  throw error;
} finally {
  client.release();
  await pool.end();
}
