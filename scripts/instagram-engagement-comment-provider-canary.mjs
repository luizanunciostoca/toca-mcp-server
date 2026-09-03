import { createHash } from 'node:crypto';
import pg from 'pg';
import { loadConfig } from '../dist/src/config.js';
import { EnvSecretResolver } from '../dist/src/core/secrets.js';
import { classifySocialEngagement } from '../dist/src/crm/social-engagement-classifier.js';
import {
  recordConversationReply,
  recordConversationReplyFailure,
} from '../dist/src/instagram-engagement/conversation-reply-state.js';
import { PostgresInstagramEngagementActionStore } from '../dist/src/instagram-engagement/postgres-action-store.js';
import { PostgresInstagramEngagementKnowledgeSource } from '../dist/src/instagram-engagement/postgres-knowledge.js';
import { evaluateEngagementPolicy } from '../dist/src/policy/engagement-policy.js';
import { InstagramGraphEngagementProvider } from '../dist/src/providers/instagram/instagram-engagement-provider.js';
import { MetaApiClient } from '../dist/src/providers/meta/meta-api-client.js';

const { Pool } = pg;
const INBOUND_TYPE = 'instagram.engagement.inbound.v1';
const SESSION_PREFIX = 'instagram:engagement:comment-canary-session:';
const RESERVED_MARKER = 'instagram:engagement:comment-canary:reserved';
const IN_FLIGHT_CODE = 'COMMENT_CANARY_SEND_IN_FLIGHT';
const UNKNOWN_CODE = 'COMMENT_CANARY_PROVIDER_OUTCOME_UNKNOWN';

const databaseUrl = requiredEnv('DATABASE_URL');
const mode = requiredEnv('INSTAGRAM_ENGAGEMENT_COMMENT_CANARY_MODE');
const session = validateSession(requiredEnv('INSTAGRAM_ENGAGEMENT_COMMENT_CANARY_SESSION'));
const sessionMarker = `${SESSION_PREFIX}${session}`;
const spreadsheetId = requiredEnv('INSTAGRAM_ENGAGEMENT_KNOWLEDGE_SPREADSHEET_ID');
const accountId = requiredEnv('INSTAGRAM_BUSINESS_ACCOUNT_ID');
const maxAgeMinutes = boundedInteger(
  process.env.INSTAGRAM_ENGAGEMENT_COMMENT_CANARY_MAX_AGE_MINUTES,
  30,
  1,
  60,
);
const startedAt = process.env.INSTAGRAM_ENGAGEMENT_COMMENT_CANARY_STARTED_AT?.trim() || null;
const pool = new Pool({ connectionString: databaseUrl, max: 3 });
const knowledge = new PostgresInstagramEngagementKnowledgeSource(pool, spreadsheetId);

try {
  if (mode === 'PREPARE') await prepare();
  else if (mode === 'EXECUTE') await execute();
  else if (mode === 'POST') await post();
  else if (mode === 'CANCEL') await cancel();
  else fail('INSTAGRAM_ENGAGEMENT_COMMENT_CANARY_MODE_INVALID');
} finally {
  await pool.end();
}

async function prepare() {
  await assertNoUnresolvedAmbiguity();
  const client = await pool.connect();
  try {
    await client.query('begin');
    const active = await client.query(
      `select count(*)::int as count
         from event_outbox inbound
         join instagram_engagement_actions action
           on action.event_id = inbound.payload->>'eventId'
        where inbound.event_type = $1
          and exists (
            select 1 from jsonb_array_elements_text(inbound.evidence) marker(value)
             where marker.value like $2
          )
          and action.status in ('SUGGESTED','READY_TO_SEND','SEND_AMBIGUOUS')`,
      [INBOUND_TYPE, `${SESSION_PREFIX}%`],
    );
    if ((active.rows[0]?.count ?? 0) !== 0) fail('COMMENT_CANARY_ACTIVE_SESSION_EXISTS');

    const result = await client.query(
      `select
         inbound.event_id as inbound_outbox_id,
         inbound.payload,
         inbound.tenant_id,
         inbound.workspace_id,
         inbound.organization_id,
         inbound.occurred_at,
         action.event_id as engagement_event_id,
         action.risk,
         action.autonomy,
         action.policy_reason,
         action.faq_id,
         action.knowledge_source,
         action.reply_sha256,
         action.provider_reply_id,
         action.failure_code,
         action.thread_id,
         action.message_group_sha256,
         action.classification_confidence,
         action.priority,
         thread.state as thread_state,
         thread.classification_confidence as thread_confidence,
         thread.priority as thread_priority,
         group_row.status as group_status,
         group_row.message_count
       from event_outbox inbound
       join instagram_engagement_actions action
         on action.event_id = inbound.payload->>'eventId'
       join instagram_engagement_threads thread on thread.thread_id = action.thread_id
       join instagram_engagement_message_groups group_row
         on group_row.group_sha256 = action.message_group_sha256
      where inbound.event_type = $1
        and inbound.status = 'DELIVERED'
        and inbound.occurred_at >= now() - ($2::text || ' minutes')::interval
        and inbound.payload->>'channel' = 'COMMENT'
        and inbound.payload->>'accountId' = $3
        and nullif(trim(inbound.payload->>'commentId'),'') is not null
        and nullif(trim(inbound.payload->>'senderId'),'') is not null
        and nullif(trim(inbound.payload->>'text'),'') is not null
        and action.status = 'SUGGESTED'
        and action.risk = 'LOW'
        and action.autonomy = 'SUGGEST_ONLY'
        and action.policy_reason = 'engagement_writes_kill_switch'
        and action.classification_confidence = 'HIGH'
        and action.priority in ('P2','P3')
        and action.provider_reply_id is null
        and action.failure_code is null
        and action.reply_sha256 is null
        and thread.state = 'AWAITING_APPROVAL'
        and thread.classification_confidence = 'HIGH'
        and thread.priority in ('P2','P3')
        and group_row.status = 'SUGGESTED'
        and group_row.message_count = 1
        and not exists (
          select 1 from event_outbox reply
           where reply.event_id = 'instagram-engagement-reply:' || action.event_id
        )
        and not exists (
          select 1 from jsonb_array_elements_text(inbound.evidence) marker(value)
           where marker.value like $4
        )
      order by inbound.occurred_at desc, inbound.event_id asc
      for update of inbound skip locked
      limit 25`,
      [INBOUND_TYPE, String(maxAgeMinutes), accountId, `${SESSION_PREFIX}%`],
    );

    let selected = null;
    for (const row of result.rows) {
      const validated = await validateCandidate(row);
      if (validated) {
        selected = { row, validated };
        break;
      }
    }
    if (!selected) fail('COMMENT_CANARY_NO_SAFE_RECENT_CANDIDATE');

    const updated = await client.query(
      `update event_outbox
          set evidence = evidence || jsonb_build_array($2::text,$3::text),
              version = version + 1
        where event_id = $1
          and status = 'DELIVERED'
          and not (evidence ? $2::text)`,
      [selected.row.inbound_outbox_id, sessionMarker, RESERVED_MARKER],
    );
    if (updated.rowCount !== 1) fail('COMMENT_CANARY_RESERVATION_CONFLICT');
    await client.query('commit');
    console.log('INSTAGRAM_ENGAGEMENT_COMMENT_CANARY_PREPARE=PASS');
    console.log(`COMMENT_CANARY_TARGET_SHA256=${digest(selected.row.engagement_event_id)}`);
    console.log(`COMMENT_CANARY_REPLY_SHA256=${selected.validated.replySha256}`);
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function execute() {
  await assertNoOtherUnresolvedAmbiguity();
  const candidate = await loadReservedCandidate();
  const validated = await validateCandidate(candidate);
  if (!validated) fail('COMMENT_CANARY_RESERVED_TARGET_NO_LONGER_ELIGIBLE');

  const executionId = `comment-canary:${session}`;
  const now = new Date().toISOString();
  const marked = await pool.query(
    `update instagram_engagement_actions set
       status='SEND_AMBIGUOUS', reply_sha256=$2, provider_reply_id=null,
       failure_code=$3, execution_id=$4, updated_at=$5::timestamptz
     where event_id=$1
       and status='SUGGESTED'
       and provider_reply_id is null
       and failure_code is null`,
    [candidate.engagement_event_id, validated.replySha256, IN_FLIGHT_CODE, executionId, now],
  );
  if (marked.rowCount !== 1) fail('COMMENT_CANARY_ACTION_STATE_CONFLICT');

  // Fail closed before the provider side effect. If the process disappears after
  // the call but before acknowledgement persistence, this state prevents blind retry.
  await recordConversationReplyFailure(pool, {
    engagementEventId: candidate.engagement_event_id,
    ambiguous: true,
    now,
  });

  const config = loadConfig(process.env);
  if (!config.META_ENABLED || !config.META_PROVIDER_VERIFIED) {
    fail('COMMENT_CANARY_META_PROVIDER_NOT_VERIFIED');
  }
  if (!config.META_ACCESS_TOKEN_ENV_KEY) fail('COMMENT_CANARY_META_TOKEN_REFERENCE_REQUIRED');
  if (!config.INSTAGRAM_ENGAGEMENT_AUTO_REPLY_CHANNELS.includes('COMMENT')) {
    fail('COMMENT_CANARY_COMMENT_CHANNEL_NOT_SELECTED');
  }
  const secrets = new EnvSecretResolver(process.env, 'env');
  const client = new MetaApiClient(
    { graphBaseUrl: config.META_GRAPH_BASE_URL, apiVersion: config.META_GRAPH_API_VERSION },
    secrets,
    { provider: 'env', key: config.META_ACCESS_TOKEN_ENV_KEY },
  );
  const provider = new InstagramGraphEngagementProvider(client);
  const actions = new PostgresInstagramEngagementActionStore(pool);

  try {
    const reply = await provider.replyToComment({
      commentId: candidate.payload.commentId,
      message: validated.answer,
    });
    const acknowledgedAt = new Date().toISOString();
    await actions.complete({
      eventId: candidate.engagement_event_id,
      status: 'SENT',
      providerReplyId: reply.commentId,
      executionId,
      now: acknowledgedAt,
    });
    await recordConversationReply(pool, {
      engagementEventId: candidate.engagement_event_id,
      providerReplyId: reply.commentId,
      now: acknowledgedAt,
    });
    console.log('INSTAGRAM_ENGAGEMENT_COMMENT_PROVIDER_CALL=ACKNOWLEDGED');
    console.log(`COMMENT_CANARY_PROVIDER_REPLY_SHA256=${digest(reply.commentId)}`);
  } catch {
    const failedAt = new Date().toISOString();
    await actions.complete({
      eventId: candidate.engagement_event_id,
      status: 'SEND_AMBIGUOUS',
      failureCode: UNKNOWN_CODE,
      executionId,
      now: failedAt,
    });
    await recordConversationReplyFailure(pool, {
      engagementEventId: candidate.engagement_event_id,
      ambiguous: true,
      now: failedAt,
    });
    fail('COMMENT_CANARY_PROVIDER_OUTCOME_AMBIGUOUS');
  }
}

async function post() {
  if (!startedAt || !Number.isFinite(Date.parse(startedAt))) {
    fail('COMMENT_CANARY_STARTED_AT_INVALID');
  }
  const result = await pool.query(
    `select
       action.event_id,
       action.status as action_status,
       action.provider_reply_id,
       action.failure_code,
       action.execution_id,
       thread.state as thread_state,
       group_row.status as group_status
     from event_outbox inbound
     join instagram_engagement_actions action
       on action.event_id = inbound.payload->>'eventId'
     join instagram_engagement_threads thread on thread.thread_id = action.thread_id
     join instagram_engagement_message_groups group_row
       on group_row.group_sha256 = action.message_group_sha256
    where inbound.event_type=$1
      and inbound.evidence ? $2::text
      and inbound.evidence ? $3::text`,
    [INBOUND_TYPE, sessionMarker, RESERVED_MARKER],
  );
  if (result.rowCount !== 1) fail('COMMENT_CANARY_POST_RESULT_NOT_UNIQUE');
  const row = result.rows[0];
  if (
    row.action_status !== 'SENT' ||
    !row.provider_reply_id ||
    row.failure_code ||
    row.execution_id !== `comment-canary:${session}`
  ) {
    fail('COMMENT_CANARY_PROVIDER_ACK_MISSING');
  }
  if (row.thread_state !== 'AWAITING_CUSTOMER') fail('COMMENT_CANARY_THREAD_POST_STATE_INVALID');
  if (row.group_status !== 'RESPONDED') fail('COMMENT_CANARY_GROUP_POST_STATE_INVALID');

  const window = await pool.query(
    `select
       count(*) filter (where status='SENT')::int as sent_count,
       count(*) filter (where status='SEND_AMBIGUOUS')::int as ambiguous_count
     from instagram_engagement_actions
    where execution_id=$1 and updated_at >= $2::timestamptz`,
    [`comment-canary:${session}`, startedAt],
  );
  if ((window.rows[0]?.sent_count ?? 0) !== 1) fail('COMMENT_CANARY_SENT_COUNT_INVALID');
  if ((window.rows[0]?.ambiguous_count ?? 0) !== 0) fail('COMMENT_CANARY_AMBIGUITY_NOT_ZERO');

  console.log('INSTAGRAM_ENGAGEMENT_REAL_COMMENT_CANARY=PASS');
  console.log('COMMENT_CANARY_SENT_COUNT=1');
  console.log('COMMENT_CANARY_PROVIDER_ACKNOWLEDGED=true');
  console.log('COMMENT_CANARY_PERSISTENT_PROMOTION=false');
}

async function cancel() {
  const result = await pool.query(
    `update event_outbox inbound
        set evidence=(inbound.evidence - $2::text) - $3::text,
            version=inbound.version+1
       from instagram_engagement_actions action
      where inbound.event_type=$1
        and inbound.evidence ? $2::text
        and inbound.payload->>'eventId'=action.event_id
        and action.status='SUGGESTED'`,
    [INBOUND_TYPE, sessionMarker, RESERVED_MARKER],
  );
  console.log('INSTAGRAM_ENGAGEMENT_COMMENT_CANARY_CANCEL=PASS');
  console.log(`COMMENT_CANARY_RESERVATIONS_RELEASED=${result.rowCount}`);
}

async function loadReservedCandidate() {
  const result = await pool.query(
    `select
       inbound.event_id as inbound_outbox_id,
       inbound.payload,
       inbound.tenant_id,
       inbound.workspace_id,
       inbound.organization_id,
       inbound.occurred_at,
       action.event_id as engagement_event_id,
       action.risk,
       action.autonomy,
       action.policy_reason,
       action.faq_id,
       action.knowledge_source,
       action.reply_sha256,
       action.provider_reply_id,
       action.failure_code,
       action.thread_id,
       action.message_group_sha256,
       action.classification_confidence,
       action.priority,
       thread.state as thread_state,
       thread.classification_confidence as thread_confidence,
       thread.priority as thread_priority,
       group_row.status as group_status,
       group_row.message_count
     from event_outbox inbound
     join instagram_engagement_actions action
       on action.event_id=inbound.payload->>'eventId'
     join instagram_engagement_threads thread on thread.thread_id=action.thread_id
     join instagram_engagement_message_groups group_row
       on group_row.group_sha256=action.message_group_sha256
    where inbound.event_type=$1
      and inbound.status='DELIVERED'
      and inbound.evidence ? $2::text
      and inbound.evidence ? $3::text`,
    [INBOUND_TYPE, sessionMarker, RESERVED_MARKER],
  );
  if (result.rowCount !== 1) fail('COMMENT_CANARY_RESERVED_TARGET_NOT_UNIQUE');
  const row = result.rows[0];
  if (row.payload?.channel !== 'COMMENT' || row.payload?.accountId !== accountId) {
    fail('COMMENT_CANARY_RESERVED_TARGET_SCOPE_INVALID');
  }
  if (
    row.risk !== 'LOW' ||
    row.autonomy !== 'SUGGEST_ONLY' ||
    row.policy_reason !== 'engagement_writes_kill_switch' ||
    row.classification_confidence !== 'HIGH' ||
    !['P2', 'P3'].includes(row.priority) ||
    row.thread_state !== 'AWAITING_APPROVAL' ||
    row.thread_confidence !== 'HIGH' ||
    !['P2', 'P3'].includes(row.thread_priority) ||
    row.group_status !== 'SUGGESTED' ||
    row.message_count !== 1 ||
    row.reply_sha256 ||
    row.provider_reply_id ||
    row.failure_code
  ) {
    fail('COMMENT_CANARY_RESERVED_TARGET_STATE_INVALID');
  }
  return row;
}

async function validateCandidate(row) {
  const payload = row.payload;
  if (
    !payload ||
    payload.channel !== 'COMMENT' ||
    payload.accountId !== accountId ||
    typeof payload.commentId !== 'string' ||
    !payload.commentId.trim() ||
    typeof payload.senderId !== 'string' ||
    !payload.senderId.trim() ||
    typeof payload.text !== 'string' ||
    !payload.text.trim()
  ) {
    return null;
  }
  const occurredAt = Date.parse(payload.occurredAt ?? row.occurred_at);
  if (!Number.isFinite(occurredAt)) return null;
  const ageMs = Date.now() - occurredAt;
  if (ageMs < 0 || ageMs > maxAgeMinutes * 60_000) return null;

  const classification = classifySocialEngagement(payload.text);
  if (classification.confidence !== 'HIGH') return null;
  if (!['P2', 'P3'].includes(classification.priority)) return null;
  if (classification.containsPotentialSensitiveData) return null;
  if (classification.commercialIntent !== 'NONE') return null;
  if (classification.urgency !== 'LOW') return null;

  const match = await knowledge.resolve(payload.text, classification.intent);
  if (!match?.factsVerified || !match.faqId?.trim() || !match.answer?.trim()) return null;
  if (match.answer.length > 2_000) return null;
  if (row.faq_id && row.faq_id !== match.faqId) return null;
  if (row.knowledge_source && row.knowledge_source !== match.source) return null;

  const policy = evaluateEngagementPolicy({
    channel: 'COMMENT',
    intent: classification.intent,
    factsVerified: true,
    containsSensitivePersonalData: false,
    writesEnabled: true,
    classificationConfidence: classification.confidence,
    contextConflict: false,
    threadAutomationBlocked: false,
  });
  if (policy.risk !== 'LOW' || policy.autonomy !== 'AUTO_REPLY_ALLOWED') return null;

  return {
    answer: match.answer,
    faqId: match.faqId,
    replySha256: digest(match.answer),
  };
}

async function assertNoUnresolvedAmbiguity() {
  const result = await pool.query(
    `select count(*)::int as count
       from instagram_engagement_actions
      where status='SEND_AMBIGUOUS'`,
  );
  if ((result.rows[0]?.count ?? 0) !== 0) fail('COMMENT_CANARY_UNRESOLVED_AMBIGUITY_EXISTS');
}

async function assertNoOtherUnresolvedAmbiguity() {
  const result = await pool.query(
    `select count(*)::int as count
       from instagram_engagement_actions
      where status='SEND_AMBIGUOUS'
        and execution_id <> $1`,
    [`comment-canary:${session}`],
  );
  if ((result.rows[0]?.count ?? 0) !== 0) fail('COMMENT_CANARY_OTHER_AMBIGUITY_EXISTS');
}

function validateSession(value) {
  if (!/^[A-Za-z0-9._-]{8,120}$/.test(value)) fail('COMMENT_CANARY_SESSION_INVALID');
  return value;
}

function boundedInteger(value, fallback, minimum, maximum) {
  if (!value?.trim()) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    fail('COMMENT_CANARY_INTEGER_INVALID');
  }
  return parsed;
}

function requiredEnv(key) {
  const value = process.env[key]?.trim();
  if (!value) fail(`${key}_REQUIRED`);
  return value;
}

function digest(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function fail(code) {
  throw new Error(code);
}
