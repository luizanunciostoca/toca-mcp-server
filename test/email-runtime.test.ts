import { describe, expect, it } from 'vitest';
import {
  assertCanonicalEmailMessage,
  computeEmailRetryDelayMs,
  deterministicEmailId,
  mapSendGridEventToDeliveryState,
  normalizeEmailAddress,
  normalizeInternetMessageId,
  providerPrivacySignalForEvent,
  resolveEmailThreadLookupIds,
  resolveEmailTrackingSettings,
  validateEmailAttachments,
  type EmailAttachmentDescriptor,
} from '../src/omnichannel/email-runtime.js';
import type { MessageRecord } from '../src/crm/sales-engine.js';

const scope = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  organizationId: 'org-1',
} as const;

describe('email runtime privacy and provider invariants', () => {
  it('enables open/click tracking only when both Privacy and Policy allow it', () => {
    expect(
      resolveEmailTrackingSettings({
        privacyAllowed: true,
        policyAllowed: true,
        openTrackingRequested: true,
        clickTrackingRequested: true,
      }),
    ).toEqual({ openTracking: true, clickTracking: true, blockedReasons: [] });

    expect(
      resolveEmailTrackingSettings({
        privacyAllowed: false,
        policyAllowed: true,
        openTrackingRequested: true,
        clickTrackingRequested: true,
      }),
    ).toEqual({
      openTracking: false,
      clickTracking: false,
      blockedReasons: ['PRIVACY_NOT_ALLOWED'],
    });

    expect(
      resolveEmailTrackingSettings({
        privacyAllowed: true,
        policyAllowed: false,
        openTrackingRequested: true,
        clickTrackingRequested: true,
      }),
    ).toEqual({
      openTracking: false,
      clickTracking: false,
      blockedReasons: ['POLICY_NOT_ALLOWED'],
    });
  });

  it('maps provider bounce, complaint and unsubscribe to canonical Privacy reconciliation signals', () => {
    expect(providerPrivacySignalForEvent('bounce')).toBe('BOUNCED');
    expect(providerPrivacySignalForEvent('spamreport')).toBe('COMPLAINT');
    expect(providerPrivacySignalForEvent('unsubscribe')).toBe('UNSUBSCRIBED');
    expect(providerPrivacySignalForEvent('group_unsubscribe')).toBe('UNSUBSCRIBED');
    expect(providerPrivacySignalForEvent('delivered')).toBeNull();
  });

  it('maps SendGrid delivery lifecycle without treating opens/clicks as delivery state', () => {
    expect(mapSendGridEventToDeliveryState('processed')).toBe('PROCESSED');
    expect(mapSendGridEventToDeliveryState('delivered')).toBe('DELIVERED');
    expect(mapSendGridEventToDeliveryState('deferred')).toBe('DEFERRED');
    expect(mapSendGridEventToDeliveryState('bounce')).toBe('BOUNCED');
    expect(mapSendGridEventToDeliveryState('spamreport')).toBe('COMPLAINT');
    expect(mapSendGridEventToDeliveryState('open')).toBeNull();
    expect(mapSendGridEventToDeliveryState('click')).toBeNull();
  });

  it('uses deterministic idempotent identifiers', () => {
    const first = deterministicEmailId('msg', 'sendgrid', 'event-1');
    const second = deterministicEmailId('msg', 'sendgrid', 'event-1');
    expect(first).toBe(second);
    expect(first).toMatch(/^msg-[0-9a-f]{32}$/);
  });

  it('normalizes addresses and RFC Message-ID thread references', () => {
    expect(normalizeEmailAddress(' Person@Example.COM ')).toBe('person@example.com');
    expect(normalizeInternetMessageId('root@example.com')).toBe('<root@example.com>');
    expect(
      resolveEmailThreadLookupIds({
        inReplyTo: '<latest@example.com>',
        references: ['<root@example.com>', '<latest@example.com>'],
      }),
    ).toEqual(['<latest@example.com>', '<root@example.com>']);
  });

  it('bounds retries and refuses a send after the configured maximum', () => {
    expect(computeEmailRetryDelayMs(1)).toBe(1_000);
    expect(computeEmailRetryDelayMs(2)).toBe(2_000);
    expect(computeEmailRetryDelayMs(2, 30_000)).toBe(30_000);
    expect(() => computeEmailRetryDelayMs(6)).toThrow('EMAIL_RETRY_ATTEMPTS_EXHAUSTED');
  });

  it('validates attachment count, total bytes and immutable digests', () => {
    const attachment: EmailAttachmentDescriptor = {
      ...scope,
      attachmentId: 'att-1',
      messageId: 'msg-1',
      fileName: 'ticket.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1024,
      contentSha256: 'a'.repeat(64),
      contentRef: 'gcs://private/email/att-1',
      disposition: 'attachment',
      contentId: null,
    };
    expect(() =>
      validateEmailAttachments([attachment], { maximumCount: 10, maximumTotalBytes: 2048 }),
    ).not.toThrow();
    expect(() =>
      validateEmailAttachments([attachment], { maximumCount: 10, maximumTotalBytes: 100 }),
    ).toThrow('EMAIL_ATTACHMENT_TOTAL_BYTES_EXCEEDED');
  });

  it('accepts only canonical CRM MessageRecord rows with EMAIL channel', () => {
    const message: MessageRecord = {
      ...scope,
      messageId: 'msg-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      leadId: null,
      direction: 'OUTBOUND',
      channel: 'EMAIL',
      language: 'pt-BR',
      contentRef: 'gcs://private/email/msg-1',
      contentSha256: 'b'.repeat(64),
      providerMessageRef: 'provider-1',
      intent: null,
      urgency: null,
      occurredAt: '2026-08-20T05:00:00.000Z',
      evidence: ['email:test'],
      createdAt: '2026-08-20T05:00:00.000Z',
    };
    expect(() => assertCanonicalEmailMessage(message)).not.toThrow();
    expect(() => assertCanonicalEmailMessage({ ...message, channel: 'WHATSAPP' })).toThrow(
      'EMAIL_CANONICAL_MESSAGE_CHANNEL_MISMATCH',
    );
  });
});
