import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ToolRegistry, type ToolDefinition } from '../src/core/tool-registry.js';
import {
  createAppGatewayHttpServer,
  type AppGatewayHttpOptions,
} from '../src/app-gateway/index.js';

const servers: ReturnType<typeof createAppGatewayHttpServer>[] = [];
const bearer = 'Bearer app-session-token';

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

function tool(overrides: Partial<ToolDefinition> & Pick<ToolDefinition, 'name'>): ToolDefinition {
  return {
    name: overrides.name,
    version: overrides.version ?? '1.0.0',
    provider: overrides.provider ?? 'test',
    riskClass: overrides.riskClass ?? 'READ',
    requiredScopes: overrides.requiredScopes ?? [],
    capabilityStatus: overrides.capabilityStatus ?? 'PRODUCTION_VALIDATED',
    sideEffects: overrides.sideEffects ?? false,
    idempotent: overrides.idempotent ?? true,
  };
}

function registry(): ToolRegistry {
  const result = new ToolRegistry();
  result.register(tool({ name: 'system.capabilities', capabilityStatus: 'IMPLEMENTED' }));
  result.register(tool({ name: 'copy.generate' }));
  result.register(tool({ name: 'video.select_assets' }));
  return result;
}

async function listen(overrides: Partial<AppGatewayHttpOptions> = {}): Promise<string> {
  const server = createAppGatewayHttpServer({
    registry: registry(),
    authorize: (request) =>
      Promise.resolve(
        request.headers.authorization === bearer
          ? { subject: 'user-1', roles: ['marketing'] }
          : undefined,
      ),
    ...overrides,
  });
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function authorizedHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: bearer, ...extra };
}

describe('Android App Gateway HTTP boundary', () => {
  it('does not expose the API when no authorization boundary is configured', async () => {
    const baseUrl = await listen({ authorize: undefined });
    const response = await fetch(`${baseUrl}/api/v1/capabilities`);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'NOT_FOUND' });
  });

  it('fails closed when the app session is unauthorized', async () => {
    const baseUrl = await listen();
    const response = await fetch(`${baseUrl}/api/v1/capabilities`, {
      headers: { authorization: 'Bearer wrong-token' },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'UNAUTHORIZED' });
  });

  it('returns capability-driven action cards without treating system.capabilities as an execution gate', async () => {
    const baseUrl = await listen();
    const response = await fetch(`${baseUrl}/api/v1/capabilities`, {
      headers: authorizedHeaders(),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as {
      actions: Array<{ action_type: string; availability: string }>;
    };
    expect(body.actions.find((action) => action.action_type === 'CREATE_CONTENT')).toMatchObject({
      availability: 'AVAILABLE',
    });
    expect(body.actions.find((action) => action.action_type === 'CREATE_VIDEO')).toMatchObject({
      availability: 'AVAILABLE',
    });
  });

  it('returns the ten governed video routes and keeps synthetic text-to-video restricted', async () => {
    const baseUrl = await listen();
    const response = await fetch(`${baseUrl}/api/v1/video-options`, {
      headers: authorizedHeaders(),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      video_options: Array<{ route: string; restricted: boolean; availability: string }>;
    };
    expect(body.video_options).toHaveLength(10);
    expect(body.video_options.at(-1)).toMatchObject({
      route: 'SYNTHETIC_TEXT_TO_VIDEO_RESTRICTED',
      restricted: true,
      availability: 'RESTRITO',
    });
  });

  it('prepares a governed video action without executing a provider side effect', async () => {
    let index = 0;
    const baseUrl = await listen({
      createId: () => `http-${++index}`,
      now: () => '2026-09-05T03:00:00.000Z',
    });
    const response = await fetch(`${baseUrl}/api/v1/actions`, {
      method: 'POST',
      headers: authorizedHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        action_type: 'CREATE_VIDEO',
        operation: 'THE_PARTY',
        objective: 'Criar Reel hero com footage real',
        mode: 'AUTO',
        video_route: 'REAL_FOOTAGE_FILM',
        payload: { duration_seconds: 30 },
        client_request_id: 'client-request-1',
      }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      client_request_id: string;
      action: {
        action_id: string;
        correlation_id: string;
        state: string;
        request: { video_route?: string };
      };
    };
    expect(body.client_request_id).toBe('client-request-1');
    expect(body.action).toMatchObject({
      action_id: 'http-1',
      correlation_id: 'http-2',
      state: 'READY',
      request: { video_route: 'REAL_FOOTAGE_FILM' },
    });
    expect(JSON.stringify(body)).not.toContain('app-session-token');
  });

  it('rejects CREATE_VIDEO without a governed route', async () => {
    const baseUrl = await listen();
    const response = await fetch(`${baseUrl}/api/v1/actions`, {
      method: 'POST',
      headers: authorizedHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        action_type: 'CREATE_VIDEO',
        operation: 'THE_PARTY',
        objective: 'Criar Reel hero',
        client_request_id: 'client-request-2',
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'VIDEO_CREATION_ROUTE_REQUIRED' });
  });

  it('rejects malformed action requests with a stable safe error code', async () => {
    const baseUrl = await listen();
    const response = await fetch(`${baseUrl}/api/v1/actions`, {
      method: 'POST',
      headers: authorizedHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ operation: 'THE_PARTY' }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'INVALID_ACTION_REQUEST' });
  });
});
