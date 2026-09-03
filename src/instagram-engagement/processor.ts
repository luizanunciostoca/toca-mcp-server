import type pg from 'pg';
import { classifySocialEngagement } from '../crm/social-engagement-classifier.js';
import {
  socialInteractionFromInstagramWebhook,
  type SocialEngagementLeadEngine,
} from '../crm/social-engagement-lead-engine.js';
import { MetaApiError } from '../providers/meta/meta-api-client.js';
import type {
  EngagementDecision,
  InstagramEngagementProvider,
  InstagramWebhookEvent,
} from '../providers/instagram/instagram-engagement-contracts.js';
import { PostgresTransactionalOutbox } from '../events/postgres-transactional-outbox.js';
import {
  INSTAGRAM_ENGAGEMENT_INBOUND_EVENT_TYPE,
  INSTAGRAM_ENGAGEMENT_REPLY_EVENT_TYPE,
  createInstagramEngagementReplyEnvelope,
  parseInstagramEngagementInboundPayload,
  parseInstagramEngagementReplyPayload,
  type InstagramEngagementReplyPayload,
} from './events.js';
import type { InstagramEngagementKnowledgeSource } from './knowledge.js';
import {
  PostgresInstagramEngagementActionStore,
  type InstagramEngagementActionStatus,
} from './postgres-action-store.js';
import { PostgresInstagramConversationOperations } from './conversation-operations.js';
import {
  recordConversationReply,
  recordConversationReplyFailure,
} from './conversation-reply-state.js';
import type { ClaimedInstagramEngagementEvent } from './typed-outbox.js';

type InboundActionStatus = Extract<
  InstagramEngagementActionStatus,
  'CLASSIFIED' | 'SUGGESTED' | 'HUMAN_REVIEW' | 'READY_TO_SEND'
>;

export interface InstagramEngagementProcessorOptions {
  readonly pool: pg.Pool;
  readonly knowledge: InstagramEngagementKnowledgeSource;
  readonly leadEngine: SocialEngagementLeadEngine;
  readonly provider: InstagramEngagementProvider;
  readonly pageId: string;
  readonly instagramUserId: string;
  readonly writesEnabled: boolean;
  readonly autoReplyChannels?: readonly ('COMMENT' | 'DIRECT')[];
  readonly actorPrincipalId?: string;
  readonly groupingWindowMs?: number;
  readonly now?: () => Date;
}

export class InstagramEngagementProcessor {
  private readonly outbox: PostgresTransactionalOutbox;
  private readonly actions: PostgresInstagramEngagementActionStore;
  private readonly conversations: PostgresInstagramConversationOperations;
  private readonly now: () => Date;
  private readonly actorPrincipalId: string;

  constructor(private readonly options: InstagramEngagementProcessorOptions) {
    if (!options.pageId.trim()) throw new Error('INSTAGRAM_ENGAGEMENT_PAGE_ID_REQUIRED');
    if (!options.instagramUserId.trim()) throw new Error('INSTAGRAM_BUSINESS_ACCOUNT_ID_REQUIRED');
    this.outbox = new PostgresTransactionalOutbox(options.pool);
    this.actions = new PostgresInstagramEngagementActionStore(options.pool);
    this.conversations = new PostgresInstagramConversationOperations(options.pool, {
      ...(options.groupingWindowMs === undefined
        ? {}
        : { groupingWindowMs: options.groupingWindowMs }),
    });
    this.now = options.now ?? (() => new Date());
    this.actorPrincipalId = options.actorPrincipalId?.trim() || 'system:instagram-engagement';
  }

  async process(claimed: ClaimedInstagramEngagementEvent): Promise<void> {
    if (claimed.eventType === INSTAGRAM_ENGAGEMENT_INBOUND_EVENT_TYPE) {
      await this.processInbound(claimed);
      return;
    }
    if (claimed.eventType === INSTAGRAM_ENGAGEMENT_REPLY_EVENT_TYPE) {
      await this.processReply(claimed);
      return;
    }
    throw new Error('INSTAGRAM_ENGAGEMENT_EVENT_TYPE_UNSUPPORTED');
  }

  private async processInbound(claimed: ClaimedInstagramEngagementEvent): Promise<void> {
    const payload = parseInstagramEngagementInboundPayload(claimed.payload);
    const now = this.now().toISOString();
    const context = await this.conversations.claimMessageGroup({
      payload,
      tenantId: claimed.tenantId,
      workspaceId: claimed.workspaceId,
      organizationId: claimed.organizationId,
      now,
    });

    if (!context.isGroupOwner) {
      await this.outbox.markDelivered({
        eventId: claimed.eventId,
        executionId: claimed.executionId,
        evidence: ['instagram:engagement:message-group-coalesced'],
        now: this.now().toISOString(),
      });
      return;
    }

    const webhookEvent: InstagramWebhookEvent = {
      eventId: payload.eventId,
      accountId: payload.accountId,
      channel: payload.channel,
      ...(payload.senderId ? { senderId: payload.senderId } : {}),
      ...(payload.commentId ? { commentId: payload.commentId } : {}),
      ...(payload.messageId ? { messageId: payload.messageId } : {}),
      ...(payload.mediaId ? { mediaId: payload.mediaId } : {}),
      ...(context.groupedText ? { text: context.groupedText } : {}),
      occurredAt: payload.occurredAt ?? now,
      rawType: payload.rawType,
    };
    const classification = classifySocialEngagement(context.groupedText);
    const knowledge = context.groupedText
      ? await this.options.knowledge.resolve(context.groupedText, classification.intent)
      : null;
    const autoReplyChannels = new Set(
      this.options.autoReplyChannels ?? (['COMMENT', 'DIRECT'] as const),
    );
    const autoWriteEligible =
      this.options.writesEnabled &&
      autoReplyChannels.has(payload.channel) &&
      classification.confidence === 'HIGH' &&
      ['P2', 'P3'].includes(classification.priority) &&
      !classification.containsPotentialSensitiveData &&
      classification.commercialIntent === 'NONE' &&
      classification.urgency === 'LOW' &&
      !context.automationBlocked;
    const leadResult = await this.options.leadEngine.process({
      tenantId: claimed.tenantId,
      workspaceId: claimed.workspaceId,
      organizationId: claimed.organizationId,
      interaction: socialInteractionFromInstagramWebhook(webhookEvent),
      authorization: {
        factsVerified: knowledge?.factsVerified === true,
        writesEnabled: autoWriteEligible,
        consentAllowed: true,
        approvalRequired: false,
        approvalSatisfied: false,
        containsSensitivePersonalData: classification.containsPotentialSensitiveData,
        classificationConfidence: classification.confidence,
        threadAutomationBlocked: context.automationBlocked,
      },
      idempotencyKey: `instagram-engagement:${context.groupSha256}`,
      executionId: claimed.executionId,
      correlationId: claimed.correlationId,
      actorPrincipalId: this.actorPrincipalId,
      evidence: [
        'meta:webhook:persisted',
        'instagram:engagement:message-grouped',
        `instagram:engagement:group-size:${context.messageCount}`,
        'instagram:engagement:classified',
      ],
      now,
    });

    const effectiveDecision = conversationDecision({
      decision: leadResult.policyDecision,
      confidence: classification.confidence,
      automationBlocked: context.automationBlocked,
      channel: payload.channel,
    });
    const effectiveHumanRequired =
      leadResult.humanRequired || effectiveDecision.autonomy === 'HUMAN_REVIEW_REQUIRED';
    const effectiveDisposition = effectiveHumanRequired
      ? ('HUMAN_REQUIRED' as const)
      : effectiveDecision.autonomy === 'AUTO_REPLY_ALLOWED'
        ? ('AUTO_REPLY_ALLOWED' as const)
        : effectiveDecision.autonomy === 'SUGGEST_ONLY'
          ? ('SUGGEST_ONLY' as const)
          : leadResult.replyDisposition;

    const reply = buildReplyPayload({
      event: webhookEvent,
      disposition: effectiveDisposition,
      knowledge,
      pageId: this.options.pageId,
      instagramUserId: this.options.instagramUserId,
    });
    const status = resolveActionStatus(effectiveHumanRequired, effectiveDisposition, reply);
    await this.actions.createIfAbsent({
      eventId: payload.eventId,
      tenantId: claimed.tenantId,
      workspaceId: claimed.workspaceId,
      organizationId: claimed.organizationId,
      channel: payload.channel,
      intent: leadResult.classification.intent,
      decision: effectiveDecision,
      knowledge,
      ...(reply ? { replyMessage: reply.message } : {}),
      status,
      executionId: claimed.executionId,
      now,
      threadId: context.threadId,
      messageGroupSha256: context.groupSha256,
      classificationConfidence: classification.confidence,
      priority: classification.priority,
      secondaryIntents: classification.conversationIntents.slice(1),
    });
    await this.conversations.recordDecision({
      threadId: context.threadId,
      groupSha256: context.groupSha256,
      classification,
      actionStatus: status,
      now,
    });

    if (status === 'READY_TO_SEND' && reply) {
      const client = await this.options.pool.connect();
      try {
        await client.query('begin');
        await this.outbox.enqueue(
          client,
          createInstagramEngagementReplyEnvelope({
            inboundEventId: claimed.eventId,
            engagementEventId: payload.eventId,
            scope: {
              tenantId: claimed.tenantId,
              workspaceId: claimed.workspaceId,
              organizationId: claimed.organizationId,
            },
            occurredAt: now,
            payload: reply,
          }),
          { availableAt: now, maxAttempts: 1 },
        );
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    }

    await this.outbox.markDelivered({
      eventId: claimed.eventId,
      executionId: claimed.executionId,
      evidence: [
        `instagram:engagement:decision:${status}`,
        `instagram:engagement:thread:${context.threadId.slice(0, 12)}`,
        `instagram:engagement:confidence:${classification.confidence}`,
        `instagram:engagement:priority:${classification.priority}`,
      ],
      now: this.now().toISOString(),
    });
  }

  private async processReply(claimed: ClaimedInstagramEngagementEvent): Promise<void> {
    const payload = parseInstagramEngagementReplyPayload(claimed.payload);
    const now = this.now().toISOString();
    try {
      const providerReplyId = await executeProviderReply(this.options.provider, payload);
      await this.actions.complete({
        eventId: payload.engagementEventId,
        status: 'SENT',
        providerReplyId,
        executionId: claimed.executionId,
        now,
      });
      await recordConversationReply(this.options.pool, {
        engagementEventId: payload.engagementEventId,
        providerReplyId,
        now,
      });
      await this.outbox.markDelivered({
        eventId: claimed.eventId,
        executionId: claimed.executionId,
        evidence: ['instagram:engagement:provider-acknowledged'],
        now: this.now().toISOString(),
      });
    } catch (error) {
      const code = safeErrorCode(error);
      const ambiguous = isAmbiguousProviderFailure(error);
      await this.actions.complete({
        eventId: payload.engagementEventId,
        status: ambiguous ? 'SEND_AMBIGUOUS' : 'SEND_FAILED',
        failureCode: code,
        executionId: claimed.executionId,
        now,
      });
      await recordConversationReplyFailure(this.options.pool, {
        engagementEventId: payload.engagementEventId,
        ambiguous,
        now,
      });
      await this.outbox.markFailed({
        eventId: claimed.eventId,
        executionId: claimed.executionId,
        errorCode: code,
        evidence: [
          ambiguous
            ? 'instagram:engagement:provider-outcome-ambiguous'
            : 'instagram:engagement:provider-failed',
        ],
        now: this.now().toISOString(),
      });
    }
  }
}

function conversationDecision(input: {
  readonly decision: EngagementDecision;
  readonly confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  readonly automationBlocked: boolean;
  readonly channel: 'COMMENT' | 'DIRECT';
}): EngagementDecision {
  if (input.automationBlocked) {
    return {
      channel: input.channel,
      risk: 'HIGH',
      autonomy: 'HUMAN_REVIEW_REQUIRED',
      reason: 'thread_automation_blocked',
      requiresHumanReview: true,
    };
  }
  if (input.confidence === 'LOW' && input.decision.autonomy === 'AUTO_REPLY_ALLOWED') {
    return {
      channel: input.channel,
      risk: 'MEDIUM',
      autonomy: 'SUGGEST_ONLY',
      reason: 'classification_confidence_low',
      requiresHumanReview: false,
    };
  }
  return input.decision;
}

function buildReplyPayload(input: {
  readonly event: InstagramWebhookEvent;
  readonly disposition: 'AUTO_REPLY_ALLOWED' | 'SUGGEST_ONLY' | 'HUMAN_REQUIRED' | 'NO_REPLY';
  readonly knowledge: Awaited<ReturnType<InstagramEngagementKnowledgeSource['resolve']>>;
  readonly pageId: string;
  readonly instagramUserId: string;
}): InstagramEngagementReplyPayload | undefined {
  if (input.disposition !== 'AUTO_REPLY_ALLOWED' || !input.knowledge?.factsVerified) {
    return undefined;
  }
  if (input.event.channel === 'COMMENT') {
    if (!input.event.commentId) return undefined;
    return {
      engagementEventId: input.event.eventId,
      channel: 'COMMENT',
      commentId: input.event.commentId,
      message: input.knowledge.answer,
      faqId: input.knowledge.faqId,
    };
  }
  if (!input.event.senderId) return undefined;
  return {
    engagementEventId: input.event.eventId,
    channel: 'DIRECT',
    pageId: input.pageId,
    instagramUserId: input.instagramUserId,
    recipientScopedId: input.event.senderId,
    message: input.knowledge.answer,
    faqId: input.knowledge.faqId,
  };
}

function resolveActionStatus(
  humanRequired: boolean,
  disposition: 'AUTO_REPLY_ALLOWED' | 'SUGGEST_ONLY' | 'HUMAN_REQUIRED' | 'NO_REPLY',
  reply: InstagramEngagementReplyPayload | undefined,
): InboundActionStatus {
  if (humanRequired || disposition === 'HUMAN_REQUIRED') return 'HUMAN_REVIEW';
  if (disposition === 'AUTO_REPLY_ALLOWED' && reply) return 'READY_TO_SEND';
  if (disposition === 'SUGGEST_ONLY' || disposition === 'AUTO_REPLY_ALLOWED') return 'SUGGESTED';
  return 'CLASSIFIED';
}

async function executeProviderReply(
  provider: InstagramEngagementProvider,
  payload: InstagramEngagementReplyPayload,
): Promise<string> {
  if (payload.channel === 'COMMENT') {
    if (!payload.commentId) throw new Error('INSTAGRAM_ENGAGEMENT_COMMENT_ID_REQUIRED');
    const result = await provider.replyToComment({
      commentId: payload.commentId,
      message: payload.message,
    });
    return result.commentId;
  }
  if (!payload.pageId || !payload.instagramUserId || !payload.recipientScopedId) {
    throw new Error('INSTAGRAM_ENGAGEMENT_DIRECT_TARGET_REQUIRED');
  }
  const result = await provider.sendDirectReply({
    pageId: payload.pageId,
    instagramUserId: payload.instagramUserId,
    recipientScopedId: payload.recipientScopedId,
    message: payload.message,
  });
  return result.messageId;
}

function isAmbiguousProviderFailure(error: unknown): boolean {
  if (error instanceof MetaApiError) return true;
  if (!(error instanceof Error)) return true;
  return error.message.startsWith('INSTAGRAM_INVALID_RESPONSE:');
}

function safeErrorCode(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const first =
    raw.split('|', 1)[0]?.split(':', 1)[0]?.trim() || 'INSTAGRAM_ENGAGEMENT_SEND_FAILED';
  return /^[A-Z0-9_]+$/.test(first) ? first.slice(0, 120) : 'INSTAGRAM_ENGAGEMENT_SEND_FAILED';
}
