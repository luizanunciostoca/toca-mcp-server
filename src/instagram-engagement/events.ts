import { z } from 'zod/v4';
import type { DomainEventEnvelope } from '../events/transactional-outbox.js';
import type { InstagramWebhookEvent } from '../providers/instagram/instagram-engagement-contracts.js';

export const INSTAGRAM_ENGAGEMENT_INBOUND_EVENT_TYPE = 'instagram.engagement.inbound.v1';
export const INSTAGRAM_ENGAGEMENT_REPLY_EVENT_TYPE = 'instagram.engagement.reply.v1';

export interface InstagramEngagementScope {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
}

const inboundPayloadSchema = z.object({
  eventId: z.string().min(1),
  accountId: z.string().min(1),
  channel: z.enum(['COMMENT', 'DIRECT']),
  senderId: z.string().min(1).optional(),
  commentId: z.string().min(1).optional(),
  messageId: z.string().min(1).optional(),
  mediaId: z.string().min(1).optional(),
  text: z.string().max(20_000).optional(),
  occurredAt: z.string().min(1),
  rawType: z.string().min(1),
});

const replyPayloadSchema = z.object({
  engagementEventId: z.string().min(1),
  channel: z.enum(['COMMENT', 'DIRECT']),
  commentId: z.string().min(1).optional(),
  pageId: z.string().min(1).optional(),
  instagramUserId: z.string().min(1).optional(),
  recipientScopedId: z.string().min(1).optional(),
  message: z.string().min(1).max(2_000),
  faqId: z.string().min(1),
});

export type InstagramEngagementInboundPayload = z.infer<typeof inboundPayloadSchema>;
export type InstagramEngagementReplyPayload = z.infer<typeof replyPayloadSchema>;

export function parseInstagramEngagementInboundPayload(
  value: unknown,
): InstagramEngagementInboundPayload {
  return inboundPayloadSchema.parse(value);
}

export function parseInstagramEngagementReplyPayload(
  value: unknown,
): InstagramEngagementReplyPayload {
  return replyPayloadSchema.parse(value);
}

export function createInstagramEngagementInboundEnvelope(
  event: InstagramWebhookEvent,
  scope: InstagramEngagementScope,
  fallbackOccurredAt = new Date().toISOString(),
): DomainEventEnvelope {
  const occurredAt = event.occurredAt ?? fallbackOccurredAt;
  return {
    eventId: `instagram-engagement-inbound:${event.eventId}`,
    eventKey: `instagram-engagement-inbound:${event.eventId}`,
    eventType: INSTAGRAM_ENGAGEMENT_INBOUND_EVENT_TYPE,
    schemaVersion: '1',
    aggregateType: 'instagram_engagement',
    aggregateId: event.eventId,
    aggregateVersion: 1,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    organizationId: scope.organizationId,
    correlationId: event.eventId,
    causationId: event.eventId,
    occurredAt,
    payload: {
      eventId: event.eventId,
      accountId: event.accountId,
      channel: event.channel,
      ...(event.senderId ? { senderId: event.senderId } : {}),
      ...(event.commentId ? { commentId: event.commentId } : {}),
      ...(event.messageId ? { messageId: event.messageId } : {}),
      ...(event.mediaId ? { mediaId: event.mediaId } : {}),
      ...(event.text ? { text: event.text } : {}),
      occurredAt,
      rawType: event.rawType,
    } satisfies InstagramEngagementInboundPayload,
    evidence: ['meta:webhook:signature-verified', 'meta:webhook:persisted'],
  };
}

export function createInstagramEngagementReplyEnvelope(input: {
  readonly inboundEventId: string;
  readonly engagementEventId: string;
  readonly scope: InstagramEngagementScope;
  readonly occurredAt: string;
  readonly payload: InstagramEngagementReplyPayload;
}): DomainEventEnvelope {
  return {
    eventId: `instagram-engagement-reply:${input.engagementEventId}`,
    eventKey: `instagram-engagement-reply:${input.engagementEventId}`,
    eventType: INSTAGRAM_ENGAGEMENT_REPLY_EVENT_TYPE,
    schemaVersion: '1',
    aggregateType: 'instagram_engagement',
    aggregateId: input.engagementEventId,
    aggregateVersion: 1,
    tenantId: input.scope.tenantId,
    workspaceId: input.scope.workspaceId,
    organizationId: input.scope.organizationId,
    correlationId: input.engagementEventId,
    causationId: input.inboundEventId,
    occurredAt: input.occurredAt,
    payload: input.payload,
    evidence: ['instagram:engagement:policy-auto-reply', 'instagram:engagement:verified-fact'],
  };
}
