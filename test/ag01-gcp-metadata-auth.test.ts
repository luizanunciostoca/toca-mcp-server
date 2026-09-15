import { describe, expect, it } from 'vitest';
import type { SecretResolver } from '../src/core/secrets.js';
import {
  AG01_GCP_METADATA_REFERENCE_KEY,
  GoogleOAuthRefreshSecretResolver,
} from '../src/orchestrator/google-oauth-secret-resolver.js';

class NoLongLivedSecrets implements SecretResolver {
  resolve(): Promise<string> {
    return Promise.reject(new Error('LONG_LIVED_SECRET_MUST_NOT_BE_READ'));
  }
}

describe('AG-01 GCP service-identity Sheets auth', () => {
  it('mints a Sheets-readonly token from metadata identity without OAuth refresh secrets', async () => {
    const calls: string[] = [];
    const fetchFn: typeof fetch = (url, init) => {
      const target = String(url);
      calls.push(target);
      if (target.includes('/instance/service-accounts/default/token')) {
        expect(init?.headers).toMatchObject({ 'Metadata-Flavor': 'Google' });
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: 'metadata-token', expires_in: 3600 }), {
            status: 200,
          }),
        );
      }
      if (target.includes('/instance/service-accounts/default/email')) {
        return Promise.resolve(
          new Response('toca-mcp-runtime@toca-mcp-production.iam.gserviceaccount.com', {
            status: 200,
          }),
        );
      }
      if (target.includes(':generateAccessToken')) {
        expect(init?.method).toBe('POST');
        expect(String(init?.body)).toContain(
          'https://www.googleapis.com/auth/spreadsheets.readonly',
        );
        return Promise.resolve(
          new Response(
            JSON.stringify({
              accessToken: 'sheets-readonly-token',
              expireTime: '2026-09-15T20:00:00.000Z',
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    };

    const resolver = new GoogleOAuthRefreshSecretResolver({
      clientIdReference: { provider: 'env', key: AG01_GCP_METADATA_REFERENCE_KEY },
      clientSecretReference: { provider: 'env', key: AG01_GCP_METADATA_REFERENCE_KEY },
      refreshTokenReference: { provider: 'env', key: AG01_GCP_METADATA_REFERENCE_KEY },
      secrets: new NoLongLivedSecrets(),
      fetchFn,
      now: () => new Date('2026-09-15T19:00:00.000Z'),
    });

    await expect(
      resolver.resolve({ provider: 'google-oauth', key: 'sheets-readonly' }),
    ).resolves.toBe('sheets-readonly-token');
    expect(calls).toHaveLength(3);
  });
});
