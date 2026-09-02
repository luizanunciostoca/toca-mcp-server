import type pg from 'pg';

export async function recordConversationReply(
  pool: pg.Pool,
  input: {
    readonly engagementEventId: string;
    readonly providerReplyId: string;
    readonly now: string;
  },
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const action = await client.query<{
      thread_id: string | null;
      message_group_sha256: string | null;
    }>(
      `select thread_id, message_group_sha256
         from instagram_engagement_actions
        where event_id = $1
        for update`,
      [input.engagementEventId],
    );
    const threadId = action.rows[0]?.thread_id;
    const groupSha256 = action.rows[0]?.message_group_sha256;
    if (groupSha256) {
      await client.query(
        `update instagram_engagement_message_groups
            set status='RESPONDED', updated_at=$2::timestamptz
          where group_sha256=$1`,
        [groupSha256, input.now],
      );
    }
    if (threadId) {
      await client.query(
        `update instagram_engagement_threads set
           state='AWAITING_CUSTOMER', last_provider_reply_id=$2,
           first_response_at=coalesce(first_response_at,$3::timestamptz),
           last_response_at=$3::timestamptz, awaiting_since=$3::timestamptz,
           updated_at=$3::timestamptz, version=version+1
         where thread_id=$1`,
        [threadId, input.providerReplyId, input.now],
      );
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function recordConversationReplyFailure(
  pool: pg.Pool,
  input: { readonly engagementEventId: string; readonly ambiguous: boolean; readonly now: string },
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const action = await client.query<{
      thread_id: string | null;
      message_group_sha256: string | null;
    }>(
      `select thread_id, message_group_sha256
         from instagram_engagement_actions
        where event_id = $1
        for update`,
      [input.engagementEventId],
    );
    const threadId = action.rows[0]?.thread_id;
    const groupSha256 = action.rows[0]?.message_group_sha256;
    if (groupSha256) {
      await client.query(
        `update instagram_engagement_message_groups
            set status='FAILED', updated_at=$2::timestamptz
          where group_sha256=$1`,
        [groupSha256, input.now],
      );
    }
    if (threadId) {
      await client.query(
        `update instagram_engagement_threads set
           state=$2, priority=case when $3 then 'P1' else priority end,
           awaiting_since=$4::timestamptz, updated_at=$4::timestamptz, version=version+1
         where thread_id=$1`,
        [threadId, input.ambiguous ? 'ESCALATED' : 'AWAITING_APPROVAL', input.ambiguous, input.now],
      );
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
