import type { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it, vi } from 'vitest';
import * as z from 'zod/v4';
import { InMemoryAuditSink } from '../src/core/audit.js';
import {
  createTrustedServiceExecutionIdentity,
  type ExecutionIdentity,
} from '../src/core/identity.js';
import { registerTocaCoreSurface } from '../src/mcp/core-surface.js';
import { ExistingCoreCapabilityGateway } from '../src/orchestrator/core-gateway.js';
import { Ag01SpecialistMissionCoordinator } from '../src/orchestrator/specialist-missions.js';
import { createToolRegistry } from '../src/registry.js';
import { InMemoryWorkflowStore } from '../src/workflow/in-memory-workflow-store.js';

const NOW = '2026-10-14T20:00:00.000Z';
function identity(
  overrides: Partial<Parameters<typeof createTrustedServiceExecutionIdentity>[0]> = {},
) {
  return createTrustedServiceExecutionIdentity({
    principalId: 'original-requester',
    tenantId: 'tenant',
    workspaceId: 'workspace',
    organizationId: 'organization',
    roles: ['READER'],
    allowedRouteIds: ['R08'],
    allowedCapabilityIds: ['meta_ads.campaigns.list'],
    allowedTargetAccounts: ['source-account'],
    evidence: ['test:trusted-service'],
    now: NOW,
    ...overrides,
  });
}

async function completedMission() {
  const workflows = new InMemoryWorkflowStore();
  const execute = vi.fn(() => Promise.resolve({ privateResult: 'account-scoped-result' }));
  const schema = z.object({ accountId: z.string() });
  const dependencies = {
    registry: createToolRegistry({ metaAdsReadsEnabled: true }),
    runtimeResolver: (capabilityId: string) =>
      capabilityId === 'meta_ads.campaigns.list'
        ? {
            inputSchema: schema,
            execute,
            targetAccount: (input: unknown) => schema.parse(input).accountId,
          }
        : undefined,
    auditSink: new InMemoryAuditSink(),
  };
  const core = new ExistingCoreCapabilityGateway(dependencies);
  const coordinator = new Ag01SpecialistMissionCoordinator(workflows, core, () => new Date(NOW));
  const request = {
    routeId: 'R08' as const,
    capabilityId: 'meta_ads.campaigns.list',
    payload: { accountId: 'source-account' },
    owner: 'AG-09',
    priority: 'P1' as const,
    correlationId: 'authorization-regression',
    idempotencyKey: 'authorization-regression',
    expiresAt: '2026-10-14T21:00:00.000Z',
    identity: identity(),
  };
  const mission = await coordinator.dispatch(request);
  const result = await coordinator.executeOwned(
    mission.mission_id,
    request.owner,
    request.identity,
  );
  function readAs(caller: ExecutionIdentity, toolName = 'toca.workflow.get') {
    const handlers = new Map<
      string,
      (input: { workflowId: string }, context: unknown) => Promise<unknown>
    >();
    const server = {
      registerTool(name: string, _definition: unknown, handler: unknown) {
        handlers.set(
          name,
          handler as (input: { workflowId: string }, context: unknown) => Promise<unknown>,
        );
      },
    } as unknown as McpServer;
    registerTocaCoreSurface(server, {
      serviceName: 'test',
      serviceVersion: 'test',
      ...dependencies,
      workflowStore: workflows,
      resolveIdentity: () => caller,
    });
    return handlers.get(toolName)!({ workflowId: mission.mission_id }, {});
  }
  return { workflows, execute, core, coordinator, request, mission, result, readAs };
}

describe('AG01 persisted result authorization with the real Core inspector', () => {
  it('denies DONE replay after target-account revocation without reexecuting or changing the checkpoint', async () => {
    const h = await completedMission();
    const before = await h.workflows.get(h.mission.mission_id);
    await expect(
      h.coordinator.executeOwned(
        h.mission.mission_id,
        'AG-09',
        identity({ allowedTargetAccounts: [] }),
      ),
    ).rejects.toMatchObject({
      code: 'POLICY_DENIED',
      message: 'AUTHORIZATION_TARGET_ACCOUNT_NOT_ALLOWED',
    });
    expect(await h.workflows.get(h.mission.mission_id)).toEqual(before);
    expect(h.execute).toHaveBeenCalledTimes(1);
  });

  it('recovers the saved result after coordinator restart without another execution or claim, including after expiry', async () => {
    const h = await completedMission();
    const before = await h.workflows.get(h.mission.mission_id);
    const restarted = new Ag01SpecialistMissionCoordinator(
      h.workflows,
      h.core,
      () => new Date('2026-10-14T22:00:00.000Z'),
    );
    await expect(
      restarted.executeOwned(h.mission.mission_id, 'AG-09', identity()),
    ).resolves.toEqual(h.result);
    expect(await h.workflows.get(h.mission.mission_id)).toEqual(before);
    expect(h.execute).toHaveBeenCalledTimes(1);
  });

  it('allows an authorized planned-step replay without duplicate execution', async () => {
    const h = await completedMission();
    await expect(h.coordinator.executePlannedStep(h.request)).resolves.toEqual(h.result);
    expect(h.execute).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'another same-tenant requester without account access',
      { principalId: 'other', allowedTargetAccounts: [] },
    ],
    ['another same-tenant requester with account access', { principalId: 'other' }],
    ['a different workspace', { workspaceId: 'other' }],
    ['a different organization', { organizationId: 'other' }],
  ])('denies generic workflow.get for %s', async (_label, overrides) => {
    const h = await completedMission();
    await expect(h.readAs(identity(overrides))).rejects.toThrow('AG01_MISSION_SCOPE_DENIED');
    expect(h.execute).toHaveBeenCalledTimes(1);
  });

  it('denies generic workflow.get when the original requester loses source-account access', async () => {
    const h = await completedMission();
    await expect(h.readAs(identity({ allowedTargetAccounts: [] }))).rejects.toMatchObject({
      code: 'POLICY_DENIED',
      message: 'AUTHORIZATION_TARGET_ACCOUNT_NOT_ALLOWED',
    });
    expect(h.execute).toHaveBeenCalledTimes(1);
  });

  it('denies generic workflow.get after capability revocation', async () => {
    const h = await completedMission();
    await expect(h.readAs(identity({ allowedCapabilityIds: [] }))).rejects.toThrow(
      'AG01_MISSION_AUTHORIZATION_DENIED',
    );
  });

  it('also denies generic workflow.advance before returning or mutating another requester’s result', async () => {
    const h = await completedMission();
    const before = await h.workflows.get(h.mission.mission_id);
    await expect(
      h.readAs(identity({ principalId: 'other', roles: ['ADMIN'] }), 'toca.workflow.advance'),
    ).rejects.toThrow('AG01_MISSION_SCOPE_DENIED');
    expect(await h.workflows.get(h.mission.mission_id)).toEqual(before);
    expect(h.execute).toHaveBeenCalledTimes(1);
  });

  it('preserves authorized generic reads of existing saved results without executing Core again', async () => {
    const h = await completedMission();
    const response = await h.readAs(identity());
    expect(JSON.stringify(response)).toContain('account-scoped-result');
    expect(h.execute).toHaveBeenCalledTimes(1);
  });
});
