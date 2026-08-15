import type { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it, vi } from 'vitest';
import * as z from 'zod/v4';
import { InMemoryAuditSink } from '../src/core/audit.js';
import {
  createTrustedServiceExecutionIdentity,
  type ExecutionIdentityResolver,
} from '../src/core/identity.js';
import { ToolRegistry } from '../src/core/tool-registry.js';
import {
  hashApprovalDescriptor,
  InMemoryApprovalStore,
  requestApproval,
} from '../src/governance/approval-governance.js';
import {
  createExecutionApprovalDescriptor,
  executeCoreCapability,
  type CoreCapabilityRuntimeBinding,
} from '../src/mcp/core-execution.js';
import {
  CORE_MCP_TOOL_NAMES,
  registerTocaCoreSurface,
  type TocaCoreSurfaceDependencies,
} from '../src/mcp/core-surface.js';
import { createToolRegistry } from '../src/registry.js';
import type { WorkflowSnapshot, WorkflowStore } from '../src/workflow/workflow-contracts.js';

const NOW = '2020-01-01T00:00:00.000Z';

function externalIdentity(principalId = 'test:external-writer', tenantId = 'toca-do-morcego') {
  return createTrustedServiceExecutionIdentity({
    principalId,
    tenantId,
    roles: ['EXTERNAL_WRITER'],
    allowedCapabilityIds: ['meta_ads.campaign.create_paused'],
    allowedTargetAccounts: ['act_test'],
    evidence: ['test:identity'],
    now: NOW,
  });
}

function readerIdentity(principalId = 'test:reader', tenantId = 'toca-do-morcego') {
  return createTrustedServiceExecutionIdentity({
    principalId,
    tenantId,
    roles: ['READER'],
    allowedCapabilityIds: ['meta_ads.campaigns.list'],
    allowedTargetAccounts: ['act_allowed'],
    evidence: ['test:identity'],
    now: NOW,
  });
}

function operatorIdentity(principalId = 'test:operator', tenantId = 'toca-do-morcego') {
  return createTrustedServiceExecutionIdentity({
    principalId,
    tenantId,
    roles: ['OPERATOR'],
    allowedCapabilityIds: ['instagram.toca_schedule.create'],
    allowedTargetAccounts: [],
    evidence: ['test:identity'],
    now: NOW,
  });
}

function adminIdentity(principalId = 'test:admin', tenantId = 'toca-do-morcego') {
  return createTrustedServiceExecutionIdentity({
    principalId,
    tenantId,
    roles: ['ADMIN'],
    evidence: ['test:identity'],
    now: NOW,
  });
}

function promotedMetaWriteRegistry(): ToolRegistry {
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

function schedulerBinding(
  options: {
    readonly readback?: CoreCapabilityRuntimeBinding['providerReadback'];
    readonly execute?: (input: unknown) => Promise<unknown>;
    readonly validated?: boolean;
  } = {},
): CoreCapabilityRuntimeBinding {
  const schema = z.object({ idempotencyKey: z.string().min(1) });
  return {
    inputSchema: schema,
    execute: options.execute ?? (async () => ({ id: 'job_1' })),
    idempotencyKey: (input) => `job:${schema.parse(input).idempotencyKey}`,
    sideEffectValidated: options.validated ?? true,
    ...(options.readback ? { providerReadback: options.readback } : {}),
  };
}

type CapturedToolHandler = (
  input: Record<string, unknown>,
  context: Parameters<ExecutionIdentityResolver>[0],
) => unknown;

function captureSurface(dependencies: TocaCoreSurfaceDependencies) {
  const handlers = new Map<string, CapturedToolHandler>();
  const server = {
    registerTool(name: string, _definition: unknown, handler: unknown) {
      handlers.set(name, handler as CapturedToolHandler);
    },
  } as unknown as McpServer;
  registerTocaCoreSurface(server, dependencies);
  return handlers;
}

function partialWorkflowSnapshot(
  workflowId: string,
  tenantId: string,
  humanTaskIds: readonly string[],
): WorkflowSnapshot {
  return {
    instance: { workflowId, tenantId },
    humanTasks: humanTaskIds.map((taskId) => ({ taskId, workflowId })),
  } as unknown as WorkflowSnapshot;
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
          auditSink: new InMemoryAuditSink(),
        },
      ),
    ).rejects.toMatchObject({
      code: 'CAPABILITY_UNAVAILABLE',
      message: expect.stringContaining('CAPABILITY_NOT_EXECUTABLE'),
    });
  });

  it('fails closed when runtime lifecycle is promoted beyond the canonical catalog', async () => {
    const execute = vi.fn(async (_input: unknown) => ({ campaignId: 'campaign_1' }));
    const binding: CoreCapabilityRuntimeBinding = {
      inputSchema: z.object({ accountId: z.string().min(1), name: z.string().min(1) }),
      execute,
      targetAccount: (input) => z.object({ accountId: z.string() }).parse(input).accountId,
      idempotencyKey: () => 'meta:test',
      providerReadback: async () => ({
        verified: true,
        evidence: ['provider:test:campaign_1'],
        externalResourceId: 'campaign_1',
      }),
      sideEffectValidated: true,
    };

    await expect(
      executeCoreCapability(
        {
          capabilityId: 'meta_ads.campaign.create_paused',
          payload: { accountId: 'act_test', name: 'campaign' },
          correlationId: 'test:lifecycle-drift',
        },
        externalIdentity(),
        {
          registry: promotedMetaWriteRegistry(),
          runtimeResolver: () => binding,
          auditSink: new InMemoryAuditSink(),
        },
      ),
    ).rejects.toMatchObject({
      code: 'CAPABILITY_UNAVAILABLE',
      message: expect.stringContaining('lifecycle_status'),
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses a side-effect runtime binding that is not explicitly validated', async () => {
    const execute = vi.fn(async (_input: unknown) => ({ id: 'job_1' }));
    const registry = createToolRegistry({ tocaManagedInstagramSchedulerEnabled: true });

    await expect(
      executeCoreCapability(
        {
          capabilityId: 'instagram.toca_schedule.create',
          payload: { idempotencyKey: 'job-key' },
          correlationId: 'test:binding-maturity',
        },
        operatorIdentity(),
        {
          registry,
          runtimeResolver: () =>
            schedulerBinding({
              execute,
              validated: false,
              readback: async () => ({
                verified: true,
                evidence: ['scheduler:job:job_1:scheduled'],
                externalResourceId: 'job_1',
              }),
            }),
          auditSink: new InMemoryAuditSink(),
        },
      ),
    ).rejects.toMatchObject({
      code: 'CAPABILITY_UNAVAILABLE',
      message: expect.stringContaining('CAPABILITY_RUNTIME_BINDING_UNVALIDATED'),
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('enforces target-account authorization for account-scoped reads', async () => {
    const execute = vi.fn(async (_input: unknown) => []);
    const schema = z.object({
      adAccountId: z.string().min(1),
      currency: z.string().min(3),
    });
    const binding: CoreCapabilityRuntimeBinding = {
      inputSchema: schema,
      execute,
      targetAccount: (input) => schema.parse(input).adAccountId,
    };

    await expect(
      executeCoreCapability(
        {
          capabilityId: 'meta_ads.campaigns.list',
          payload: { adAccountId: 'act_other', currency: 'BRL' },
          correlationId: 'test:account-read-auth',
        },
        readerIdentity(),
        {
          registry: createToolRegistry({ metaAdsReadsEnabled: true }),
          runtimeResolver: () => binding,
          auditSink: new InMemoryAuditSink(),
        },
      ),
    ).rejects.toMatchObject({
      code: 'POLICY_DENIED',
      message: 'AUTHORIZATION_TARGET_ACCOUNT_NOT_ALLOWED',
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('binds approval descriptor hashing to payload and requester identity context', () => {
    const first = createExecutionApprovalDescriptor({
      capabilityId: 'meta_ads.campaign.create_paused',
      payload: { accountId: 'act_test', name: 'campaign-a' },
      identity: externalIdentity('principal:a', 'tenant-a'),
      targetAccount: 'act_test',
      idempotencyKey: 'meta:a',
    });
    const payloadDrift = createExecutionApprovalDescriptor({
      capabilityId: 'meta_ads.campaign.create_paused',
      payload: { accountId: 'act_test', name: 'campaign-b' },
      identity: externalIdentity('principal:a', 'tenant-a'),
      targetAccount: 'act_test',
      idempotencyKey: 'meta:a',
    });
    const requesterDrift = createExecutionApprovalDescriptor({
      capabilityId: 'meta_ads.campaign.create_paused',
      payload: { accountId: 'act_test', name: 'campaign-a' },
      identity: externalIdentity('principal:b', 'tenant-b'),
      targetAccount: 'act_test',
      idempotencyKey: 'meta:a',
    });

    expect(hashApprovalDescriptor(first)).not.toBe(hashApprovalDescriptor(payloadDrift));
    expect(hashApprovalDescriptor(first)).not.toBe(hashApprovalDescriptor(requesterDrift));
  });

  it('refuses every side effect that lacks provider read-back before invoking the handler', async () => {
    const execute = vi.fn(async (_input: unknown) => ({ id: 'job_1' }));
    const registry = createToolRegistry({ tocaManagedInstagramSchedulerEnabled: true });

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
          runtimeResolver: () => schedulerBinding({ execute }),
          auditSink: new InMemoryAuditSink(),
        },
      ),
    ).rejects.toMatchObject({
      code: 'CAPABILITY_UNAVAILABLE',
      message: expect.stringContaining('PROVIDER_READBACK_REQUIRED'),
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('requires provider read-back to identify the exact side-effect resource', async () => {
    const registry = createToolRegistry({ tocaManagedInstagramSchedulerEnabled: true });
    const auditSink = new InMemoryAuditSink();

    await expect(
      executeCoreCapability(
        {
          capabilityId: 'instagram.toca_schedule.create',
          payload: { idempotencyKey: 'job-key' },
          correlationId: 'test:resource-id-required',
        },
        operatorIdentity(),
        {
          registry,
          runtimeResolver: () =>
            schedulerBinding({
              readback: async () => ({
                verified: true,
                evidence: ['scheduler:job:job_1:scheduled'],
              }),
            }),
          auditSink,
        },
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_READBACK_FAILED' });
    expect(auditSink.list().at(-1)).toMatchObject({
      status: 'FAILED',
      errorCode: 'PROVIDER_READBACK_FAILED',
      evidence: expect.arrayContaining([expect.stringMatching(/^core:descriptor-sha256:/)]),
    });
  });

  it('binds successful side effects to descriptor evidence and provider resource identity in audit', async () => {
    const registry = createToolRegistry({ tocaManagedInstagramSchedulerEnabled: true });
    const auditSink = new InMemoryAuditSink();
    const result = await executeCoreCapability(
      {
        capabilityId: 'instagram.toca_schedule.create',
        payload: { idempotencyKey: 'job-key' },
        correlationId: 'test:audit-binding',
      },
      operatorIdentity(),
      {
        registry,
        runtimeResolver: () =>
          schedulerBinding({
            readback: async () => ({
              verified: true,
              evidence: ['scheduler:job:job_1:scheduled'],
              externalResourceId: 'job_1',
            }),
          }),
        auditSink,
        createExecutionId: () => 'execution_1',
      },
    );

    expect(result).toMatchObject({
      executionId: 'execution_1',
      providerReadbackVerified: true,
    });
    expect(auditSink.list().at(-1)).toMatchObject({
      status: 'SUCCEEDED',
      externalResourceId: 'job_1',
      evidence: expect.arrayContaining([
        expect.stringMatching(/^core:descriptor-sha256:/),
        'provider:readback:instagram.toca_schedule.create',
        'scheduler:job:job_1:scheduled',
      ]),
    });
  });

  it('rejects a human-task id that is not part of the already-authorized workflow before mutation', async () => {
    const local = partialWorkflowSnapshot('wf_local', 'toca-do-morcego', []);
    const claimHumanTask = vi.fn(async (_input: unknown) => local);
    const workflowStore = {
      get: vi.fn(async (_workflowId: string) => local),
      claimHumanTask,
    } as unknown as WorkflowStore;
    const identity = operatorIdentity();
    const handlers = captureSurface({
      serviceName: 'test',
      serviceVersion: '1.0.0',
      registry: createToolRegistry(),
      runtimeResolver: () => undefined,
      resolveIdentity: () => identity,
      workflowStore,
    });
    const handler = handlers.get('toca.workflow.advance');
    expect(handler).toBeDefined();

    await expect(
      handler!(
        {
          action: 'CLAIM_HUMAN_TASK',
          workflowId: 'wf_local',
          taskId: 'foreign_task',
          evidence: ['test:evidence'],
        },
        {},
      ) as Promise<unknown>,
    ).rejects.toThrow('WORKFLOW_HUMAN_TASK_WORKFLOW_MISMATCH');
    expect(claimHumanTask).not.toHaveBeenCalled();
  });

  it('does not let a generic ADMIN role read an ApprovalRecord owned by another requester', async () => {
    const approvalStore = new InMemoryApprovalStore();
    const approval = requestApproval(
      {
        requester: 'other:requester',
        routeId: 'R28',
        capabilityId: 'meta_ads.campaign.create_paused',
        descriptor: { test: true },
        targetAccount: 'act_test',
        scope: ['meta_ads.campaign.create_paused'],
        expiresAt: '2099-01-01T00:00:00.000Z',
        correlationId: 'test:approval-read',
      },
      { now: NOW, createId: () => 'approval_other' },
    );
    await approvalStore.put(approval);
    const handlers = captureSurface({
      serviceName: 'test',
      serviceVersion: '1.0.0',
      registry: createToolRegistry(),
      runtimeResolver: () => undefined,
      resolveIdentity: () => adminIdentity(),
      approvalStore,
    });
    const handler = handlers.get('toca.approval.get');
    expect(handler).toBeDefined();

    await expect(
      handler!({ approvalId: approval.approvalId }, {}) as Promise<unknown>,
    ).rejects.toThrow('APPROVAL_ACCESS_DENIED');
  });
});
