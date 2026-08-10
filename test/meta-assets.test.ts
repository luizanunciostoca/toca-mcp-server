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
        expect(parsed.searchParams.get('limit')).toBe('100');
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

  it('falls back to user field expansion when /me/accounts is unexpectedly empty', async () => {
    let requestCount = 0;
    const http: MetaHttpTransport = {
      get: (url, headers) => {
        requestCount += 1;
        const parsed = new URL(url);
        expect(headers.Authorization).toBe('Bearer USER_TOKEN');
        expect(parsed.searchParams.has('access_token')).toBe(false);

        if (requestCount === 1) {
          expect(parsed.pathname).toBe('/v1.0/me/accounts');
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ data: [] }),
          });
        }

        expect(parsed.pathname).toBe('/v1.0/me');
        expect(parsed.searchParams.get('fields')).toBe(
          'accounts.limit(100){id,name,tasks,instagram_business_account}',
        );
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              id: 'meta-user-1',
              accounts: {
                data: [
                  {
                    id: 'page-1',
                    name: 'Toca do Morcego',
                    tasks: ['MANAGE'],
                    instagram_business_account: { id: 'ig-123' },
                  },
                ],
              },
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
        tasks: ['MANAGE'],
        instagramBusinessAccountId: 'ig-123',
      },
    ]);
    expect(requestCount).toBe(2);
  });

  it('falls back to business portfolio Pages when user account edges are empty', async () => {
    const businessState: MetaConnectionState = {
      ...state,
      account: {
        ...state.account,
        scopes: ['business_management', 'pages_show_list'],
      },
      grantedScopes: ['business_management', 'pages_show_list'],
    };
    const requests: string[] = [];
    const http: MetaHttpTransport = {
      get: (url, headers) => {
        const parsed = new URL(url);
        requests.push(parsed.pathname);
        expect(headers.Authorization).toBe('Bearer USER_TOKEN');
        expect(parsed.searchParams.has('access_token')).toBe(false);

        if (parsed.pathname === '/v1.0/me/accounts') {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: [] }) });
        }
        if (parsed.pathname === '/v1.0/me') {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: 'user-1' }) });
        }
        if (parsed.pathname === '/v1.0/me/businesses') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ data: [{ id: 'business-1', name: 'Toca do Morcego' }] }),
          });
        }
        if (parsed.pathname === '/v1.0/business-1/owned_pages') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                data: [
                  {
                    id: 'page-1',
                    name: 'Toca do Morcego',
                    instagram_business_account: { id: 'ig-123' },
                  },
                ],
              }),
          });
        }
        if (parsed.pathname === '/v1.0/business-1/client_pages') {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: [] }) });
        }

        throw new Error(`Unexpected request: ${parsed.pathname}`);
      },
    };

    const discovery = new MetaGraphManagedAssetDiscovery(
      { graphBaseUrl: 'https://graph.facebook.com', apiVersion: 'v1.0' },
      new TestSecrets(),
      http,
    );

    await expect(discovery.list(businessState)).resolves.toEqual([
      {
        pageId: 'page-1',
        pageName: 'Toca do Morcego',
        tasks: [],
        instagramBusinessAccountId: 'ig-123',
      },
    ]);
    expect(requests).toEqual([
      '/v1.0/me/accounts',
      '/v1.0/me',
      '/v1.0/me/businesses',
      '/v1.0/business-1/owned_pages',
      '/v1.0/business-1/client_pages',
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
