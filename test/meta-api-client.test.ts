import { describe, expect, it, vi } from 'vitest';
import type { SecretResolver } from '../src/core/secrets.js';
import {
  MetaApiClient,
  type MetaApiError,
  type MetaApiResponse,
  type MetaApiTransport,
} from '../src/providers/meta/meta-api-client.js';

const secrets: SecretResolver = {
  resolve: vi.fn().mockResolvedValue('test-access-token'),
};

function response(status: number, payload: unknown): MetaApiResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(payload),
  };
}

describe('MetaApiClient provider error diagnostics', () => {
  it('preserves provider code, subcode, type and a sanitized reason on form errors', async () => {
    const transport: MetaApiTransport = {
      request: vi.fn().mockResolvedValue(
        response(400, {
          error: {
            type: 'OAuthException',
            code: 100,
            error_subcode: 18157520,
            error_user_msg: 'Invalid campaign parameter for account.',
          },
        }),
      ),
    };
    const client = new MetaApiClient(
      { graphBaseUrl: 'https://graph.facebook.com', apiVersion: 'v24.0' },
      secrets,
      { provider: 'env', key: 'META_ACCESS_TOKEN' },
      transport,
    );

    const promise = client.post('act_123/campaigns', { name: 'validation' });
    await expect(promise).rejects.toMatchObject({
      name: 'MetaApiError',
      status: 400,
      code: 'META_HTTP_400',
      providerCode: 100,
      providerSubcode: 18157520,
      type: 'OAuthException',
      reason: 'Invalid campaign parameter for account.',
    } satisfies Partial<MetaApiError>);
    await expect(promise).rejects.toThrow(
      'META_HTTP_400|META_CODE_100|META_SUBCODE_18157520|META_TYPE_OAuthException|META_REASON_Invalid campaign parameter for account.',
    );
  });

  it('redacts credential-shaped values from provider reasons', async () => {
    const transport: MetaApiTransport = {
      request: vi.fn().mockResolvedValue(
        response(400, {
          error: {
            code: 190,
            message: 'Bearer super-secret-token cannot be used',
          },
        }),
      ),
    };
    const client = new MetaApiClient(
      { graphBaseUrl: 'https://graph.facebook.com', apiVersion: 'v24.0' },
      secrets,
      { provider: 'env', key: 'META_ACCESS_TOKEN' },
      transport,
    );

    await expect(client.get('me')).rejects.toMatchObject({
      providerCode: 190,
      reason: '[REDACTED] cannot be used',
    });
  });

  it('falls back to the coarse HTTP error when Meta error JSON cannot be parsed', async () => {
    const transport: MetaApiTransport = {
      request: vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: vi.fn().mockRejectedValue(new Error('invalid json')),
      }),
    };
    const client = new MetaApiClient(
      { graphBaseUrl: 'https://graph.facebook.com', apiVersion: 'v24.0' },
      secrets,
      { provider: 'env', key: 'META_ACCESS_TOKEN' },
      transport,
    );

    await expect(client.get('me')).rejects.toMatchObject({
      status: 503,
      code: 'META_HTTP_503',
      message: 'META_HTTP_503',
    });
  });
});
