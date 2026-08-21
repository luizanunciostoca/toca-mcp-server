import { describe, expect, it } from 'vitest';
import { createTrustedServiceExecutionIdentity } from '../src/core/identity.js';
import type { SecretResolver } from '../src/core/secrets.js';
import { getRouteDefinition } from '../src/governance/route-catalog.js';
import { ROUTE_IDS } from '../src/governance/types.js';
import { OpenAiResponsesDecisionAdapter } from '../src/orchestrator/openai-responses-adapter.js';
import { parseAg01StructuredDecision } from '../src/orchestrator/structured-decision.js';
import type { TocaOsRegistrySnapshot } from '../src/orchestrator/toca-os-registry.js';

const identity = createTrustedServiceExecutionIdentity({
  principalId: 'ag01-model-test',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  organizationId: 'org-a',
  roles: ['READER'],
  evidence: ['test:ag01:model'],
  now: '2026-08-20T20:00:00.000Z',
});

class StaticSecrets implements SecretResolver {
  resolve(): Promise<string> {
    return Promise.resolve('test-secret');
  }
}

function registry(): TocaOsRegistrySnapshot {
  return {
    routes: new Map(
      ROUTE_IDS.map((routeId) => {
        const route = getRouteDefinition(routeId);
        return [
          routeId,
          {
            routeId,
            demandType: `Demand ${routeId}`,
            triggers: [routeId.toLowerCase()],
            primaryAgent: route.primaryAgent,
            auxiliaryAgents: route.auxiliaryAgents,
            mandatorySources: ['TOCA_OS'],
            qualityGate: ['canonical'],
            approvalRequired: 'POLICY',
            mcpRole: 'EXECUTE_IF_RUNTIME_BOUND',
            outputStates: ['READY'],
          },
        ] as const;
      }),
    ),
    resources: new Map([
      [
        'SOP-DOC-INDEX',
        {
          resourceId: 'SOP-DOC-INDEX',
          driveId: 'drive-sop-index',
          title: 'SOP INDEX v1.0',
          type: 'DOC',
          module: '14_SOPS',
          logicalPath: 'TOCA_OS/14_SOPS/SOP_INDEX',
          status: 'ACTIVE_CANONICAL',
          purpose: 'Test SOP',
          lastValidatedAt: '2026-08-20',
          governanceStatus: 'CANONICAL',
        },
      ],
    ]),
    fetchedAt: '2026-08-20T20:00:00.000Z',
    evidence: ['test:toca-os:registry'],
  };
}

function decisionJson(): string {
  const route = getRouteDefinition('R17');
  return JSON.stringify({
    routeId: 'R17',
    agent: route.primaryAgent,
    intent: 'inspect safely',
    inputs: { summary: 'inspection request', payloadJson: '{}' },
    requiredArtifacts: ['SOP-DOC-INDEX'],
    proposedCapability: null,
    risk: 'READ',
    approvalRequirement: 'NONE',
    expectedReadback: [],
    confidence: 0.98,
    steps: [],
    humanEscalationReason: null,
  });
}

function completedResponse(outputText = decisionJson()): Response {
  return new Response(
    JSON.stringify({
      id: 'resp_test_1',
      status: 'completed',
      model: 'configured-test-model',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: outputText }],
        },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function input() {
  return {
    message: 'Inspect the current state safely.',
    contextSummary: '',
    identity,
    registry: registry(),
    runtimeCapabilityIds: [] as readonly string[],
  };
}

function adapter(
  fetchFn: typeof fetch,
  overrides: { timeoutMs?: number; maxRetries?: number } = {},
) {
  return new OpenAiResponsesDecisionAdapter({
    baseUrl: 'https://api.openai.test/v1',
    model: 'configured-test-model',
    apiKeyReference: { provider: 'env', key: 'OPENAI_TEST_KEY' },
    secrets: new StaticSecrets(),
    timeoutMs: overrides.timeoutMs ?? 100,
    maxRetries: overrides.maxRetries ?? 0,
    maxOutputTokens: 1024,
    fetchFn,
    sleep: () => Promise.resolve(),
  });
}

describe('AG-01 OpenAI Responses adapter', () => {
  it('uses Responses API with strict JSON Schema structured output', async () => {
    let requestBody: unknown;
    const fetchFn: typeof fetch = (url, init) => {
      void url;
      if (typeof init?.body !== 'string') throw new Error('TEST_EXPECTED_STRING_BODY');
      requestBody = JSON.parse(init.body) as unknown;
      return Promise.resolve(completedResponse());
    };
    const result = await adapter(fetchFn).decide(input());
    expect(result.decision.routeId).toBe('R17');
    expect(result.responseId).toBe('resp_test_1');
    expect(requestBody).toMatchObject({
      model: 'configured-test-model',
      store: false,
      text: { format: { type: 'json_schema', strict: true } },
    });
  });

  it('fails closed on malformed structured output', async () => {
    const fetchFn: typeof fetch = () => Promise.resolve(completedResponse('{not-json'));
    await expect(adapter(fetchFn).decide(input())).rejects.toThrow(
      'AG01_MODEL_STRUCTURED_OUTPUT_INVALID_JSON',
    );
  });

  it('times out a model request without executing any capability', async () => {
    const fetchFn: typeof fetch = (url, init) => {
      void url;
      return new Promise<Response>((resolve, reject) => {
        void resolve;
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    };
    await expect(adapter(fetchFn, { timeoutMs: 1 }).decide(input())).rejects.toThrow(
      'AG01_MODEL_TIMEOUT',
    );
  });

  it('retries a transient provider failure and succeeds within the configured budget', async () => {
    let calls = 0;
    const fetchFn: typeof fetch = () => {
      calls += 1;
      return Promise.resolve(
        calls === 1 ? new Response('{}', { status: 503 }) : completedResponse(),
      );
    };
    const result = await adapter(fetchFn, { maxRetries: 1 }).decide(input());
    expect(result.decision.routeId).toBe('R17');
    expect(calls).toBe(2);
  });

  it('rejects an invalid route before it can enter orchestration', () => {
    expect(() =>
      parseAg01StructuredDecision({
        ...JSON.parse(decisionJson()),
        routeId: 'R99',
      }),
    ).toThrow('AG01_MODEL_ROUTE_INVALID:R99');
  });
});
