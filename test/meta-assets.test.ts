import { describe, expect, it } from 'vitest';
import type { SecretReference, SecretResolver } from '../src/core/secrets.js';
import { MetaGraphManagedAssetDiscovery } from '../src/providers/meta/meta-assets.js';
import type { MetaConnectionState } from '../src/providers/meta/meta-connection.js';
import type { MetaHttpTransport } from '../src/providers/meta/meta-graph.js';

const state: MetaConnectionState = {
  account: {
    id: 'meta-account-1',
    provider: 'meta',
    externalAccountId: 'meta-user-1',
    label: 'Toca Meta',
    scopes: ['pages_show_list'],
    status: 'CONNECTED',
    tokenReference: 'test:meta-user-token',
  },
  accessToken: { provider: 'test', key: 'meta-user-token' },
  grantedScopes: ['pages_show_list'],
  connectedAt: '2026-08-09T02:00:00.000Z',
};

class TestSecrets implements SecretResolver {
  resolve(reference: SecretReference): Promise<string> {
    expect(reference.key).toBe('meta-user-token');
    return Promise.resolve('USER_TOKEN');
  }
}

describe('MetaGraphManagedAssetDiscovery', () => {
  it('discovers managed Pages and linked Instagram professional accounts without requesting page tokens', async () => {
    const http: MetaHttpTransport = {
      get: (url, headers) => {
        const parsed = new URL(url);
        expect(parsed.pathname).toBe('/v1.0/me/accounts');
        expect(parsed.searchParams.get('fields')).toBe('id,name,tasks,instagram_business_account');
        expect(parsed.searchParams.has('access_token')).toBe(false);
        expect(headers.Authorization).toBe('Bearer USER_TOKEN');

        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              data: [
                {
                  id: 'page-2',
                  name: 'Second Page',
                  tasks: ['CREATE_CONTENT', 'ANALYZE'],
                },
                {
                  id: 'page-1',
                  name: 'Toca do Morcego',
                  tasks: ['MANAGE', 'CREATE_CONTENT'],
                  instagram_business_account: { id: 'ig-123' },
                },
              ],
            }),
        });
      },
    };

    const discovery = new MetaGraphManagedAssetDiscovery(
      { graphBaseUrl: 'https://graph.facebook.com', apiVersion: 'v1.0' },
      new TestSecrets(),
      http,
    );

    await expect(discovery.list(state)).resolves.toEqual([
      {
        pageId: 'page-1',
        pageName: 'Toca do Morcego',
        tasks: ['CREATE_CONTENT', 'MANAGE'],
        instagramBusinessAccountId: 'ig-123',
      },
      {
        pageId: 'page-2',
        pageName: 'Second Page',
        tasks: ['ANALYZE', 'CREATE_CONTENT'],
      },
    ]);
  });

  it('normalizes HTTP failure without leaking the access token', async () => {
    const http: MetaHttpTransport = {
      get: () =>
        Promise.resolve({
          ok: false,
          status: 403,
          json: () => Promise.resolve({ error: 'denied' }),
        }),
    };

    const discovery = new MetaGraphManagedAssetDiscovery(
      { graphBaseUrl: 'https://graph.facebook.com', apiVersion: 'v1.0' },
      new TestSecrets(),
      http,
    );

    await expect(discovery.list(state)).rejects.toThrow('META_ASSET_DISCOVERY_HTTP_403');
  });
});
