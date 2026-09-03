import { createHash } from 'node:crypto';
import type pg from 'pg';
import type { SocialPriority } from '../crm/social-engagement-contracts.js';
import type { InstagramCanonicalIntent } from './conversation-control-plane.js';

export interface InstagramConversationAnalyticsScope {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
}

export interface InstagramResponseQaScores {
  readonly factuality: number;
  readonly verbalIdentity: number;
  readonly clarity: number;
  readonly personalization: number;
  readonly safety: number;
  readonly concision: number;
  readonly ctaQuality: number;
  readonly contextAwareness: number;
}

export class PostgresInstagramConversationAnalyticsScoped {
  readonly #scope: InstagramConversationAnalyticsScope;
  readonly #faqReviewMinOccurrences: number;

  constructor(
    private readonly pool: pg.Pool,
    scope: InstagramConversationAnalyticsScope,
    faqReviewMinOccurrences = 5,
  ) {
    this.#scope = validateScope(scope);
    if (!Number.isInteger(faqReviewMinOccurrences) || faqReviewMinOccurrences < 2) {
      throw new Error('INSTAGRAM_ENGAGEMENT_FAQ_REVIEW_THRESHOLD_INVALID');
    }
    this.#faqReviewMinOccurrences = faqReviewMinOccurrences;
  }

  async recordFaqSignal(input: {
    readonly questionRedacted: string;
    readonly questionSha256: string;
    readonly primaryIntent: InstagramCanonicalIntent;
    readonly kbHit: boolean;
    readonly resolved: boolean;
    readonly now: string;
  }): Promise<void> {
    validateTimestamp(input.now, 'INSTAGRAM_ENGAGEMENT_FAQ_SIGNAL_NOW_INVALID');
    validateSha256(input.questionSha256, 'INSTAGRAM_ENGAGEMENT_FAQ_SIGNAL_SHA256_INVALID');
    const question = input.questionRedacted.trim().slice(0, 280);
    if (!question) throw new Error('INSTAGRAM_ENGAGEMENT_FAQ_SIGNAL_QUESTION_REQUIRED');

    await this.pool.query(
      `insert into instagram_engagement_faq_signals_scoped (
         tenant_id,workspace_id,organization_id,normalized_question_sha256,
         normalized_question_redacted,primary_intent,occurrence_count,kb_hit_count,kb_miss_count,
         resolved_count,first_seen_at,last_seen_at,review_state,updated_at
       ) values ($1,$2,$3,$4,$5,$6,1,$7,$8,$9,$10::timestamptz,$10::timestamptz,'OBSERVE',$10::timestamptz)
       on conflict (tenant_id,workspace_id,organization_id,normalized_question_sha256) do update set
         occurrence_count=instagram_engagement_faq_signals_scoped.occurrence_count+1,
         kb_hit_count=instagram_engagement_faq_signals_scoped.kb_hit_count+excluded.kb_hit_count,
         kb_miss_count=instagram_engagement_faq_signals_scoped.kb_miss_count+excluded.kb_miss_count,
         resolved_count=instagram_engagement_faq_signals_scoped.resolved_count+excluded.resolved_count,
         last_seen_at=excluded.last_seen_at,
         review_state=case
           when instagram_engagement_faq_signals_scoped.occurrence_count+1 >= $11
            and instagram_engagement_faq_signals_scoped.kb_miss_count+excluded.kb_miss_count > 0
           then 'NEEDS_FAQ_REVIEW'
           else instagram_engagement_faq_signals_scoped.review_state
         end,
         updated_at=excluded.updated_at`,
      [
        this.#scope.tenantId,
        this.#scope.workspaceId,
        this.#scope.organizationId,
        input.questionSha256,
        question,
        input.primaryIntent,
        input.kbHit ? 1 : 0,
        input.kbHit ? 0 : 1,
        input.resolved ? 1 : 0,
        input.now,
        this.#faqReviewMinOccurrences,
      ],
    );
  }

  async recordClassificationFeedback(input: {
    readonly eventSha256: string;
    readonly predictedIntent: InstagramCanonicalIntent;
    readonly expectedIntent: InstagramCanonicalIntent;
    readonly predictedPriority?: SocialPriority;
    readonly expectedPriority?: SocialPriority;
    readonly predictedAutonomy?: string;
    readonly expectedAutonomy?: string;
    readonly now: string;
  }): Promise<{ readonly feedbackId: string }> {
    validateTimestamp(input.now, 'INSTAGRAM_ENGAGEMENT_FEEDBACK_NOW_INVALID');
    validateSha256(input.eventSha256, 'INSTAGRAM_ENGAGEMENT_FEEDBACK_EVENT_SHA256_INVALID');
    const feedbackId = digest(
      `${this.#scope.tenantId}|${this.#scope.workspaceId}|${this.#scope.organizationId}|${input.eventSha256}|${input.predictedIntent}|${input.expectedIntent}|${input.now}`,
    );

    await this.pool.query(
      `insert into instagram_engagement_classification_feedback_scoped (
         tenant_id,workspace_id,organization_id,feedback_id,event_sha256,predicted_intent,
         expected_intent,predicted_priority,expected_priority,predicted_autonomy,expected_autonomy,
         intent_mismatch,priority_mismatch,autonomy_mismatch,review_state,created_at,updated_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'RECORDED',$15::timestamptz,$15::timestamptz)`,
      [
        this.#scope.tenantId,
        this.#scope.workspaceId,
        this.#scope.organizationId,
        feedbackId,
        input.eventSha256,
        input.predictedIntent,
        input.expectedIntent,
        input.predictedPriority ?? null,
        input.expectedPriority ?? null,
        input.predictedAutonomy ?? null,
        input.expectedAutonomy ?? null,
        input.predictedIntent !== input.expectedIntent,
        (input.predictedPriority ?? null) !== (input.expectedPriority ?? null),
        (input.predictedAutonomy ?? null) !== (input.expectedAutonomy ?? null),
        input.now,
      ],
    );
    return { feedbackId };
  }

  async recordResponseQa(input: {
    readonly eventSha256: string;
    readonly scores: InstagramResponseQaScores;
    readonly duplicateDetected: boolean;
    readonly reviewer: string;
    readonly reviewedAt: string;
  }): Promise<void> {
    validateTimestamp(input.reviewedAt, 'INSTAGRAM_ENGAGEMENT_RESPONSE_QA_TIME_INVALID');
    validateSha256(input.eventSha256, 'INSTAGRAM_ENGAGEMENT_RESPONSE_QA_EVENT_SHA256_INVALID');
    const reviewer = input.reviewer.trim().slice(0, 160);
    if (!reviewer) throw new Error('INSTAGRAM_ENGAGEMENT_RESPONSE_QA_REVIEWER_REQUIRED');
    const scores = validateScores(input.scores);

    await this.pool.query(
      `insert into instagram_engagement_response_qa_scoped (
         tenant_id,workspace_id,organization_id,event_sha256,factuality,verbal_identity,clarity,
         personalization,safety,concision,cta_quality,context_awareness,duplicate_detected,
         reviewer,reviewed_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::timestamptz)
       on conflict (tenant_id,workspace_id,organization_id,event_sha256) do update set
         factuality=excluded.factuality,
         verbal_identity=excluded.verbal_identity,
         clarity=excluded.clarity,
         personalization=excluded.personalization,
         safety=excluded.safety,
         concision=excluded.concision,
         cta_quality=excluded.cta_quality,
         context_awareness=excluded.context_awareness,
         duplicate_detected=excluded.duplicate_detected,
         reviewer=excluded.reviewer,
         reviewed_at=excluded.reviewed_at`,
      [
        this.#scope.tenantId,
        this.#scope.workspaceId,
        this.#scope.organizationId,
        input.eventSha256,
        scores.factuality,
        scores.verbalIdentity,
        scores.clarity,
        scores.personalization,
        scores.safety,
        scores.concision,
        scores.ctaQuality,
        scores.contextAwareness,
        input.duplicateDetected,
        reviewer,
        input.reviewedAt,
      ],
    );
  }

  async getFaqMisses(): Promise<number> {
    const result = await this.pool.query<{ faq_misses: number | string }>(
      `select coalesce(sum(kb_miss_count),0) as faq_misses
         from instagram_engagement_faq_signals_scoped
        where tenant_id=$1 and workspace_id=$2 and organization_id=$3`,
      [this.#scope.tenantId, this.#scope.workspaceId, this.#scope.organizationId],
    );
    return integer(result.rows[0]?.faq_misses ?? 0);
  }
}

function validateScope(
  scope: InstagramConversationAnalyticsScope,
): InstagramConversationAnalyticsScope {
  const tenantId = scope.tenantId.trim();
  const workspaceId = scope.workspaceId.trim();
  const organizationId = scope.organizationId.trim();
  if (!tenantId) throw new Error('INSTAGRAM_ENGAGEMENT_ANALYTICS_TENANT_REQUIRED');
  if (!workspaceId) throw new Error('INSTAGRAM_ENGAGEMENT_ANALYTICS_WORKSPACE_REQUIRED');
  if (!organizationId) throw new Error('INSTAGRAM_ENGAGEMENT_ANALYTICS_ORGANIZATION_REQUIRED');
  return { tenantId, workspaceId, organizationId };
}

function validateScores(scores: InstagramResponseQaScores): InstagramResponseQaScores {
  for (const value of Object.values(scores)) {
    if (!Number.isInteger(value) || value < 0 || value > 5) {
      throw new Error('INSTAGRAM_ENGAGEMENT_RESPONSE_QA_SCORE_INVALID');
    }
  }
  return scores;
}

function validateTimestamp(value: string, code: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(code);
}

function validateSha256(value: string, code: string): void {
  if (!/^[0-9a-f]{64}$/u.test(value)) throw new Error(code);
}

function integer(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('INSTAGRAM_ENGAGEMENT_ANALYTICS_INTEGER_INVALID');
  }
  return parsed;
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
