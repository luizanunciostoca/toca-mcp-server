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
    expect(verifyMetaWebhookSignature(Buffer.from('{}'), `sha256=${signature}`, secret)).toBe(
      false,
    );
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
      occurredAt: '2023-11-14T22:13:20.000Z',
      rawType: 'comments',
    });
    expect(first[0]?.eventId).toBe(second[0]?.eventId);
  });

  it('normalizes entry-level Instagram comment webhooks with entry.time fallback', () => {
    const events = parseMetaWebhookEvents(
      Buffer.from(
        JSON.stringify({
          object: 'instagram',
          entry: [
            {
              id: '17841402033495654',
              time: 1_700_000_010,
              field: 'comments',
              value: {
                id: 'comment-entry-level-1',
                from: { id: 'sender-entry-level-1', username: 'external-user' },
                text: 'Comentário de teste',
                media: { id: 'media-entry-level-1', media_product_type: 'FEED' },
              },
            },
          ],
        }),
      ),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      accountId: '17841402033495654',
      channel: 'COMMENT',
      senderId: 'sender-entry-level-1',
      commentId: 'comment-entry-level-1',
      mediaId: 'media-entry-level-1',
      text: 'Comentário de teste',
      occurredAt: '2023-11-14T22:13:30.000Z',
      rawType: 'comments',
    });
  });

  it('uses entry.time when a changes-level comment omits its own timestamp', () => {
    const events = parseMetaWebhookEvents(
      Buffer.from(
        JSON.stringify({
          object: 'instagram',
          entry: [
            {
              id: '17841402033495654',
              time: 1_700_000_020,
              changes: [
                {
                  field: 'comments',
                  value: {
                    id: 'comment-entry-time-fallback',
                    media_id: 'media-entry-time-fallback',
                    text: 'Sem timestamp no value',
                  },
                },
              ],
            },
          ],
        }),
      ),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      channel: 'COMMENT',
      commentId: 'comment-entry-time-fallback',
      occurredAt: '2023-11-14T22:13:40.000Z',
    });
  });

  it('deduplicates the same comment represented at entry and changes level', () => {
    const events = parseMetaWebhookEvents(
      Buffer.from(
        JSON.stringify({
          object: 'instagram',
          entry: [
            {
              id: '17841402033495654',
              time: 1_700_000_030,
              field: 'comments',
              value: { id: 'comment-duplicate', text: 'Mesmo comentário' },
              changes: [
                {
                  field: 'comments',
                  value: { id: 'comment-duplicate', text: 'Mesmo comentário' },
                },
              ],
            },
          ],
        }),
      ),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      channel: 'COMMENT',
      commentId: 'comment-duplicate',
      occurredAt: '2023-11-14T22:13:50.000Z',
    });
  });

  it('drops comments authored by the connected Instagram account to prevent reply loops', () => {
    const events = parseMetaWebhookEvents(
      Buffer.from(
        JSON.stringify({
          object: 'instagram',
          entry: [
            {
              id: '17841402033495654',
              changes: [
                {
                  field: 'comments',
                  value: {
                    id: 'comment-self-1',
                    from: { id: '17841402033495654' },
                    text: 'Resposta publicada pela própria conta',
                  },
                },
              ],
            },
          ],
        }),
      ),
    );

    expect(events).toEqual([]);
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

  it('drops outbound DIRECT echoes and self-sent messages before automation', () => {
    const echoEvents = parseMetaWebhookEvents(
      Buffer.from(
        JSON.stringify({
          object: 'instagram',
          entry: [
            {
              id: '17841402033495654',
              messaging: [
                {
                  sender: { id: '17841402033495654' },
                  recipient: { id: 'recipient-1' },
                  timestamp: 1_700_000_002_000,
                  message: { mid: 'message-echo-1', text: 'Resposta automática', is_echo: true },
                },
              ],
            },
          ],
        }),
      ),
    );

    expect(echoEvents).toEqual([]);
  });

  it('drops DIRECT events addressed to another account when recipient id is available', () => {
    const events = parseMetaWebhookEvents(
      Buffer.from(
        JSON.stringify({
          object: 'instagram',
          entry: [
            {
              id: '17841402033495654',
              messaging: [
                {
                  sender: { id: 'sender-3' },
                  recipient: { id: 'different-account' },
                  timestamp: 1_700_000_003_000,
                  message: { mid: 'message-2', text: 'Não é para esta conta' },
                },
              ],
            },
          ],
        }),
      ),
    );

    expect(events).toEqual([]);
  });
});
