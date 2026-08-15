import { describe, expect, it } from 'vitest';
import {
  createTrustedServiceExecutionIdentity,
  resolveExecutionIdentityFromMcpContext,
} from '../src/core/identity.js';

describe('M-FOUND-04 workspace and organization identity', () => {
  it('binds trusted infrastructure identities to explicit workspace and organization context', () => {
    const identity = createTrustedServiceExecutionIdentity({
      principalId: 'cloud-run-service:toca-mcp-production',
      tenantId: 'toca-do-morcego',
      workspaceId: 'toca-os',
      organizationId: 'toca-do-morcego',
      roles: ['OPERATOR'],
      allowedCapabilityIds: ['instagram.toca_schedule.create'],
      evidence: ['test://cloud-run/iam-boundary'],
      now: '2026-08-14T20:00:00Z',
    });

    expect(identity.principal).toMatchObject({
      tenantId: 'toca-do-morcego',
      workspaceId: 'toca-os',
      organizationId: 'toca-do-morcego',
    });
  });

  it('defaults workspace and organization to the verified tenant when no narrower context exists', () => {
    const identity = resolveExecutionIdentityFromMcpContext(
      {
        http: {
          authInfo: {
            clientId: 'chatgpt-client',
            scopes: ['toca:read'],
            expiresAt: Date.parse('2026-08-15T00:00:00Z') / 1000,
          },
        },
      },
      { tenantId: 'toca-do-morcego', now: '2026-08-14T20:00:00Z' },
    );

    expect(identity?.principal).toMatchObject({
      workspaceId: 'toca-do-morcego',
      organizationId: 'toca-do-morcego',
    });
  });

  it('returns no identity when an authenticated token carries no TOCA authorization role', () => {
    expect(
      resolveExecutionIdentityFromMcpContext(
        {
          http: {
            authInfo: {
              clientId: 'unprivileged-client',
              scopes: ['openid', 'profile'],
              expiresAt: Date.parse('2026-08-15T00:00:00Z') / 1000,
            },
          },
        },
        {
          tenantId: 'toca-do-morcego',
          now: '2026-08-14T20:00:00Z',
        },
      ),
    ).toBeUndefined();
  });
});
