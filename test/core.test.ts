import { describe, expect, it } from 'vitest';
import { InMemoryAuditSink } from '../src/core/audit.js';
import { executeTool } from '../src/core/executor.js';
import { parseExecutionContext } from '../src/core/execution-context.js';
import { createTrustedServiceExecutionIdentity } from '../src/core/identity.js';
import { evaluatePolicy } from '../src/core/policy.js';
import { ToolRegistry, type ToolDefinition } from '../src/core/tool-registry.js';
import {
  hashApprovalDescriptor,
  issueApproval,
  requestApproval,
} from '../src/governance/approval-governance.js';
import {
  metaOAuthConfigSchema,
  type MetaOAuthTransport,
} from '../src/providers/meta/meta-connection.js';
import { InMemoryOAuthStateStore, MetaOAuthService } from '../src/providers/meta/meta-oauth.js';
import { createToolRegistry } from '../src/registry.js';

const readTool: ToolDefinition = {
  name: 'system.health',
  version: '1.0.0',
  provider: 'system',
  riskClass: 'READ',
  requiredScopes: [],
  capabilityStatus: 'IMPLEMENTED',
  sideEffects: false,
  idempotent: true,
};

const writeTool: ToolDefinition = {
  name: 'instagram.publish.image',
  version: '1.0.0',
  provider: 'meta',
  riskClass: 'WRITE_EXTERNAL',
  requiredScopes: ['instagram_content_publish'],
  capabilityStatus: 'IMPLEMENTED',
  sideEffects: true,
  idempotent: true,
};

const externalWriterIdentity = createTrustedServiceExecutionIdentity({
  principalId: 'test',
  tenantId: 'toca-do-morcego',
  roles: ['EXTERNAL_WRITER'],
  allowedCapabilityIds: ['instagram.publish.image'],
  allowedTargetAccounts: ['instagram-account-1'],
  evidence: ['test://identity/external-writer'],
  now: '2026-08-14T19:59:00Z',
});

describe('ToolRegistry', () => {
  it('registers and lists definitions deterministically', () => {
    const registry = new ToolRegistry();
    registry.register(readTool);
    expect(registry.get('system.health')).toEqual(readTool);
    expect(registry.list()).toEqual([readTool]);
  });

  it('rejects duplicate tool names', () => {
    const registry = new ToolRegistry();
    registry.register(readTool);
    expect(() => registry.register(readTool)).toThrow(/already registered/);
  });

  it('exposes planned publication discovery without making writes executable', () => {
    const registry = createToolRegistry();
    const names = registry.list().map((tool) => tool.name);

    expect(names).toContain('system.capabilities');
    expect(names).toContain('system.health');
    expect(names).toContain('instagram.publish.image');
    expect(names).toContain('instagram.publication.schedule');
    expect(names).toContain('instagram.publication.status');
    expect(registry.get('instagram.publish.image')?.capabilityStatus).toBe('PLANNED');
    expect(registry.get('instagram.publication.schedule')?.capabilityStatus).toBe('PLANNED');
  });

  it('preserves implemented Instagram reads when the provider-backed read boundary is enabled', () => {
    const registry = createToolRegistry({ instagramReadsEnabled: true });
    expect(registry.get('instagram.media.list')).toMatchObject({
      capabilityStatus: 'IMPLEMENTED',
      riskClass: 'READ',
    });
    expect(registry.get('instagram.publish.image')?.capabilityStatus).toBe('PLANNED');
  });
});

describe('evaluatePolicy', () => {
  it('allows non-mutating implemented capabilities', () => {
    expect(evaluatePolicy(readTool, { requester: 'test' }).decision).toBe('ALLOW');
  });

  it('denies side effects before production validation', () => {
    expect(evaluatePolicy(writeTool, { requester: 'test', approved: true }).decision).toBe('DENY');
  });

  it('requires approval for production-validated external writes', () => {
    const validated = {
      ...writeTool,
      capabilityStatus: 'PRODUCTION_VALIDATED' as const,
    };
    expect(
      evaluatePolicy(validated, {
        identity: externalWriterIdentity,
        connectedAccount: 'instagram-account-1',
      }).decision,
    ).toBe('REQUIRE_APPROVAL');
    expect(
      evaluatePolicy(validated, {
        identity: externalWriterIdentity,
        connectedAccount: 'instagram-account-1',
        approved: true,
      }).decision,
    ).toBe('REQUIRE_APPROVAL');

    const descriptor = { mediaId: 'media-1', caption: 'TOCA' };
    const requested = requestApproval(
      {
        requester: externalWriterIdentity.principal.principalId,
        routeId: 'R02',
        capabilityId: validated.name,
        descriptor,
        targetAccount: 'instagram-account-1',
        scope: [validated.name],
        expiresAt: '2026-08-15T00:00:00Z',
        evidence: ['chatgpt://request/policy-test'],
        correlationId: 'corr-policy-approval-1',
      },
      { now: '2026-08-14T20:00:00Z', createId: () => 'approval-policy-1' },
    );
    const approval = issueApproval(requested, {
      authority: {
        approver: 'authorized-approver',
        allowedRouteIds: ['R02'],
        allowedCapabilityIds: [validated.name],
        allowedTargetAccounts: ['instagram-account-1'],
        maxFinancialCeiling: null,
        validatedAt: '2026-08-14T20:00:30Z',
        evidence: ['drive://approval-authority/test'],
      },
      evidence: ['chatgpt://approval/policy-test'],
      now: '2026-08-14T20:01:00Z',
    });
    expect(
      evaluatePolicy(validated, {
        identity: externalWriterIdentity,
        connectedAccount: 'instagram-account-1',
        approval,
        descriptorSha256: hashApprovalDescriptor(descriptor),
        now: '2026-08-14T20:02:00Z',
      }).decision,
    ).toBe('ALLOW');
  });
});

describe('executeTool', () => {
  it('audits successful allowed executions', async () => {
    const auditSink = new InMemoryAuditSink();
    const result = await executeTool({
      tool: readTool,
      policyContext: { requester: 'test-user' },
      auditSink,
      correlationId: 'corr_exec_001',
      action: () => Promise.resolve('ok'),
    });

    expect(result).toBe('ok');
    expect(auditSink.list().map((event) => event.status)).toEqual(['STARTED', 'SUCCEEDED']);
    expect(new Set(auditSink.list().map((event) => event.executionId)).size).toBe(1);
  });

  it('blocks writes that are not production validated before action execution', async () => {
    const auditSink = new InMemoryAuditSink();
    let called = false;

    await expect(
      executeTool({
        tool: writeTool,
        policyContext: { requester: 'test-user', approved: true },
        auditSink,
        correlationId: 'corr_exec_002',
        action: () => {
          called = true;
          return Promise.resolve('should-not-run');
        },
      }),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });

    expect(called).toBe(false);
    expect(auditSink.list().map((event) => event.status)).toEqual(['DENIED']);
  });
});

describe('ExecutionContext', () => {
  it('parses machine-actionable context without inventing optional facts', () => {
    expect(
      parseExecutionContext({
        brand: 'toca_do_morcego',
        businessDomain: 'marketing',
        timezone: 'America/Bahia',
        correlationId: 'corr_test_001',
      }),
    ).toEqual({
      brand: 'toca_do_morcego',
      businessDomain: 'marketing',
      timezone: 'America/Bahia',
      correlationId: 'corr_test_001',
    });
  });

  it('rejects invalid content states and negative budgets', () => {
    expect(() =>
      parseExecutionContext({
        brand: 'toca_do_morcego',
        businessDomain: 'marketing',
        timezone: 'America/Bahia',
        correlationId: 'corr_test_002',
        contentStatus: 'READY_TO_POST',
        budgetAuthorized: -1,
      }),
    ).toThrow();
  });
});

const validMetaOAuthConfig = {
  appId: 'app-id',
  appSecret: { provider: 'env', key: 'META_APP_SECRET' },
  authorizationEndpoint: 'https://www.facebook.com/dialog/oauth',
  tokenEndpoint: 'https://graph.facebook.com/oauth/access_token',
  redirectUri: 'https://example.com/oauth/meta/callback',
  requestedScopes: ['pages_show_list'],
};

describe('Meta OAuth configuration', () => {
  it('accepts secret references instead of raw app secrets', () => {
    expect(metaOAuthConfigSchema.parse(validMetaOAuthConfig)).toEqual(validMetaOAuthConfig);
  });

  it('rejects invalid redirect URIs and empty scope sets', () => {
    expect(() =>
      metaOAuthConfigSchema.parse({
        ...validMetaOAuthConfig,
        redirectUri: 'not-a-url',
        requestedScopes: [],
      }),
    ).toThrow();
  });
});

describe('Meta OAuth state flow', () => {
  const createTransport = (): MetaOAuthTransport => ({
    exchangeAuthorizationCode: () =>
      Promise.resolve({
        accessToken: { provider: 'test-secret-store', key: 'meta/access-token' },
        grantedScopes: ['pages_show_list'],
      }),
  });

  it('generates an authorization URL with state and exchanges a valid callback once', async () => {
    const now = new Date('2026-08-09T02:00:00.000Z');
    const service = new MetaOAuthService(
      metaOAuthConfigSchema.parse(validMetaOAuthConfig),
      new InMemoryOAuthStateStore(),
      createTransport(),
      { now: () => now },
    );

    const authorization = await service.beginAuthorization();
    const url = new URL(authorization.authorizationUrl);
    expect(url.searchParams.get('state')).toBe(authorization.state);
    expect(url.searchParams.get('client_id')).toBe('app-id');
    expect(url.searchParams.get('scope')).toBe('pages_show_list');

    await expect(
      service.completeAuthorization({ code: 'authorization-code', state: authorization.state }),
    ).resolves.toMatchObject({
      accessToken: { provider: 'test-secret-store', key: 'meta/access-token' },
    });

    await expect(
      service.completeAuthorization({ code: 'replay', state: authorization.state }),
    ).rejects.toThrow(/already-consumed/);
  });

  it('rejects expired state before token exchange', async () => {
    let now = new Date('2026-08-09T02:00:00.000Z');
    const service = new MetaOAuthService(
      metaOAuthConfigSchema.parse(validMetaOAuthConfig),
      new InMemoryOAuthStateStore(),
      createTransport(),
      { stateTtlMs: 1000, now: () => now },
    );

    const authorization = await service.beginAuthorization();
    now = new Date('2026-08-09T02:00:02.000Z');

    await expect(
      service.completeAuthorization({ code: 'authorization-code', state: authorization.state }),
    ).rejects.toThrow(/expired/);
  });
});
