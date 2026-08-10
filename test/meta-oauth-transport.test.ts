import { describe, expect, it, vi } from 'vitest';
import { InMemorySecretStore, type SecretResolver } from '../src/core/secrets.js';
import { FetchMetaOAuthTransport } from '../src/providers/meta/meta-oauth.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('FetchMetaOAuthTransport', () => {
  it('inspects and returns granted scopes without exposing the access token', async () => {
    const appSecrets: SecretResolver = {
      resolve: () => Promise.resolve('APP_SECRET'),
    };
    const tokenStore = new InMemorySecretStore('memory');
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: 'USER_ACCESS_TOKEN', expires_in: 3600 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            app_id: '2281930145887404',
            is_valid: true,
            scopes: ['pages_show_list', 'instagram_basic', 'instagram_manage_comments'],
          },
        }),
      );

    const transport = new FetchMetaOAuthTransport(appSecrets, tokenStore, {
      graphBaseUrl: 'https://graph.facebook.com',
      apiVersion: 'v24.0',
      fetchImpl,
    });

    const result = await transport.exchangeAuthorizationCode({
      code: 'AUTH_CODE',
      redirectUri: 'https://example.test/oauth/meta/callback',
      appId: '2281930145887404',
      appSecret: { provider: 'env', key: 'META_APP_SECRET' },
      tokenEndpoint: 'https://graph.facebook.com/oauth/access_token',
    });

    expect(result.grantedScopes).toEqual([
      'instagram_basic',
      'instagram_manage_comments',
      'pages_show_list',
    ]);
    await expect(tokenStore.resolve(result.accessToken)).resolves.toBe('USER_ACCESS_TOKEN');

    const debugCall = fetchImpl.mock.calls[1];
    expect(String(debugCall?.[0])).toContain('/v24.0/debug_token');
    expect(String(debugCall?.[0])).toContain('input_token=USER_ACCESS_TOKEN');
    expect(debugCall?.[1]?.headers).toEqual(
      expect.objectContaining({ Authorization: 'Bearer 2281930145887404|APP_SECRET' }),
    );
  });

  it('rejects an invalid token before persisting it', async () => {
    const appSecrets: SecretResolver = {
      resolve: () => Promise.resolve('APP_SECRET'),
    };
    const tokenStore = new InMemorySecretStore('memory');
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'BAD_TOKEN', expires_in: 3600 }))
      .mockResolvedValueOnce(
        jsonResponse({ data: { app_id: '2281930145887404', is_valid: false, scopes: [] } }),
      );

    const transport = new FetchMetaOAuthTransport(appSecrets, tokenStore, {
      graphBaseUrl: 'https://graph.facebook.com',
      apiVersion: 'v24.0',
      fetchImpl,
    });

    await expect(
      transport.exchangeAuthorizationCode({
        code: 'AUTH_CODE',
        redirectUri: 'https://example.test/oauth/meta/callback',
        appId: '2281930145887404',
        appSecret: { provider: 'env', key: 'META_APP_SECRET' },
        tokenEndpoint: 'https://graph.facebook.com/oauth/access_token',
      }),
    ).rejects.toThrow('invalid token');
  });
});
