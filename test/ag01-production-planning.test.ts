import { describe, expect, it } from 'vitest';
import { createTrustedServiceExecutionIdentity } from '../src/core/identity.js';
import { resolveCapabilityDefinition } from '../src/governance/capability-resolution.js';
import type { ApprovalRecord } from '../src/governance/approval-governance.js';
import { getRouteDefinition } from '../src/governance/route-catalog.js';
import type { DeadLetterSink } from '../src/worker/worker.js';
import type {
  CanonicalArtifactResolver,
  CoreCapabilityGateway,
  IntentRouteResolver,
  PlanBuilder,
} from '../src/orchestrator/contracts.js';
import { InMemoryConversationStore } from '../src/orchestrator/in-memory-conversation-store.js';
import type { Ag01DecisionModelAdapter } from '../src/orchestrator/openai-responses-adapter.js';
import {
  Ag01DecisionContext,
  ModelBackedIntentRouteResolver,
  StructuredDecisionPlanBuilder,
} from '../src/orchestrator/production-planning.js';
import { TocaOrchestratorRuntime } from '../src/orchestrator/runtime.js';
import {
  TocaOsCanonicalArtifactResolver,
  type TocaOsRegistryClient,
  type TocaOsRegistrySnapshot,
} from '../src/orchestrator/toca-os-registry.js';

const route = getRouteDefinition('R17');
const readCapabilityId = route.capabilityIds.find((capabilityId) => {
  const definition = resolveCapabilityDefinition(capabilityId)?.canonical_definition;
  return definition?.risk_class === 'READ' && definition.side_effects === false;
});
if (!readCapabilityId) throw new Error('TEST_R17_READ_CAPABILITY_REQUIRED');
const readDefinition = resolveCapabilityDefinition(readCapabilityId)!.canonical_definition;

const identityA = createTrustedServiceExecutionIdentity({
  principalId: 'ag01-test-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  organizationId: 'org-a',
  roles: ['READER', 'OPERATOR', 'EXTERNAL_WRITER'],
  allowedRouteIds: ['R17'],
  allowedCapabilityIds: [readCapabilityId],
  allowedTargetAccounts: ['account-a'],
  evidence: ['test:ag01:a'],
  now: '2026-08-20T20:00:00.000Z',
});

const identityB = createTrustedServiceExecutionIdentity({
  principalId: 'ag01-test-b',
  tenantId: 'tenant-b',
  workspaceId: 'workspace-b',
  organizationId: 'org-b',
  roles: ['READER'],
  evidence: ['test:ag01:b'],
  now: '2026-08-20T20:00:00.000Z',
});

function snapshot(): TocaOsRegistrySnapshot {
  return {
    routes: new Map([
      [
        'R17',
        {
          routeId: 'R17',
          demandType: 'Technology request',
          triggers: ['technology'],
          primaryAgent: route.primaryAgent,
          auxiliaryAgents: route.auxiliaryAgents,
          mandatorySources: ['TOCA_OS'],
          qualityGate: ['canonical'],
          approvalRequired: 'POLICY',
          mcpRole: 'EXECUTE_IF_BOUND',
          outputStates: ['READY'],
        },
      ],
    ]),
    resources: new Map([
      [
        'SOP-DOC-INDEX',
        {
          resourceId: 'SOP-DOC-INDEX',
          driveId: 'sop-index-drive-id',
          title: 'SOP INDEX v1.0',
          type: 'DOC',
          module: '14_SOPS',
          logicalPath: 'TOCA_OS/14_SOPS/SOP_INDEX',
          status: 'ACTIVE_CANONICAL',
          purpose: 'Canonical SOP index',
          lastValidatedAt: '2026-08-20',
          governanceStatus: 'CANONICAL',
        },
      ],
    ]),
    fetchedAt: '2026-08-20T20:00:00.000Z',
    evidence: ['test:toca-os'],
  };
}

class StaticRegistry implements TocaOsRegistryClient {
  constructor(private readonly value: TocaOsRegistrySnapshot = snapshot()) {}
  snapshot(): Promise<TocaOsRegistrySnapshot> {
    return Promise.resolve(this.value);
  }
}

class StaticModel implements Ag01DecisionModelAdapter {
  constructor(private readonly artifactId = 'SOP-DOC-INDEX') {}
  readiness(): Promise<void> {
    return Promise.resolve();
  }
  decide() {
    return Promise.resolve({
      responseId: 'resp-e2e',
      model: 'test-model',
      evidence: ['test:model'],
      decision: {
        routeId: 'R17' as const,
        agent: route.primaryAgent,
        intent: 'inspect technology state',
        inputs: { summary: 'safe inspection', payloadJson: '{}' },
        requiredArtifacts: [this.artifactId],
        proposedCapability: readCapabilityId,
        risk: readDefinition.risk_class,
        approvalRequirement: 'NONE' as const,
        expectedReadback: [],
        confidence: 0.99,
        steps: [
          {
            stepId: 'inspect',
            name: 'Inspect through Core',
            capabilityId: readCapabilityId,
            payloadJson: '{}',
            maxAttempts: 1,
          },
        ],
        humanEscalationReason: null,
      },
    });
  }
}

class NoopDeadLetters implements DeadLetterSink {
  put(): Promise<void> {
    return Promise.resolve();
  }
}

class ReadOnlyCore implements CoreCapabilityGateway {
  calls = 0;
  inspect(input: Parameters<CoreCapabilityGateway['inspect']>[0]) {
    return {
      canonicalCapabilityId: input.capabilityId,
      routeId: 'R17' as const,
      sideEffects: false,
      approvalRequired: false,
      idempotent: true,
    };
  }
  execute(input: Parameters<CoreCapabilityGateway['execute']>[0]) {
    this.calls += 1;
    return Promise.resolve({
      executionId: `exec-${this.calls}`,
      capabilityId: input.capabilityId,
      result: { ok: true },
      providerReadbackVerified: true,
    });
  }
  requestApproval(): Promise<ApprovalRecord> {
    return Promise.reject(new Error('UNEXPECTED_APPROVAL'));
  }
  getApproval(): Promise<ApprovalRecord | undefined> {
    return Promise.resolve(undefined);
  }
}

function governedRuntime(model: Ag01DecisionModelAdapter = new StaticModel()) {
  const conversations = new InMemoryConversationStore();
  const registry = new StaticRegistry();
  const context = new Ag01DecisionContext();
  const core = new ReadOnlyCore();
  const routeResolver = new ModelBackedIntentRouteResolver(model, registry, context, () => [
    readCapabilityId,
  ]);
  const artifacts = new TocaOsCanonicalArtifactResolver(registry, context);
  const planner = new StructuredDecisionPlanBuilder(context, () => [readCapabilityId]);
  const runtime = new TocaOrchestratorRuntime({
    conversations,
    routeResolver,
    artifacts,
    planner,
    core,
    deadLetters: new NoopDeadLetters(),
  });
  return { runtime, context, core, conversations };
}

describe('AG-01 production planning composition', () => {
  it('runs a complete structured E2E against mocked Core', async () => {
    const { runtime, context, core } = governedRuntime();
    const result = await context.run(() =>
      runtime.handle({
        idempotencyKey: 'e2e-1',
        message: 'Inspect this technology request.',
        identity: identityA,
        routeHint: 'R17',
      }),
    );
    expect(result.status).toBe('SUCCEEDED');
    expect(result.routeId).toBe('R17');
    expect(result.primaryAgent).toBe(route.primaryAgent);
    expect(result.outputs).toEqual([{ ok: true }]);
    expect(core.calls).toBe(1);
    expect(context.result()).toBeUndefined();
  });

  it('fails closed when a required canonical artifact is missing', async () => {
    const { runtime, context, core } = governedRuntime(new StaticModel('SOP-MISSING'));
    await expect(
      context.run(() =>
        runtime.handle({
          idempotencyKey: 'missing-artifact',
          message: 'Inspect safely.',
          identity: identityA,
          routeHint: 'R17',
        }),
      ),
    ).rejects.toThrow('AG01_REQUIRED_ARTIFACT_UNKNOWN:SOP-MISSING');
    expect(core.calls).toBe(0);
  });

  it('prevents cross-tenant conversation resume', async () => {
    const { runtime, context, core } = governedRuntime();
    const first = await context.run(() =>
      runtime.handle({
        conversationId: 'conversation-private-a',
        idempotencyKey: 'tenant-a-1',
        message: 'Inspect safely.',
        identity: identityA,
        routeHint: 'R17',
      }),
    );
    expect(first.status).toBe('SUCCEEDED');
    await expect(runtime.resume('conversation-private-a', identityB)).rejects.toThrow(
      'AG01_CONVERSATION_NOT_FOUND',
    );
    expect(core.calls).toBe(1);
  });
});

describe('AG-01 approval denial handling', () => {
  it('escalates a revoked approval and never executes the side effect', async () => {
    const conversations = new InMemoryConversationStore();
    const approval = approvalRecord('REQUESTED');
    let status: ApprovalRecord['status'] = 'REQUESTED';
    let executeCalls = 0;
    const core: CoreCapabilityGateway = {
      inspect: ({ capabilityId }) => ({
        canonicalCapabilityId: capabilityId,
        routeId: 'R17',
        sideEffects: true,
        approvalRequired: true,
        idempotent: true,
      }),
      execute: ({ capabilityId }) => {
        executeCalls += 1;
        return Promise.resolve({
          executionId: 'should-not-run',
          capabilityId,
          result: {},
          providerReadbackVerified: true,
        });
      },
      requestApproval: () => Promise.resolve(approval),
      getApproval: () => Promise.resolve({ ...approval, status }),
    };
    const routeResolver: IntentRouteResolver = {
      resolve: () => Promise.resolve({ routeId: 'R17', confidence: 1, evidence: ['test:route'] }),
    };
    const artifacts: CanonicalArtifactResolver = {
      resolveSop: () =>
        Promise.resolve({
          artifactId: 'SOP-DOC-INDEX',
          version: '1.0',
          sourceRef: 'drive:sop',
          evidence: ['test:sop'],
        }),
      resolveTemplate: () => Promise.resolve(null),
    };
    const planner: PlanBuilder = {
      build: () =>
        Promise.resolve([
          {
            stepId: 'side-effect',
            name: 'Governed side effect',
            capabilityId: 'test.side.effect',
            payload: { idempotencyKey: 'side-effect-1' },
            maxAttempts: 1,
          },
        ]),
    };
    const runtime = new TocaOrchestratorRuntime({
      conversations,
      routeResolver,
      artifacts,
      planner,
      core,
      deadLetters: new NoopDeadLetters(),
    });

    const waiting = await runtime.handle({
      conversationId: 'approval-conversation',
      idempotencyKey: 'approval-1',
      message: 'Do the governed action.',
      identity: identityA,
      routeHint: 'R17',
    });
    expect(waiting.status).toBe('WAITING_APPROVAL');
    expect(executeCalls).toBe(0);

    status = 'REVOKED';
    const denied = await runtime.resume('approval-conversation', identityA);
    expect(denied.status).toBe('HUMAN_REQUIRED');
    expect(denied.humanReason).toContain('APPROVAL_UNUSABLE:REVOKED');
    expect(executeCalls).toBe(0);
  });
});

function approvalRecord(status: ApprovalRecord['status']): ApprovalRecord {
  return {
    approvalId: 'approval-test-1',
    requester: identityA.principal.principalId,
    approver: null,
    routeId: 'R17',
    capabilityId: 'test.side.effect',
    descriptorSha256: 'a'.repeat(64),
    targetAccount: 'account-a',
    scope: ['test.side.effect'],
    financialCeiling: null,
    requestedAt: '2026-08-20T20:00:00.000Z',
    issuedAt: null,
    expiresAt: '2026-08-21T20:00:00.000Z',
    consumedAt: null,
    revokedAt: status === 'REVOKED' ? '2026-08-20T20:05:00.000Z' : null,
    reservationExecutionId: null,
    reservationPrincipalId: null,
    reservationCorrelationId: null,
    reservedAt: null,
    executingAt: null,
    providerReadbackAt: null,
    providerReadbackEvidence: [],
    releasedAt: null,
    releaseReason: null,
    failedReviewAt: null,
    failureReason: null,
    status,
    evidence: ['test:approval'],
    correlationId: 'approval-correlation',
    version: 1,
  };
}
