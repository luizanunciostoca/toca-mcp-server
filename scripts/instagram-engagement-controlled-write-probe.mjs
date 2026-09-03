import { createHash } from 'node:crypto';
import pg from 'pg';
import { classifySocialEngagement } from '../dist/src/crm/social-engagement-classifier.js';
import { PostgresInstagramEngagementKnowledgeSource } from '../dist/src/instagram-engagement/postgres-knowledge.js';

const { Pool } = pg;
const INBOUND_TYPE = 'instagram.engagement.inbound.v1';
const REPLY_TYPE = 'instagram.engagement.reply.v1';
const AUTO_ELIGIBLE = new Set([
  'FAQ_OPERATIONAL',
  'EVENT_INFO',
  'TICKET_INFO',
  'LOCATION_HOURS',
  'GENERAL_SOCIAL',
]);

const databaseUrl = requiredEnv('DATABASE_URL');
const mode = requiredEnv('INSTAGRAM_ENGAGEMENT_CANARY_PROBE_MODE');
const session = validateSession(requiredEnv('INSTAGRAM_ENGAGEMENT_CANARY_SESSION'));
const channel = optionalChannel(process.env.INSTAGRAM_ENGAGEMENT_CANARY_CHANNEL);
const spreadsheetId = process.env.INSTAGRAM_ENGAGEMENT_KNOWLEDGE_SPREADSHEET_ID?.trim();
const startedAt = process.env.INSTAGRAM_ENGAGEMENT_CANARY_STARTED_AT?.trim() || null;
const maxAgeMinutes = boundedInteger(process.env.INSTAGRAM_ENGAGEMENT_CANARY_MAX_AGE_MINUTES, 30, 1, 60);
const sessionMarker = `instagram:engagement:canary-session:${session}`;
const inboundMarker = 'instagram:engagement:canary-phase:inbound';
const replyMarker = 'instagram:engagement:canary-phase:reply';
const pool = new Pool({ connectionString: databaseUrl, max: 2 });

try {
  if (mode === 'PREPARE') await prepareInbound();
  else if (mode === 'VERIFY_REPLY') await verifyAndReserveReply();
  else if (mode === 'POST') await verifyPostcondition();
  else if (mode === 'CANCEL') await cancelReservations();
  else fail('INSTAGRAM_ENGAGEMENT_CANARY_PROBE_MODE_INVALID');
} finally {
  await pool.end();
}

async function prepareInbound() {
  if (!channel) fail('INSTAGRAM_ENGAGEMENT_CANARY_CHANNEL_REQUIRED');
  if (!spreadsheetId) fail('INSTAGRAM_ENGAGEMENT_CANARY_KNOWLEDGE_SOURCE_REQUIRED');
  await assertCleanGlobalState();

  const client = await pool.connect();
  try {
    await client.query('begin');
    const active = await client.query(
      `select count(*)::int as count
         from event_outbox
        where event_type in ($1,$2)
          and status in ('PENDING','FAILED_RETRYABLE','CLAIMED')
          and exists (
            select 1 from jsonb_array_elements_text(evidence) as marker(value)
             where marker.value like 'instagram:engagement:canary-session:%'
          )`,
      [INBOUND_TYPE, REPLY_TYPE],
    );
    if ((active.rows[0]?.count ?? 0) !== 0) fail('INSTAGRAM_ENGAGEMENT_CANARY_ACTIVE_RESERVATION_EXISTS');

    const infinity = await client.query(
      `select count(*)::int as count
         from event_outbox
        where event_type in ($1,$2)
          and status in ('PENDING','FAILED_RETRYABLE')
          and available_at = '-infinity'::timestamptz`,
      [INBOUND_TYPE, REPLY_TYPE],
    );
    if ((infinity.rows[0]?.count ?? 0) !== 0) fail('INSTAGRAM_ENGAGEMENT_CANARY_RESERVED_PRIORITY_CONFLICT');

    const candidates = await client.query(
      `select event_id, payload
         from event_outbox candidate
        where candidate.event_type = $1
          and candidate.status = 'PENDING'
          and candidate.attempts = 0
          and candidate.available_at <= now()
          and candidate.occurred_at >= now() - ($2::text || ' minutes')::interval
          and candidate.payload->>'channel' = $3
          and nullif(trim(candidate.payload->>'text'),'') is not null
          and nullif(trim(candidate.payload->>'senderId'),'') is not null
          and not exists (
            select 1
              from event_outbox nearby
             where nearby.event_type = $1
               and nearby.event_id <> candidate.event_id
               and nearby.tenant_id = candidate.tenant_id
               and nearby.payload->>'channel' = candidate.payload->>'channel'
               and nearby.payload->>'senderId' = candidate.payload->>'senderId'
               and nearby.occurred_at between candidate.occurred_at - interval '8 seconds'
                                           and candidate.occurred_at + interval '8 seconds'
               and (
                 candidate.payload->>'channel' <> 'COMMENT'
                 or coalesce(nearby.payload->>'mediaId','') = coalesce(candidate.payload->>'mediaId','')
               )
          )
        order by candidate.occurred_at asc, candidate.event_id asc
        for update of candidate skip locked
        limit 25`,
      [INBOUND_TYPE, String(maxAgeMinutes), channel],
    );

    const knowledge = new PostgresInstagramEngagementKnowledgeSource(pool, spreadsheetId);
    let selected = null;
    for (const row of candidates.rows) {
      const text = safeText(row.payload);
      if (!text) continue;
      const classification = classifySocialEngagement(text);
      if (classification.confidence !== 'HIGH') continue;
      if (!['P2', 'P3'].includes(classification.priority)) continue;
      if (classification.containsPotentialSensitiveData) continue;
      if (classification.commercialIntent !== 'NONE') continue;
      if (classification.urgency !== 'LOW') continue;
      if (!AUTO_ELIGIBLE.has(classification.intent)) continue;
      const match = await knowledge.resolve(text, classification.intent);
      if (!match?.factsVerified || !match.faqId?.trim()) continue;
      selected = row;
      break;
    }
    if (!selected) fail('INSTAGRAM_ENGAGEMENT_CANARY_NO_SAFE_RECENT_CANDIDATE');

    const updated = await client.query(
      `update event_outbox
          set available_at = '-infinity'::timestamptz,
              evidence = evidence || jsonb_build_array($2::text,$3::text),
              version = version + 1
        where event_id = $1 and status = 'PENDING' and attempts = 0`,
      [selected.event_id, sessionMarker, inboundMarker],
    );
    if (updated.rowCount !== 1) fail('INSTAGRAM_ENGAGEMENT_CANARY_RESERVATION_CONFLICT');
    await client.query('commit');
    console.log('INSTAGRAM_ENGAGEMENT_CANARY_PREPARE=PASS');
    console.log(`CANARY_CHANNEL=${channel}`);
    console.log(`CANARY_TARGET_SHA256=${digest(selected.event_id)}`);
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function verifyAndReserveReply() {
  await assertCleanGlobalState();
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await client.query(
      `select
         inbound.event_id as inbound_outbox_id,
         inbound.status as inbound_status,
         inbound.payload->>'eventId' as engagement_event_id,
         action.channel,
         action.risk,
         action.autonomy,
         action.status as action_status,
         action.classification_confidence,
         action.priority,
         action.faq_id,
         action.knowledge_source,
         action.reply_sha256,
         action.provider_reply_id,
         action.failure_code,
         action.thread_id,
         action.message_group_sha256,
         thread.state as thread_state,
         thread.classification_confidence as thread_confidence,
         thread.priority as thread_priority,
         group_row.status as group_status
       from event_outbox inbound
       join instagram_engagement_actions action
         on action.event_id = inbound.payload->>'eventId'
       join instagram_engagement_threads thread on thread.thread_id = action.thread_id
       join instagram_engagement_message_groups group_row
         on group_row.group_sha256 = action.message_group_sha256
      where inbound.event_type = $1
        and inbound.evidence ? $2::text
        and inbound.evidence ? $3::text`,
      [INBOUND_TYPE, sessionMarker, inboundMarker],
    );
    if (result.rowCount !== 1) fail('INSTAGRAM_ENGAGEMENT_CANARY_INBOUND_RESULT_NOT_UNIQUE');
    const row = result.rows[0];
    if (row.inbound_status !== 'DELIVERED') fail('INSTAGRAM_ENGAGEMENT_CANARY_INBOUND_NOT_DELIVERED');
    if (row.risk !== 'LOW') fail('INSTAGRAM_ENGAGEMENT_CANARY_RISK_NOT_LOW');
    if (row.autonomy !== 'AUTO_REPLY_ALLOWED') fail('INSTAGRAM_ENGAGEMENT_CANARY_AUTONOMY_NOT_AUTO');
    if (row.action_status !== 'READY_TO_SEND') fail('INSTAGRAM_ENGAGEMENT_CANARY_ACTION_NOT_READY');
    if (row.classification_confidence !== 'HIGH') fail('INSTAGRAM_ENGAGEMENT_CANARY_CONFIDENCE_NOT_HIGH');
    if (!['P2', 'P3'].includes(row.priority)) fail('INSTAGRAM_ENGAGEMENT_CANARY_PRIORITY_NOT_LOW');
    if (!row.faq_id || !row.knowledge_source || !row.reply_sha256) fail('INSTAGRAM_ENGAGEMENT_CANARY_FACT_EVIDENCE_MISSING');
    if (row.provider_reply_id || row.failure_code) fail('INSTAGRAM_ENGAGEMENT_CANARY_PREMATURE_PROVIDER_OUTCOME');
    if (row.thread_state !== 'RESPONDABLE') fail('INSTAGRAM_ENGAGEMENT_CANARY_THREAD_NOT_RESPONDABLE');
    if (row.thread_confidence !== 'HIGH') fail('INSTAGRAM_ENGAGEMENT_CANARY_THREAD_CONFIDENCE_NOT_HIGH');
    if (!['P2', 'P3'].includes(row.thread_priority)) fail('INSTAGRAM_ENGAGEMENT_CANARY_THREAD_PRIORITY_NOT_LOW');
    if (row.group_status !== 'READY_TO_SEND') fail('INSTAGRAM_ENGAGEMENT_CANARY_GROUP_NOT_READY');
    if (!row.engagement_event_id) fail('INSTAGRAM_ENGAGEMENT_CANARY_ENGAGEMENT_EVENT_MISSING');

    const replyEventId = `instagram-engagement-reply:${row.engagement_event_id}`;
    const reply = await client.query(
      `select event_id, event_type, status, attempts, max_attempts, payload, evidence
         from event_outbox
        where event_id = $1 for update`,
      [replyEventId],
    );
    if (reply.rowCount !== 1) fail('INSTAGRAM_ENGAGEMENT_CANARY_REPLY_EVENT_MISSING');
    const replyRow = reply.rows[0];
    if (replyRow.event_type !== REPLY_TYPE || replyRow.status !== 'PENDING') fail('INSTAGRAM_ENGAGEMENT_CANARY_REPLY_NOT_PENDING');
    if (replyRow.attempts !== 0 || replyRow.max_attempts !== 1) fail('INSTAGRAM_ENGAGEMENT_CANARY_REPLY_ATTEMPT_BOUNDARY_INVALID');
    if (replyRow.payload?.engagementEventId !== row.engagement_event_id) fail('INSTAGRAM_ENGAGEMENT_CANARY_REPLY_CORRELATION_INVALID');
    if (replyRow.payload?.channel !== row.channel) fail('INSTAGRAM_ENGAGEMENT_CANARY_REPLY_CHANNEL_INVALID');
    if (!Array.isArray(replyRow.evidence) || !replyRow.evidence.includes('instagram:engagement:verified-fact')) fail('INSTAGRAM_ENGAGEMENT_CANARY_REPLY_FACT_EVIDENCE_MISSING');

    const updated = await client.query(
      `update event_outbox
          set available_at = '-infinity'::timestamptz,
              evidence = evidence || jsonb_build_array($2::text,$3::text),
              version = version + 1
        where event_id = $1 and status = 'PENDING' and attempts = 0`,
      [replyEventId, sessionMarker, replyMarker],
    );
    if (updated.rowCount !== 1) fail('INSTAGRAM_ENGAGEMENT_CANARY_REPLY_RESERVATION_CONFLICT');
    await client.query('commit');
    console.log('INSTAGRAM_ENGAGEMENT_CANARY_VERIFY_REPLY=PASS');
    console.log(`CANARY_REPLY_SHA256=${digest(replyEventId)}`);
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function verifyPostcondition() {
  if (!startedAt || !Number.isFinite(Date.parse(startedAt))) fail('INSTAGRAM_ENGAGEMENT_CANARY_STARTED_AT_INVALID');
  const result = await pool.query(
    `select
       action.status as action_status,
       action.provider_reply_id,
       action.failure_code,
       thread.state as thread_state,
       group_row.status as group_status,
       reply.status as reply_status,
       reply.attempts as reply_attempts,
       reply.max_attempts as reply_max_attempts,
       reply.delivered_at
     from event_outbox inbound
     join instagram_engagement_actions action
       on action.event_id = inbound.payload->>'eventId'
     join instagram_engagement_threads thread on thread.thread_id = action.thread_id
     join instagram_engagement_message_groups group_row
       on group_row.group_sha256 = action.message_group_sha256
     join event_outbox reply
       on reply.event_id = 'instagram-engagement-reply:' || action.event_id
    where inbound.event_type = $1
      and inbound.evidence ? $2::text
      and inbound.evidence ? $3::text
      and reply.evidence ? $2::text
      and reply.evidence ? $4::text`,
    [INBOUND_TYPE, sessionMarker, inboundMarker, replyMarker],
  );
  if (result.rowCount !== 1) fail('INSTAGRAM_ENGAGEMENT_CANARY_POST_RESULT_NOT_UNIQUE');
  const row = result.rows[0];
  if (row.action_status !== 'SENT' || !row.provider_reply_id || row.failure_code) fail('INSTAGRAM_ENGAGEMENT_CANARY_PROVIDER_ACK_MISSING');
  if (row.thread_state !== 'AWAITING_CUSTOMER') fail('INSTAGRAM_ENGAGEMENT_CANARY_THREAD_POST_STATE_INVALID');
  if (row.group_status !== 'RESPONDED') fail('INSTAGRAM_ENGAGEMENT_CANARY_GROUP_POST_STATE_INVALID');
  if (row.reply_status !== 'DELIVERED' || row.reply_attempts !== 1 || row.reply_max_attempts !== 1 || !row.delivered_at) fail('INSTAGRAM_ENGAGEMENT_CANARY_REPLY_RECEIPT_INVALID');

  const window = await pool.query(
    `select
       count(*) filter (where status = 'SENT')::int as sent_count,
       count(*) filter (where status = 'SEND_FAILED')::int as failed_count,
       count(*) filter (where status = 'SEND_AMBIGUOUS')::int as ambiguous_count
       from instagram_engagement_actions
      where updated_at >= $1::timestamptz`,
    [startedAt],
  );
  const summary = window.rows[0] ?? {};
  if (summary.sent_count !== 1) fail('INSTAGRAM_ENGAGEMENT_CANARY_SENT_COUNT_INVALID');
  if (summary.failed_count !== 0) fail('INSTAGRAM_ENGAGEMENT_CANARY_SEND_FAILED');
  if (summary.ambiguous_count !== 0) fail('INSTAGRAM_ENGAGEMENT_CANARY_SEND_AMBIGUOUS');
  await assertCleanGlobalState();
  console.log('INSTAGRAM_ENGAGEMENT_CONTROLLED_WRITE_CANARY=PASS');
  console.log('CANARY_SENT_COUNT=1');
  console.log('CANARY_PROVIDER_ACKNOWLEDGED=true');
  console.log('CANARY_PERSISTENT_WRITES=false');
}

async function cancelReservations() {
  const result = await pool.query(
    `update event_outbox
        set available_at = now(),
            evidence = (evidence - $1::text) - $2::text - $3::text,
            version = version + 1
      where event_type in ($4,$5)
        and status in ('PENDING','FAILED_RETRYABLE')
        and evidence ? $1::text`,
    [sessionMarker, inboundMarker, replyMarker, INBOUND_TYPE, REPLY_TYPE],
  );
  console.log('INSTAGRAM_ENGAGEMENT_CANARY_CANCEL=PASS');
  console.log(`CANARY_RESERVATIONS_RELEASED=${result.rowCount}`);
}

async function assertCleanGlobalState() {
  const deadLetter = await pool.query(
    `select count(*)::int as count from event_outbox
      where event_type in ($1,$2) and status = 'DEAD_LETTER'`,
    [INBOUND_TYPE, REPLY_TYPE],
  );
  const ambiguous = await pool.query(
    `select count(*)::int as count from instagram_engagement_actions
      where status = 'SEND_AMBIGUOUS'`,
  );
  const claimed = await pool.query(
    `select count(*)::int as count from event_outbox
      where event_type in ($1,$2) and status = 'CLAIMED'`,
    [INBOUND_TYPE, REPLY_TYPE],
  );
  if ((deadLetter.rows[0]?.count ?? 0) !== 0) fail('INSTAGRAM_ENGAGEMENT_CANARY_DEAD_LETTER_NOT_CLEAN');
  if ((ambiguous.rows[0]?.count ?? 0) !== 0) fail('INSTAGRAM_ENGAGEMENT_CANARY_AMBIGUOUS_NOT_CLEAN');
  if ((claimed.rows[0]?.count ?? 0) !== 0) fail('INSTAGRAM_ENGAGEMENT_CANARY_CLAIMED_BACKLOG_NOT_CLEAN');
}

function safeText(payload) {
  if (!payload || typeof payload !== 'object') return '';
  return typeof payload.text === 'string' ? payload.text.trim() : '';
}

function requiredEnv(key) {
  const value = process.env[key]?.trim();
  if (!value) fail(`${key}_REQUIRED`);
  return value;
}

function optionalChannel(value) {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) return null;
  if (normalized !== 'DIRECT' && normalized !== 'COMMENT') fail('INSTAGRAM_ENGAGEMENT_CANARY_CHANNEL_INVALID');
  return normalized;
}

function validateSession(value) {
  if (!/^[A-Za-z0-9._-]{8,120}$/.test(value)) fail('INSTAGRAM_ENGAGEMENT_CANARY_SESSION_INVALID');
  return value;
}

function boundedInteger(value, fallback, minimum, maximum) {
  if (!value?.trim()) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) fail('INSTAGRAM_ENGAGEMENT_CANARY_INTEGER_INVALID');
  return parsed;
}

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function fail(code) {
  throw new Error(code);
}
