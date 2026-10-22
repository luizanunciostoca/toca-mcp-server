import { describe, expect, it, vi } from 'vitest';
import * as z from 'zod/v4';
import * as routes from '../src/governance/route-catalog.js';
import { ExistingCoreCapabilityGateway } from '../src/orchestrator/core-gateway.js';
import { InMemoryAuditSink } from '../src/core/audit.js';
import { createToolRegistry } from '../src/registry.js';
import { createTrustedServiceExecutionIdentity } from '../src/core/identity.js';
import {
  Ag01SpecialistMissionCoordinator,
  SPECIALIST_MISSION_MAX_TTL_MS,
} from '../src/orchestrator/specialist-missions.js';
import type { CoreCapabilityGateway } from '../src/orchestrator/contracts.js';
import { InMemoryWorkflowStore } from '../src/workflow/in-memory-workflow-store.js';
import { InMemoryConversationStore } from '../src/orchestrator/in-memory-conversation-store.js';
import { TocaOrchestratorRuntime } from '../src/orchestrator/runtime.js';
import type { Ag01SpecialistMissionCoordinator as SpecialistCoordinator } from '../src/orchestrator/specialist-missions.js';

const T0 = '2026-10-14T20:00:00.000Z';
const T1 = '2026-10-14T21:00:00.000Z';
const T2 = '2026-10-14T22:00:00.000Z';

function identity(
  input: { tenantId?: string; routes?: ('R03' | 'R04' | 'R19')[]; capabilities?: string[] } = {},
) {
  return createTrustedServiceExecutionIdentity({
    principalId: 'toca-ag01',
    tenantId: input.tenantId ?? 'toca',
    workspaceId: 'workspace',
    organizationId: 'organization',
    roles: ['READER'],
    allowedRouteIds: input.routes ?? ['R03'],
    allowedCapabilityIds: input.capabilities ?? ['media.scan'],
    allowedTargetAccounts: [],
    evidence: ['service-auth:fixture'],
    now: T0,
  });
}

type ExecutionResult = Awaited<ReturnType<CoreCapabilityGateway['execute']>>;

function harness(
  options: {
    sideEffects?: boolean;
    approved?: boolean;
    wait?: Promise<void>;
    fail?: boolean;
    badAck?: boolean;
    approvalRequired?: boolean;
  } = {},
) {
  let clock = T0;
  const workflows = new InMemoryWorkflowStore();
  const execute = vi.fn(async (): Promise<ExecutionResult> => {
    if (options.wait) await options.wait;
    if (options.fail) throw new Error('PROVIDER_READER_TEMPORARILY_FAILED');
    return {
      executionId: options.badAck ? '' : 'core-ack-001',
      capabilityId: 'media.scan',
      result: { producer: 'toca-core', count: 3 },
      providerReadbackVerified: options.approved ?? false,
    };
  });
  const core = {
    inspect: vi.fn(() => ({
      canonicalCapabilityId: 'media.scan',
      routeId: 'R03' as const,
      sideEffects: options.sideEffects ?? false,
      approvalRequired: options.approvalRequired ?? false,
      idempotent: true,
    })),
    execute,
    requestApproval: vi.fn(),
    getApproval: vi.fn(),
  } as unknown as CoreCapabilityGateway;
  const coordinator = new Ag01SpecialistMissionCoordinator(workflows, core, () => new Date(clock));
  const request = (patch: Record<string, unknown> = {}) => ({
    routeId: 'R03' as const,
    capabilityId: 'media.scan',
    payload: { folderId: 'test-only' },
    owner: 'AG-06',
    priority: 'P1' as const,
    correlationId: 'corr-001',
    idempotencyKey: 'job-001',
    expiresAt: T1,
    identity: identity(),
    ...patch,
  });
  return {
    workflows,
    coordinator,
    request,
    execute,
    core,
    setNow: (now: string) => {
      clock = now;
    },
  };
}

describe('AG-01 internal specialized missions — existing WorkflowStore, producer-only ACK', () => {
  it('records READY and only marks DONE after the existing Core returns execution evidence', async () => {
    const h = harness();
    const queued = await h.coordinator.dispatch(h.request());
    expect(queued.mission_id).toMatch(/^ag01mission_/);
    expect(queued.status).toBe('READY');
    expect(queued.coreExecutionId).toBeNull();
    const actual = await h.coordinator.executeOwned(queued.mission_id, 'AG-06', identity());
    expect(actual.executionId).toBe('core-ack-001');
    const done = await h.coordinator.status(queued.mission_id, identity());
    expect(done.status).toBe('DONE');
    expect(done.coreExecutionId).toBe('core-ack-001');
    expect(done.providerReadbackVerified).toBe(false); // read-only Core ACK != provider proof
    expect(done.evidence).toContain('ag01:core-execution:core-ack-001');
    expect(h.execute).toHaveBeenCalledTimes(1);
    await h.coordinator.executeOwned(queued.mission_id, 'AG-06', identity());
    expect(h.execute).toHaveBeenCalledTimes(1);
  });

  it('prevents duplicate or changed replays within a tenant', async () => {
    const h = harness();
    const first = await h.coordinator.dispatch(h.request());
    const replay = await h.coordinator.dispatch(h.request());
    expect(replay.mission_id).toBe(first.mission_id);
    expect(
      (await h.workflows.get(first.mission_id))?.events.filter(
        (x) => x.eventType === 'WORKFLOW_CREATED',
      ),
    ).toHaveLength(1);
    await expect(
      h.coordinator.dispatch(h.request({ payload: { folderId: 'different' } })),
    ).rejects.toThrow('AG01_MISSION_IDEMPOTENCY_CONFLICT');
  });

  it('rejects worker ownership mismatch, changed tenant and identity authorization', async () => {
    const h = harness();
    const queued = await h.coordinator.dispatch(h.request());
    await expect(
      h.coordinator.executeOwned(queued.mission_id, 'AG-04', identity()),
    ).rejects.toThrow('AG01_MISSION_WORKER_OWNER_MISMATCH');
    await expect(
      h.coordinator.executeOwned(
        queued.mission_id,
        'AG-06',
        identity({ tenantId: 'someone-else' }),
      ),
    ).rejects.toThrow('AG01_MISSION_SCOPE_DENIED');
    await expect(
      h.coordinator.executeOwned(
        queued.mission_id,
        'AG-06',
        identity({ capabilities: ['image.enhance'] }),
      ),
    ).rejects.toThrow('AG01_MISSION_AUTHORIZATION_DENIED');
    expect(h.execute).not.toHaveBeenCalled();
  });

  it('enforces bounded expiry before worker claim without provider calls', async () => {
    const h = harness();
    const queued = await h.coordinator.dispatch(h.request());
    h.setNow(T2);
    await expect(
      h.coordinator.executeOwned(queued.mission_id, 'AG-06', identity()),
    ).rejects.toThrow('AG01_MISSION_TTL_EXPIRED_OR_INVALID');
    expect((await h.coordinator.status(queued.mission_id, identity())).status).toBe('READY');
    expect(h.execute).not.toHaveBeenCalled();
  });

  it('fails closed for side-effecting Core tools even if an upstream registry suggests READ', async () => {
    const h = harness({ sideEffects: true });
    await expect(h.coordinator.dispatch(h.request())).rejects.toThrow(
      'AG01_MISSION_CORE_READONLY_BOUNDARY',
    );
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.coordinator.supports('instagram.publication.publish')).toBe(false);
    expect(h.coordinator.supports('google_ads.campaign.create')).toBe(false);
  });

  it('prevents reentrancy while first worker owns the workflow claim', async () => {
    let proceed!: () => void;
    const wait = new Promise<void>((resolve) => {
      proceed = resolve;
    });
    const h = harness({ wait });
    const queued = await h.coordinator.dispatch(h.request());
    const inProgress = h.coordinator.executeOwned(queued.mission_id, 'AG-06', identity());
    // Core invocation begins after the durable atomic claim.
    for (let n = 0; n < 100 && h.execute.mock.calls.length === 0; n++) await Promise.resolve();
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect((await h.coordinator.status(queued.mission_id, identity())).status).toBe('STARTED');
    await expect(
      h.coordinator.executeOwned(queued.mission_id, 'AG-06', identity()),
    ).rejects.toThrow('AG01_MISSION_ALREADY_CLAIMED');
    proceed();
    await inProgress;
    expect(h.execute).toHaveBeenCalledTimes(1);
  });

  it('persists FAILED when the real executor fails, without a forged DONE', async () => {
    const h = harness({ fail: true });
    const queued = await h.coordinator.dispatch(h.request());
    await expect(
      h.coordinator.executeOwned(queued.mission_id, 'AG-06', identity()),
    ).rejects.toThrow('PROVIDER_READER_TEMPORARILY_FAILED');
    const failed = await h.coordinator.status(queued.mission_id, identity());
    expect(failed.status).toBe('FAILED');
    expect(failed.coreExecutionId).toBeNull();
    await expect(
      h.coordinator.executeOwned(queued.mission_id, 'AG-06', identity()),
    ).rejects.toThrow('AG01_MISSION_ALREADY_FAILED');
    expect(h.execute).toHaveBeenCalledTimes(1);
  });

  it('returns STARTED after an uncertain post-Core persistence failure, never double-executes', async () => {
    const h = harness();
    const queued = await h.coordinator.dispatch(h.request());
    const original = h.workflows.completeStep.bind(h.workflows);
    h.workflows.completeStep = vi.fn().mockRejectedValue(new Error('POSTGRES_UNAVAILABLE'));
    await expect(
      h.coordinator.executeOwned(queued.mission_id, 'AG-06', identity()),
    ).rejects.toThrow('POSTGRES_UNAVAILABLE');
    expect((await h.coordinator.status(queued.mission_id, identity())).status).toBe('STARTED');
    await expect(
      h.coordinator.executeOwned(queued.mission_id, 'AG-06', identity()),
    ).rejects.toThrow('AG01_MISSION_ALREADY_CLAIMED');
    expect(h.execute).toHaveBeenCalledTimes(1);
    h.workflows.completeStep = original;
  });

  it('binds expiry into the immutable replay contract and forbids TTL extension', async () => {
    const h = harness();
    await h.coordinator.dispatch(h.request());
    await expect(
      h.coordinator.dispatch(h.request({ expiresAt: '2026-10-14T20:30:00.000Z' })),
    ).rejects.toThrow('AG01_MISSION_IDEMPOTENCY_CONFLICT');
    await expect(
      h.coordinator.dispatch(
        h.request({
          expiresAt: new Date(Date.parse(T0) + SPECIALIST_MISSION_MAX_TTL_MS + 1000).toISOString(),
        }),
      ),
    ).rejects.toThrow('AG01_MISSION_TTL_EXCEEDS_MAXIMUM');
    expect(h.execute).not.toHaveBeenCalled();
  });

  it('does not reveal finished evidence when current read authorization has been revoked', async () => {
    const h = harness();
    const queued = await h.coordinator.dispatch(h.request());
    await h.coordinator.executeOwned(queued.mission_id, 'AG-06', identity());
    await expect(
      h.coordinator.status(queued.mission_id, identity({ capabilities: ['image.enhance'] })),
    ).rejects.toThrow('AG01_MISSION_AUTHORIZATION_DENIED');
    await expect(
      h.coordinator.executeOwned(
        queued.mission_id,
        'AG-06',
        identity({ capabilities: ['image.enhance'] }),
      ),
    ).rejects.toThrow('AG01_MISSION_AUTHORIZATION_DENIED');
    expect(h.execute).toHaveBeenCalledTimes(1);
  });

  it('rejects invented Core acknowledgements without recording DONE', async () => {
    const h = harness({ badAck: true });
    const queued = await h.coordinator.dispatch(h.request());
    await expect(
      h.coordinator.executeOwned(queued.mission_id, 'AG-06', identity()),
    ).rejects.toThrow('AG01_MISSION_CORE_ACK_INVALID');
    const failed = await h.coordinator.status(queued.mission_id, identity());
    expect(failed.status).toBe('FAILED');
    expect(failed.coreExecutionId).toBeNull();
    expect(h.execute).toHaveBeenCalledTimes(1);
  });

  it('enforces Core approval gate even on an upstream catalog READ definition', async () => {
    const h = harness({ approvalRequired: true });
    await expect(h.coordinator.dispatch(h.request())).rejects.toThrow(
      'AG01_MISSION_CORE_READONLY_BOUNDARY',
    );
    expect(h.execute).not.toHaveBeenCalled();
  });

  it('keeps AG-01-primary routes on the existing Core path when specialist opt-in is enabled', async () => {
    const coreExecute = vi.fn((input: Parameters<CoreCapabilityGateway['execute']>[0]) =>
      Promise.resolve({
        executionId: 'core-ag01-own-route',
        capabilityId: input.capabilityId,
        result: { ok: true },
        providerReadbackVerified: false,
      }),
    );
    const core = {
      inspect: (input: Parameters<CoreCapabilityGateway['inspect']>[0]) => ({
        canonicalCapabilityId: input.capabilityId,
        routeId: 'R19' as const,
        sideEffects: false,
        approvalRequired: false,
        idempotent: true,
      }),
      execute: coreExecute,
      requestApproval: vi.fn(),
      getApproval: vi.fn(),
    } as unknown as CoreCapabilityGateway;
    const specialistExecute = vi.fn();
    const specialist = {
      supports: vi.fn(() => true),
      executePlannedStep: specialistExecute,
    } as unknown as SpecialistCoordinator;
    const runtime = new TocaOrchestratorRuntime({
      conversations: new InMemoryConversationStore(),
      routeResolver: {
        resolve: () => Promise.resolve({ routeId: 'R19', confidence: 1, evidence: ['route:r19'] }),
      },
      artifacts: {
        resolveSop: () =>
          Promise.resolve({
            artifactId: 'SOP-R19',
            version: '1.0',
            sourceRef: 'toca-os:sop-r19',
            evidence: ['sop:r19'],
          }),
        resolveTemplate: () => Promise.resolve(null),
      },
      planner: {
        build: () =>
          Promise.resolve([
            {
              stepId: 'read-autopilot',
              name: 'Inspect automation',
              capabilityId: 'autopilot.state.inspect',
              payload: { id: 'test' },
              maxAttempts: 1,
            },
          ]),
      },
      core,
      specialistMissions: specialist,
      deadLetters: { put: vi.fn(() => Promise.resolve()) },
      now: () => new Date(T0),
    });
    const outcome = await runtime.handle({
      idempotencyKey: 'ag01-primary-not-specialist',
      message: 'Inspect existing state only',
      identity: identity({ routes: ['R19'], capabilities: ['autopilot.state.inspect'] }),
    });
    expect(outcome.status).toBe('SUCCEEDED');
    expect(coreExecute).toHaveBeenCalledTimes(1);
    expect(specialistExecute).not.toHaveBeenCalled();
  });
});

function runtimeHarness(
  h: ReturnType<typeof harness>,
  conversations = new InMemoryConversationStore(),
  enabled = true,
) {
  return {
    conversations,
    runtime: new TocaOrchestratorRuntime({
      conversations,
      routeResolver: {
        resolve: () =>
          Promise.resolve({ routeId: 'R03', confidence: 1, evidence: ['route:readback'] }),
      },
      artifacts: {
        resolveSop: () =>
          Promise.resolve({
            artifactId: 'SOP-R03',
            version: '1.0',
            sourceRef: 'toca-os:sop-r03',
            evidence: ['sop:readback'],
          }),
        resolveTemplate: () => Promise.resolve(null),
      },
      planner: {
        build: () =>
          Promise.resolve([
            {
              stepId: 'scan',
              name: 'Scan assets',
              capabilityId: 'media.scan',
              payload: { folderId: 'test-only' },
              maxAttempts: 1,
            },
          ]),
      },
      core: h.core,
      specialistMissions: h.coordinator,
      specialistMissionsEnabled: enabled,
      deadLetters: { put: vi.fn(() => Promise.resolve()) },
      now: () => new Date(T0),
      budget: {
        maxToolCallsPerResume: 1,
        toolTimeoutMs: 5,
        maxTotalAttempts: 1,
        circuitFailureThreshold: 1,
      },
    }),
  };
}

describe('durable specialist recovery regressions', () => {
  it('reconciles timeout across flag-OFF restarts without consuming attempts or calling Core twice', async () => {
    let proceed!: () => void;
    const h = harness({
      wait: new Promise<void>((resolve) => {
        proceed = resolve;
      }),
    });
    const firstRuntime = runtimeHarness(h);
    const first = await firstRuntime.runtime.handle({
      idempotencyKey: 'timeout-recovery',
      message: 'Inspect assets',
      identity: identity(),
    });
    expect(first.status).toBe('RUNNING');
    const restarted = runtimeHarness(h, firstRuntime.conversations, false);
    for (let n = 0; n < 3; n++) {
      const pending = await restarted.runtime.resume(first.conversationId, identity());
      expect(pending.status).toBe('RUNNING');
    }
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(await firstRuntime.conversations.getCircuit('toca', 'media.scan')).toBeUndefined();
    const pending = await firstRuntime.conversations.getConversation('toca', first.conversationId);
    expect(pending?.checkpoint?.totalToolCalls).toBe(1);
    expect(pending?.checkpoint?.currentAttempt).toBe(1);
    proceed();
    for (let n = 0; n < 50; n++) await Promise.resolve();
    const done = await restarted.runtime.resume(first.conversationId, identity());
    expect(done.status).toBe('SUCCEEDED');
    expect(h.execute).toHaveBeenCalledTimes(1);
  });

  it.each(['legacy', 'invalid', 'missing-anchor'] as const)(
    'fails closed or reconciles the existing claim for %s checkpoint metadata',
    async (mode) => {
      let proceed!: () => void;
      const h = harness({
        wait: new Promise<void>((resolve) => {
          proceed = resolve;
        }),
      });
      const initial = runtimeHarness(h);
      const first = await initial.runtime.handle({
        idempotencyKey: `metadata-${mode}`,
        message: 'Inspect assets',
        identity: identity(),
      });
      const record = await initial.conversations.getConversation('toca', first.conversationId);
      if (!record?.checkpoint) throw new Error('TEST_CHECKPOINT_MISSING');
      const checkpoint = { ...record.checkpoint };
      delete checkpoint.executionPath;
      if (mode === 'invalid') Object.assign(checkpoint, { executionPath: 'UNTRUSTED_PATH' });
      if (mode === 'missing-anchor') delete checkpoint.missionCreatedAt;
      await initial.conversations.updateConversation({
        ...record,
        expectedVersion: record.version,
        checkpoint,
        now: T0,
      });
      const restarted = runtimeHarness(h, initial.conversations, false);
      const response = await restarted.runtime.resume(first.conversationId, identity());
      expect(response.status).toBe(mode === 'legacy' ? 'RUNNING' : 'HUMAN_REQUIRED');
      expect(h.execute).toHaveBeenCalledTimes(1);
      proceed();
      for (let n = 0; n < 50; n++) await Promise.resolve();
      if (mode === 'legacy')
        expect((await restarted.runtime.resume(first.conversationId, identity())).status).toBe(
          'SUCCEEDED',
        );
    },
  );

  it('keeps new work direct-Core while the existing opt-in flag is OFF', async () => {
    const h = harness();
    const dispatch = vi.spyOn(h.coordinator, 'dispatch');
    const { runtime } = runtimeHarness(h, undefined, false);
    expect(
      (
        await runtime.handle({
          idempotencyKey: 'flag-off-new',
          message: 'Inspect assets',
          identity: identity(),
        })
      ).status,
    ).toBe('SUCCEEDED');
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('recovers DONE after TTL without extending expiry, but still rejects changed payload or revoked access', async () => {
    const h = harness();
    const expected = await h.coordinator.executePlannedStep(h.request());
    h.setNow(T2);
    await expect(h.coordinator.executePlannedStep(h.request())).resolves.toEqual(expected);
    await expect(
      h.coordinator.executePlannedStep(h.request({ payload: { folderId: 'changed' } })),
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
    await expect(
      h.coordinator.executePlannedStep(h.request({ identity: identity({ capabilities: [] }) })),
    ).rejects.toThrow('AUTHORIZATION_DENIED');
    expect(h.execute).toHaveBeenCalledTimes(1);
  });

  it('never claims an expired READY mission even when replay finds its immutable record', async () => {
    const h = harness();
    await h.coordinator.dispatch(h.request());
    h.setNow(T2);
    await expect(h.coordinator.executePlannedStep(h.request())).rejects.toThrow('TTL_EXPIRED');
    expect(h.execute).not.toHaveBeenCalled();
  });

  it('revalidates current route inspection before READY execution and DONE disclosure', async () => {
    const h = harness();
    const mission = await h.coordinator.dispatch(h.request());
    const originalInspection = h.core.inspect({
      capabilityId: 'media.scan',
      payload: {},
      identity: identity(),
    });
    const spy = vi
      .spyOn(h.core, 'inspect')
      .mockImplementation(() => ({ ...originalInspection, routeId: 'R08' }));
    await expect(
      h.coordinator.executeOwned(mission.mission_id, 'AG-06', identity()),
    ).rejects.toThrow('CORE_ROUTE_MISMATCH');
    expect(h.execute).not.toHaveBeenCalled();
    spy.mockReturnValue(originalInspection);
    await h.coordinator.executeOwned(mission.mission_id, 'AG-06', identity());
    vi.spyOn(h.core, 'inspect').mockImplementation(() => ({
      ...originalInspection,
      routeId: 'R08',
    }));
    await expect(h.coordinator.status(mission.mission_id, identity())).rejects.toThrow(
      'CORE_ROUTE_MISMATCH',
    );
  });

  it('revalidates current catalog owner and capability membership before claim', async () => {
    const h = harness();
    const mission = await h.coordinator.dispatch(h.request());
    const route = routes.getRouteDefinition('R03');
    const spy = vi
      .spyOn(routes, 'getRouteDefinition')
      .mockReturnValue({ ...route, primaryAgent: 'AG-04', auxiliaryAgents: [] });
    await expect(
      h.coordinator.executeOwned(mission.mission_id, 'AG-06', identity()),
    ).rejects.toThrow('OWNER_OUTSIDE_ROUTE');
    spy.mockReturnValue({ ...route, capabilityIds: [] });
    await expect(
      h.coordinator.executeOwned(mission.mission_id, 'AG-06', identity()),
    ).rejects.toThrow('CAPABILITY_ROUTE_MISMATCH');
    spy.mockRestore();
    expect(h.execute).not.toHaveBeenCalled();
  });

  it('does not promote the real Core READ-default flag into provider proof', async () => {
    const execute = vi.fn(() => Promise.resolve({ rows: [] }));
    const schema = z.object({ accountId: z.string() });
    const core = new ExistingCoreCapabilityGateway({
      registry: createToolRegistry({ metaAdsReadsEnabled: true }),
      runtimeResolver: (capability) =>
        capability === 'meta_ads.campaigns.list'
          ? {
              inputSchema: schema,
              execute,
              targetAccount: (input) => schema.parse(input).accountId,
            }
          : undefined,
      auditSink: new InMemoryAuditSink(),
    });
    const caller = createTrustedServiceExecutionIdentity({
      principalId: 'reader',
      tenantId: 'toca',
      workspaceId: 'workspace',
      organizationId: 'organization',
      roles: ['READER'],
      allowedRouteIds: ['R08'],
      allowedCapabilityIds: ['meta_ads.campaigns.list'],
      allowedTargetAccounts: ['source-account'],
      evidence: ['test:trusted'],
      now: T0,
    });
    const coordinator = new Ag01SpecialistMissionCoordinator(
      new InMemoryWorkflowStore(),
      core,
      () => new Date(T0),
    );
    const request = {
      routeId: 'R08' as const,
      capabilityId: 'meta_ads.campaigns.list',
      payload: { accountId: 'source-account' },
      owner: 'AG-09',
      priority: 'P1' as const,
      correlationId: 'real-core-read',
      idempotencyKey: 'real-core-read',
      expiresAt: T1,
      identity: caller,
    };
    const result = await coordinator.executePlannedStep(request);
    const mission = await coordinator.dispatch(request);
    expect(result.providerReadbackVerified).toBe(false);
    expect(mission.providerReadbackVerified).toBe(false);
    expect(mission.evidence).not.toContain('ag01:provider-readback-verified');
    const revoked = {
      ...caller,
      authorization: { ...caller.authorization, allowedTargetAccounts: [] },
    };
    await expect(coordinator.status(mission.mission_id, revoked)).rejects.toThrow();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
