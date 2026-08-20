import { describe, expect, it } from 'vitest';
import { createTrustedServiceExecutionIdentity } from '../src/core/identity.js';
import { resolveRuntimeTenantIdentity } from '../src/runtime/tenant-identity.js';

const expiresAt = Math.floor(Date.parse('2026-08-21T00:00:00.000Z') / 1000);

function context(scopes: readonly string[]) {
  return {
    sessionId: 'session-1',
    http: {
      authInfo: {
        clientId: 'client-1',
        scopes,
        expiresAt,
      },
    },
  };
}

describe('runtime tenant identity', () => {
  it('keeps the canonical compatibility tenant when no tenant scope is supplied', () => {
    const identity = resolveRuntimeTenantIdentity(context(['toca:read']), {
      tenantId: 'toca',
      workspaceId: 'toca',
      organizationId: 'toca',
    });

    expect(identity?.principal).toMatchObject({
      tenantId: 'toca',
      workspaceId: 'toca',
      organizationId: 'toca',
    });
  });

  it('resolves a fully scoped non-default tenant from authenticated OAuth scopes', () => {
    const identity = resolveRuntimeTenantIdentity(
      context([
        'toca:read',
        'toca:tenant:tenant-b',
        'toca:workspace:tenant-b-workspace',
        'toca:organization:tenant-b-organization',
      ]),
      { tenantId: 'toca', workspaceId: 'toca', organizationId: 'toca' },
    );

    expect(identity?.principal).toMatchObject({
      tenantId: 'tenant-b',
      workspaceId: 'tenant-b-workspace',
      organizationId: 'tenant-b-organization',
    });
    expect(identity?.authorization.tenantId).toBe('tenant-b');
  });

  it('fails closed when another tenant is selected without workspace and organization', () => {
    expect(
      resolveRuntimeTenantIdentity(context(['toca:read', 'toca:tenant:tenant-b']), {
        tenantId: 'toca',
      }),
    ).toBeUndefined();
  });

  it('fails closed on ambiguous tenant scopes', () => {
    expect(
      resolveRuntimeTenantIdentity(
        context([
          'toca:read',
          'toca:tenant:tenant-a',
          'toca:tenant:tenant-b',
          'toca:workspace:workspace',
          'toca:organization:organization',
        ]),
        { tenantId: 'toca' },
      ),
    ).toBeUndefined();
  });

  it('preserves the trusted runtime fallback when no MCP auth is present', () => {
    const fallbackIdentity = createTrustedServiceExecutionIdentity({
      principalId: 'cloud-run-service:toca-mcp-production',
      tenantId: 'toca',
      workspaceId: 'toca',
      organizationId: 'toca',
      roles: ['OPERATOR'],
      evidence: ['runtime:test'],
      now: '2026-08-20T19:00:00.000Z',
    });

    const identity = resolveRuntimeTenantIdentity(
      { sessionId: 'runtime-session' },
      { tenantId: 'toca', fallbackIdentity },
    );

    expect(identity).toEqual(fallbackIdentity);
  });
});
