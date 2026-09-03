import pg from 'pg';

const { Pool } = pg;
const databaseUrl = requiredEnv('DATABASE_URL');
const tenantId = requiredEnv('INSTAGRAM_ENGAGEMENT_TENANT_ID');
const workspaceId = requiredEnv('INSTAGRAM_ENGAGEMENT_WORKSPACE_ID');
const organizationId = requiredEnv('INSTAGRAM_ENGAGEMENT_ORGANIZATION_ID');
const pool = new Pool({ connectionString: databaseUrl, max: 2 });

try {
  const replyQueue = await pool.query<{ count: number }>(
    `select count(*)::int as count
       from event_outbox
      where tenant_id = $1
        and workspace_id = $2
        and organization_id = $3
        and event_type = 'instagram.engagement.reply.v1'
        and status in ('PENDING', 'CLAIMED', 'FAILED_RETRYABLE')`,
    [tenantId, workspaceId, organizationId],
  );
  const replyDeadLetter = await pool.query<{ count: number }>(
    `select count(*)::int as count
       from event_outbox
      where tenant_id = $1
        and workspace_id = $2
        and organization_id = $3
        and event_type = 'instagram.engagement.reply.v1'
        and status = 'DEAD_LETTER'`,
    [tenantId, workspaceId, organizationId],
  );
  const ambiguous = await pool.query<{ count: number }>(
    `select count(*)::int as count
       from instagram_engagement_actions
      where tenant_id = $1
        and workspace_id = $2
        and organization_id = $3
        and status = 'SEND_AMBIGUOUS'`,
    [tenantId, workspaceId, organizationId],
  );

  const activeReplies = replyQueue.rows[0]?.count ?? 0;
  const deadLetters = replyDeadLetter.rows[0]?.count ?? 0;
  const ambiguousCount = ambiguous.rows[0]?.count ?? 0;

  if (activeReplies !== 0) throw new Error('LIMITED_ACTIVATION_ACTIVE_REPLY_QUEUE_NOT_EMPTY');
  if (deadLetters !== 0) throw new Error('LIMITED_ACTIVATION_REPLY_DEAD_LETTER_PRESENT');
  if (ambiguousCount !== 0) throw new Error('LIMITED_ACTIVATION_AMBIGUOUS_OUTCOME_PRESENT');

  console.log('INSTAGRAM_ENGAGEMENT_LIMITED_ACTIVATION_PREFLIGHT=PASS');
  console.log(`ACTIVE_REPLY_QUEUE=${activeReplies}`);
  console.log(`REPLY_DEAD_LETTER=${deadLetters}`);
  console.log(`AMBIGUOUS_OUTCOMES=${ambiguousCount}`);
  console.log('DATABASE_MUTATIONS=false');
  console.log('PROVIDER_CALLS=false');
  console.log('RAW_USER_DATA_LOGGED=false');
} finally {
  await pool.end();
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}
