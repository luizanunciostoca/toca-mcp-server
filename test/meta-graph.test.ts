import { describe, expect, it } from 'vitest';
import type { SecretReference, SecretResolver } from '../src/core/secrets.js';
import type { MetaConnectionState } from '../src/providers/meta/meta-connection.js';
import {
  MetaGraphConnectionProvider,
  type MetaHttpTransport,
} from '../src/providers/meta/meta-graph.js';

const oauthConfig = {
  appId: 'app-123',
  appSecret: { provider: 'test', key: 'meta-app-secret' },
  authorizationEndpoint: 'https://www.facebook.com/dialog/oauth',
  tokenEndpoint: 'https://graph.facebook.com/oauth/access_token',
  redirectUri: 'https://example.com/oauth/meta/callback',
  requestedScopes: ['pages_show_list'],
};

const state: MetaConnectionState = {
  account: {
    id: 'meta-account-1',
    provider: 'meta',
    externalAccountId: 'pending-user',
    label: 'Toca Meta',
    scopes: ['pages_show_list'],
    status: 'PENDING',
    tokenReference: 'test:meta-user-token',
  },
  accessToken: { provider: 'test', key: 'meta-user-token' },
  grantedScopes: ['pages_show_list'],
  connectedAt: '2026-08-09T02:00:00.000Z',
};

class TestSecrets implements SecretResolver {
  resolve(reference: SecretReference): Promise<string> {
    if (reference.key === 'meta-user-token') return Promise.resolve('USER_TOKEN');
    if (reference.key === 'meta-app-secret') return Promise.resolve('APP_SECRET');
    throw new Error('unknown secret');
  }
}

function createHttp(body: unknown, status = 200): MetaHttpTransport {
  return {
    get: (url, headers) => {
      expect(url).toContain('/v1.0/debug_token');
      expect(url).toContain('input_token=USER_TOKEN');
      expect(headers.Authorization).toBe('Bearer app-123|APP_SECRET');
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
      });
    },
  };
}

describe('MetaGraphConnectionProvider', () => {
  it('validates a token only when Meta confirms validity and app ownership', async () => {
    const provider = new MetaGraphConnectionProvider(
      oauthConfig,
      { graphBaseUrl: 'https://graph.facebook.com', apiVersion: 'v1.0' },
      new TestSecrets(),
      createHttp({
        data: {
          app_id: 'app-123',
          is_valid: true,
          scopes: ['pages_show_list', 'ads_read'],
          user_id: 'meta-user-1',
        },
      }),
      () => new Date('2026-08-09T02:10:00.000Z'),
    );

    await expect(provider.validateConnection(state)).resolves.toEqual({
      healthy: true,
      providerAccountId: 'meta-user-1',
      grantedScopes: ['ads_read', 'pages_show_list'],
      capabilities: [],
      checkedAt: '2026-08-09T02:10:00.000Z',
    });
  });

  it('returns a normalized failure without exposing secrets', async () => {
    const provider = new MetaGraphConnectionProvider(
      oauthConfig,
      { graphBaseUrl: 'https://graph.facebook.com', apiVersion: 'v1.0' },
      new TestSecrets(),
      createHttp({ data: { app_id: 'app-123', is_valid: false, scopes: [] } }),
      () => new Date('2026-08-09T02:10:00.000Z'),
    );

    const result = await provider.validateConnection(state);
    expect(result).toMatchObject({ healthy: false, reason: 'TOKEN_INVALID' });
    expect(JSON.stringify(result)).not.toContain('USER_TOKEN');
    expect(JSON.stringify(result)).not.toContain('APP_SECRET');
  });

  it('normalizes provider HTTP failures', async () => {
    const provider = new MetaGraphConnectionProvider(
      oauthConfig,
      { graphBaseUrl: 'https://graph.facebook.com', apiVersion: 'v1.0' },
      new TestSecrets(),
      createHttp({}, 429),
      () => new Date('2026-08-09T02:10:00.000Z'),
    );

    await expect(provider.validateConnection(state)).resolves.toMatchObject({
      healthy: false,
      reason: 'META_HTTP_429',
    });
  });
});
