import { createHash } from 'node:crypto';
import pg from 'pg';
import { classifySocialEngagement } from '../crm/social-engagement-classifier.js';
import { PostgresInstagramEngagementKnowledgeSource } from '../instagram-engagement/postgres-knowledge.js';
import { evaluateEngagementPolicy } from '../policy/engagement-policy.js';

const { Pool } = pg;
const INBOUND_TYPE = 'instagram.engagement.inbound.v1';
const SESSION_PREFIX = 'instagram:engagement:comment-canary-session:';

interface CandidateRow {
  inbound_outbox_id: string;
  payload: unknown;
  occurred_at: Date | string;
  engagement_event_id: string;
  faq_id: string | null;
  knowledge_source: string | null;
}

interface CommentPayload {
  channel: string;
  accountId: string;
  commentId: string;
  senderId: string;
  text: string;
  occurredAt?: string;
}

type RejectReason =
  | 'scope'
  | 'age'
  | 'confidence'
  | 'priority'
  | 'sensitive'
  | 'commercial'
  | 'urgency'
  | 'knowledge'
  | 'policy';

const databaseUrl = requiredEnv('DATABASE_URL');
const spreadsheetId = requiredEnv('INSTAGRAM_ENGAGEMENT_KNOWLEDGE_SPREADSHEET_ID');
const accountId = requiredEnv('INSTAGRAM_BUSINESS_ACCOUNT_ID');
const maxAgeMinutes = boundedInteger(
  process.env.INSTAGRAM_ENGAGEMENT_COMMENT_CANARY_MAX_AGE_MINUTES,
  30,
  1,
  60,
);
const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const knowledge = new PostgresInstagramEngagementKnowledgeSource(pool, spreadsheetId);

try {
  const ambiguity = await pool.query<{ count: number }>(
    `select count(*)::int as count
       from instagram_engagement_actions
      where status='SEND_AMBIGUOUS'`,
  );
  const unresolvedAmbiguityCount = ambiguity.rows[0]?.count ?? 0;

  const activeReservation = await pool.query<{ count: number }>(
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
  const activeReservationCount = activeReservation.rows[0]?.count ?? 0;

  const recent = await pool.query<{ count: number }>(
    `select count(*)::int as count
       from event_outbox inbound
      where inbound.event_type = $1
        and inbound.status = 'DELIVERED'
        and inbound.occurred_at >= now() - ($2::text || ' minutes')::interval
        and inbound.payload->>'channel' = 'COMMENT'
        and inbound.payload->>'accountId' = $3
        and nullif(trim(inbound.payload->>'commentId'),'') is not null
        and nullif(trim(inbound.payload->>'senderId'),'') is not null
        and nullif(trim(inbound.payload->>'text'),'') is not null`,
    [INBOUND_TYPE, String(maxAgeMinutes), accountId],
  );
  const recentCommentCount = recent.rows[0]?.count ?? 0;

  const stateCandidates = await pool.query<CandidateRow>(
    `select
       inbound.event_id as inbound_outbox_id,
       inbound.payload,
       inbound.occurred_at,
       action.event_id as engagement_event_id,
       action.faq_id,
       action.knowledge_source
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
    limit 25`,
    [INBOUND_TYPE, String(maxAgeMinutes), accountId, `${SESSION_PREFIX}%`],
  );

  const rejected: Record<RejectReason, number> = {
    scope: 0,
    age: 0,
    confidence: 0,
    priority: 0,
    sensitive: 0,
    commercial: 0,
    urgency: 0,
    knowledge: 0,
    policy: 0,
  };
  const eligible: string[] = [];

  for (const row of stateCandidates.rows) {
    const result = await validateCandidate(row);
    if (typeof result === 'string') {
      rejected[result] += 1;
      continue;
    }
    eligible.push(digest(row.engagement_event_id));
  }

  const status =
    unresolvedAmbiguityCount > 0
      ? 'BLOCKED_UNRESOLVED_AMBIGUITY'
      : activeReservationCount > 0
        ? 'BLOCKED_ACTIVE_RESERVATION'
        : eligible.length === 0
          ? 'NO_ELIGIBLE_TARGET'
          : eligible.length === 1
            ? 'READY'
            : 'MULTIPLE_ELIGIBLE_TARGETS';

  console.log(`INSTAGRAM_ENGAGEMENT_COMMENT_CANARY_ELIGIBILITY=${status}`);
  console.log(`RECENT_COMMENT_COUNT=${recentCommentCount}`);
  console.log(`STATE_CANDIDATE_COUNT=${stateCandidates.rowCount ?? stateCandidates.rows.length}`);
  console.log(`ELIGIBLE_COUNT=${eligible.length}`);
  if (eligible.length === 1) console.log(`ELIGIBLE_TARGET_SHA256=${eligible[0]}`);
  console.log(`UNRESOLVED_AMBIGUITY_COUNT=${unresolvedAmbiguityCount}`);
  console.log(`ACTIVE_RESERVATION_COUNT=${activeReservationCount}`);
  console.log(`REJECTED_SCOPE=${rejected.scope}`);
  console.log(`REJECTED_AGE=${rejected.age}`);
  console.log(`REJECTED_CONFIDENCE=${rejected.confidence}`);
  console.log(`REJECTED_PRIORITY=${rejected.priority}`);
  console.log(`REJECTED_SENSITIVE=${rejected.sensitive}`);
  console.log(`REJECTED_COMMERCIAL=${rejected.commercial}`);
  console.log(`REJECTED_URGENCY=${rejected.urgency}`);
  console.log(`REJECTED_KNOWLEDGE=${rejected.knowledge}`);
  console.log(`REJECTED_POLICY=${rejected.policy}`);
  console.log('CANARY_CHANNEL=COMMENT');
  console.log('READ_ONLY_ELIGIBILITY=true');
  console.log('DATABASE_MUTATIONS=false');
  console.log('PROVIDER_CALLS=false');
  console.log('EXTERNAL_REPLY_WRITES=false');
  console.log('RAW_USER_DATA_LOGGED=false');
} finally {
  await pool.end();
}

async function validateCandidate(row: CandidateRow): Promise<true | RejectReason> {
  const payload = parsePayload(row.payload);
  if (!payload || payload.channel !== 'COMMENT' || payload.accountId !== accountId) return 'scope';

  const occurredAt = Date.parse(
    payload.occurredAt ??
      (row.occurred_at instanceof Date ? row.occurred_at.toISOString() : String(row.occurred_at)),
  );
  if (!Number.isFinite(occurredAt)) return 'age';
  const ageMs = Date.now() - occurredAt;
  if (ageMs < 0 || ageMs > maxAgeMinutes * 60_000) return 'age';

  const classification = classifySocialEngagement(payload.text);
  if (classification.confidence !== 'HIGH') return 'confidence';
  if (!['P2', 'P3'].includes(classification.priority)) return 'priority';
  if (classification.containsPotentialSensitiveData) return 'sensitive';
  if (classification.commercialIntent !== 'NONE') return 'commercial';
  if (classification.urgency !== 'LOW') return 'urgency';

  const match = await knowledge.resolve(payload.text, classification.intent);
  if (!match?.factsVerified || !match.faqId?.trim() || !match.answer?.trim()) return 'knowledge';
  if (match.answer.length > 2_000) return 'knowledge';
  if (row.faq_id && row.faq_id !== match.faqId) return 'knowledge';
  if (row.knowledge_source && row.knowledge_source !== match.source) return 'knowledge';

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
  if (policy.risk !== 'LOW' || policy.autonomy !== 'AUTO_REPLY_ALLOWED') return 'policy';
  return true;
}

function parsePayload(payload: unknown): CommentPayload | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const value = payload as Record<string, unknown>;
  if (
    value.channel !== 'COMMENT' ||
    typeof value.accountId !== 'string' ||
    !value.accountId.trim() ||
    typeof value.commentId !== 'string' ||
    !value.commentId.trim() ||
    typeof value.senderId !== 'string' ||
    !value.senderId.trim() ||
    typeof value.text !== 'string' ||
    !value.text.trim() ||
    (value.occurredAt !== undefined && typeof value.occurredAt !== 'string')
  ) {
    return null;
  }
  const base = {
    channel: value.channel,
    accountId: value.accountId,
    commentId: value.commentId,
    senderId: value.senderId,
    text: value.text,
  };
  return typeof value.occurredAt === 'string' ? { ...base, occurredAt: value.occurredAt } : base;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function boundedInteger(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!raw?.trim()) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error('INSTAGRAM_ENGAGEMENT_COMMENT_CANARY_MAX_AGE_INVALID');
  }
  return parsed;
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
