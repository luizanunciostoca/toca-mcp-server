import { describe, expect, it } from 'vitest';
import { createTrustedServiceExecutionIdentity } from '../src/core/identity.js';
import { getRouteDefinition } from '../src/governance/route-catalog.js';
import { ROUTE_IDS } from '../src/governance/types.js';
import { loadAg01ProductionConfig } from '../src/orchestrator/production-config.js';
import type { TocaOsRegistrySnapshot } from '../src/orchestrator/toca-os-registry.js';
import {
  VertexGeminiDecisionAdapter,
  type VertexAccessTokenProvider,
} from '../src/orchestrator/vertex-gemini-decision-adapter.js';

const identity = createTrustedServiceExecutionIdentity({
  principalId: 'ag01-vertex-test',
  tenantId: 'toca',
  workspaceId: 'toca',
  organizationId: 'toca',
  roles: ['READER'],
  evidence: ['test:ag01:vertex'],
  now: '2026-09-15T18:00:00.000Z',
});

class StaticToken implements VertexAccessTokenProvider {
  getAccessToken(): Promise<string> {
    return Promise.resolve('gcp-access-token');
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
          lastValidatedAt: '2026-09-15',
          governanceStatus: 'CANONICAL',
        },
      ],
    ]),
    fetchedAt: '2026-09-15T18:00:00.000Z',
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

function vertexResponse(status = 200): Response {
  return new Response(
    status === 200
      ? JSON.stringify({
          responseId: 'vertex-response-1',
          modelVersion: 'gemini-2.5-flash',
          candidates: [{ content: { parts: [{ text: decisionJson() }] } }],
        })
      : '{}',
    { status, headers: { 'content-type': 'application/json' } },
  );
}

describe('AG-01 production-verified Vertex binding', () => {
  it('loads Vertex plus GCP metadata auth without long-lived OpenAI or Google OAuth secrets', () => {
    const config = loadAg01ProductionConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://test:test@localhost:5432/toca',
      AG01_MODEL_PROVIDER: 'vertex',
      AG01_VERTEX_PROJECT_ID: 'toca-mcp-production',
      AG01_VERTEX_MODEL: 'gemini-2.5-flash',
      AG01_GOOGLE_AUTH_MODE: 'gcp_metadata',
      AG01_TOCA_OS_ROUTING_SPREADSHEET_ID: 'routing-sheet',
      AG01_TOCA_OS_CANONICAL_RESOURCES_SPREADSHEET_ID: 'resources-sheet',
    });

    expect(config.modelProvider).toBe('vertex');
    expect(config.vertexModel).toBe('gemini-2.5-flash');
    expect(config.googleAuthMode).toBe('gcp_metadata');
    expect(config.googleOAuthClientIdEnvKey).toBe('__ag01_gcp_metadata__');
    expect(config.openAiApiKeyEnvKey).toBe('');
  });

  it('uses Vertex structured output while preserving a planning-only R17 decision', async () => {
    let requestedUrl = '';
    let requestBody: unknown;
    const adapter = new VertexGeminiDecisionAdapter({
      projectId: 'toca-mcp-production',
      location: 'global',
      model: 'gemini-2.5-flash',
      timeoutMs: 100,
      maxRetries: 0,
      maxOutputTokens: 1024,
      accessTokenProvider: new StaticToken(),
      fetchFn: (url, init) => {
        requestedUrl = String(url);
        requestBody = JSON.parse(String(init?.body ?? '{}')) as unknown;
        return Promise.resolve(vertexResponse());
      },
    });

    const result = await adapter.decide({
      message: 'Inspect the current state safely.',
      contextSummary: '',
      identity,
      registry: registry(),
      runtimeCapabilityIds: [],
    });

    expect(requestedUrl).toContain('/publishers/google/models/gemini-2.5-flash:generateContent');
    expect(requestBody).toMatchObject({
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
      },
    });
    expect(result.responseId).toBe('vertex-response-1');
    expect(result.model).toBe('gemini-2.5-flash');
    expect(result.decision.routeId).toBe('R17');
    expect(result.decision.steps).toEqual([]);
  });

  it('retries only a transient provider failure inside the bounded retry budget', async () => {
    let calls = 0;
    const adapter = new VertexGeminiDecisionAdapter({
      projectId: 'toca-mcp-production',
      location: 'global',
      model: 'gemini-2.5-flash',
      timeoutMs: 100,
      maxRetries: 1,
      maxOutputTokens: 1024,
      accessTokenProvider: new StaticToken(),
      fetchFn: () => {
        calls += 1;
        return Promise.resolve(calls === 1 ? vertexResponse(503) : vertexResponse());
      },
      sleep: () => Promise.resolve(),
    });

    const result = await adapter.decide({
      message: 'Inspect the current state safely.',
      contextSummary: '',
      identity,
      registry: registry(),
      runtimeCapabilityIds: [],
    });

    expect(calls).toBe(2);
    expect(result.decision.routeId).toBe('R17');
  });
});
