import { describe, expect, it } from 'vitest';
import {
  INSTAGRAM_ENGAGEMENT_INBOUND_EVENT_TYPE,
  INSTAGRAM_ENGAGEMENT_REPLY_EVENT_TYPE,
  createInstagramEngagementInboundEnvelope,
  createInstagramEngagementReplyEnvelope,
  parseInstagramEngagementInboundPayload,
  parseInstagramEngagementReplyPayload,
} from '../src/instagram-engagement/events.js';

describe('Instagram engagement outbox contracts', () => {
  it('normalizes missing webhook occurrence time and carries only the data required for processing', () => {
    const envelope = createInstagramEngagementInboundEnvelope(
      {
        eventId: 'event-1',
        accountId: 'account-1',
        channel: 'DIRECT',
        senderId: 'sender-1',
        messageId: 'message-1',
        text: 'Qual o horario?',
        rawType: 'messaging',
      },
      { tenantId: 'tenant', workspaceId: 'workspace', organizationId: 'org' },
      '2026-08-28T12:00:00.000Z',
    );
    expect(envelope.eventType).toBe(INSTAGRAM_ENGAGEMENT_INBOUND_EVENT_TYPE);
    const payload = parseInstagramEngagementInboundPayload(envelope.payload);
    expect(payload.occurredAt).toBe('2026-08-28T12:00:00.000Z');
    expect(payload.senderId).toBe('sender-1');
    expect(envelope.evidence).toContain('meta:webhook:persisted');
  });

  it('creates one deterministic reply event per engagement event', () => {
    const first = createInstagramEngagementReplyEnvelope({
      inboundEventId: 'instagram-engagement-inbound:event-1',
      engagementEventId: 'event-1',
      scope: { tenantId: 'tenant', workspaceId: 'workspace', organizationId: 'org' },
      occurredAt: '2026-08-28T12:01:00.000Z',
      payload: {
        engagementEventId: 'event-1',
        channel: 'COMMENT',
        commentId: 'comment-1',
        message: 'Resposta oficial',
        faqId: 'FAQ-001',
      },
    });
    const second = createInstagramEngagementReplyEnvelope({
      inboundEventId: 'instagram-engagement-inbound:event-1',
      engagementEventId: 'event-1',
      scope: { tenantId: 'tenant', workspaceId: 'workspace', organizationId: 'org' },
      occurredAt: '2026-08-28T12:01:00.000Z',
      payload: parseInstagramEngagementReplyPayload(first.payload),
    });
    expect(first.eventType).toBe(INSTAGRAM_ENGAGEMENT_REPLY_EVENT_TYPE);
    expect(first.eventId).toBe(second.eventId);
    expect(first.eventKey).toBe(second.eventKey);
  });
});
