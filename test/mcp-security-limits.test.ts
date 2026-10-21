import { once } from 'node:events';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, type AuthInfo, type McpServer } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as z from 'zod/v4';
import type { ExecutionIdentity } from '../src/core/identity.js';
import { createTocaHttpServer } from '../src/http-server.js';
import type { ReadonlyMcpAuth } from '../src/mcp/readonly-auth.js';
import { createReadonlyMcpServer, READONLY_MCP_TOOL_NAMES } from '../src/mcp/readonly-server.js';
import {
  MCP_MAX_REQUEST_BODY_BYTES,
  MCP_MAX_TOOL_INPUT_ELEMENTS,
  MCP_READONLY_MAX_REQUEST_BODY_BYTES,
} from '../src/mcp/security-limits.js';
import { createTocaServer } from '../src/server.js';

const servers: Server[] = [];
const handlers: ReturnType<typeof createMcpHandler>[] = [];
const headers = {
  accept: 'application/json, text/event-stream',
  'content-type': 'application/json',
  'mcp-protocol-version': '2025-11-25',
};
afterEach(async () => {
  await Promise.all(handlers.splice(0).map((handler) => handler.close()));
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        }),
    ),
  );
});
async function listen(server: Server) {
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
function authFixture() {
  const authInfo: AuthInfo = {
    token: 'synthetic',
    clientId: 'test',
    scopes: ['toca:read'],
  };
  const resolveIdentity = vi.fn(() => ({}) as ExecutionIdentity);
  const auth: ReadonlyMcpAuth = {
    resourceMetadataUrl: 'https://example.test/.well-known/oauth-protected-resource/mcp',
    resourceMetadata: {
      resource: 'https://example.test/mcp',
      authorization_servers: ['https://issuer.example.test'],
      scopes_supported: ['toca:read'],
      bearer_methods_supported: ['header'],
    },
    authenticate: (req) => {
      if (req.headers.authorization !== 'Bearer synthetic') throw new Error('unauthorized');
      return Promise.resolve(authInfo);
    },
    resolveIdentity,
  };
  return { auth, authInfo, resolveIdentity };
}
function rpc(args: unknown, id = 1, name = 'security_probe') {
  return {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: args },
  };
}
interface RpcReply {
  id: number;
  result: {
    isError?: boolean;
    tools: { name: string }[];
    content: { type: string; text: string }[];
    structuredContent: { toolCount: number };
  };
}
async function post(url: string, body: unknown) {
  const response = await fetch(`${url}/mcp`, {
    method: 'POST',
    headers: { ...headers, authorization: 'Bearer synthetic' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  const data =
    text.startsWith('event:') || text.startsWith('data:')
      ? text
          .split('\n')
          .filter((line) => line.startsWith('data: '))
          .map((line) => JSON.parse(line.slice(6)) as RpcReply)
          .at(-1)
      : (JSON.parse(text) as RpcReply);
  if (!data) throw new Error(`Missing RPC response: ${text}`);
  return { status: response.status, data, text };
}
async function probeEndpoint(factory: () => McpServer) {
  const callback = vi.fn(() => ({
    content: [{ type: 'text' as const, text: 'accepted' }],
  }));
  const created = vi.fn(() => {
    const server = factory();
    server.registerTool(
      'security_probe',
      { inputSchema: z.object({ payload: z.unknown() }) },
      callback,
    );
    return server;
  });
  const handler = createMcpHandler(created, {
    maxRequestBodySize: MCP_MAX_REQUEST_BODY_BYTES,
  });
  handlers.push(handler);
  const nodeHandler = toNodeHandler(handler);
  const url = await listen(
    createServer((req, res) => {
      void nodeHandler(
        {
          method: req.method ?? 'POST',
          url: req.url ?? '/mcp',
          headers: req.headers,
          [Symbol.asyncIterator]: () => req[Symbol.asyncIterator](),
        },
        res,
      );
    }),
  );
  return { url, callback, created };
}
function oversized(url: string, limit: number, chunked: boolean) {
  return new Promise<number>((resolve, reject) => {
    const req = request(
      `${url}/mcp`,
      {
        method: 'POST',
        headers: {
          ...headers,
          authorization: 'Bearer synthetic',
          ...(chunked
            ? { 'transfer-encoding': 'chunked' }
            : { 'content-length': String(limit + 1) }),
        },
      },
      (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode!));
      },
    );
    req.on('error', reject);
    // Deliberately invalid JSON: the byte guard must win before parsing or factory creation.
    for (let remaining = limit + 1; remaining > 0; remaining -= 8192)
      req.write('x'.repeat(Math.min(8192, remaining)));
    req.end();
  });
}

describe('MCP security budgets', () => {
  for (const surface of ['core', 'readonly'] as const) {
    it(`${surface} rejects aggregate elements before the tool callback and accepts the exact boundary`, async () => {
      const { auth, authInfo } = authFixture();
      const fixture = await probeEndpoint(() =>
        surface === 'core'
          ? createTocaServer({ env: {} })
          : createReadonlyMcpServer(auth, authInfo),
      );
      const allowed = await post(
        fixture.url,
        rpc({ payload: Array(MCP_MAX_TOOL_INPUT_ELEMENTS - 1).fill(0) }),
      );
      expect(allowed.data.result.isError).not.toBe(true);
      expect(fixture.callback).toHaveBeenCalledTimes(1);
      const rejected = await post(
        fixture.url,
        rpc({ payload: Array(MCP_MAX_TOOL_INPUT_ELEMENTS).fill(0) }),
      );
      expect(rejected.text).toContain(`maximum of ${MCP_MAX_TOOL_INPUT_ELEMENTS} elements`);
      expect(fixture.callback).toHaveBeenCalledTimes(1);
      const nested = await post(
        fixture.url,
        rpc({ payload: Array.from({ length: 17_000 }, () => ({ value: 0 })) }),
      );
      expect(nested.text).toContain('maximum');
      expect(fixture.callback).toHaveBeenCalledTimes(1);
    });
  }
  it('allows the bounded 200-step / 100-dependency workflow shape and a realistic inline asset', async () => {
    const fixture = await probeEndpoint(() => createTocaServer({ env: {} }));
    const steps = Array.from({ length: 200 }, (_, index) => ({
      stepId: `step-${index}`,
      name: 'work',
      capabilityId: 'example.capability',
      maxAttempts: 20,
      dependsOn: Array.from({ length: 100 }, (_, i) => `dependency-${i}`),
      input: { note: 'bounded input' },
    }));
    expect((await post(fixture.url, rpc({ payload: { steps } }))).data.result.isError).not.toBe(
      true,
    );
    expect(
      (await post(fixture.url, rpc({ payload: { imageBase64: 'A'.repeat(3 * 1024 * 1024) } }))).data
        .result.isError,
    ).not.toBe(true);
    expect(fixture.callback).toHaveBeenCalledTimes(2);
  });
  for (const chunked of [false, true]) {
    it(`rejects ${chunked ? 'chunked' : 'Content-Length'} oversized bodies before readonly factory creation`, async () => {
      const fixture = authFixture();
      const url = await listen(createTocaHttpServer({ readonlyMcpAuth: fixture.auth }));
      expect(await oversized(url, MCP_READONLY_MAX_REQUEST_BODY_BYTES, chunked)).toBe(413);
      expect(fixture.resolveIdentity).not.toHaveBeenCalled();
    });
    it(`bounds legacy ${chunked ? 'chunked' : 'Content-Length'} bodies before factory creation`, async () => {
      const fixture = await probeEndpoint(() => createTocaServer({ env: {} }));
      expect(await oversized(fixture.url, MCP_MAX_REQUEST_BODY_BYTES, chunked)).toBe(413);
      expect(fixture.created).not.toHaveBeenCalled();
      expect(fixture.callback).not.toHaveBeenCalled();
    });
  }
  it('accepts the exact readonly byte budget and rejects one additional byte', async () => {
    const fixture = authFixture();
    const url = await listen(createTocaHttpServer({ readonlyMcpAuth: fixture.auth }));
    const body = JSON.stringify(rpc({}, 1, 'toca.system.health'));
    const padded = body + ' '.repeat(MCP_READONLY_MAX_REQUEST_BODY_BYTES - Buffer.byteLength(body));
    for (const [payload, status] of [
      [padded, 200],
      [padded + ' ', 413],
    ] as const) {
      const response = await fetch(`${url}/mcp`, {
        method: 'POST',
        headers: { ...headers, authorization: 'Bearer synthetic' },
        body: payload,
      });
      expect(response.status).toBe(status);
      await response.text();
    }
  });
  it('wires the legacy byte guard into the production HTTP server', async () => {
    const url = await listen(createTocaHttpServer());
    expect(await oversized(url, MCP_MAX_REQUEST_BODY_BYTES, false)).toBe(413);
    expect(await oversized(url, MCP_MAX_REQUEST_BODY_BYTES, true)).toBe(413);
    expect((await fetch(`${url}/healthz`)).status).toBe(200);
  });
  it('keeps readonly auth, its three tools, health and webhook challenge intact', async () => {
    const fixture = authFixture();
    const url = await listen(
      createTocaHttpServer({
        readonlyMcpAuth: fixture.auth,
        metaWebhook: {
          resolveVerifyToken: () => Promise.resolve('verify'),
          resolveAppSecret: () => Promise.resolve('secret'),
        },
      }),
    );
    expect(
      (
        await fetch(`${url}/mcp`, {
          method: 'POST',
          headers,
          body: JSON.stringify(rpc({})),
        })
      ).status,
    ).toBe(401);
    expect(fixture.resolveIdentity).not.toHaveBeenCalled();
    const listed = await post(url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    });
    expect(listed.data.result.tools.map((tool: { name: string }) => tool.name).sort()).toEqual(
      [...READONLY_MCP_TOOL_NAMES].sort(),
    );
    expect((await fetch(`${url}/healthz`)).status).toBe(200);
    expect(
      await (
        await fetch(
          `${url}/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify&hub.challenge=challenge`,
        )
      ).text(),
    ).toBe('challenge');
    const health = await post(url, rpc({}, 7, 'toca.system.health'));
    expect(health.data.result.structuredContent.toolCount).toBe(3);
  });
  it('isolates repeated and concurrent identical RPC IDs in independent server instances', async () => {
    let instance = 0;
    const handler = createMcpHandler(
      () => {
        const server = createTocaServer({ env: {} });
        const ownInstance = ++instance;
        server.registerTool(
          'isolation_probe',
          { inputSchema: z.object({ marker: z.string() }) },
          async ({ marker }) => {
            await new Promise((resolve) => setTimeout(resolve, marker === 'slow' ? 25 : 1));
            return {
              content: [{ type: 'text', text: `${ownInstance}:${marker}` }],
            };
          },
        );
        return server;
      },
      { maxRequestBodySize: MCP_MAX_REQUEST_BODY_BYTES },
    );
    handlers.push(handler);
    const nodeHandler = toNodeHandler(handler);
    const url = await listen(
      createServer((req, res) => {
        void nodeHandler(
          {
            method: req.method ?? 'POST',
            url: req.url ?? '/mcp',
            headers: req.headers,
            [Symbol.asyncIterator]: () => req[Symbol.asyncIterator](),
          },
          res,
        );
      }),
    );
    const markers = ['first', 'second', 'slow', 'fast'];
    const results = [
      await post(url, rpc({ marker: markers[0] }, 42, 'isolation_probe')),
      await post(url, rpc({ marker: markers[1] }, 42, 'isolation_probe')),
      ...(await Promise.all(
        markers.slice(2).map((marker) => post(url, rpc({ marker }, 42, 'isolation_probe'))),
      )),
    ];
    expect(results.map((result) => result.data.id)).toEqual([42, 42, 42, 42]);
    const texts = results.map((result) => result.data.result.content[0]!.text);
    expect(texts.map((text) => text.split(':')[1])).toEqual(markers);
    expect(new Set(texts.map((text) => text.split(':')[0])).size).toBe(4);
  });
});
