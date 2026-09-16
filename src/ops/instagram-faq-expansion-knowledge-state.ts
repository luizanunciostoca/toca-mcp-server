import { loadConfig } from '../config.js';
import { INSTAGRAM_ENGAGEMENT_CANONICAL_SPREADSHEET_ID } from '../instagram-engagement/knowledge-snapshot-current.js';
import { createPostgresPool } from '../persistence/postgres.js';

const SOURCE_IDS = [
  'SRC-OPS-001',
  'SRC-MENU-002',
  'SRC-LOC-001',
  'SRC-BRAND-001',
  'SRC-PROD-001',
] as const;

const action = requiredEnv('INSTAGRAM_FAQ_EXPANSION_STATE_ACTION');
const backupKey = requiredEnv('INSTAGRAM_FAQ_EXPANSION_BACKUP_KEY');
if (!/^[0-9]+_[0-9]+$/.test(backupKey)) {
  throw new Error('INSTAGRAM_FAQ_EXPANSION_BACKUP_KEY_INVALID');
}
if (!['BACKUP', 'RESTORE', 'CLEANUP', 'INSPECT'].includes(action)) {
  throw new Error('INSTAGRAM_FAQ_EXPANSION_STATE_ACTION_INVALID');
}

const config = loadConfig();
if (!config.DATABASE_URL) throw new Error('INSTAGRAM_ENGAGEMENT_DATABASE_URL_REQUIRED');

const tables = {
  faq: `igfaq_b_f_${backupKey}`,
  documents: `igfaq_b_d_${backupKey}`,
  chunks: `igfaq_b_c_${backupKey}`,
} as const;
for (const table of Object.values(tables)) {
  if (!/^[a-z0-9_]+$/.test(table) || table.length > 63) {
    throw new Error('INSTAGRAM_FAQ_EXPANSION_BACKUP_TABLE_INVALID');
  }
}

const pool = createPostgresPool({ connectionString: config.DATABASE_URL });
const client = await pool.connect();
try {
  if (action === 'INSPECT') {
    const present = await backupTablesPresent();
    const active = await activeScopedCounts();
    const backup = present
      ? await backupCounts()
      : { faq: 0, documents: 0, chunks: 0 };
    printInspection(present, backup, active);
  } else if (action === 'BACKUP') {
    await client.query('begin');
    await assertNoBackupTables();
    await client.query(
      `create table ${tables.faq} as
       select * from instagram_engagement_knowledge
       where source_spreadsheet_id = $1`,
      [INSTAGRAM_ENGAGEMENT_CANONICAL_SPREADSHEET_ID],
    );
    await client.query(
      `create table ${tables.documents} as
       select * from instagram_engagement_knowledge_documents
       where source_id = any($1::text[])`,
      [[...SOURCE_IDS]],
    );
    await client.query(
      `create table ${tables.chunks} as
       select * from instagram_engagement_knowledge_chunks c
       where c.document_id in (
         select document_id from instagram_engagement_knowledge_documents
         where source_id = any($1::text[])
       )`,
      [[...SOURCE_IDS]],
    );
    const counts = await backupCounts();
    await client.query('commit');
    printResult('BACKUP', 'PASS', counts, true);
  } else if (action === 'RESTORE') {
    const present = await backupTablesPresent();
    if (!present) {
      printResult('RESTORE', 'NO_BACKUP', { faq: 0, documents: 0, chunks: 0 }, false);
    } else {
      await client.query('begin');
      const expected = await backupCounts();
      await client.query(
        `delete from instagram_engagement_knowledge_chunks
         where document_id in (
           select document_id from instagram_engagement_knowledge_documents
           where source_id = any($1::text[])
         )`,
        [[...SOURCE_IDS]],
      );
      await client.query(
        `delete from instagram_engagement_knowledge_documents
         where source_id = any($1::text[])`,
        [[...SOURCE_IDS]],
      );
      await client.query(
        `delete from instagram_engagement_knowledge
         where source_spreadsheet_id = $1`,
        [INSTAGRAM_ENGAGEMENT_CANONICAL_SPREADSHEET_ID],
      );
      await client.query(`insert into instagram_engagement_knowledge select * from ${tables.faq}`);
      await client.query(
        `insert into instagram_engagement_knowledge_documents select * from ${tables.documents}`,
      );
      await client.query(
        `insert into instagram_engagement_knowledge_chunks (
           chunk_id,
           document_id,
           sequence,
           heading,
           content,
           search_text,
           intent_hints,
           risk,
           autonomy,
           source_reference,
           source_sha256,
           active,
           synced_at
         )
         select
           chunk_id,
           document_id,
           sequence,
           heading,
           content,
           search_text,
           intent_hints,
           risk,
           autonomy,
           source_reference,
           source_sha256,
           active,
           synced_at
         from ${tables.chunks}`,
      );
      const restored = await activeScopedCounts();
      if (
        restored.faq !== expected.faq ||
        restored.documents !== expected.documents ||
        restored.chunks !== expected.chunks
      ) {
        throw new Error('INSTAGRAM_FAQ_EXPANSION_RESTORE_COUNT_MISMATCH');
      }
      await dropBackupTables();
      await client.query('commit');
      printResult('RESTORE', 'PASS', restored, true);
    }
  } else {
    await client.query('begin');
    await dropBackupTables();
    await client.query('commit');
    printResult('CLEANUP', 'PASS', { faq: 0, documents: 0, chunks: 0 }, false);
  }
} catch (error) {
  try {
    await client.query('rollback');
  } catch {
    // Preserve the original failure.
  }
  throw error;
} finally {
  client.release();
  await pool.end();
}

async function assertNoBackupTables(): Promise<void> {
  if (await backupTablesPresent()) {
    throw new Error('INSTAGRAM_FAQ_EXPANSION_BACKUP_ALREADY_EXISTS');
  }
}

async function backupTablesPresent(): Promise<boolean> {
  const result = await client.query<{ present: boolean }>(
    `select
       to_regclass($1) is not null and
       to_regclass($2) is not null and
       to_regclass($3) is not null as present`,
    [tables.faq, tables.documents, tables.chunks],
  );
  return result.rows[0]?.present === true;
}

async function backupCounts(): Promise<{ faq: number; documents: number; chunks: number }> {
  const result = await client.query<{ faq: string; documents: string; chunks: string }>(
    `select
       (select count(*)::text from ${tables.faq}) as faq,
       (select count(*)::text from ${tables.documents}) as documents,
       (select count(*)::text from ${tables.chunks}) as chunks`,
  );
  return {
    faq: Number(result.rows[0]?.faq ?? 0),
    documents: Number(result.rows[0]?.documents ?? 0),
    chunks: Number(result.rows[0]?.chunks ?? 0),
  };
}

async function activeScopedCounts(): Promise<{
  faq: number;
  documents: number;
  chunks: number;
}> {
  const result = await client.query<{ faq: string; documents: string; chunks: string }>(
    `select
       (select count(*)::text
          from instagram_engagement_knowledge
         where source_spreadsheet_id = $1) as faq,
       (select count(*)::text
          from instagram_engagement_knowledge_documents
         where source_id = any($2::text[])) as documents,
       (select count(*)::text
          from instagram_engagement_knowledge_chunks c
          join instagram_engagement_knowledge_documents d on d.document_id = c.document_id
         where d.source_id = any($2::text[])) as chunks`,
    [INSTAGRAM_ENGAGEMENT_CANONICAL_SPREADSHEET_ID, [...SOURCE_IDS]],
  );
  return {
    faq: Number(result.rows[0]?.faq ?? 0),
    documents: Number(result.rows[0]?.documents ?? 0),
    chunks: Number(result.rows[0]?.chunks ?? 0),
  };
}

async function dropBackupTables(): Promise<void> {
  await client.query(`drop table if exists ${tables.chunks}`);
  await client.query(`drop table if exists ${tables.documents}`);
  await client.query(`drop table if exists ${tables.faq}`);
}

function printResult(
  operation: string,
  status: string,
  counts: { faq: number; documents: number; chunks: number },
  backupPresent: boolean,
): void {
  console.log(
    JSON.stringify({
      validation: 'instagram-faq-expansion-knowledge-state',
      operation,
      status,
      faqCount: counts.faq,
      documentCount: counts.documents,
      chunkCount: counts.chunks,
      backupPresent,
      rawAnswerContentPrinted: false,
      rawSourceContentPrinted: false,
      providerWriteAttempted: false,
    }),
  );
}

function printInspection(
  backupPresent: boolean,
  backup: { faq: number; documents: number; chunks: number },
  active: { faq: number; documents: number; chunks: number },
): void {
  console.log(
    JSON.stringify({
      validation: 'instagram-faq-expansion-knowledge-state',
      operation: 'INSPECT',
      status: 'PASS',
      backupPresent,
      backupFaqCount: backup.faq,
      backupDocumentCount: backup.documents,
      backupChunkCount: backup.chunks,
      activeFaqCount: active.faq,
      activeDocumentCount: active.documents,
      activeChunkCount: active.chunks,
      rawAnswerContentPrinted: false,
      rawSourceContentPrinted: false,
      providerWriteAttempted: false,
    }),
  );
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}
