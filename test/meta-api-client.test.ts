import { describe, expect, it, vi } from 'vitest';
import type { SecretResolver } from '../src/core/secrets.js';
import {
  MetaApiClient,
  type MetaApiError,
  type MetaApiResponse,
  type MetaApiRequestContext,
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

const requestPaths = ['GET', 'form POST', 'JSON POST', 'direct-token JSON POST'] as const;
type RequestPath = (typeof requestPaths)[number];

function invokeRequestPath(
  client: MetaApiClient,
  path: RequestPath,
  context?: MetaApiRequestContext,
): Promise<unknown> {
  if (path === 'GET') return client.get('me', { fields: 'id' }, context);
  if (path === 'form POST') return client.post('me', { name: 'validation' }, context);
  if (path === 'JSON POST') return client.postJson('me', { name: 'validation' }, context);
  return client.postJsonWithAccessToken('me', { name: 'validation' }, 'test-access-token', context);
}

function expectedRequest(path: RequestPath): { url: string; init: RequestInit } {
  const headers = { Accept: 'application/json', Authorization: 'Bearer test-access-token' };
  if (path === 'GET') {
    return {
      url: 'https://graph.facebook.com/v24.0/me?fields=id',
      init: { method: 'GET', headers },
    };
  }
  return {
    url: 'https://graph.facebook.com/v24.0/me',
    init: {
      method: 'POST',
      headers: {
        ...headers,
        'content-type':
          path === 'form POST' ? 'application/x-www-form-urlencoded' : 'application/json',
      },
      body: path === 'form POST' ? 'name=validation' : JSON.stringify({ name: 'validation' }),
    },
  };
}

function guardedClient(
  resolve: SecretResolver['resolve'] = () => Promise.resolve('test-access-token'),
) {
  const resolver = { resolve: vi.fn(resolve) };
  const transport = {
    request: vi.fn<MetaApiTransport['request']>().mockResolvedValue(response(200, { id: 'ok' })),
  };
  const client = new MetaApiClient(
    { graphBaseUrl: 'https://graph.facebook.com', apiVersion: 'v24.0' },
    resolver,
    { provider: 'env', key: 'META_ACCESS_TOKEN' },
    transport,
  );
  return { client, resolver, transport };
}

describe('MetaApiClient request-context dispatch guards', () => {
  it.each(requestPaths)(
    'does not resolve credentials or dispatch %s with a pre-aborted signal',
    async (path) => {
      const { client, resolver, transport } = guardedClient();
      const controller = new AbortController();
      controller.abort(new Error('TEST_OPERATION_CLOSED'));

      await expect(
        invokeRequestPath(client, path, { signal: controller.signal }),
      ).rejects.toThrow();
      expect(resolver.resolve).not.toHaveBeenCalled();
      expect(transport.request).not.toHaveBeenCalled();
    },
  );

  it.each(requestPaths)(
    'does not resolve credentials or dispatch %s with an inactive authorization',
    async (path) => {
      const { client, resolver, transport } = guardedClient();
      const assertActive = vi.fn(() => {
        throw new Error('TEST_AUTHORIZATION_EXPIRED');
      });

      await expect(invokeRequestPath(client, path, { assertActive })).rejects.toThrow(
        'TEST_AUTHORIZATION_EXPIRED',
      );
      expect(assertActive).toHaveBeenCalled();
      expect(resolver.resolve).not.toHaveBeenCalled();
      expect(transport.request).not.toHaveBeenCalled();
    },
  );

  it.each(requestPaths.filter((path) => path !== 'direct-token JSON POST'))(
    'does not dispatch %s when cancellation happens during credential resolution',
    async (path) => {
      let resolveToken!: (token: string) => void;
      const credential = new Promise<string>((resolve) => {
        resolveToken = resolve;
      });
      const { client, resolver, transport } = guardedClient(() => credential);
      const controller = new AbortController();
      const outcome = expect(
        invokeRequestPath(client, path, { signal: controller.signal }),
      ).rejects.toThrow();
      expect(resolver.resolve).toHaveBeenCalledOnce();
      expect(transport.request).not.toHaveBeenCalled();

      controller.abort(new Error('TEST_OPERATION_CLOSED'));
      resolveToken('test-access-token');
      await outcome;
      expect(transport.request).not.toHaveBeenCalled();
    },
  );

  it.each(requestPaths.filter((path) => path !== 'direct-token JSON POST'))(
    'rechecks authorization after the credential wait before dispatching %s',
    async (path) => {
      let resolveToken!: (token: string) => void;
      const credential = new Promise<string>((resolve) => {
        resolveToken = resolve;
      });
      const { client, resolver, transport } = guardedClient(() => credential);
      let active = true;
      const assertActive = vi.fn(() => {
        if (!active) throw new Error('TEST_AUTHORIZATION_EXPIRED');
      });
      const outcome = expect(invokeRequestPath(client, path, { assertActive })).rejects.toThrow(
        'TEST_AUTHORIZATION_EXPIRED',
      );
      expect(resolver.resolve).toHaveBeenCalledOnce();
      expect(assertActive).toHaveBeenCalled();

      active = false;
      resolveToken('test-access-token');
      await outcome;
      expect(assertActive.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(transport.request).not.toHaveBeenCalled();
    },
  );

  it.each(requestPaths)(
    'forwards the live signal to %s without changing the request payload',
    async (path) => {
      const { client, resolver, transport } = guardedClient();
      const controller = new AbortController();
      const assertActive = vi.fn();
      await expect(
        invokeRequestPath(client, path, { signal: controller.signal, assertActive }),
      ).resolves.toEqual({ id: 'ok' });

      const expected = expectedRequest(path);
      expect(transport.request).toHaveBeenCalledExactlyOnceWith(expected.url, {
        ...expected.init,
        signal: controller.signal,
      });
      expect(controller.signal.aborted).toBe(false);
      expect(assertActive).toHaveBeenCalled();
      expect(resolver.resolve).toHaveBeenCalledTimes(path === 'direct-token JSON POST' ? 0 : 1);
    },
  );

  it.each(requestPaths)(
    'preserves the legacy %s request shape when no context is supplied',
    async (path) => {
      const { client, transport } = guardedClient();
      await expect(invokeRequestPath(client, path)).resolves.toEqual({ id: 'ok' });

      const expected = expectedRequest(path);
      expect(transport.request).toHaveBeenCalledExactlyOnceWith(expected.url, expected.init);
      expect(transport.request.mock.calls[0]?.[1]).not.toHaveProperty('signal');
    },
  );
});
