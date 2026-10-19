import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { once } from 'node:events';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { toNodeHandler } from '@modelcontextprotocol/node';
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  McpServer,
  PROTOCOL_VERSION_META_KEY,
  createMcpHandler,
  type AuthInfo,
  type McpHttpHandler,
  type Tool,
} from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExecutionIdentity } from '../src/core/identity.js';
import { ToolRegistry } from '../src/core/tool-registry.js';
import { CAPABILITY_ALIAS_RULES } from '../src/governance/capability-aliases.js';
import { getEffectiveCapabilityCatalog } from '../src/governance/capability-resolution.js';
import { createTocaHttpServer } from '../src/http-server.js';
import { CORE_MCP_TOOL_NAMES, registerTocaCoreSurface } from '../src/mcp/core-surface.js';
import {
  createReadonlyMcpAuth,
  type ReadonlyAuthOptions,
  type ReadonlyMcpAuth,
} from '../src/mcp/readonly-auth.js';
import { createReadonlyMcpAuthFromEnv } from '../src/mcp/readonly-runtime.js';
import { READONLY_MCP_TOOL_NAMES } from '../src/mcp/readonly-server.js';

// Synthetic keys and signed claims never leave this process. Only the loopback
// HTTP transport is real; the injected JWKS transport cannot contact a provider.
const ISSUER = 'https://readonly-identity.example.test/';
const AUDIENCE = 'https://readonly-resource.example.test/mcp';
const METADATA_PATH = '/.well-known/oauth-protected-resource/mcp';
const METADATA_URL = `https://readonly-resource.example.test${METADATA_PATH}`;
const JWKS_URI = `${ISSUER}.well-known/jwks.json`;
const NOW = 2_000_000_000;
const CLIENT_ID = 'shared-oauth-client';
const KEY_ID = 'ephemeral-readonly-key';
const signingKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
const wrongSigningKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = {
  ...signingKey.publicKey.export({ format: 'jwk' }),
  kid: KEY_ID,
  alg: 'RS256',
  use: 'sig',
  key_ops: ['verify'],
};
const principals = [
  {
    subject: 'alice',
    tenantId: 'tenant-alice',
    workspaceId: 'workspace-alice',
    organizationId: 'organization-alice',
  },
  {
    subject: 'bob',
    tenantId: 'tenant-bob',
    workspaceId: 'workspace-bob',
    organizationId: 'organization-bob',
  },
] as const;

type JsonObject = Record<string, unknown>;
interface HttpReply {
  readonly status: number;
  readonly headers: Headers;
  readonly body: JsonObject | readonly JsonObject[] | null;
  readonly text: string;
}
interface Observation {
  readonly authInfo: AuthInfo;
  readonly identity: ExecutionIdentity;
}

const servers: Server[] = [];
const handlers: McpHttpHandler[] = [];
let requestId = 0;

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

function jwt(
  claims: JsonObject = {},
  header: JsonObject = {},
  key: KeyObject = signingKey.privateKey,
): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = `${encode({ alg: 'RS256', typ: 'JWT', kid: KEY_ID, ...header })}.${encode({
    iss: ISSUER,
    aud: AUDIENCE,
    sub: 'alice',
    client_id: CLIENT_ID,
    scope: 'toca:read',
    exp: NOW + 300,
    ...claims,
  })}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), key).toString('base64url')}`;
}

function authFixture(overrides: Partial<ReadonlyAuthOptions> = {}) {
  const jwksRequests: string[] = [];
  const authenticationAttempts: (string | undefined)[] = [];
  const authenticated: AuthInfo[] = [];
  const observations: Observation[] = [];
  const verifier = createReadonlyMcpAuth({
    issuer: ISSUER,
    audience: AUDIENCE,
    resourceUrl: AUDIENCE,
    jwksUri: JWKS_URI,
    principals,
    clockSkewSeconds: 0,
    nowEpochSeconds: () => NOW,
    transport: (url) => {
      expect(url).toBe(JWKS_URI);
      jwksRequests.push(url);
      return Promise.resolve(JSON.stringify({ keys: [publicJwk] }));
    },
    ...overrides,
  });
  // Observe the actual binding at the SDK/Core seam without mocking its
  // verifier, identity resolver, registrations, catalog, or HTTP transport.
  const auth: ReadonlyMcpAuth = {
    resourceMetadata: verifier.resourceMetadata,
    resourceMetadataUrl: verifier.resourceMetadataUrl,
    async authenticate(request) {
      authenticationAttempts.push(request.headers.authorization);
      const authInfo = await verifier.authenticate(request);
      authenticated.push(authInfo);
      return authInfo;
    },
    resolveIdentity(authInfo) {
      const identity = verifier.resolveIdentity(authInfo);
      observations.push({ authInfo: authInfo!, identity });
      return identity;
    },
  };
  return { auth, verifier, jwksRequests, authenticationAttempts, authenticated, observations };
}

async function listen(server: Server): Promise<string> {
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
}

async function readonlyEndpoint(fixture = authFixture()) {
  const endpoint = await listen(createTocaHttpServer({ readonlyMcpAuth: fixture.auth }));
  return { ...fixture, endpoint };
}

async function canonicalEndpoint(): Promise<string> {
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: 'canonical-core-test', version: '0.2.0' });
    registerTocaCoreSurface(server, {
      serviceName: 'canonical-core-test',
      serviceVersion: '0.2.0',
      registry: new ToolRegistry(),
      runtimeResolver: () => undefined,
      resolveIdentity: () => undefined,
    });
    return server;
  });
  handlers.push(handler);
  const handle = toNodeHandler(handler);
  return listen(
    createServer((request, response) => {
      void handle(
        {
          method: request.method ?? 'POST',
          url: request.url ?? '/mcp',
          headers: request.headers,
          [Symbol.asyncIterator]: () => request[Symbol.asyncIterator](),
        },
        response,
      ).catch((error: unknown) => {
        response.writeHead(500);
        response.end(error instanceof Error ? error.message : 'canonical_test_handler_failed');
      });
    }),
  );
}

async function send(
  endpoint: string,
  payload: unknown,
  options: { token?: string; headers?: Record<string, string>; method?: string } = {},
): Promise<HttpReply> {
  const method = options.method ?? 'POST';
  const response = await fetch(endpoint, {
    method,
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': '2025-11-25',
      ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }),
      ...options.headers,
    },
    ...(['GET', 'HEAD', 'DELETE'].includes(method) ? {} : { body: JSON.stringify(payload) }),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  return parseReply(response.status, response.headers, text);
}

function parseReply(status: number, headers: Headers, text: string): HttpReply {
  const frames = headers.get('content-type')?.includes('text/event-stream')
    ? text
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => JSON.parse(line.slice(6)) as JsonObject)
    : undefined;
  const body = frames
    ? frames.length === 1
      ? frames[0]!
      : frames
    : text
      ? (JSON.parse(text) as HttpReply['body'])
      : null;
  return { status, headers, body, text };
}

// Node fetch replaces a caller-supplied Host. Native HTTP is necessary to put
// the forged Host on the wire and genuinely test authority-header spoofing.
function sendWithHost(
  endpoint: string,
  payload: unknown,
  options: { headers: Record<string, string>; token?: string; method?: string },
): Promise<HttpReply> {
  return new Promise((resolve, reject) => {
    const method = options.method ?? 'POST';
    const body = ['GET', 'HEAD', 'DELETE'].includes(method) ? undefined : JSON.stringify(payload);
    const request = httpRequest(
      endpoint,
      {
        method,
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'mcp-protocol-version': '2025-11-25',
          ...(body === undefined ? {} : { 'content-length': String(Buffer.byteLength(body)) }),
          ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }),
          ...options.headers,
        },
      },
      (response) => {
        response.setEncoding('utf8');
        let text = '';
        response.on('data', (chunk: string) => {
          text += chunk;
        });
        response.on('error', reject);
        response.on('end', () => {
          const headers = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (value !== undefined) {
              for (const entry of Array.isArray(value) ? value : [value])
                headers.append(name, entry);
            }
          }
          try {
            resolve(parseReply(response.statusCode!, headers, text));
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
      },
    );
    expect(request.getHeader('host')).toBe(options.headers.host);
    request.on('error', reject);
    request.setTimeout(10_000, () => request.destroy(new Error('HTTP fixture timed out')));
    request.end(body);
  });
}

function rpc(method: string, params: JsonObject = {}): JsonObject {
  return { jsonrpc: '2.0', id: ++requestId, method, params };
}

function success(reply: HttpReply): JsonObject {
  expect(reply.status, reply.text).toBe(200);
  expect(reply.body).not.toBeNull();
  expect(Array.isArray(reply.body)).toBe(false);
  const body = reply.body as JsonObject;
  expect(body.error, reply.text).toBeUndefined();
  expect(body.result).toBeDefined();
  return body.result as JsonObject;
}

function output(reply: HttpReply): JsonObject {
  const result = success(reply);
  expect(result.isError, reply.text).not.toBe(true);
  expect(result.structuredContent).toBeDefined();
  return result.structuredContent as JsonObject;
}

function call(endpoint: string, token: string, name: string, args: JsonObject = {}) {
  return send(endpoint, rpc('tools/call', { name, arguments: args }), { token });
}

function expectedPrincipalId(subject: string): string {
  return `mcp-subject:${createHash('sha256')
    .update(JSON.stringify([ISSUER, subject]))
    .digest('hex')}`;
}

describe('source-only read-only MCP bearer boundary over real SDK HTTP', () => {
  it('initializes and exposes exactly the three canonical discovery tools', async () => {
    const fixture = await readonlyEndpoint();
    const token = jwt();
    const initialized = success(
      await send(
        fixture.endpoint,
        rpc('initialize', {
          protocolVersion: '2025-11-25',
          clientInfo: { name: 'readonly-binding-test', version: '1.0.0' },
          capabilities: {},
        }),
        { token },
      ),
    );
    expect(initialized.serverInfo).toEqual({ name: 'toca-mcp-readonly', version: '0.2.0' });
    const tools = success(await send(fixture.endpoint, rpc('tools/list'), { token }))
      .tools as Tool[];
    expect(tools.map((tool) => tool.name).sort()).toEqual([...READONLY_MCP_TOOL_NAMES].sort());
    for (const tool of tools) {
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
    const health = output(await call(fixture.endpoint, token, 'toca.system.health'));
    expect(health).toEqual({
      status: 'ok',
      service: 'toca-mcp-readonly',
      version: '0.2.0',
      surfaceVersion: '1.0.0',
      toolCount: 3,
      discoveryOnly: true,
      persistence: { workflow: false, approval: false, audit: false, event: false },
    });
    expect(fixture.jwksRequests).toEqual([JWKS_URI]);
    expect(fixture.authenticated).toHaveLength(3);
    expect(new Set(fixture.authenticated).size).toBe(3);
  });

  it('preserves canonical Core schemas, descriptors, aliases and search semantics', async () => {
    const { endpoint } = await readonlyEndpoint();
    const canonical = await canonicalEndpoint();
    const token = jwt();
    const actualTools = success(await send(endpoint, rpc('tools/list'), { token })).tools;
    const canonicalTools = success(await send(canonical, rpc('tools/list'))).tools as Tool[];
    expect(actualTools).toEqual(
      canonicalTools.filter((tool) =>
        (READONLY_MCP_TOOL_NAMES as readonly string[]).includes(tool.name),
      ),
    );
    for (const args of [
      {},
      { limit: 100 },
      { query: 'instagram', limit: 100 },
      { provider: 'meta', limit: 100 },
      { routeId: 'R01', limit: 100 },
      { query: 'no-such-capability-ever' },
      { executableOnly: true, limit: 100 },
    ]) {
      const actual = output(await call(endpoint, token, 'toca.capabilities.search', args));
      const expected = output(await call(canonical, token, 'toca.capabilities.search', args));
      expect(actual).toEqual(expected);
      for (const capability of actual.capabilities as JsonObject[]) {
        expect(capability.executable).toBe(false);
      }
      if (args.executableOnly) expect(actual.capabilities).toEqual([]);
    }
    const catalog = getEffectiveCapabilityCatalog();
    const selections = new Set<string>();
    for (const risk of [
      'READ',
      'WRITE_REVERSIBLE',
      'WRITE_EXTERNAL',
      'FINANCIAL_IMPACT',
      'DESTRUCTIVE',
    ]) {
      const capability = catalog.capabilities.find((entry) => entry.risk_class === risk);
      if (capability) selections.add(capability.capability_id);
    }
    expect(CAPABILITY_ALIAS_RULES.length).toBeGreaterThan(0);
    selections.add(CAPABILITY_ALIAS_RULES[0]!.alias_id);
    for (const capabilityId of selections) {
      const actual = output(
        await call(endpoint, token, 'toca.capabilities.describe', { capabilityId }),
      );
      const expected = output(
        await call(canonical, token, 'toca.capabilities.describe', { capabilityId }),
      );
      expect(actual).toEqual(expected);
      expect(actual.executable).toBe(false);
      expect(actual.inputSchema).toBeDefined();
      expect(actual.outputSchema).toBeDefined();
    }
  });

  it.each([
    ['malformed JWT', () => 'not.a.jwt'],
    ['expired token', () => jwt({ exp: NOW - 1 })],
    ['expiry boundary', () => jwt({ exp: NOW })],
    ['future token', () => jwt({ nbf: NOW + 300 })],
    ['wrong issuer', () => jwt({ iss: 'https://attacker.example.test/' })],
    ['wrong audience', () => jwt({ aud: 'other-service' })],
    ['wrong signature', () => jwt({}, {}, wrongSigningKey.privateKey)],
    ['unknown key', () => jwt({}, { kid: 'untrusted-key' })],
    ['unsigned algorithm', () => jwt({}, { alg: 'none' })],
    ['header-provided key', () => jwt({}, { jwk: publicJwk })],
    ['unknown subject', () => jwt({ sub: 'unmapped-user' })],
    ['missing subject', () => jwt({ sub: undefined })],
    ['missing scope', () => jwt({ scope: undefined })],
    ['write-only scope', () => jwt({ scope: 'toca:write toca:admin' })],
    ['scope prefix confusion', () => jwt({ scope: 'toca:read:all' })],
    ['unsigned array scopes', () => jwt({ scope: undefined, scopes: ['toca:read'] })],
    ['missing client', () => jwt({ client_id: undefined })],
    ['blank client', () => jwt({ client_id: '' })],
    ['client whitespace', () => jwt({ client_id: ' shared-oauth-client' })],
  ])(
    'rejects %s without exposing verification details or entering Core',
    async (_name, tokenFor) => {
      const fixture = await readonlyEndpoint();
      const token = tokenFor();
      const reply = await send(fixture.endpoint, rpc('tools/list'), { token });
      expect(reply.status).toBe(401);
      expect(reply.body).toEqual({ error: 'invalid_token' });
      expect(reply.headers.get('www-authenticate')).toBe(
        `Bearer resource_metadata="${METADATA_URL}", scope="toca:read"`,
      );
      expect(reply.headers.get('cache-control')).toBe('no-store');
      expect(reply.text).not.toContain(token);
      expect(fixture.authenticated).toEqual([]);
      expect(fixture.observations).toEqual([]);
    },
  );

  it.each([undefined, 'Basic test', 'Bearer', 'Bearer a b', 'Bearer bad, Bearer other'])(
    'rejects missing or malformed Authorization (%s)',
    async (authorization) => {
      const fixture = await readonlyEndpoint();
      const reply = await send(fixture.endpoint, rpc('tools/list'), {
        ...(authorization === undefined ? {} : { headers: { authorization } }),
      });
      expect(reply.status).toBe(401);
      expect(reply.body).toEqual({ error: 'invalid_token' });
      expect(fixture.jwksRequests).toEqual([]);
      expect(fixture.observations).toEqual([]);
    },
  );

  it('rejects duplicate Authorization fields before Node normalization can hide them', async () => {
    const fixture = await readonlyEndpoint();
    const token = jwt();
    const body = JSON.stringify(rpc('tools/list'));
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(
        fixture.endpoint,
        {
          method: 'POST',
          headers: [
            'Host',
            new URL(fixture.endpoint).host,
            'Authorization',
            `Bearer ${token}`,
            'authorization',
            `Bearer ${token}`,
            'Content-Type',
            'application/json',
            'Content-Length',
            String(Buffer.byteLength(body)),
          ],
        },
        (response) => {
          response.resume();
          response.on('end', () => resolve(response.statusCode));
        },
      );
      request.on('error', reject);
      request.end(body);
    });
    expect(status).toBe(401);
    expect(fixture.jwksRequests).toEqual([]);
  });

  it('ignores forged header, body, argument, metadata and signed tenant/role claims', async () => {
    const fixture = await readonlyEndpoint();
    const token = jwt({
      tenantId: 'forged-tenant',
      workspaceId: 'forged-workspace',
      organizationId: 'forged-organization',
      roles: ['ADMIN'],
      scope: 'toca:read toca:write toca:admin toca:approve toca:account:*',
    });
    const forged = {
      principalId: 'forged-admin',
      tenantId: 'forged-tenant',
      workspaceId: 'forged-workspace',
      organizationId: 'forged-organization',
      clientId: 'forged-admin-client',
      scopes: ['toca:admin'],
      roles: ['ADMIN'],
    };
    const payload: JsonObject = {
      ...rpc('tools/call', {
        name: 'toca.system.health',
        arguments: { identity: forged, authInfo: forged },
        _meta: { identity: forged, authInfo: forged, ...forged },
      }),
      auth: forged,
      authInfo: forged,
      identity: forged,
    };
    const headers = {
      'x-auth-info': JSON.stringify(forged),
      'x-user-id': 'forged-admin',
      'x-tenant-id': 'forged-tenant',
      'x-workspace-id': 'forged-workspace',
      'x-organization-id': 'forged-organization',
      'x-mcp-auth-scopes': 'toca:admin',
      'mcp-session-id': 'forged-shared-session',
    };
    expect((await send(fixture.endpoint, payload, { headers })).status).toBe(401);
    // Unknown root fields are invalid JSON-RPC, so rejection is the safe
    // behavior. Valid argument/_meta fields must not alter the trusted identity.
    const invalidEnvelope = await send(fixture.endpoint, payload, { token, headers });
    expect(invalidEnvelope.status).toBe(400);
    expect(fixture.observations).toEqual([]);
    const health = output(
      await send(fixture.endpoint, rpc('tools/call', payload.params as JsonObject), {
        token,
        headers,
      }),
    );
    expect(health.discoveryOnly).toBe(true);
    expect(fixture.observations.length).toBeGreaterThanOrEqual(2);
    for (const { authInfo, identity } of fixture.observations) {
      expect(authInfo.clientId).toBe(CLIENT_ID);
      expect(authInfo.scopes).toEqual(['toca:read']);
      expect(identity.principal).toMatchObject({
        principalId: expectedPrincipalId('alice'),
        principalType: 'HUMAN',
        tenantId: principals[0].tenantId,
        workspaceId: principals[0].workspaceId,
        organizationId: principals[0].organizationId,
        authenticationMethod: 'MCP_OAUTH_BEARER',
      });
      expect(identity.authorization).toMatchObject({
        principalId: expectedPrincipalId('alice'),
        tenantId: principals[0].tenantId,
        roles: ['READER'],
        allowedRouteIds: [],
        allowedCapabilityIds: [],
        allowedTargetAccounts: [],
      });
      expect(identity.principal.sessionId).toBeUndefined();
      expect(JSON.stringify(identity)).not.toContain('forged');
      expect(JSON.stringify(identity)).not.toContain(token);
    }
  });

  it('isolates concurrent subjects sharing one OAuth client and caller-selected session', async () => {
    const fixture = await readonlyEndpoint();
    const alice = jwt();
    const bob = jwt({ sub: 'bob' });
    const requests = Array.from({ length: 24 }, (_, index) => {
      const token = index % 2 === 0 ? alice : bob;
      return send(
        fixture.endpoint,
        rpc('tools/call', { name: 'toca.system.health', arguments: {} }),
        { token, headers: { 'mcp-session-id': 'same-session' } },
      );
    });
    for (const reply of await Promise.all(requests)) expect(output(reply).discoveryOnly).toBe(true);
    expect(fixture.authenticated).toHaveLength(24);
    expect(new Set(fixture.authenticated).size).toBe(24);
    expect(fixture.observations.length).toBeGreaterThanOrEqual(48);
    const seen = new Set<string>();
    for (const { authInfo, identity } of fixture.observations) {
      const mapping = authInfo.token === alice ? principals[0] : principals[1];
      expect([alice, bob]).toContain(authInfo.token);
      expect(authInfo.clientId).toBe(CLIENT_ID);
      expect(identity.principal.principalType).toBe('HUMAN');
      expect(identity.principal.principalId).toBe(expectedPrincipalId(mapping.subject));
      expect(identity.principal.tenantId).toBe(mapping.tenantId);
      expect(identity.principal.workspaceId).toBe(mapping.workspaceId);
      expect(identity.principal.organizationId).toBe(mapping.organizationId);
      expect(identity.authorization.tenantId).toBe(mapping.tenantId);
      seen.add(identity.principal.principalId);
    }
    expect(seen.size).toBe(2);
  });

  it('never reuses previous request authentication or falls back after failure', async () => {
    let now = NOW;
    const fixture = await readonlyEndpoint(authFixture({ nowEpochSeconds: () => now }));
    const token = jwt({ exp: NOW + 1 });
    const headers = { 'mcp-session-id': 'reused-session' };
    success(await send(fixture.endpoint, rpc('tools/list'), { token, headers }));
    const count = fixture.observations.length;
    for (const options of [{ headers }, { headers, token: jwt({ sub: 'unknown' }) }]) {
      const reply = await send(fixture.endpoint, rpc('tools/list'), options);
      expect(reply.status).toBe(401);
      expect(reply.body).toEqual({ error: 'invalid_token' });
    }
    now = NOW + 1;
    expect((await send(fixture.endpoint, rpc('tools/list'), { token, headers })).status).toBe(401);
    expect(fixture.observations).toHaveLength(count);
    expect(fixture.authenticated).toHaveLength(1);
    expect(() => fixture.verifier.resolveIdentity(fixture.authenticated[0])).toThrow(
      'IDENTITY_EXPIRED',
    );
  });

  it('requires verifier provenance rather than a structurally convincing AuthInfo', async () => {
    const fixture = await readonlyEndpoint();
    success(await send(fixture.endpoint, rpc('tools/list'), { token: jwt() }));
    const verified = fixture.authenticated[0]!;
    expect(fixture.verifier.resolveIdentity(verified).principal.principalId).toBe(
      expectedPrincipalId('alice'),
    );
    expect(() => fixture.verifier.resolveIdentity(undefined)).toThrow('MCP_READONLY_AUTH_REQUIRED');
    expect(() => fixture.verifier.resolveIdentity({ ...verified })).toThrow(
      'MCP_READONLY_AUTH_REQUIRED',
    );
    expect(() => authFixture().verifier.resolveIdentity(verified)).toThrow(
      'MCP_READONLY_AUTH_REQUIRED',
    );
    expect(() =>
      fixture.verifier.resolveIdentity({
        token: jwt(),
        clientId: CLIENT_ID,
        scopes: ['toca:read'],
        expiresAt: NOW + 300,
      }),
    ).toThrow('MCP_READONLY_AUTH_REQUIRED');
  });

  it('rejects expired read-only tokens even within the underlying OIDC clock-skew allowance', async () => {
    const fixture = await readonlyEndpoint(authFixture({ clockSkewSeconds: 60 }));
    for (const exp of [NOW - 1, NOW]) {
      const reply = await send(fixture.endpoint, rpc('tools/list'), { token: jwt({ exp }) });
      expect(reply.status).toBe(401);
      expect(reply.body).toEqual({ error: 'invalid_token' });
    }
    expect(fixture.authenticated).toEqual([]);
    expect(fixture.observations).toEqual([]);
  });

  it.each([
    ...CORE_MCP_TOOL_NAMES.filter(
      (name) => !(READONLY_MCP_TOOL_NAMES as readonly string[]).includes(name),
    ),
    'toca.creative.artist_composite',
    'toca.creative.artist_segment',
    'toca.creative.video_generate',
    'meta_ads.campaign.create_paused',
    'toca.approval.approve',
  ])('never registers or dispatches guessed tool %s', async (name) => {
    const fixture = await readonlyEndpoint();
    const reply = await call(fixture.endpoint, jwt({ scope: 'toca:read toca:admin' }), name, {
      capabilityId: 'meta_ads.campaign.create_paused',
      approvalId: 'forged-approval',
      workflowId: 'forged-workflow',
      input: {},
    });
    const body = reply.body as JsonObject;
    const result = body.result as JsonObject | undefined;
    expect(Boolean(body.error) || result?.isError === true, reply.text).toBe(true);
    expect(reply.text).toMatch(/not found|unknown tool/i);
    expect(reply.text).not.toMatch(
      /WORKFLOW_STORE_REQUIRED|APPROVAL_STORE_REQUIRED|IDENTITY_REQUIRED/,
    );
  });

  it.each(['GET', 'DELETE'])('authenticates but disables %s session operations', async (method) => {
    const fixture = await readonlyEndpoint();
    const missing = await send(fixture.endpoint, undefined, { method });
    expect(missing.status).toBe(401);
    const authenticated = await send(fixture.endpoint, undefined, { method, token: jwt() });
    expect(authenticated.status).toBe(405);
    expect(authenticated.headers.get('allow')).toBe('POST');
    expect(fixture.observations).toEqual([]);
  });

  it('keeps the same authentication boundary on legacy batches and modern envelopes', async () => {
    const fixture = await readonlyEndpoint();
    const batch = [rpc('tools/list'), rpc('tools/call', { name: 'toca.execute', arguments: {} })];
    expect((await send(fixture.endpoint, batch)).status).toBe(401);
    const authenticatedBatch = await send(fixture.endpoint, batch, { token: jwt() });
    // SDK 2 supports legacy batches. Every member must share the verified
    // request identity and the same three-tool registration allowlist.
    expect(authenticatedBatch.status).toBe(200);
    expect(Array.isArray(authenticatedBatch.body)).toBe(true);
    const batchReplies = authenticatedBatch.body as readonly JsonObject[];
    expect(batchReplies).toHaveLength(2);
    const listed = batchReplies.find((reply) => reply.id === batch[0]!.id)!;
    expect(((listed.result as JsonObject).tools as Tool[]).map((tool) => tool.name).sort()).toEqual(
      [...READONLY_MCP_TOOL_NAMES].sort(),
    );
    const denied = batchReplies.find((reply) => reply.id === batch[1]!.id)!;
    expect(
      Boolean(denied.error) || (denied.result as JsonObject | undefined)?.isError === true,
    ).toBe(true);
    expect(JSON.stringify(denied)).toMatch(/not found|unknown tool/i);
    const modern = rpc('tools/call', {
      name: 'toca.system.health',
      arguments: {},
      _meta: {
        [PROTOCOL_VERSION_META_KEY]: '2026-07-28',
        [CLIENT_INFO_META_KEY]: { name: 'modern-readonly-test', version: '1.0.0' },
        [CLIENT_CAPABILITIES_META_KEY]: {},
      },
    });
    const headers = {
      'mcp-protocol-version': '2026-07-28',
      'mcp-session-id': 'shared-modern-session',
      'mcp-method': 'tools/call',
      'mcp-name': 'toca.system.health',
    };
    expect((await send(fixture.endpoint, modern, { headers })).status).toBe(401);
    expect(
      output(await send(fixture.endpoint, modern, { token: jwt(), headers })).discoveryOnly,
    ).toBe(true);
    for (const name of ['toca.execute', 'toca.workflow.create', 'toca.creative.artist_segment']) {
      const deniedModern = await send(
        fixture.endpoint,
        {
          ...modern,
          id: ++requestId,
          params: { ...(modern.params as JsonObject), name },
        },
        { token: jwt(), headers: { ...headers, 'mcp-name': name } },
      );
      const body = deniedModern.body as JsonObject;
      const result = body.result as JsonObject | undefined;
      expect(Boolean(body.error) || result?.isError === true, deniedModern.text).toBe(true);
      expect(deniedModern.text).toMatch(/not found|unknown tool/i);
    }
  });

  it('fails closed when JWKS transport is unavailable and never falls back to legacy tools', async () => {
    const fixture = await readonlyEndpoint(
      authFixture({ transport: () => Promise.reject(new Error('offline fixture')) }),
    );
    const reply = await send(fixture.endpoint, rpc('tools/list'), { token: jwt() });
    expect(reply.status).toBe(401);
    expect(reply.body).toEqual({ error: 'invalid_token' });
    expect(fixture.observations).toEqual([]);
    expect(reply.text).not.toContain('offline fixture');
  });

  it('rejects an oversized authenticated request before a Core handler can run', async () => {
    const fixture = await readonlyEndpoint();
    const reply = await send(
      fixture.endpoint,
      rpc('tools/call', { name: 'toca.system.health', arguments: { padding: 'x'.repeat(65_536) } }),
      { token: jwt() },
    );
    expect(reply.status).toBe(413);
    expect(reply.body).toEqual({ error: 'mcp_request_too_large' });
    expect(fixture.observations).toEqual([]);
  });
});

describe('read-only MCP source configuration is opt-in and fail-closed', () => {
  const environment: NodeJS.ProcessEnv = {
    MCP_READONLY_AUTH_ENABLED: 'true',
    MCP_READONLY_OIDC_ISSUER: ISSUER,
    MCP_READONLY_OIDC_AUDIENCE: AUDIENCE,
    MCP_READONLY_RESOURCE_URL: AUDIENCE,
    MCP_READONLY_OIDC_JWKS_URI: JWKS_URI,
    MCP_READONLY_PRINCIPALS_JSON: JSON.stringify(principals),
  };

  it.each([undefined, 'false'])(
    'preserves the real legacy HTTP surface when the flag is %s',
    async (flag) => {
      const auth = createReadonlyMcpAuthFromEnv({
        ...(flag === undefined ? {} : { MCP_READONLY_AUTH_ENABLED: flag }),
        MCP_READONLY_PRINCIPALS_JSON: 'malformed but disabled',
      });
      expect(auth).toBeUndefined();
      const endpoint = await listen(createTocaHttpServer(auth ? { readonlyMcpAuth: auth } : {}));
      const tools = success(await send(endpoint, rpc('tools/list'))).tools as Tool[];
      expect(tools.some((tool) => tool.name === 'toca.execute')).toBe(true);
      expect(tools.some((tool) => tool.name === 'toca.creative.artist_segment')).toBe(true);
      expect(tools.length).toBeGreaterThan(READONLY_MCP_TOOL_NAMES.length);
    },
  );

  it('accepts complete explicit configuration without fetching keys or selecting runtime providers', () => {
    const auth = createReadonlyMcpAuthFromEnv(environment);
    expect(auth).toBeDefined();
    expect(auth!.resourceMetadataUrl).toBe(METADATA_URL);
    expect(auth!.resourceMetadata).toEqual({
      resource: AUDIENCE,
      authorization_servers: [ISSUER],
      scopes_supported: ['toca:read'],
      bearer_methods_supported: ['header'],
    });
    expect(() => auth!.resolveIdentity(undefined)).toThrow('MCP_READONLY_AUTH_REQUIRED');
  });

  it.each([
    '',
    'http://readonly-resource.example.test/mcp',
    'ftp://readonly-resource.example.test/mcp',
    'https://user:pass@readonly-resource.example.test/mcp',
    'https://readonly-resource.example.test/',
    'https://readonly-resource.example.test/other',
    'https://readonly-resource.example.test/mcp/',
    'https://readonly-resource.example.test/%6dcp',
    'https://readonly-resource.example.test/mcp?tenant=other',
    'https://readonly-resource.example.test/mcp?',
    'https://readonly-resource.example.test/mcp#fragment',
    'https://readonly-resource.example.test/mcp#',
    'HTTPS://readonly-resource.example.test/mcp',
    'https://READONLY-RESOURCE.example.test/mcp',
    'https://readonly-resource.example.test:443/mcp',
    'https://readonly-resource.example.test/./mcp',
    'https://readonly-resource.example.test/other/../mcp',
    'https://readonly-resource.example.test\\mcp',
    ' https://readonly-resource.example.test/mcp',
    'https://readonly-resource.example.test/mcp ',
  ])('rejects noncanonical or unsafe resource URL %j', (resourceUrl) => {
    expect(() => authFixture({ resourceUrl, audience: resourceUrl })).toThrow();
    expect(() =>
      createReadonlyMcpAuthFromEnv({
        ...environment,
        MCP_READONLY_RESOURCE_URL: resourceUrl,
        MCP_READONLY_OIDC_AUDIENCE: resourceUrl,
      }),
    ).toThrow();
  });

  it.each([
    '',
    'http://readonly-identity.example.test/',
    'ftp://readonly-identity.example.test/',
    'https://user:pass@readonly-identity.example.test/',
    'https://readonly-identity.example.test/?tenant=other',
    'https://readonly-identity.example.test/?',
    'https://readonly-identity.example.test/#fragment',
    'https://readonly-identity.example.test/#',
    'HTTPS://readonly-identity.example.test/',
    'https://READONLY-IDENTITY.example.test/',
    'https://readonly-identity.example.test:443/',
    'https://readonly-identity.example.test/realm/../',
    'https://readonly-identity.example.test',
    ' https://readonly-identity.example.test/',
  ])('rejects noncanonical or unsafe issuer URL %j', (issuer) => {
    expect(() => authFixture({ issuer })).toThrow();
    expect(() =>
      createReadonlyMcpAuthFromEnv({ ...environment, MCP_READONLY_OIDC_ISSUER: issuer }),
    ).toThrow();
  });

  it.each([
    'different-audience',
    'https://other-resource.example.test/mcp',
    `${AUDIENCE}/`,
    `${AUDIENCE}?tenant=other`,
    [AUDIENCE],
    [AUDIENCE, 'different-audience'],
    [],
  ])('requires one exact resource audience rather than %j', (audience) => {
    expect(() => authFixture({ audience })).toThrow();
    expect(() =>
      createReadonlyMcpAuthFromEnv({
        ...environment,
        MCP_READONLY_OIDC_AUDIENCE:
          typeof audience === 'string' ? audience : JSON.stringify(audience),
      }),
    ).toThrow();
  });

  it('derives metadata solely from canonical configured URLs, retaining issuer paths and HTTPS ports', () => {
    const resourceUrl = 'https://readonly-resource.example.test:8443/mcp';
    const issuer = 'https://readonly-identity.example.test/realms/readers';
    const fixture = authFixture({ resourceUrl, audience: resourceUrl, issuer });
    expect(fixture.auth.resourceMetadataUrl).toBe(
      `https://readonly-resource.example.test:8443${METADATA_PATH}`,
    );
    expect(fixture.auth.resourceMetadata).toEqual({
      resource: resourceUrl,
      authorization_servers: [issuer],
      scopes_supported: ['toca:read'],
      bearer_methods_supported: ['header'],
    });
    expect(fixture.jwksRequests).toEqual([]);
    expect(fixture.authenticationAttempts).toEqual([]);
    expect(fixture.observations).toEqual([]);
  });

  it.each(['', 'TRUE', '1', 'yes', ' false ', ' true '])(
    'rejects ambiguous enable flag %j',
    (flag) => {
      expect(() =>
        createReadonlyMcpAuthFromEnv({ ...environment, MCP_READONLY_AUTH_ENABLED: flag }),
      ).toThrow();
    },
  );

  it.each([
    'MCP_READONLY_OIDC_ISSUER',
    'MCP_READONLY_OIDC_AUDIENCE',
    'MCP_READONLY_RESOURCE_URL',
    'MCP_READONLY_OIDC_JWKS_URI',
    'MCP_READONLY_PRINCIPALS_JSON',
  ])('fails closed with missing, blank or padded %s', (key) => {
    for (const value of [undefined, '', ' ']) {
      expect(() => createReadonlyMcpAuthFromEnv({ ...environment, [key]: value })).toThrow();
    }
    expect(() =>
      createReadonlyMcpAuthFromEnv({ ...environment, [key]: ` ${environment[key]!}` }),
    ).toThrow();
  });

  it.each([
    'not-json',
    '{}',
    '[]',
    JSON.stringify([principals[0], principals[0]]),
    JSON.stringify([{ ...principals[0], tenantId: '' }]),
    JSON.stringify([{ ...principals[0], workspaceId: ' ' }]),
    JSON.stringify([{ ...principals[0], organizationId: undefined }]),
    JSON.stringify([{ ...principals[0], subject: ' alice' }]),
    JSON.stringify([{ ...principals[0], roles: ['ADMIN'] }]),
  ])('rejects invalid or ambiguous principal mappings (%s)', (mapping) => {
    expect(() =>
      createReadonlyMcpAuthFromEnv({ ...environment, MCP_READONLY_PRINCIPALS_JSON: mapping }),
    ).toThrow();
  });

  it('rejects insecure JWKS configuration and preserves explicit endpoint disablement', async () => {
    expect(() =>
      createReadonlyMcpAuthFromEnv({
        ...environment,
        MCP_READONLY_OIDC_JWKS_URI: 'http://identity.example.test/keys',
      }),
    ).toThrow();
    const fixture = authFixture();
    const endpoint = await listen(
      createTocaHttpServer({ readonlyMcpAuth: fixture.auth, mcpEnabled: false }),
    );
    expect((await send(endpoint, rpc('tools/list'), { token: jwt() })).status).toBe(404);
    expect(fixture.authenticated).toEqual([]);
    const health = await fetch(new URL('/health', endpoint));
    expect(health.status).toBe(200);
    await health.text();
  });
});

describe('RFC 9728 read-only MCP protected-resource metadata', () => {
  const metadata = {
    resource: AUDIENCE,
    authorization_servers: [ISSUER],
    scopes_supported: ['toca:read'],
    bearer_methods_supported: ['header'],
  };
  const spoofedHeaders = {
    host: 'attacker.example.test:8080',
    forwarded: 'for=192.0.2.1;host=attacker.example.test;proto=http',
    'x-forwarded-host': 'attacker.example.test',
    'x-forwarded-proto': 'http',
    'x-forwarded-prefix': '/forged-prefix',
    'x-original-url': 'https://attacker.example.test/mcp',
  };

  it.each([undefined, 'Bearer malformed', 'Basic forged-client'])(
    'serves public GET metadata without authentication, JWKS or identity lookup (%s)',
    async (authorization) => {
      const fixture = await readonlyEndpoint();
      const endpoint = new URL(METADATA_PATH, fixture.endpoint).href;
      const reply = await send(endpoint, undefined, {
        method: 'GET',
        ...(authorization === undefined ? {} : { headers: { authorization } }),
      });
      expect(reply.status).toBe(200);
      expect(reply.headers.get('content-type')?.split(';')[0]).toBe('application/json');
      expect(reply.headers.get('www-authenticate')).toBeNull();
      expect(reply.body).toEqual(metadata);
      expect(fixture.authenticationAttempts).toEqual([]);
      expect(fixture.authenticated).toEqual([]);
      expect(fixture.jwksRequests).toEqual([]);
      expect(fixture.observations).toEqual([]);
      expect(reply.text).not.toContain('tenant-alice');
      expect(reply.text).not.toContain('workspace-alice');
      expect(reply.text).not.toContain(JWKS_URI);
    },
  );

  it('serves HEAD with metadata headers and no body or authentication work', async () => {
    const fixture = await readonlyEndpoint();
    const endpoint = new URL(METADATA_PATH, fixture.endpoint).href;
    const reply = await sendWithHost(endpoint, undefined, {
      method: 'HEAD',
      headers: { authorization: 'Bearer malformed', ...spoofedHeaders },
    });
    expect(reply.status).toBe(200);
    expect(reply.headers.get('content-type')?.split(';')[0]).toBe('application/json');
    expect(reply.body).toBeNull();
    expect(reply.text).toBe('');
    expect(fixture.authenticationAttempts).toEqual([]);
    expect(fixture.jwksRequests).toEqual([]);
    expect(fixture.observations).toEqual([]);
  });

  it('ignores Host and forwarding claims for both metadata and authentication challenges', async () => {
    const fixture = await readonlyEndpoint();
    const endpoint = new URL(METADATA_PATH, fixture.endpoint).href;
    const publicReply = await sendWithHost(endpoint, undefined, {
      method: 'GET',
      headers: spoofedHeaders,
    });
    expect(publicReply.status).toBe(200);
    expect(publicReply.body).toEqual(metadata);
    expect(publicReply.text).not.toContain('attacker');
    expect(publicReply.text).not.toContain('forged-prefix');
    expect(fixture.authenticationAttempts).toEqual([]);
    expect(fixture.jwksRequests).toEqual([]);
    expect(fixture.observations).toEqual([]);

    for (const token of [undefined, 'malformed', jwt({ exp: NOW - 1 })]) {
      const reply = await sendWithHost(fixture.endpoint, rpc('tools/list'), {
        ...(token === undefined ? {} : { token }),
        headers: spoofedHeaders,
      });
      expect(reply.status).toBe(401);
      expect(reply.body).toEqual({ error: 'invalid_token' });
      expect(reply.headers.get('www-authenticate')).toBe(
        `Bearer resource_metadata="${METADATA_URL}", scope="toca:read"`,
      );
      expect(reply.headers.get('www-authenticate')).not.toContain('attacker');
      expect(reply.headers.get('cache-control')).toBe('no-store');
    }
    expect(fixture.authenticated).toEqual([]);
    expect(fixture.observations).toEqual([]);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])(
    'rejects %s metadata requests without invoking authentication or Core',
    async (method) => {
      const fixture = await readonlyEndpoint();
      const endpoint = new URL(METADATA_PATH, fixture.endpoint).href;
      const reply = await send(endpoint, rpc('tools/list'), { method, token: jwt() });
      expect(reply.status).toBe(405);
      expect(
        reply.headers
          .get('allow')
          ?.split(',')
          .map((value) => value.trim())
          .sort(),
      ).toEqual(['GET', 'HEAD']);
      expect(fixture.authenticationAttempts).toEqual([]);
      expect(fixture.jwksRequests).toEqual([]);
      expect(fixture.observations).toEqual([]);
    },
  );

  it.each([undefined, 'false'])(
    'does not publish resource metadata when read-only authentication is disabled (%s)',
    async (flag) => {
      const auth = createReadonlyMcpAuthFromEnv({
        ...(flag === undefined ? {} : { MCP_READONLY_AUTH_ENABLED: flag }),
      });
      expect(auth).toBeUndefined();
      const endpoint = await listen(createTocaHttpServer());
      for (const method of ['GET', 'HEAD', 'POST']) {
        const reply = await send(new URL(METADATA_PATH, endpoint).href, undefined, { method });
        expect(reply.status).toBe(404);
        expect(reply.headers.get('www-authenticate')).toBeNull();
      }
    },
  );

  it('does not publish metadata or authenticate when the MCP endpoint is explicitly disabled', async () => {
    const fixture = authFixture();
    const endpoint = await listen(
      createTocaHttpServer({ readonlyMcpAuth: fixture.auth, mcpEnabled: false }),
    );
    for (const method of ['GET', 'HEAD', 'POST']) {
      const reply = await send(new URL(METADATA_PATH, endpoint).href, undefined, {
        method,
        token: jwt(),
      });
      expect(reply.status).toBe(404);
      expect(reply.headers.get('www-authenticate')).toBeNull();
    }
    expect(fixture.authenticationAttempts).toEqual([]);
    expect(fixture.jwksRequests).toEqual([]);
    expect(fixture.observations).toEqual([]);
  });

  it.each([
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/other',
    `${METADATA_PATH}/`,
  ])('does not expose metadata for the unconfigured path %s', async (path) => {
    const fixture = await readonlyEndpoint();
    const reply = await send(new URL(path, fixture.endpoint).href, undefined, { method: 'GET' });
    expect(reply.status).toBe(404);
    expect(fixture.authenticationAttempts).toEqual([]);
    expect(fixture.jwksRequests).toEqual([]);
  });

  it('continues to require header bearer authentication after metadata discovery', async () => {
    const fixture = await readonlyEndpoint();
    const discovery = await send(new URL(METADATA_PATH, fixture.endpoint).href, undefined, {
      method: 'GET',
    });
    expect(discovery.body).toEqual(metadata);
    expect(fixture.authenticationAttempts).toEqual([]);
    const token = jwt();
    const queryToken = await send(`${fixture.endpoint}?access_token=${token}`, rpc('tools/list'));
    expect(queryToken.status).toBe(401);
    expect(fixture.authenticated).toEqual([]);
    expect(fixture.jwksRequests).toEqual([]);
    const health = output(await call(fixture.endpoint, token, 'toca.system.health'));
    expect(health.discoveryOnly).toBe(true);
    expect(fixture.authenticated).toHaveLength(1);
    expect(fixture.jwksRequests).toEqual([JWKS_URI]);
  });
});
