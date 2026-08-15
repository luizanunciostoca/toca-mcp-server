import { describe, expect, it, vi } from 'vitest';
import * as z from 'zod/v4';
import { InMemoryAuditSink } from '../src/core/audit.js';
import { createTrustedServiceExecutionIdentity } from '../src/core/identity.js';
import { ToolRegistry } from '../src/core/tool-registry.js';
import { InMemoryApprovalStore, issueApproval } from '../src/governance/approval-governance.js';
import {
  executeCoreCapability,
  requestCoreApproval,
  type CoreCapabilityRuntimeBinding,
} from '../src/mcp/core-execution.js';
import { CORE_MCP_TOOL_NAMES } from '../src/mcp/core-surface.js';
import { createToolRegistry } from '../src/registry.js';

const NOW = '2026-08-15T05:00:00.000Z';
const LATER = '2026-08-15T06:00:00.000Z';

function externalIdentity() {
  return createTrustedServiceExecutionIdentity({
    principalId: 'test:external-writer',
    tenantId: 'toca-do-morcego',
    roles: ['EXTERNAL_WRITER'],
    allowedCapabilityIds: ['meta_ads.campaign.create_paused'],
    allowedTargetAccounts: ['act_test'],
    evidence: ['test:identity'],
    now: NOW,
  });
}

function operatorIdentity() {
  return createTrustedServiceExecutionIdentity({
    principalId: 'test:operator',
    tenantId: 'toca-do-morcego',
    roles: ['OPERATOR'],
    allowedCapabilityIds: ['instagram.toca_schedule.create'],
    allowedTargetAccounts: [],
    evidence: ['test:identity'],
    now: NOW,
  });
}

function metaWriteRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({
    name: 'meta_ads.campaign.create_paused',
    version: '1.0.0',
    provider: 'Meta Marketing API',
    riskClass: 'WRITE_EXTERNAL',
    requiredScopes: ['ads_management'],
    capabilityStatus: 'PRODUCTION_VALIDATED',
    sideEffects: true,
    idempotent: false,
  });
  return registry;
}

function metaWriteBinding(
  execute = vi.fn(async (_input: unknown) => ({ id: 'campaign_1' })),
): {
  binding: CoreCapabilityRuntimeBinding;
  execute: typeof execute;
} {
  const schema = z.object({ accountId: z.string().min(1), name: z.string().min(1) });
  return {
    execute,
    binding: {
      inputSchema: schema,
      execute: (input) => execute(input),
      targetAccount: (input) => schema.parse(input).accountId,
      idempotencyKey: (input) => `meta:${schema.parse(input).name}`,
      providerReadback: async () => ({
        verified: true,
        evidence: ['provider:test:campaign_1'],
        externalResourceId: 'campaign_1',
      }),
    },
  };
}

describe('M-FOUND-11 TOCA Core MCP Surface', () => {
  it('keeps the public MCP surface small and stable', () => {
    expect(CORE_MCP_TOOL_NAMES).toHaveLength(12);
    expect(new Set(CORE_MCP_TOOL_NAMES).size).toBe(12);
    expect(CORE_MCP_TOOL_NAMES).toEqual([
      'toca.system.health',
      'toca.capabilities.search',
      'toca.capabilities.describe',
      'toca.workflow.create',
      'toca.workflow.get',
      'toca.workflow.advance',
      'toca.approval.request',
      'toca.approval.get',
      'toca.execute',
      'toca.verify',
      'toca.audit.query',
      'toca.event.get',
    ]);
  });

  it('does not execute a catalogued capability without an active runtime binding', async () => {
    const registry = createToolRegistry();
    const auditSink = new InMemoryAuditSink();
    await expect(
      executeCoreCapability(
        {
          capabilityId: 'instagram.publish.image',
          payload: {},
          correlationId: 'test:catalog-only',
        },
        operatorIdentity(),
        {
          registry,
          runtimeResolver: () => undefined,
          auditSink,
        },
      ),
    ).rejects.toMatchObject({
      code: 'CAPABILITY_UNAVAILABLE',
      message: expect.stringContaining('CAPABILITY_NOT_EXECUTABLE'),
    });
  });

  it('requires a formal approval before a production-validated external write', async () => {
    const registry = metaWriteRegistry();
    const auditSink = new InMemoryAuditSink();
    const approvalStore = new InMemoryApprovalStore();
    const { binding, execute } = metaWriteBinding();

    await expect(
      executeCoreCapability(
        {
          capabilityId: 'meta_ads.campaign.create_paused',
          payload: { accountId: 'act_test', name: 'approved-campaign' },
          correlationId: 'test:approval-required',
        },
        externalIdentity(),
        {
          registry,
          runtimeResolver: () => binding,
          auditSink,
          approvalStore,
        },
      ),
    ).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    expect(execute).not.toHaveBeenCalled();
    expect(auditSink.list().at(-1)).toMatchObject({
      status: 'DENIED',
      errorCode: 'APPROVAL_REQUIRED',
    });
  });

  it('invalidates an approval when the typed execution payload changes', async () => {
    const registry = metaWriteRegistry();
    const auditSink = new InMemoryAuditSink();
    const approvalStore = new InMemoryApprovalStore();
    const { binding, execute } = metaWriteBinding();
    const identity = externalIdentity();
    const runtimeResolver = () => binding;

    const requested = await requestCoreApproval(
      {
        capabilityId: 'meta_ads.campaign.create_paused',
        payload: { accountId: 'act_test', name: 'campaign-a' },
        correlationId: 'test:approval-binding',
        expiresAt: LATER,
        evidence: ['test:request'],
      },
      identity,
      { registry, runtimeResolver, approvalStore },
    );
    const approved = issueApproval(requested, {
      authority: {
        approver: 'human:approver',
        allowedRouteIds: [requested.routeId],
        allowedCapabilityIds: [requested.capabilityId],
        allowedTargetAccounts: [requested.targetAccount],
        maxFinancialCeiling: null,
        validatedAt: NOW,
        evidence: ['test:authority'],
      },
      evidence: ['test:approved'],
      now: NOW,
    });
    await approvalStore.put(approved, requested.version);

    await expect(
      executeCoreCapability(
        {
          capabilityId: 'meta_ads.campaign.create_paused',
          payload: { accountId: 'act_test', name: 'campaign-b' },
          correlationId: 'test:approval-binding',
          approvalId: approved.approvalId,
        },
        identity,
        { registry, runtimeResolver, auditSink, approvalStore },
      ),
    ).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses every side effect that lacks provider read-back', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'instagram.toca_schedule.create',
      version: '1.0.0',
      provider: 'toca-mcp',
      riskClass: 'WRITE_REVERSIBLE',
      requiredScopes: [],
      capabilityStatus: 'PRODUCTION_VALIDATED',
      sideEffects: true,
      idempotent: true,
    });
    const execute = vi.fn(async (_input: unknown) => ({ id: 'job_1' }));
    const schema = z.object({ idempotencyKey: z.string().min(1) });
    const binding: CoreCapabilityRuntimeBinding = {
      inputSchema: schema,
      execute: (input) => execute(input),
      idempotencyKey: (input) => schema.parse(input).idempotencyKey,
    };

    await expect(
      executeCoreCapability(
        {
          capabilityId: 'instagram.toca_schedule.create',
          payload: { idempotencyKey: 'job-key' },
          correlationId: 'test:readback-required',
        },
        operatorIdentity(),
        {
          registry,
          runtimeResolver: () => binding,
          auditSink: new InMemoryAuditSink(),
        },
      ),
    ).rejects.toMatchObject({
      code: 'CAPABILITY_UNAVAILABLE',
      message: expect.stringContaining('PROVIDER_READBACK_REQUIRED'),
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
