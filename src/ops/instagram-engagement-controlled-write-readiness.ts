import { Pool } from 'pg';

function fail(code: string): never {
  throw new Error(code);
}

function countValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return 0;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) fail('INSTAGRAM_ENGAGEMENT_CANARY_DATABASE_URL_REQUIRED');

  const mode = process.env.INSTAGRAM_ENGAGEMENT_CANARY_PROBE_MODE?.trim() || 'PRE';
  const startedAt = process.env.INSTAGRAM_ENGAGEMENT_CANARY_STARTED_AT?.trim() || null;
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });

  try {
    const deadLetter = await pool.query<{ count: number | string }>(
      `select count(*)::int as count
         from event_outbox
        where event_type in ('instagram.engagement.inbound.v1','instagram.engagement.reply.v1')
          and status = 'DEAD_LETTER'`,
    );
    const ambiguous = await pool.query<{ count: number | string }>(
      `select count(*)::int as count
         from instagram_engagement_actions
        where status = 'SEND_AMBIGUOUS'`,
    );

    const deadLetterCount = countValue(deadLetter.rows[0]?.count);
    const ambiguousCount = countValue(ambiguous.rows[0]?.count);

    if (deadLetterCount !== 0) fail('INSTAGRAM_ENGAGEMENT_CANARY_DEAD_LETTER_NOT_CLEAN');
    if (ambiguousCount !== 0) fail('INSTAGRAM_ENGAGEMENT_CANARY_AMBIGUOUS_NOT_CLEAN');

    if (mode === 'PRE') {
      console.log('INSTAGRAM_ENGAGEMENT_CONTROLLED_WRITE_BACKLOG=PASS');
      console.log(`DEAD_LETTER_COUNT=${deadLetterCount}`);
      console.log(`SEND_AMBIGUOUS_COUNT=${ambiguousCount}`);
      return;
    }

    if (mode !== 'POST' || !startedAt) fail('INSTAGRAM_ENGAGEMENT_CANARY_POST_INPUT_INVALID');

    const result = await pool.query<{
      sent_count: number | string;
      failed_count: number | string;
      ambiguous_count: number | string;
    }>(
      `select
         count(*) filter (where status = 'SENT')::int as sent_count,
         count(*) filter (where status = 'SEND_FAILED')::int as failed_count,
         count(*) filter (where status = 'SEND_AMBIGUOUS')::int as ambiguous_count
         from instagram_engagement_actions
        where updated_at >= $1::timestamptz`,
      [startedAt],
    );

    const row = result.rows[0];
    const sentCount = countValue(row?.sent_count);
    const failedCount = countValue(row?.failed_count);
    const postAmbiguousCount = countValue(row?.ambiguous_count);

    if (failedCount !== 0) fail('INSTAGRAM_ENGAGEMENT_CANARY_SEND_FAILED');
    if (postAmbiguousCount !== 0) fail('INSTAGRAM_ENGAGEMENT_CANARY_SEND_AMBIGUOUS');
    if (sentCount > 1) fail('INSTAGRAM_ENGAGEMENT_CANARY_REPLY_BUDGET_EXCEEDED');

    console.log('INSTAGRAM_ENGAGEMENT_CONTROLLED_WRITE_CANARY=PASS');
    console.log(`CANARY_SENT_COUNT=${sentCount}`);
    console.log(`CANARY_FAILED_COUNT=${failedCount}`);
    console.log(`CANARY_AMBIGUOUS_COUNT=${postAmbiguousCount}`);
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'INSTAGRAM_ENGAGEMENT_CANARY_UNKNOWN_FAILURE';
  console.error(message);
  process.exitCode = 1;
});
