import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createTocaHttpServerWithAppGateway } from '../src/app-gateway/index.js';
import { ToolRegistry, type ToolDefinition } from '../src/core/tool-registry.js';
import { createTocaHttpServer } from '../src/http-server.js';

const servers: Server[] = [];
const bearer = 'Bearer toca-app-session';

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

async function listen(server: Server): Promise<string> {
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

describe('TOCA HTTP + App Gateway composition', () => {
  it('keeps api v1 absent from the canonical server by default', async () => {
    const baseUrl = await listen(createTocaHttpServer());
    const response = await fetch(`${baseUrl}/api/v1/capabilities`);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'not_found' });
  });

  it('fails closed when the composition has no application authorizer', async () => {
    const baseUrl = await listen(
      createTocaHttpServerWithAppGateway({
        appGateway: { registry: registry() },
      }),
    );

    const api = await fetch(`${baseUrl}/api/v1/capabilities`);
    expect(api.status).toBe(404);
    await expect(api.json()).resolves.toEqual({ error: 'not_found' });

    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toMatchObject({
      status: 'ok',
      service: 'toca-mcp-server',
    });
  });

  it('exposes authenticated PREPARE-only app gateway routes when explicitly injected', async () => {
    let id = 0;
    const baseUrl = await listen(
      createTocaHttpServerWithAppGateway({
        appGateway: {
          registry: registry(),
          authorize: (request) =>
            Promise.resolve(
              request.headers.authorization === bearer
                ? { subject: 'android-user', roles: ['marketing'] }
                : undefined,
            ),
          createId: () => `composition-${++id}`,
          now: () => '2026-09-05T05:30:00.000Z',
        },
      }),
    );

    const unauthorized = await fetch(`${baseUrl}/api/v1/capabilities`, {
      headers: { authorization: 'Bearer invalid' },
    });
    expect(unauthorized.status).toBe(401);
    await expect(unauthorized.json()).resolves.toEqual({ error: 'UNAUTHORIZED' });

    const capabilities = await fetch(`${baseUrl}/api/v1/capabilities`, {
      headers: { authorization: bearer },
    });
    expect(capabilities.status).toBe(200);
    const capabilityBody = (await capabilities.json()) as {
      actions: Array<{ action_type: string; availability: string }>;
    };
    expect(
      capabilityBody.actions.find((action) => action.action_type === 'CREATE_VIDEO'),
    ).toMatchObject({ availability: 'AVAILABLE' });

    const prepared = await fetch(`${baseUrl}/api/v1/actions`, {
      method: 'POST',
      headers: {
        authorization: bearer,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action_type: 'CREATE_VIDEO',
        operation: 'THE_PARTY',
        objective: 'Criar Reel hero',
        mode: 'AUTO',
        video_route: 'REAL_FOOTAGE_FILM',
        payload: {},
        client_request_id: 'android-request-1',
      }),
    });

    expect(prepared.status).toBe(201);
    const preparedBody = (await prepared.json()) as {
      action: { action_id: string; correlation_id: string; state: string };
    };
    expect(preparedBody.action).toMatchObject({
      action_id: 'composition-1',
      correlation_id: 'composition-2',
      state: 'READY',
    });
  });
});
