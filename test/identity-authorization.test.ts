import { describe, expect, it } from 'vitest';
import { InMemoryAuditSink } from '../src/core/audit.js';
import { executeTool } from '../src/core/executor.js';
import {
  authorizeExecution,
  createTrustedServiceExecutionIdentity,
  resolveExecutionIdentityFromMcpContext,
} from '../src/core/identity.js';
import { evaluatePolicy } from '../src/core/policy.js';
import { createToolRegistry } from '../src/registry.js';

const schedulerIdentity = createTrustedServiceExecutionIdentity({
  principalId: 'cloud-run-service:toca-mcp-production',
  tenantId: 'toca-do-morcego',
  roles: ['OPERATOR'],
  allowedCapabilityIds: [
    'instagram.toca_schedule.create',
    'instagram.toca_schedule.reschedule',
    'instagram.toca_schedule.cancel',
  ],
  allowedTargetAccounts: [],
  evidence: ['test://cloud-run/iam-boundary'],
  now: '2026-08-14T20:00:00Z',
});

const registry = createToolRegistry({ tocaManagedInstagramSchedulerEnabled: true });
const schedulerCreate = registry.get('instagram.toca_schedule.create')!;

describe('M-FOUND-04 execution identity', () => {
  it('resolves verified MCP auth info into roles and account restrictions without retaining tokens', () => {
    const identity = resolveExecutionIdentityFromMcpContext(
      {
        http: {
          authInfo: {
            clientId: 'chatgpt-client',
            scopes: [
              'toca:write:external',
              'toca:route:R28',
              'toca:capability:meta_ads.campaign.create_paused',
              'toca:account:act_123',
            ],
            expiresAt: Date.parse('2026-08-15T00:00:00Z') / 1000,
          },
        },
      },
      { tenantId: 'toca-do-morcego', now: '2026-08-14T20:00:00Z' },
    );

    expect(identity).toMatchObject({
      principal: {
        principalId: 'mcp-client:chatgpt-client',
        tenantId: 'toca-do-morcego',
        authenticationMethod: 'MCP_OAUTH_BEARER',
      },
      authorization: {
        roles: ['EXTERNAL_WRITER'],
        allowedRouteIds: ['R28'],
        allowedCapabilityIds: ['meta_ads.campaign.create_paused'],
        allowedTargetAccounts: ['act_123'],
      },
    });
    expect(JSON.stringify(identity)).not.toContain('token');
  });

  it('rejects expired MCP identities instead of falling back to a broader service identity', () => {
    const resolved = resolveExecutionIdentityFromMcpContext(
      {
        http: {
          authInfo: {
            clientId: 'expired-client',
            scopes: ['toca:admin'],
            expiresAt: Date.parse('2026-08-14T19:00:00Z') / 1000,
          },
        },
      },
      {
        tenantId: 'toca-do-morcego',
        fallbackIdentity: schedulerIdentity,
        now: '2026-08-14T20:00:00Z',
      },
    );

    expect(resolved).toBeUndefined();
  });

  it('applies least privilege by risk class, capability and target account', () => {
    expect(
      authorizeExecution(schedulerIdentity, {
        capabilityId: 'instagram.toca_schedule.create',
        riskClass: 'WRITE_REVERSIBLE',
        now: '2026-08-14T20:01:00Z',
      }),
    ).toEqual({ allowed: true, reason: 'IDENTITY_AND_AUTHORIZATION_VALID' });

    expect(
      authorizeExecution(schedulerIdentity, {
        capabilityId: 'meta_ads.campaign.create_paused',
        riskClass: 'WRITE_EXTERNAL',
        targetAccount: 'act_123',
        now: '2026-08-14T20:01:00Z',
      }).allowed,
    ).toBe(false);
  });
});

describe('M-FOUND-04 policy and audit binding', () => {
  it('denies a production side effect without an authenticated execution identity', () => {
    expect(evaluatePolicy(schedulerCreate, {}).decision).toBe('DENY');
    expect(evaluatePolicy(schedulerCreate, {}).reason).toBe('IDENTITY_REQUIRED');
  });

  it('allows the bounded scheduler operator and audits its principal metadata', async () => {
    expect(evaluatePolicy(schedulerCreate, { identity: schedulerIdentity }).decision).toBe('ALLOW');

    const auditSink = new InMemoryAuditSink();
    await expect(
      executeTool({
        tool: schedulerCreate,
        policyContext: { identity: schedulerIdentity },
        auditSink,
        correlationId: 'corr-identity-001',
        action: () => Promise.resolve({ status: 'scheduled' }),
      }),
    ).resolves.toEqual({ status: 'scheduled' });

    expect(auditSink.list()).toHaveLength(2);
    for (const event of auditSink.list()) {
      expect(event).toMatchObject({
        requester: 'cloud-run-service:toca-mcp-production',
        principalType: 'SERVICE',
        tenantId: 'toca-do-morcego',
        authenticationMethod: 'INFRASTRUCTURE_IDENTITY',
        authorizationRoles: ['OPERATOR'],
      });
    }
  });
});
