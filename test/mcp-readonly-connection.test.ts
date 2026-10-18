import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { it as test } from 'vitest';
// @ts-expect-error The offline diagnostic is intentionally a plain Node ESM script.
import * as diagnosticModule from '../scripts/check-mcp-readonly-connection.mjs';
const { inspectMcpReadonlyConnection } = diagnosticModule as unknown as {
  inspectMcpReadonlyConnection: (root?: string) => {
    status: string;
    observations: { httpHandoff: string; existingOidcVerifier: string };
    sourceEvidence: { path: string; sha256?: string; error?: string }[];
  };
};
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { authorizeExecution, createTrustedServiceExecutionIdentity } from '../src/core/identity.js';
import { resolveRuntimeTenantIdentity } from '../src/runtime/tenant-identity.js';

const defaults = {
  tenantId: 'fixture-tenant',
  workspaceId: 'fixture-workspace',
  organizationId: 'fixture-org',
};
const fixtureAuth = () => ({
  token: 'synthetic-not-a-credential',
  clientId: 'fixture-reader',
  scopes: [
    'toca:read',
    'toca:tenant:fixture-tenant',
    'toca:workspace:fixture-workspace',
    'toca:organization:fixture-org',
    'toca:capability:fixture.read',
  ],
  expiresAt: Math.floor(Date.now() / 1000) + 60,
});

async function probe(mode: 'raw-header' | 'injected' | 'normalized', auth = fixtureAuth()) {
  let observed: unknown;
  const handler = createMcpHandler(() => {
    const server = new McpServer({
      name: 'offline-auth-probe',
      version: '1.0.0',
    });
    server.registerTool(
      'probe',
      {
        description: 'Synthetic context probe',
        inputSchema: {},
        annotations: { readOnlyHint: true },
      },
      (_input, context) => {
        observed = context.http?.authInfo;
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                verifiedContextPresent: Boolean(observed),
              }),
            },
          ],
        };
      },
    );
    return server;
  });
  const adapted = toNodeHandler(handler);
  const server = createServer((req, res) => {
    if (mode !== 'raw-header') Object.assign(req, { auth }); // fixture, never real verification
    const normalized = {
      method: req.method ?? 'POST',
      url: req.url ?? '/mcp',
      headers: req.headers,
      [Symbol.asyncIterator]: () => req[Symbol.asyncIterator](),
    };
    void adapted({ ...normalized, ...(mode === 'injected' ? { auth } : {}) }, res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const response = await fetch(
      `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: 'Bearer synthetic-not-a-credential',
          'mcp-protocol-version': '2025-03-26',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'probe', arguments: {} },
        }),
      },
    );
    const body = await response.text();
    assert.equal(response.status, 200, body);
    assert.match(body, /verifiedContextPresent/);
    return observed;
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    await handler.close();
  }
}

test('Authorization bearer text does not establish SDK authInfo', async () => {
  assert.equal(await probe('raw-header'), undefined);
});
test('TOCA request normalization drops even an injected req.auth', async () => {
  assert.equal(await probe('normalized'), undefined);
});
test('SDK supports explicit verifier-populated req.auth without new orchestrator', async () => {
  const context = await probe('injected');
  assert.equal((context as { clientId: string }).clientId, 'fixture-reader');
});
test('no authInfo and no fallback gives no tenant identity', () => {
  assert.equal(resolveRuntimeTenantIdentity({}, defaults), undefined);
});
test('verified read scopes use existing identity and deny reversible mutation', () => {
  const identity = resolveRuntimeTenantIdentity({ http: { authInfo: fixtureAuth() } }, defaults);
  assert.ok(identity);
  assert.deepEqual(identity.authorization.roles, ['READER']);
  assert.equal(identity.principal.authenticationMethod, 'MCP_OAUTH_BEARER');
  assert.equal(
    authorizeExecution(identity, {
      capabilityId: 'fixture.read',
      riskClass: 'READ',
    }).allowed,
    true,
  );
  assert.equal(
    authorizeExecution(identity, {
      capabilityId: 'fixture.read',
      riskClass: 'WRITE_REVERSIBLE',
    }).allowed,
    false,
  );
  assert.equal(
    authorizeExecution(identity, {
      capabilityId: 'unapproved.read',
      riskClass: 'READ',
    }).allowed,
    false,
  );
});
test('expired and ambiguous-tenant fixtures fail closed', () => {
  assert.equal(
    resolveRuntimeTenantIdentity(
      { http: { authInfo: { ...fixtureAuth(), expiresAt: 1 } } },
      defaults,
    ),
    undefined,
  );
  const auth = fixtureAuth();
  assert.equal(
    resolveRuntimeTenantIdentity(
      {
        http: {
          authInfo: { ...auth, scopes: [...auth.scopes, 'toca:tenant:other'] },
        },
      },
      defaults,
    ),
    undefined,
  );
});
test('infrastructure fallback is not evidence of caller authentication', () => {
  const fallback = createTrustedServiceExecutionIdentity({
    ...defaults,
    principalId: 'cloud-run-service:fixture',
    roles: ['OPERATOR'],
    allowedCapabilityIds: ['instagram.toca_schedule.create'],
    allowedTargetAccounts: [],
    evidence: ['synthetic-fixture'],
  });
  const identity = resolveRuntimeTenantIdentity({}, { ...defaults, fallbackIdentity: fallback });
  assert.equal(identity?.principal.authenticationMethod, 'INFRASTRUCTURE_IDENTITY');
  assert.equal(
    authorizeExecution(identity, {
      capabilityId: 'fixture.read',
      riskClass: 'READ',
    }).allowed,
    false,
  );
  assert.equal(
    authorizeExecution(identity, {
      capabilityId: 'instagram.toca_schedule.create',
      riskClass: 'WRITE_REVERSIBLE',
    }).allowed,
    true,
  );
});

test('offline inventory never promotes source presence to a live connection', () => {
  const report = inspectMcpReadonlyConnection();
  assert.equal(report.status, 'NOT_INTEGRATED');
  assert.equal(report.observations.httpHandoff, 'KNOWN_NORMALIZATION_WITHOUT_AUTH_INFO');
  assert.equal(report.observations.existingOidcVerifier, 'SOURCE_PRESENT_NOT_RUNTIME_PROVEN');
  assert.equal(report.sourceEvidence.length, 6);
  assert.ok(
    report.sourceEvidence.every((entry: { sha256?: string }) =>
      /^[a-f0-9]{64}$/.test(entry.sha256 ?? ''),
    ),
  );
  assert.equal(
    inspectMcpReadonlyConnection('/nonexistent-offline-source-fixture').observations.httpHandoff,
    'UNKNOWN_REQUIRES_REVIEW',
  );
});
