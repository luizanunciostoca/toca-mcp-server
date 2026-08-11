import { describe, expect, it } from 'vitest';
import { parseMetaWebhookEvents } from './meta-webhook.js';

describe('parseMetaWebhookEvents', () => {
  it('normalizes Instagram comments changes', () => {
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
                    id: 'comment-1',
                    from: { id: 'sender-1' },
                    media: { id: 'media-1' },
                    text: 'example',
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
      accountId: '17841402033495654',
      channel: 'COMMENT',
      commentId: 'comment-1',
      senderId: 'sender-1',
      mediaId: 'media-1',
      rawType: 'comments',
    });
  });

  it('normalizes Instagram messages delivered through changes', () => {
    const events = parseMetaWebhookEvents(
      Buffer.from(
        JSON.stringify({
          object: 'instagram',
          entry: [
            {
              id: '17841402033495654',
              changes: [
                {
                  field: 'messages',
                  value: {
                    sender: { id: '12334' },
                    recipient: { id: '23245' },
                    timestamp: '1527459824',
                    message: {
                      mid: 'random_mid',
                      text: 'random_text',
                    },
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
      accountId: '17841402033495654',
      channel: 'DIRECT',
      senderId: '12334',
      messageId: 'random_mid',
      text: 'random_text',
      occurredAt: '1527459824',
      rawType: 'messages',
    });
  });
});
