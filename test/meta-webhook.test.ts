import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  parseMetaWebhookEvents,
  verifyMetaWebhookChallenge,
  verifyMetaWebhookSignature,
} from '../src/providers/meta/meta-webhook.js';

describe('Meta webhook boundary', () => {
  it('accepts only the configured verification token', () => {
    expect(
      verifyMetaWebhookChallenge(
        { mode: 'subscribe', verifyToken: 'expected-token', challenge: '12345' },
        'expected-token',
      ),
    ).toEqual({ accepted: true, challenge: '12345' });

    expect(
      verifyMetaWebhookChallenge(
        { mode: 'subscribe', verifyToken: 'wrong-token', challenge: '12345' },
        'expected-token',
      ),
    ).toEqual({ accepted: false });
  });

  it('validates X-Hub-Signature-256 against the exact raw body', () => {
    const rawBody = Buffer.from('{"object":"instagram","entry":[]}');
    const secret = 'app-secret';
    const signature = createHmac('sha256', secret).update(rawBody).digest('hex');

    expect(verifyMetaWebhookSignature(rawBody, `sha256=${signature}`, secret)).toBe(true);
    expect(verifyMetaWebhookSignature(Buffer.from('{}'), `sha256=${signature}`, secret)).toBe(false);
    expect(verifyMetaWebhookSignature(rawBody, 'sha256=invalid', secret)).toBe(false);
  });

  it('normalizes comment changes into deterministic events', () => {
    const rawBody = Buffer.from(
      JSON.stringify({
        object: 'instagram',
        entry: [
          {
            id: '17841402033495654',
            changes: [
              {
                field: 'comments',
                value: {
                  id: 'comment-1',
                  media_id: 'media-1',
                  from: { id: 'sender-1' },
                  text: 'Olá',
                  created_time: 1_700_000_000,
                },
              },
            ],
          },
        ],
      }),
    );

    const first = parseMetaWebhookEvents(rawBody);
    const second = parseMetaWebhookEvents(rawBody);

    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      accountId: '17841402033495654',
      channel: 'COMMENT',
      senderId: 'sender-1',
      commentId: 'comment-1',
      mediaId: 'media-1',
      text: 'Olá',
      rawType: 'comments',
    });
    expect(first[0]?.eventId).toBe(second[0]?.eventId);
  });

  it('normalizes direct messages without authorizing a reply', () => {
    const events = parseMetaWebhookEvents(
      Buffer.from(
        JSON.stringify({
          object: 'instagram',
          entry: [
            {
              id: '17841402033495654',
              messaging: [
                {
                  sender: { id: 'sender-2' },
                  recipient: { id: '17841402033495654' },
                  timestamp: 1_700_000_001_000,
                  message: { mid: 'message-1', text: 'Oi' },
                },
              ],
            },
          ],
        }),
      ),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      accountId: '17841402033495654',
      channel: 'DIRECT',
      senderId: 'sender-2',
      messageId: 'message-1',
      text: 'Oi',
      rawType: 'messaging',
    });
  });
});
