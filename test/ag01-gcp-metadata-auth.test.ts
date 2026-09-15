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

function createMetadataResolver(expireTime: unknown): GoogleOAuthRefreshSecretResolver {
  const fetchFn: typeof fetch = (url, init) => {
    const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    if (target.includes('/instance/service-accounts/default/token')) {
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
      return Promise.resolve(
        new Response(JSON.stringify({ accessToken: 'sheets-readonly-token', expireTime }), {
          status: 200,
        }),
      );
    }
    return Promise.resolve(new Response('{}', { status: 404 }));
  };

  return new GoogleOAuthRefreshSecretResolver({
    clientIdReference: { provider: 'env', key: AG01_GCP_METADATA_REFERENCE_KEY },
    clientSecretReference: { provider: 'env', key: AG01_GCP_METADATA_REFERENCE_KEY },
    refreshTokenReference: { provider: 'env', key: AG01_GCP_METADATA_REFERENCE_KEY },
    secrets: new NoLongLivedSecrets(),
    fetchFn,
    now: () => new Date('2026-09-15T19:00:00.000Z'),
  });
}

describe('AG-01 GCP service-identity Sheets auth', () => {
  it('mints a Sheets-readonly token from metadata identity without OAuth refresh secrets', async () => {
    const calls: string[] = [];
    const fetchFn: typeof fetch = (url, init) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
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
        const body = init?.body;
        if (typeof body !== 'string') throw new Error('EXPECTED_STRING_BODY');
        expect(body).toContain('https://www.googleapis.com/auth/spreadsheets.readonly');
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

  it('fails closed when IAM Credentials omits token expiry', async () => {
    await expect(
      createMetadataResolver(undefined).resolve({
        provider: 'google-oauth',
        key: 'sheets-readonly',
      }),
    ).rejects.toThrow('AG01_GCP_SHEETS_EXPIRY_MISSING');
  });

  it('fails closed when IAM Credentials returns malformed token expiry', async () => {
    await expect(
      createMetadataResolver('not-a-date').resolve({
        provider: 'google-oauth',
        key: 'sheets-readonly',
      }),
    ).rejects.toThrow('AG01_GCP_SHEETS_EXPIRY_INVALID');
  });

  it('fails closed when IAM Credentials returns an expired token', async () => {
    await expect(
      createMetadataResolver('2026-09-15T18:59:59.000Z').resolve({
        provider: 'google-oauth',
        key: 'sheets-readonly',
      }),
    ).rejects.toThrow('AG01_GCP_SHEETS_TOKEN_EXPIRED');
  });
});
