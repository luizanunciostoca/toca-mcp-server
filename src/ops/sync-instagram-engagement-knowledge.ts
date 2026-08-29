import { createHash } from 'node:crypto';
import { loadConfig } from '../config.js';
import {
  INSTAGRAM_ENGAGEMENT_CANONICAL_SPREADSHEET_ID,
  INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE,
} from '../instagram-engagement/knowledge-snapshot-current.js';
import { createPostgresPool } from '../persistence/postgres.js';

const config = loadConfig();
if (!config.DATABASE_URL) throw new Error('INSTAGRAM_ENGAGEMENT_DATABASE_URL_REQUIRED');

const expectedSpreadsheetId =
  process.env.INSTAGRAM_ENGAGEMENT_KNOWLEDGE_SPREADSHEET_ID?.trim() ||
  INSTAGRAM_ENGAGEMENT_CANONICAL_SPREADSHEET_ID;
if (expectedSpreadsheetId !== INSTAGRAM_ENGAGEMENT_CANONICAL_SPREADSHEET_ID) {
  throw new Error('INSTAGRAM_ENGAGEMENT_KNOWLEDGE_SPREADSHEET_MISMATCH');
}

const snapshotSha256 = createHash('sha256')
  .update(JSON.stringify(INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE), 'utf8')
  .digest('hex');
const pool = createPostgresPool({ connectionString: config.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query('begin');
  const migration = await client.query<{ present: boolean }>(
    `select exists(select 1 from schema_migrations where version = '036_instagram_engagement_knowledge.sql') as present`,
  );
  if (!migration.rows[0]?.present)
    throw new Error('INSTAGRAM_ENGAGEMENT_KNOWLEDGE_MIGRATION_NOT_APPLIED');

  await client.query(
    `update instagram_engagement_knowledge
        set active = false, synced_at = now()
      where source_spreadsheet_id = $1`,
    [INSTAGRAM_ENGAGEMENT_CANONICAL_SPREADSHEET_ID],
  );

  for (const row of INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE) {
    await client.query(
      `insert into instagram_engagement_knowledge (
         faq_id, canonical_question, variants, intent, risk, autonomy, answer, source,
         facts_to_validate, source_updated_on, status, operational_validity,
         source_spreadsheet_id, source_snapshot_sha256, active, synced_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::date,$11,$12,$13,$14,true,now())
       on conflict (faq_id) do update set
         canonical_question = excluded.canonical_question,
         variants = excluded.variants,
         intent = excluded.intent,
         risk = excluded.risk,
         autonomy = excluded.autonomy,
         answer = excluded.answer,
         source = excluded.source,
         facts_to_validate = excluded.facts_to_validate,
         source_updated_on = excluded.source_updated_on,
         status = excluded.status,
         operational_validity = excluded.operational_validity,
         source_spreadsheet_id = excluded.source_spreadsheet_id,
         source_snapshot_sha256 = excluded.source_snapshot_sha256,
         active = true,
         synced_at = now()`,
      [
        row.faqId,
        row.canonicalQuestion,
        [...row.variants],
        row.intent,
        row.risk,
        row.autonomy,
        row.answer,
        row.source,
        row.factsToValidate,
        row.sourceUpdatedOn,
        row.status,
        row.operationalValidity,
        INSTAGRAM_ENGAGEMENT_CANONICAL_SPREADSHEET_ID,
        snapshotSha256,
      ],
    );
  }

  const verified = await client.query<{ count: string; hashes: number }>(
    `select count(*)::text as count, count(distinct source_snapshot_sha256)::int as hashes
       from instagram_engagement_knowledge
      where active = true and source_spreadsheet_id = $1 and source_snapshot_sha256 = $2`,
    [INSTAGRAM_ENGAGEMENT_CANONICAL_SPREADSHEET_ID, snapshotSha256],
  );
  if (Number(verified.rows[0]?.count ?? 0) !== INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE.length) {
    throw new Error('INSTAGRAM_ENGAGEMENT_KNOWLEDGE_SYNC_COUNT_MISMATCH');
  }
  if (verified.rows[0]?.hashes !== 1)
    throw new Error('INSTAGRAM_ENGAGEMENT_KNOWLEDGE_SYNC_HASH_MISMATCH');
  await client.query('commit');

  console.log(
    JSON.stringify({
      validation: 'instagram-engagement-knowledge-sync',
      status: 'PASS',
      rowCount: INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE.length,
      snapshotSha256,
      canonicalSpreadsheetMatched: true,
      historical2025Used: false,
      rawPrivateMessagesUsed: false,
    }),
  );
} catch (error) {
  await client.query('rollback');
  throw error;
} finally {
  client.release();
  await pool.end();
}
