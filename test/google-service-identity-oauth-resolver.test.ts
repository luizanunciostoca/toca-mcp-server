import { describe, expect, it, vi } from 'vitest';
import { GoogleMetadataAccessTokenResolver } from '../src/providers/gcp/google-metadata-access-token-resolver.js';
import { GoogleServiceIdentityOAuthResolver } from '../src/providers/gcp/google-service-identity-oauth-resolver.js';

describe('Google service identity OAuth resolvers', () => {
  it('uses the canonical metadata token endpoint for cloud-platform access and caches it', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ access_token: 'cloud-token', expires_in: 3600, token_type: 'Bearer' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const resolver = new GoogleMetadataAccessTokenResolver({
      fetchImpl: fetchImpl as typeof fetch,
      now: () => 1_000,
    });

    await expect(
      resolver.resolve({ provider: 'gcp-metadata-oauth', key: 'cloud-platform' }),
    ).resolves.toBe('cloud-token');
    await expect(
      resolver.resolve({ provider: 'gcp-metadata-oauth', key: 'cloud-platform' }),
    ).resolves.toBe('cloud-token');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    );
  });

  it('mints Drive and Sheets OAuth from the attached service identity without private keys', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/token') && url.startsWith('http://metadata.google.internal/')) {
        return new Response(JSON.stringify({ access_token: 'metadata-token' }), { status: 200 });
      }
      if (url.endsWith('/email')) {
        return new Response('toca-mcp-runtime@toca-mcp-production.iam.gserviceaccount.com', {
          status: 200,
        });
      }
      if (url.includes(':signBlob')) {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer metadata-token' });
        const payload = JSON.parse(String(init?.body)) as { payload: string };
        const unsignedJwt = Buffer.from(payload.payload, 'base64').toString('utf8');
        const [, claimsPart] = unsignedJwt.split('.');
        const claims = JSON.parse(
          Buffer.from(claimsPart!.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
        ) as { scope: string; iss: string };
        expect(claims.iss).toBe('toca-mcp-runtime@toca-mcp-production.iam.gserviceaccount.com');
        expect(claims.scope).toContain('https://www.googleapis.com/auth/drive.readonly');
        expect(claims.scope).toContain('https://www.googleapis.com/auth/spreadsheets');
        return new Response(JSON.stringify({ signedBlob: Buffer.from('signature').toString('base64') }), {
          status: 200,
        });
      }
      if (url === 'https://oauth2.googleapis.com/token') {
        expect(String(init?.body)).toContain(
          'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer',
        );
        return new Response(
          JSON.stringify({ access_token: 'workspace-token', expires_in: 3600, token_type: 'Bearer' }),
          { status: 200 },
        );
      }
      return new Response('unexpected', { status: 500 });
    });
    const resolver = new GoogleServiceIdentityOAuthResolver({
      fetchImpl: fetchImpl as typeof fetch,
      now: () => 1_700_000_000_000,
    });

    await expect(
      resolver.resolve({ provider: 'gcp-service-identity-oauth', key: 'video-workspace' }),
    ).resolves.toBe('workspace-token');
    await expect(
      resolver.resolve({ provider: 'gcp-service-identity-oauth', key: 'video-workspace' }),
    ).resolves.toBe('workspace-token');

    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('fails closed on unsupported token references', async () => {
    const resolver = new GoogleServiceIdentityOAuthResolver({ fetchImpl: vi.fn() as typeof fetch });
    await expect(
      resolver.resolve({ provider: 'env', key: 'video-workspace' }),
    ).rejects.toThrow('GCP_SERVICE_IDENTITY_OAUTH_REFERENCE_INVALID');
  });
});
