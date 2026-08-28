import { describe, expect, it } from 'vitest';
import {
  InstagramMessagingReadProvider,
  type InstagramMessagingMetaClient,
} from '../src/providers/instagram/instagram-messaging-read-provider.js';

interface RecordedRead {
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly token?: string;
}

function createClient(handler: (read: RecordedRead) => unknown): {
  readonly client: InstagramMessagingMetaClient;
  readonly reads: RecordedRead[];
} {
  const reads: RecordedRead[] = [];
  return {
    reads,
    client: {
      async get(path, query = {}) {
        const read = { path, query } satisfies RecordedRead;
        reads.push(read);
        return handler(read);
      },
      async getWithAccessToken(path, query, token) {
        const read = { path, query, token } satisfies RecordedRead;
        reads.push(read);
        return handler(read);
      },
    },
  };
}

function bindingResponses(read: RecordedRead): unknown | undefined {
  if (read.path === 'IG_1') {
    return { id: 'IG_1', username: 'tocadomorcego' };
  }
  if (read.path === 'me/accounts') {
    return {
      data: [
        {
          id: 'PAGE_OTHER',
          access_token: 'PAGE_OTHER_TOKEN',
          tasks: ['MESSAGING'],
        },
        {
          id: 'PAGE_1',
          access_token: 'PAGE_TOKEN',
          tasks: ['MESSAGING', 'CREATE_CONTENT'],
          instagram_business_account: { id: 'IG_1' },
        },
      ],
    };
  }
  return undefined;
}

describe('InstagramMessagingReadProvider', () => {
  it('lists Instagram conversations through the linked Page token and exposes only minimized fields', async () => {
    const { client, reads } = createClient((read) => {
      const binding = bindingResponses(read);
      if (binding !== undefined) return binding;
      if (read.path === 'PAGE_1/conversations') {
        expect(read.token).toBe('PAGE_TOKEN');
        expect(read.query).toEqual({
          platform: 'instagram',
          fields: 'id,updated_time',
          limit: '50',
          after: 'CURSOR_1',
        });
        return {
          data: [
            { id: 'CONV_1', updated_time: '2025-05-01T12:00:00+0000', participants: 'SHOULD_NOT_LEAK' },
          ],
          paging: { cursors: { after: 'CURSOR_2' } },
        };
      }
      throw new Error(`UNEXPECTED_READ:${read.path}`);
    });
    const provider = new InstagramMessagingReadProvider(client, 'IG_1');

    await expect(provider.listConversations({ limit: 50, after: 'CURSOR_1' })).resolves.toEqual({
      conversations: [{ conversationId: 'CONV_1', updatedTime: '2025-05-01T12:00:00+0000' }],
      nextAfter: 'CURSOR_2',
    });

    expect(reads.map((read) => read.path)).toEqual(['IG_1', 'me/accounts', 'PAGE_1/conversations']);
    expect(JSON.stringify(await provider.listConversations({ limit: 1 }))).not.toContain('SHOULD_NOT_LEAK');
  });

  it('bounds message detail to 20, classifies direction and strips participant identity', async () => {
    const { client } = createClient((read) => {
      const binding = bindingResponses(read);
      if (binding !== undefined) return binding;
      if (read.path === 'CONV_1') {
        expect(read.token).toBe('PAGE_TOKEN');
        expect(read.query.fields).toBe(
          'messages.limit(20){id,created_time,from,to,message,is_unsupported}',
        );
        return {
          messages: {
            data: [
              {
                id: 'MID_IN',
                created_time: '2025-05-01T12:00:00+0000',
                from: { id: 'FOLLOWER_PRIVATE_ID', username: 'follower_private_username' },
                to: { data: [{ id: 'IG_1', username: 'tocadomorcego' }] },
                message: 'Qual o horário hoje?',
              },
              {
                id: 'MID_OUT',
                created_time: '2025-05-01T12:01:00+0000',
                from: { id: 'IG_1', username: 'tocadomorcego' },
                to: { data: [{ id: 'FOLLOWER_PRIVATE_ID', username: 'follower_private_username' }] },
                message: 'Abrimos às 16:30.',
              },
            ],
            paging: { next: 'https://graph.facebook.com/next-page' },
          },
        };
      }
      throw new Error(`UNEXPECTED_READ:${read.path}`);
    });
    const provider = new InstagramMessagingReadProvider(client, 'IG_1');

    const result = await provider.listMessages({ conversationId: 'CONV_1', limit: 100 });

    expect(result).toEqual({
      messages: [
        {
          messageId: 'MID_IN',
          createdTime: '2025-05-01T12:00:00+0000',
          direction: 'INBOUND',
          text: 'Qual o horário hoje?',
          unsupported: false,
        },
        {
          messageId: 'MID_OUT',
          createdTime: '2025-05-01T12:01:00+0000',
          direction: 'OUTBOUND',
          text: 'Abrimos às 16:30.',
          unsupported: false,
        },
      ],
      providerHasMore: true,
      providerMessageDetailLimit: 20,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('FOLLOWER_PRIVATE_ID');
    expect(serialized).not.toContain('follower_private_username');
  });

  it('fails closed when the linked Page does not carry the MESSAGING task', async () => {
    const { client } = createClient((read) => {
      if (read.path === 'IG_1') return { id: 'IG_1', username: 'tocadomorcego' };
      if (read.path === 'me/accounts') {
        return {
          data: [
            {
              id: 'PAGE_1',
              access_token: 'PAGE_TOKEN',
              tasks: ['CREATE_CONTENT'],
              instagram_business_account: { id: 'IG_1' },
            },
          ],
        };
      }
      throw new Error(`UNEXPECTED_READ:${read.path}`);
    });
    const provider = new InstagramMessagingReadProvider(client, 'IG_1');

    await expect(provider.listConversations({ limit: 10 })).rejects.toThrow(
      'INSTAGRAM_PAGE_MESSAGING_TASK_MISSING',
    );
  });

  it('fails closed when more than one Page claims the same Instagram account', async () => {
    const { client } = createClient((read) => {
      if (read.path === 'IG_1') return { id: 'IG_1', username: 'tocadomorcego' };
      if (read.path === 'me/accounts') {
        return {
          data: ['PAGE_1', 'PAGE_2'].map((id) => ({
            id,
            access_token: `${id}_TOKEN`,
            tasks: ['MESSAGING'],
            instagram_business_account: { id: 'IG_1' },
          })),
        };
      }
      throw new Error(`UNEXPECTED_READ:${read.path}`);
    });
    const provider = new InstagramMessagingReadProvider(client, 'IG_1');

    await expect(provider.listConversations({ limit: 10 })).rejects.toThrow(
      'INSTAGRAM_MESSAGING_PAGE_MATCH_COUNT:2',
    );
  });
});
