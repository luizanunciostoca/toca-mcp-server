import { describe, expect, it } from 'vitest';
import { InMemorySecretStore } from '../src/core/secrets.js';
import { InstagramGraphEngagementProvider } from '../src/providers/instagram/instagram-engagement-provider.js';
import {
  MetaApiClient,
  type MetaApiResponse,
  type MetaApiTransport,
} from '../src/providers/meta/meta-api-client.js';

interface RecordedRequest {
  readonly url: string;
  readonly init: RequestInit;
}

function response(body: unknown, status = 200): MetaApiResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

async function createProvider(
  handler: (url: string, init: RequestInit) => Promise<MetaApiResponse>,
): Promise<{ provider: InstagramGraphEngagementProvider; requests: RecordedRequest[] }> {
  const secrets = new InMemorySecretStore();
  const accessToken = await secrets.put('meta-user-token', 'USER_TOKEN');
  const requests: RecordedRequest[] = [];
  const transport: MetaApiTransport = {
    async request(url, init) {
      requests.push({ url, init });
      return handler(url, init);
    },
  };
  const client = new MetaApiClient(
    { graphBaseUrl: 'https://graph.facebook.com', apiVersion: 'v24.0' },
    secrets,
    accessToken,
    transport,
  );
  return { provider: new InstagramGraphEngagementProvider(client), requests };
}

describe('InstagramGraphEngagementProvider Direct routing', () => {
  it('resolves the Page token and sends through PAGE_ID/messages with RESPONSE semantics', async () => {
    const { provider, requests } = await createProvider(async (url, init) => {
      if (init.method === 'GET') {
        return response({
          data: [
            {
              id: 'PAGE_1',
              access_token: 'PAGE_TOKEN',
              tasks: ['MESSAGING', 'CREATE_CONTENT'],
              instagram_business_account: { id: 'IG_1' },
            },
          ],
        });
      }
      expect(url).toBe('https://graph.facebook.com/v24.0/PAGE_1/messages');
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer PAGE_TOKEN');
      expect(JSON.parse(String(init.body))).toEqual({
        recipient: { id: 'IGSID_1' },
        messaging_type: 'RESPONSE',
        message: { text: 'Olá' },
      });
      return response({ recipient_id: 'IGSID_1', message_id: 'MID_1' });
    });

    await expect(
      provider.sendDirectReply({
        pageId: 'PAGE_1',
        instagramUserId: 'IG_1',
        recipientScopedId: 'IGSID_1',
        message: 'Olá',
      }),
    ).resolves.toEqual({ recipientId: 'IGSID_1', messageId: 'MID_1' });

    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toContain('/v24.0/me/accounts?');
    expect(new Headers(requests[0]?.init.headers).get('authorization')).toBe('Bearer USER_TOKEN');
  });

  it('fails closed before POST when the selected Page is linked to a different Instagram account', async () => {
    const { provider, requests } = await createProvider(async () =>
      response({
        data: [
          {
            id: 'PAGE_1',
            access_token: 'PAGE_TOKEN',
            tasks: ['MESSAGING'],
            instagram_business_account: { id: 'IG_OTHER' },
          },
        ],
      }),
    );

    await expect(
      provider.sendDirectReply({
        pageId: 'PAGE_1',
        instagramUserId: 'IG_1',
        recipientScopedId: 'IGSID_1',
        message: 'Olá',
      }),
    ).rejects.toThrow('INSTAGRAM_LINKED_ACCOUNT_MISMATCH');

    expect(requests).toHaveLength(1);
  });

  it('rejects a provider acknowledgement for a different recipient', async () => {
    const { provider } = await createProvider(async (_url, init) => {
      if (init.method === 'GET') {
        return response({
          data: [
            {
              id: 'PAGE_1',
              access_token: 'PAGE_TOKEN',
              tasks: ['MESSAGING'],
              instagram_business_account: { id: 'IG_1' },
            },
          ],
        });
      }
      return response({ recipient_id: 'IGSID_OTHER', message_id: 'MID_1' });
    });

    await expect(
      provider.sendDirectReply({
        pageId: 'PAGE_1',
        instagramUserId: 'IG_1',
        recipientScopedId: 'IGSID_1',
        message: 'Olá',
      }),
    ).rejects.toThrow('INSTAGRAM_INVALID_RESPONSE:recipient_id_mismatch');
  });
});
