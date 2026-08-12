import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createTocaHttpServer } from '../src/http-server.js';
import type { InstagramWebhookEvent } from '../src/providers/instagram/instagram-engagement-contracts.js';
import type { MetaOAuthTransport } from '../src/providers/meta/meta-connection.js';
import { InMemoryOAuthStateStore, MetaOAuthService } from '../src/providers/meta/meta-oauth.js';

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

async function listen(options: Parameters<typeof createTocaHttpServer>[0] = {}): Promise<string> {
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
  it('exposes health endpoints for internal compatibility and Cloud Run', async () => {
    const baseUrl = await listen();

    for (const path of ['/healthz', '/health']) {
      const response = await fetch(`${baseUrl}${path}`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        status: 'ok',
        service: 'toca-mcp-server',
        version: '0.1.0',
      });
    }
  });

  it('exposes public Meta compliance pages even when MCP is disabled', async () => {
    const baseUrl = await listen({ mcpEnabled: false });
    const expected = [
      ['/privacy', 'Política de Privacidade — TOCA MCP'],
      ['/terms', 'Termos de Serviço — TOCA MCP'],
      ['/data-deletion', 'Exclusão de Dados — TOCA MCP'],
    ] as const;

    for (const [path, title] of expected) {
      const response = await fetch(`${baseUrl}${path}`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      const body = await response.text();
      expect(body).toContain(title);
      expect(body).toContain('adm@tocadomorcego.com');
      expect(body).not.toContain('access_token');
    }
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
    const body: unknown = await callback.json();
    expect(body).toEqual({ status: 'connected', grantedScopes: ['instagram_basic'] });
    expect(JSON.stringify(body)).not.toContain('token-1');
  });

  it('accepts a valid Meta webhook challenge while MCP remains disabled', async () => {
    const baseUrl = await listen({
      mcpEnabled: false,
      metaWebhook: {
        resolveVerifyToken: () => Promise.resolve('verify-token'),
        resolveAppSecret: () => Promise.resolve('app-secret'),
      },
    });

    const accepted = await fetch(
      `${baseUrl}/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=challenge-123`,
    );
    expect(accepted.status).toBe(200);
    await expect(accepted.text()).resolves.toBe('challenge-123');

    const rejected = await fetch(
      `${baseUrl}/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge-123`,
    );
    expect(rejected.status).toBe(403);

    const mcp = await fetch(`${baseUrl}/mcp`, { method: 'POST' });
    expect(mcp.status).toBe(404);
  });

  it('accepts only signed Meta webhook events and forwards normalized read-only events', async () => {
    const acceptedEvents: InstagramWebhookEvent[] = [];
    const appSecret = 'app-secret';
    const rawBody = JSON.stringify({
      object: 'instagram',
      entry: [
        {
          id: '17841402033495654',
          changes: [
            {
              field: 'comments',
              value: {
                id: 'comment-1',
                media_id: 'media-1',
                from: { id: 'sender-1' },
                text: 'Olá',
                created_time: 1_700_000_000,
              },
            },
          ],
        },
      ],
    });
    const signature = createHmac('sha256', appSecret).update(rawBody).digest('hex');

    const baseUrl = await listen({
      mcpEnabled: false,
      metaWebhook: {
        resolveVerifyToken: () => Promise.resolve('verify-token'),
        resolveAppSecret: () => Promise.resolve(appSecret),
        onEvents: (events) => {
          acceptedEvents.push(...events);
        },
      },
    });

    const accepted = await fetch(`${baseUrl}/webhooks/meta`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': `sha256=${signature}`,
      },
      body: rawBody,
    });

    expect(accepted.status).toBe(200);
    await expect(accepted.text()).resolves.toBe('EVENT_RECEIVED');
    expect(acceptedEvents).toHaveLength(1);
    expect(acceptedEvents[0]).toMatchObject({
      channel: 'COMMENT',
      commentId: 'comment-1',
      mediaId: 'media-1',
    });

    const rejected = await fetch(`${baseUrl}/webhooks/meta`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'sha256=invalid',
      },
      body: rawBody,
    });

    expect(rejected.status).toBe(401);
    expect(acceptedEvents).toHaveLength(1);
  });
});
