import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createTocaHttpServer } from '../src/http-server.js';
import {
  InMemoryOAuthStateStore,
  MetaOAuthService,
} from '../src/providers/meta/meta-oauth.js';
import type { MetaOAuthTransport } from '../src/providers/meta/meta-connection.js';

const servers: ReturnType<typeof createTocaHttpServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

async function listen(
  options: Parameters<typeof createTocaHttpServer>[0] = {},
): Promise<string> {
  const server = createTocaHttpServer(options);
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function createOAuthService(): MetaOAuthService {
  const transport: MetaOAuthTransport = {
    exchangeAuthorizationCode: () =>
      Promise.resolve({
        accessToken: { provider: 'memory', key: 'token-1' },
        grantedScopes: ['instagram_basic'],
      }),
  };

  return new MetaOAuthService(
    {
      appId: 'app-123',
      appSecret: { provider: 'env', key: 'META_APP_SECRET' },
      authorizationEndpoint: 'https://www.facebook.com/dialog/oauth',
      tokenEndpoint: 'https://graph.facebook.com/oauth/access_token',
      redirectUri: 'https://example.com/oauth/meta/callback',
      requestedScopes: ['instagram_basic'],
    },
    new InMemoryOAuthStateStore(),
    transport,
  );
}

describe('remote MCP HTTP server', () => {
  it('exposes a minimal health endpoint', async () => {
    const baseUrl = await listen();
    const response = await fetch(`${baseUrl}/healthz`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      service: 'toca-mcp-server',
      version: '0.1.0',
    });
  });

  it('does not expose arbitrary routes', async () => {
    const baseUrl = await listen();
    const response = await fetch(`${baseUrl}/unknown`);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'not_found' });
  });

  it('can disable the MCP endpoint for a public OAuth-only service', async () => {
    const baseUrl = await listen({ mcpEnabled: false });
    const response = await fetch(`${baseUrl}/mcp`, { method: 'POST' });

    expect(response.status).toBe(404);
  });

  it('redirects to Meta and completes a valid OAuth callback without exposing the token', async () => {
    const baseUrl = await listen({ metaOAuth: createOAuthService(), mcpEnabled: false });
    const start = await fetch(`${baseUrl}/oauth/meta/start`, { redirect: 'manual' });

    expect(start.status).toBe(302);
    const location = start.headers.get('location');
    expect(location).toBeTruthy();
    const authorizationUrl = new URL(location!);
    const state = authorizationUrl.searchParams.get('state');
    expect(state).toBeTruthy();

    const callback = await fetch(
      `${baseUrl}/oauth/meta/callback?code=code-123&state=${encodeURIComponent(state!)}`,
    );
    expect(callback.status).toBe(200);
    const body = await callback.json();
    expect(body).toEqual({ status: 'connected', grantedScopes: ['instagram_basic'] });
    expect(JSON.stringify(body)).not.toContain('token-1');
  });
});
