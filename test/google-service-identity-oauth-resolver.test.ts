import { describe, expect, it, vi } from 'vitest';
import { GoogleMetadataAccessTokenResolver } from '../src/providers/gcp/google-metadata-access-token-resolver.js';
import { GoogleServiceIdentityOAuthResolver } from '../src/providers/gcp/google-service-identity-oauth-resolver.js';

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.toString() : input.url;
}

function jsonBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== 'string') throw new Error('expected JSON string body');
  return JSON.parse(body) as unknown;
}

function formBody(body: BodyInit | null | undefined): string {
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  throw new Error('expected form body');
}

describe('Google service identity OAuth resolvers', () => {
  it('uses the canonical metadata token endpoint for cloud-platform access and caches it', async () => {
    let observedUrl: string | undefined;
    const fetchImpl = vi.fn((input: string | URL | Request) => {
      observedUrl = requestUrl(input);
      return Promise.resolve(
        new Response(
          JSON.stringify({ access_token: 'cloud-token', expires_in: 3600, token_type: 'Bearer' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    });
    const resolver = new GoogleMetadataAccessTokenResolver({
      fetchImpl,
      now: () => 1_000,
    });

    await expect(
      resolver.resolve({ provider: 'gcp-metadata-oauth', key: 'cloud-platform' }),
    ).resolves.toBe('cloud-token');
    await expect(
      resolver.resolve({ provider: 'gcp-metadata-oauth', key: 'cloud-platform' }),
    ).resolves.toBe('cloud-token');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(observedUrl).toBe(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    );
  });

  it('mints Drive and Sheets OAuth from the attached service identity without private keys', async () => {
    const fetchImpl = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith('/token') && url.startsWith('http://metadata.google.internal/')) {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: 'metadata-token' }), { status: 200 }),
        );
      }
      if (url.endsWith('/email')) {
        return Promise.resolve(
          new Response('toca-mcp-runtime@toca-mcp-production.iam.gserviceaccount.com', {
            status: 200,
          }),
        );
      }
      if (url.includes(':signBlob')) {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer metadata-token' });
        const payload = jsonBody(init?.body) as { payload: string };
        const unsignedJwt = Buffer.from(payload.payload, 'base64').toString('utf8');
        const [, claimsPart] = unsignedJwt.split('.');
        const claims = JSON.parse(
          Buffer.from(claimsPart!.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
        ) as { scope: string; iss: string };
        expect(claims.iss).toBe('toca-mcp-runtime@toca-mcp-production.iam.gserviceaccount.com');
        expect(claims.scope).toContain('https://www.googleapis.com/auth/drive.readonly');
        expect(claims.scope).toContain('https://www.googleapis.com/auth/spreadsheets');
        return Promise.resolve(
          new Response(
            JSON.stringify({ signedBlob: Buffer.from('signature').toString('base64') }),
            {
              status: 200,
            },
          ),
        );
      }
      if (url === 'https://oauth2.googleapis.com/token') {
        expect(formBody(init?.body)).toContain(
          'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer',
        );
        return Promise.resolve(
          new Response(
            JSON.stringify({
              access_token: 'workspace-token',
              expires_in: 3600,
              token_type: 'Bearer',
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(new Response('unexpected', { status: 500 }));
    });
    const resolver = new GoogleServiceIdentityOAuthResolver({
      fetchImpl,
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
    const fetchImpl = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      void input;
      void init;
      return Promise.resolve(new Response('unexpected', { status: 500 }));
    });
    const resolver = new GoogleServiceIdentityOAuthResolver({ fetchImpl });
    await expect(resolver.resolve({ provider: 'env', key: 'video-workspace' })).rejects.toThrow(
      'GCP_SERVICE_IDENTITY_OAUTH_REFERENCE_INVALID',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
