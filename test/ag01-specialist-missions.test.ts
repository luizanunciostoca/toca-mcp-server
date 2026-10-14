import { describe, expect, it, vi } from 'vitest';
import { createTrustedServiceExecutionIdentity } from '../src/core/identity.js';
import {
  Ag01SpecialistMissionCoordinator,
  SPECIALIST_MISSION_MAX_TTL_MS,
  type SpecialistMissionInput,
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
  input: { tenantId?: string; routes?: ('R03' | 'R04')[]; capabilities?: string[] } = {},
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

  it('keeps the opt-in planned mission expiry immutable after a failed execution and later resume', async () => {
    let clock = T0;
    const h = harness();
    const dispatch = vi
      .fn(async (_input: SpecialistMissionInput): Promise<ExecutionResult> => {
        throw new Error('UNEXPECTED_SPECIALIST_DISPATCH');
      })
      .mockRejectedValueOnce(new Error('TRANSIENT_READ_FAILURE'))
      .mockResolvedValueOnce({
        executionId: 'core-returned-on-retry',
        capabilityId: 'media.scan',
        result: { ok: true },
        providerReadbackVerified: false,
      });
    const specialistMissions = {
      supports: vi.fn(() => true),
      executePlannedStep: dispatch,
    } as unknown as SpecialistCoordinator;
    const runtime = new TocaOrchestratorRuntime({
      conversations: new InMemoryConversationStore(),
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
              maxAttempts: 2,
            },
          ]),
      },
      core: h.core,
      specialistMissions,
      deadLetters: { put: vi.fn(() => Promise.resolve()) },
      now: () => new Date(clock),
      budget: {
        maxToolCallsPerResume: 1,
        toolTimeoutMs: 200,
        circuitFailureThreshold: 100,
      },
    });
    const first = await runtime.handle({
      idempotencyKey: 'stable-runtime-ttl',
      message: 'Classify this asset',
      identity: identity(),
    });
    expect(first.status).toBe('READY');
    expect(dispatch).toHaveBeenCalledTimes(1);
    clock = '2026-10-14T20:05:00.000Z';
    const recovered = await runtime.resume(first.conversationId, identity());
    expect(recovered.status).toBe('SUCCEEDED');
    expect(dispatch).toHaveBeenCalledTimes(2);
    const initial = dispatch.mock.calls[0]?.[0] as { expiresAt: string } | undefined;
    const resumed = dispatch.mock.calls[1]?.[0] as { expiresAt: string } | undefined;
    expect(initial?.expiresAt).toBe(resumed?.expiresAt);
    expect(initial?.expiresAt).toBe(
      new Date(Date.parse(T0) + SPECIALIST_MISSION_MAX_TTL_MS).toISOString(),
    );
    expect(h.execute).not.toHaveBeenCalled();
  });
});
