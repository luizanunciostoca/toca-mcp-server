import { describe, expect, it } from 'vitest';
import { metaOAuthConfigSchema, type MetaOAuthTransport } from '../src/providers/meta/meta-connection.js';
import { InMemoryOAuthStateStore, MetaOAuthService } from '../src/providers/meta/meta-oauth.js';

const transport: MetaOAuthTransport = {
  exchangeAuthorizationCode: () =>
    Promise.resolve({
      accessToken: { provider: 'test', key: 'token' },
      grantedScopes: [],
    }),
};

function createService(requestedScopes: string[]) {
  return new MetaOAuthService(
    metaOAuthConfigSchema.parse({
      appId: 'app-id',
      appSecret: { provider: 'env', key: 'META_APP_SECRET' },
      authorizationEndpoint: 'https://www.facebook.com/dialog/oauth',
      tokenEndpoint: 'https://graph.facebook.com/oauth/access_token',
      redirectUri: 'https://example.com/oauth/meta/callback',
      requestedScopes,
    }),
    new InMemoryOAuthStateStore(),
    transport,
  );
}

describe('Meta OAuth Instagram publication scope', () => {
  it('adds instagram_content_publish when Instagram OAuth is requested', async () => {
    const authorization = await createService(['pages_show_list', 'instagram_basic']).beginAuthorization();
    const scopes = new URL(authorization.authorizationUrl).searchParams.get('scope')?.split(',') ?? [];

    expect(scopes).toEqual(['instagram_basic', 'instagram_content_publish', 'pages_show_list']);
  });

  it('does not broaden non-Instagram Meta authorization requests', async () => {
    const authorization = await createService(['pages_show_list']).beginAuthorization();

    expect(new URL(authorization.authorizationUrl).searchParams.get('scope')).toBe('pages_show_list');
  });
});
