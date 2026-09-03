import { createHash } from 'node:crypto';
import type pg from 'pg';
import type {
  SocialEngagementClassification,
  SocialPriority,
} from '../crm/social-engagement-contracts.js';

export type InstagramCanonicalIntent =
  | 'EVENT_INFO'
  | 'SUNSET'
  | 'THE_PARTY'
  | 'GASTRONOMIA'
  | 'TICKET_INFO'
  | 'PRICE'
  | 'RESERVATION'
  | 'LOCATION'
  | 'HOURS'
  | 'COMMERCIAL_LEAD'
  | 'SUPPORT'
  | 'COMPLAINT'
  | 'REFUND'
  | 'SAFETY'
  | 'LEGAL'
  | 'PRESS'
  | 'PUBLIC_FIGURE'
  | 'HARASSMENT'
  | 'PRAISE'
  | 'UGC'
  | 'MARKING'
  | 'PARTNERSHIP'
  | 'WORK_WITH_US'
  | 'SPAM'
  | 'ABUSE'
  | 'UNKNOWN'
  | 'OTHER';

export interface CanonicalIntentProjection {
  readonly primaryIntent: InstagramCanonicalIntent;
  readonly secondaryIntents: readonly InstagramCanonicalIntent[];
}

export interface InstagramConversationSlaPolicy {
  readonly P0: number;
  readonly P1: number;
  readonly P2: number;
  readonly P3: number;
}

export interface InstagramConversationControlPlaneOptions {
  readonly humanEscalationSlaMs: InstagramConversationSlaPolicy;
  readonly faqReviewMinOccurrences?: number;
}

export interface SanitizedConversationContextItem {
  readonly occurredAt: string;
  readonly channel: 'COMMENT' | 'DIRECT';
  readonly textRedacted: string;
  readonly intent: string | null;
  readonly priority: SocialPriority | null;
  readonly actionStatus: string | null;
  readonly faqId: string | null;
  readonly providerReplyObserved: boolean;
}

export interface SanitizedConversationContext {
  readonly threadIdSha256: string;
  readonly state: string;
  readonly primaryIntent: string | null;
  readonly secondaryIntents: readonly string[];
  readonly priority: SocialPriority;
  readonly classificationConfidence: 'HIGH' | 'MEDIUM' | 'LOW';
  readonly commercialIntent: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
  readonly awaitingSince: string | null;
  readonly lastResponseAt: string | null;
  readonly sourceAttributionVerified: boolean;
  readonly sourceCampaignId: string | null;
  readonly sourceAdSetId: string | null;
  readonly sourceAdId: string | null;
  readonly sourceCreativeId: string | null;
  readonly recentItems: readonly SanitizedConversationContextItem[];
}

export interface InstagramResponseStatusDashboard {
  readonly newConversations: number;
  readonly unansweredConversations: number;
  readonly awaitingCustomer: number;
  readonly awaitingHuman: number;
  readonly escalated: number;
  readonly p0Open: number;
  readonly p1Open: number;
  readonly sendFailed: number;
  readonly sendAmbiguous: number;
  readonly deadLetter: number;
  readonly overdueHumanEscalations: number;
  readonly faqMisses: number;
  readonly medianFirstResponseMs: number | null;
  readonly p95FirstResponseMs: number | null;
}

interface ThreadContextRow {
  readonly thread_id: string;
  readonly state: string;
  readonly primary_intent: string | null;
  readonly secondary_intents: string[] | null;
  readonly priority: SocialPriority;
  readonly classification_confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  readonly commercial_intent: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
  readonly awaiting_since: Date | string | null;
  readonly last_response_at: Date | string | null;
  readonly attribution_verified: boolean;
  readonly source_campaign_id: string | null;
  readonly source_ad_set_id: string | null;
  readonly source_ad_id: string | null;
  readonly source_creative_id: string | null;
}

interface ContextItemRow {
  readonly occurred_at: Date | string;
  readonly channel: 'COMMENT' | 'DIRECT';
  readonly text: string | null;
  readonly intent: string | null;
  readonly priority: SocialPriority | null;
  readonly status: string | null;
  readonly faq_id: string | null;
  readonly provider_reply_id: string | null;
}

interface ExistingQueueRow {
  readonly id: string;
}

interface DashboardRow {
  readonly new_conversations: number | string;
  readonly unanswered_conversations: number | string;
  readonly awaiting_customer: number | string;
  readonly awaiting_human: number | string;
  readonly escalated: number | string;
  readonly p0_open: number | string;
  readonly p1_open: number | string;
  readonly send_failed: number | string;
  readonly send_ambiguous: number | string;
  readonly dead_letter: number | string;
  readonly overdue_human_escalations: number | string;
  readonly faq_misses: number | string;
  readonly median_first_response_ms: number | string | null;
  readonly p95_first_response_ms: number | string | null;
}

const CANONICAL_PRECEDENCE: readonly InstagramCanonicalIntent[] = [
  'SAFETY',
  'LEGAL',
  'HARASSMENT',
  'REFUND',
  'COMPLAINT',
  'SUPPORT',
  'PUBLIC_FIGURE',
  'PRESS',
  'COMMERCIAL_LEAD',
  'RESERVATION',
  'TICKET_INFO',
  'PRICE',
  'EVENT_INFO',
  'THE_PARTY',
  'SUNSET',
  'GASTRONOMIA',
  'LOCATION',
  'HOURS',
  'PARTNERSHIP',
  'WORK_WITH_US',
  'PRAISE',
  'UGC',
  'MARKING',
  'SPAM',
  'ABUSE',
  'UNKNOWN',
  'OTHER',
];

export function projectCanonicalIntents(
  classification: SocialEngagementClassification,
): CanonicalIntentProjection {
  const intents = new Set<InstagramCanonicalIntent>();
  const legacyIntent = classification.intent;

  if (legacyIntent === 'EVENT_INFO') intents.add('EVENT_INFO');
  if (legacyIntent === 'TICKET_INFO') intents.add('TICKET_INFO');
  if (legacyIntent === 'COMMERCIAL_LEAD') intents.add('COMMERCIAL_LEAD');
  if (legacyIntent === 'COMPLAINT') intents.add('COMPLAINT');
  if (legacyIntent === 'REFUND') intents.add('REFUND');
  if (legacyIntent === 'SAFETY_INCIDENT') intents.add('SAFETY');
  if (legacyIntent === 'LEGAL') intents.add('LEGAL');
  if (legacyIntent === 'PRESS') intents.add('PRESS');
  if (legacyIntent === 'PUBLIC_FIGURE') intents.add('PUBLIC_FIGURE');
  if (legacyIntent === 'HARASSMENT_OR_THREAT') intents.add('HARASSMENT');
  if (legacyIntent === 'UNKNOWN') intents.add('UNKNOWN');

  if (classification.eventInterest === 'SUNSET' || classification.eventInterest === 'BOTH') {
    intents.add('SUNSET');
    intents.add('EVENT_INFO');
  }
  if (
    classification.eventInterest === 'THE_PARTY' ||
    classification.eventInterest === 'BOTH'
  ) {
    intents.add('THE_PARTY');
    intents.add('EVENT_INFO');
  }

  switch (classification.topic) {
    case 'TICKETS':
      intents.add('TICKET_INFO');
      break;
    case 'RESERVATION':
      intents.add('RESERVATION');
      break;
    case 'PRICE':
      intents.add('PRICE');
      break;
    case 'LOCATION_HOURS':
      intents.add('LOCATION');
      intents.add('HOURS');
      break;
    case 'GASTRONOMY':
      intents.add('GASTRONOMIA');
      break;
    case 'COMPLAINT':
      intents.add('COMPLAINT');
      break;
    case 'REFUND':
      intents.add('REFUND');
      break;
    case 'LEGAL':
      intents.add('LEGAL');
      break;
    case 'SAFETY':
      intents.add('SAFETY');
      break;
    case 'PRESS':
      intents.add('PRESS');
      break;
    case 'PARTNERSHIP':
      intents.add('PARTNERSHIP');
      break;
    case 'CAREERS':
      intents.add('WORK_WITH_US');
      break;
    case 'EVENT_INFO':
      intents.add('EVENT_INFO');
      break;
    case 'GENERAL':
      break;
  }

  for (const intent of classification.conversationIntents) {
    if (intent === 'SUPPORT') intents.add('SUPPORT');
    else if (intent === 'COMPLAINT') intents.add('COMPLAINT');
    else if (intent === 'PRAISE') intents.add('PRAISE');
    else if (intent === 'UGC_BRAND_MENTION') {
      intents.add('UGC');
      intents.add('MARKING');
    } else if (intent === 'PARTNERSHIP') intents.add('PARTNERSHIP');
    else if (intent === 'CAREERS') intents.add('WORK_WITH_US');
    else if (intent === 'SPAM') intents.add('SPAM');
    else if (intent === 'ABUSE') intents.add('ABUSE');
    else if (intent === 'GASTRONOMY') intents.add('GASTRONOMIA');
    else if (intent === 'SUNSET') intents.add('SUNSET');
    else if (intent === 'THE_PARTY') intents.add('THE_PARTY');
    else if (intent === 'COMMERCIAL' || intent === 'PURCHASE') intents.add('COMMERCIAL_LEAD');
  }

  if (intents.size === 0) intents.add('OTHER');
  const ordered = CANONICAL_PRECEDENCE.filter((intent) => intents.has(intent));
  return {
    primaryIntent: ordered[0] ?? 'OTHER',
    secondaryIntents: ordered.slice(1),
  };
}

export function normalizeQuestionForAnalytics(value: string): {
  readonly redacted: string;
  readonly sha256: string;
} {
  const redacted = value
    .normalize('NFKC')
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '[email]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[document]')
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, '[phone]')
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[payment-data]')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('pt-BR')
    .slice(0, 280);
  return { redacted, sha256: digest(redacted) };
}

export class PostgresInstagramConversationControlPlane {
  readonly #faqReviewMinOccurrences: number;

  constructor(
    private readonly pool: pg.Pool,
    private readonly options: InstagramConversationControlPlaneOptions,
  ) {
    for (const priority of ['P0', 'P1', 'P2', 'P3'] as const) {
      const duration = options.humanEscalationSlaMs[priority];
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error(`INSTAGRAM_ENGAGEMENT_${priority}_HUMAN_SLA_INVALID`);
      }
    }
    this.#faqReviewMinOccurrences = options.faqReviewMinOccurrences ?? 5;
    if (!Number.isInteger(this.#faqReviewMinOccurrences) || this.#faqReviewMinOccurrences < 2) {
      throw new Error('INSTAGRAM_ENGAGEMENT_FAQ_REVIEW_THRESHOLD_INVALID');
    }
  }

  async getConversationContext(threadId: string, limit = 12): Promise<SanitizedConversationContext> {
    if (!threadId.trim()) throw new Error('INSTAGRAM_ENGAGEMENT_THREAD_ID_REQUIRED');
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new Error('INSTAGRAM_ENGAGEMENT_CONTEXT_LIMIT_INVALID');
    }
    const thread = await this.pool.query<ThreadContextRow>(
      `select thread_id,state,primary_intent,secondary_intents,priority,classification_confidence,
              commercial_intent,awaiting_since,last_response_at,attribution_verified,
              source_campaign_id,source_ad_set_id,source_ad_id,source_creative_id
         from instagram_engagement_threads where thread_id=$1`,
      [threadId],
    );
    const row = thread.rows[0];
    if (!row) throw new Error('INSTAGRAM_ENGAGEMENT_THREAD_NOT_FOUND');

    const items = await this.pool.query<ContextItemRow>(
      `select inbound.occurred_at,
              inbound.payload->>'channel' as channel,
              inbound.payload->>'text' as text,
              action.intent,action.priority,action.status,action.faq_id,action.provider_reply_id
         from event_outbox inbound
         left join instagram_engagement_actions action
           on action.event_id = inbound.payload->>'eventId'
        where inbound.event_type='instagram.engagement.inbound.v1'
          and action.thread_id=$1
        order by inbound.occurred_at desc, inbound.event_id desc
        limit $2`,
      [threadId, limit],
    );

    return {
      threadIdSha256: digest(threadId),
      state: row.state,
      primaryIntent: row.primary_intent,
      secondaryIntents: row.secondary_intents ?? [],
      priority: row.priority,
      classificationConfidence: row.classification_confidence,
      commercialIntent: row.commercial_intent,
      awaitingSince: timestampOrNull(row.awaiting_since),
      lastResponseAt: timestampOrNull(row.last_response_at),
      sourceAttributionVerified: row.attribution_verified,
      sourceCampaignId: row.source_campaign_id,
      sourceAdSetId: row.source_ad_set_id,
      sourceAdId: row.source_ad_id,
      sourceCreativeId: row.source_creative_id,
      recentItems: items.rows.reverse().map((item) => ({
        occurredAt: timestamp(item.occurred_at),
        channel: item.channel,
        textRedacted: normalizeQuestionForAnalytics(item.text ?? '').redacted,
        intent: item.intent,
        priority: item.priority,
        actionStatus: item.status,
        faqId: item.faq_id,
        providerReplyObserved: Boolean(item.provider_reply_id),
      })),
    };
  }

  async enqueueHumanEscalation(input: {
    readonly threadId: string;
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly organizationId: string;
    readonly priority: SocialPriority;
    readonly primaryIntent: InstagramCanonicalIntent;
    readonly reasonCode: string;
    readonly owner?: string;
    readonly now: string;
  }): Promise<{ readonly queueIdSha256: string; readonly reused: boolean }> {
    const nowMs = validDateMs(input.now, 'INSTAGRAM_ENGAGEMENT_ESCALATION_NOW_INVALID');
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const existing = await client.query<ExistingQueueRow>(
        `select queue_id as id from instagram_engagement_human_queue
          where thread_id=$1 and state in ('PENDING','ACKNOWLEDGED')
          order by created_at asc limit 1 for update`,
        [input.threadId],
      );
      const current = existing.rows[0];
      if (current) {
        await client.query('commit');
        return { queueIdSha256: digest(current.id), reused: true };
      }

      const queueId = digest(`human|${input.threadId}|${input.reasonCode}|${input.now}`);
      const slaDueAt = new Date(nowMs + this.options.humanEscalationSlaMs[input.priority]).toISOString();
      await client.query(
        `insert into instagram_engagement_human_queue (
           queue_id,thread_id,tenant_id,workspace_id,organization_id,priority,primary_intent,
           reason_code,owner,state,created_at,sla_due_at,updated_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING',$10::timestamptz,$11::timestamptz,$10::timestamptz)`,
        [
          queueId,input.threadId,input.tenantId,input.workspaceId,input.organizationId,input.priority,
          input.primaryIntent,input.reasonCode,input.owner ?? null,input.now,slaDueAt,
        ],
      );
      await client.query(
        `update instagram_engagement_threads set
           state='ESCALATED',follow_up_required=false,follow_up_due_at=null,
           awaiting_since=coalesce(awaiting_since,$2::timestamptz),updated_at=$2::timestamptz,version=version+1
         where thread_id=$1`,
        [input.threadId, input.now],
      );
      await client.query('commit');
      return { queueIdSha256: digest(queueId), reused: false };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async scheduleFollowUp(input: {
    readonly threadId: string;
    readonly reasonCode: string;
    readonly dueAt: string;
    readonly maxAttempts?: 1 | 2;
    readonly contextAuthorized: boolean;
    readonly consentRequired?: boolean;
    readonly consentVerified?: boolean;
    readonly now: string;
  }): Promise<{ readonly followUpIdSha256: string; readonly reused: boolean }> {
    if (!input.contextAuthorized) throw new Error('INSTAGRAM_ENGAGEMENT_FOLLOW_UP_CONTEXT_NOT_AUTHORIZED');
    const nowMs = validDateMs(input.now, 'INSTAGRAM_ENGAGEMENT_FOLLOW_UP_NOW_INVALID');
    const dueMs = validDateMs(input.dueAt, 'INSTAGRAM_ENGAGEMENT_FOLLOW_UP_DUE_INVALID');
    if (dueMs <= nowMs) throw new Error('INSTAGRAM_ENGAGEMENT_FOLLOW_UP_DUE_NOT_FUTURE');
    if (input.consentRequired && !input.consentVerified) {
      throw new Error('INSTAGRAM_ENGAGEMENT_FOLLOW_UP_CONSENT_NOT_VERIFIED');
    }
    const maxAttempts = input.maxAttempts ?? 1;
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const thread = await client.query<{ state: string }>(
        'select state from instagram_engagement_threads where thread_id=$1 for update',
        [input.threadId],
      );
      const state = thread.rows[0]?.state;
      if (!state) throw new Error('INSTAGRAM_ENGAGEMENT_THREAD_NOT_FOUND');
      if (state === 'RESOLVED' || state === 'CLOSED') {
        throw new Error('INSTAGRAM_ENGAGEMENT_FOLLOW_UP_THREAD_CLOSED');
      }
      const existing = await client.query<ExistingQueueRow>(
        `select follow_up_id as id from instagram_engagement_follow_up_queue
          where thread_id=$1 and reason_code=$2 and state='PENDING'
          order by created_at asc limit 1 for update`,
        [input.threadId, input.reasonCode],
      );
      const current = existing.rows[0];
      if (current) {
        await client.query('commit');
        return { followUpIdSha256: digest(current.id), reused: true };
      }
      const followUpId = digest(`follow-up|${input.threadId}|${input.reasonCode}|${input.dueAt}`);
      await client.query(
        `insert into instagram_engagement_follow_up_queue (
           follow_up_id,thread_id,reason_code,due_at,state,attempt_count,max_attempts,
           context_authorized,consent_required,consent_verified,created_at,updated_at
         ) values ($1,$2,$3,$4::timestamptz,'PENDING',0,$5,true,$6,$7,$8::timestamptz,$8::timestamptz)`,
        [
          followUpId,input.threadId,input.reasonCode,input.dueAt,maxAttempts,
          input.consentRequired ?? false,input.consentVerified ?? false,input.now,
        ],
      );
      await client.query(
        `update instagram_engagement_threads set
           state='FOLLOW_UP_REQUIRED',follow_up_required=true,follow_up_due_at=$2::timestamptz,
           updated_at=$3::timestamptz,version=version+1 where thread_id=$1`,
        [input.threadId, input.dueAt, input.now],
      );
      await client.query('commit');
      return { followUpIdSha256: digest(followUpId), reused: false };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async recordFaqSignal(input: {
    readonly question: string;
    readonly primaryIntent: InstagramCanonicalIntent;
    readonly kbHit: boolean;
    readonly resolved: boolean;
    readonly now: string;
  }): Promise<{ readonly questionSha256: string }> {
    validDateMs(input.now, 'INSTAGRAM_ENGAGEMENT_FAQ_SIGNAL_NOW_INVALID');
    const normalized = normalizeQuestionForAnalytics(input.question);
    if (!normalized.redacted) throw new Error('INSTAGRAM_ENGAGEMENT_FAQ_SIGNAL_QUESTION_REQUIRED');
    await this.pool.query(
      `insert into instagram_engagement_faq_signals (
         normalized_question_sha256,normalized_question_redacted,primary_intent,occurrence_count,
         kb_hit_count,kb_miss_count,resolved_count,first_seen_at,last_seen_at,review_state,updated_at
       ) values ($1,$2,$3,1,$4,$5,$6,$7::timestamptz,$7::timestamptz,'OBSERVE',$7::timestamptz)
       on conflict (normalized_question_sha256) do update set
         occurrence_count=instagram_engagement_faq_signals.occurrence_count+1,
         kb_hit_count=instagram_engagement_faq_signals.kb_hit_count+excluded.kb_hit_count,
         kb_miss_count=instagram_engagement_faq_signals.kb_miss_count+excluded.kb_miss_count,
         resolved_count=instagram_engagement_faq_signals.resolved_count+excluded.resolved_count,
         last_seen_at=excluded.last_seen_at,
         review_state=case
           when instagram_engagement_faq_signals.occurrence_count+1 >= $8
            and instagram_engagement_faq_signals.kb_miss_count+excluded.kb_miss_count > 0
           then 'NEEDS_FAQ_REVIEW'
           else instagram_engagement_faq_signals.review_state
         end,
         updated_at=excluded.updated_at`,
      [
        normalized.sha256,normalized.redacted,input.primaryIntent,input.kbHit ? 1 : 0,
        input.kbHit ? 0 : 1,input.resolved ? 1 : 0,input.now,this.#faqReviewMinOccurrences,
      ],
    );
    return { questionSha256: normalized.sha256 };
  }

  async recordClassificationFeedback(input: {
    readonly eventId: string;
    readonly predictedIntent: InstagramCanonicalIntent;
    readonly expectedIntent: InstagramCanonicalIntent;
    readonly predictedPriority?: SocialPriority;
    readonly expectedPriority?: SocialPriority;
    readonly predictedAutonomy?: string;
    readonly expectedAutonomy?: string;
    readonly now: string;
  }): Promise<{ readonly feedbackId: string }> {
    validDateMs(input.now, 'INSTAGRAM_ENGAGEMENT_FEEDBACK_NOW_INVALID');
    const eventSha256 = digest(input.eventId);
    const feedbackId = digest(
      `feedback|${eventSha256}|${input.predictedIntent}|${input.expectedIntent}|${input.now}`,
    );
    await this.pool.query(
      `insert into instagram_engagement_classification_feedback (
         feedback_id,event_sha256,predicted_intent,expected_intent,predicted_priority,expected_priority,
         predicted_autonomy,expected_autonomy,intent_mismatch,priority_mismatch,autonomy_mismatch,
         review_state,created_at,updated_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'RECORDED',$12::timestamptz,$12::timestamptz)`,
      [
        feedbackId,eventSha256,input.predictedIntent,input.expectedIntent,
        input.predictedPriority ?? null,input.expectedPriority ?? null,
        input.predictedAutonomy ?? null,input.expectedAutonomy ?? null,
        input.predictedIntent !== input.expectedIntent,
        (input.predictedPriority ?? null) !== (input.expectedPriority ?? null),
        (input.predictedAutonomy ?? null) !== (input.expectedAutonomy ?? null),input.now,
      ],
    );
    return { feedbackId };
  }

  async recordAdContext(input: {
    readonly threadId: string;
    readonly campaignId?: string;
    readonly adSetId?: string;
    readonly adId?: string;
    readonly creativeId?: string;
    readonly attributionVerified: boolean;
    readonly now: string;
  }): Promise<void> {
    validDateMs(input.now, 'INSTAGRAM_ENGAGEMENT_AD_CONTEXT_NOW_INVALID');
    if (!input.attributionVerified) {
      throw new Error('INSTAGRAM_ENGAGEMENT_AD_ATTRIBUTION_NOT_VERIFIED');
    }
    if (!input.campaignId && !input.adSetId && !input.adId && !input.creativeId) {
      throw new Error('INSTAGRAM_ENGAGEMENT_AD_CONTEXT_EMPTY');
    }
    await this.pool.query(
      `update instagram_engagement_threads set
         source_campaign_id=$2,source_ad_set_id=$3,source_ad_id=$4,source_creative_id=$5,
         attribution_verified=true,updated_at=$6::timestamptz,version=version+1
       where thread_id=$1`,
      [
        input.threadId,input.campaignId ?? null,input.adSetId ?? null,input.adId ?? null,
        input.creativeId ?? null,input.now,
      ],
    );
  }

  async getStatusDashboard(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly organizationId: string;
  }): Promise<InstagramResponseStatusDashboard> {
    const result = await this.pool.query<DashboardRow>(
      `select
        (select count(*) from instagram_engagement_threads t
          where t.tenant_id=$1 and t.workspace_id=$2 and t.organization_id=$3 and t.state='NEW') as new_conversations,
        (select count(*) from instagram_engagement_threads t
          where t.tenant_id=$1 and t.workspace_id=$2 and t.organization_id=$3
            and t.state in ('NEW','CLASSIFIED','RESPONDABLE','AWAITING_APPROVAL')) as unanswered_conversations,
        (select count(*) from instagram_engagement_threads t
          where t.tenant_id=$1 and t.workspace_id=$2 and t.organization_id=$3 and t.state='AWAITING_CUSTOMER') as awaiting_customer,
        (select count(*) from instagram_engagement_human_queue h
          where h.tenant_id=$1 and h.workspace_id=$2 and h.organization_id=$3
            and h.state in ('PENDING','ACKNOWLEDGED')) as awaiting_human,
        (select count(*) from instagram_engagement_threads t
          where t.tenant_id=$1 and t.workspace_id=$2 and t.organization_id=$3 and t.state='ESCALATED') as escalated,
        (select count(*) from instagram_engagement_threads t
          where t.tenant_id=$1 and t.workspace_id=$2 and t.organization_id=$3
            and t.priority='P0' and t.state not in ('RESOLVED','CLOSED')) as p0_open,
        (select count(*) from instagram_engagement_threads t
          where t.tenant_id=$1 and t.workspace_id=$2 and t.organization_id=$3
            and t.priority='P1' and t.state not in ('RESOLVED','CLOSED')) as p1_open,
        (select count(*) from instagram_engagement_actions a
          where a.tenant_id=$1 and a.workspace_id=$2 and a.organization_id=$3 and a.status='SEND_FAILED') as send_failed,
        (select count(*) from instagram_engagement_actions a
          where a.tenant_id=$1 and a.workspace_id=$2 and a.organization_id=$3 and a.status='SEND_AMBIGUOUS') as send_ambiguous,
        (select count(*) from event_outbox e
          where e.tenant_id=$1 and e.event_type in ('instagram.engagement.inbound.v1','instagram.engagement.reply.v1')
            and e.status='DEAD_LETTER') as dead_letter,
        (select count(*) from instagram_engagement_human_queue h
          where h.tenant_id=$1 and h.workspace_id=$2 and h.organization_id=$3
            and h.state in ('PENDING','ACKNOWLEDGED') and h.sla_due_at < now()) as overdue_human_escalations,
        (select coalesce(sum(kb_miss_count),0) from instagram_engagement_faq_signals) as faq_misses,
        (select percentile_cont(0.5) within group (order by extract(epoch from (t.first_response_at-t.first_inbound_at))*1000)
           from instagram_engagement_threads t where t.tenant_id=$1 and t.workspace_id=$2 and t.organization_id=$3
             and t.first_response_at is not null and t.first_inbound_at is not null) as median_first_response_ms,
        (select percentile_cont(0.95) within group (order by extract(epoch from (t.first_response_at-t.first_inbound_at))*1000)
           from instagram_engagement_threads t where t.tenant_id=$1 and t.workspace_id=$2 and t.organization_id=$3
             and t.first_response_at is not null and t.first_inbound_at is not null) as p95_first_response_ms`,
      [input.tenantId, input.workspaceId, input.organizationId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('INSTAGRAM_ENGAGEMENT_DASHBOARD_QUERY_EMPTY');
    return {
      newConversations: integer(row.new_conversations),
      unansweredConversations: integer(row.unanswered_conversations),
      awaitingCustomer: integer(row.awaiting_customer),
      awaitingHuman: integer(row.awaiting_human),
      escalated: integer(row.escalated),
      p0Open: integer(row.p0_open),
      p1Open: integer(row.p1_open),
      sendFailed: integer(row.send_failed),
      sendAmbiguous: integer(row.send_ambiguous),
      deadLetter: integer(row.dead_letter),
      overdueHumanEscalations: integer(row.overdue_human_escalations),
      faqMisses: integer(row.faq_misses),
      medianFirstResponseMs: nullableNumber(row.median_first_response_ms),
      p95FirstResponseMs: nullableNumber(row.p95_first_response_ms),
    };
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function validDateMs(value: string, code: string): number {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(code);
  return ms;
}

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function timestampOrNull(value: Date | string | null): string | null {
  return value === null ? null : timestamp(value);
}

function integer(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('INSTAGRAM_ENGAGEMENT_DASHBOARD_COUNT_INVALID');
  }
  return parsed;
}

function nullableNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('INSTAGRAM_ENGAGEMENT_DASHBOARD_DURATION_INVALID');
  }
  return parsed;
}
