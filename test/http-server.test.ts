import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createTocaHttpServer } from '../src/http-server.js';

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

async function listen(): Promise<string> {
  const server = createTocaHttpServer();
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
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
});
