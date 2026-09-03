import { describe, expect, it } from 'vitest';
import { parseMetaWebhookEvents } from '../src/providers/meta/meta-webhook.js';

describe('Instagram Meta webhook object boundary', () => {
  it('accepts the Instagram object for Direct normalization', () => {
    const events = parseMetaWebhookEvents(
      Buffer.from(
        JSON.stringify({
          object: 'instagram',
          entry: [
            {
              id: 'ig-account-1',
              messaging: [
                {
                  sender: { id: 'sender-1' },
                  recipient: { id: 'ig-account-1' },
                  timestamp: 1_700_000_001_000,
                  message: { mid: 'ig-message-1', text: 'Oi' },
                },
              ],
            },
          ],
        }),
      ),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      accountId: 'ig-account-1',
      channel: 'DIRECT',
      messageId: 'ig-message-1',
    });
  });

  it('fails closed for Facebook Page/Messenger messaging envelopes', () => {
    const events = parseMetaWebhookEvents(
      Buffer.from(
        JSON.stringify({
          object: 'page',
          entry: [
            {
              id: 'facebook-page-1',
              messaging: [
                {
                  sender: { id: 'messenger-user-1' },
                  recipient: { id: 'facebook-page-1' },
                  timestamp: 1_700_000_001_000,
                  message: { mid: 'messenger-message-1', text: 'Olá no Messenger' },
                },
              ],
            },
          ],
        }),
      ),
    );

    expect(events).toEqual([]);
  });

  it('fails closed for unknown Meta object families even when payload resembles Instagram', () => {
    const events = parseMetaWebhookEvents(
      Buffer.from(
        JSON.stringify({
          object: 'unknown_meta_object',
          entry: [
            {
              id: 'account-1',
              changes: [
                {
                  field: 'comments',
                  value: { id: 'comment-1', text: 'should not route' },
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
