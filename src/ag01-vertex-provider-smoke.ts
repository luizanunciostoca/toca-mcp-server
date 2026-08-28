import { writeFile } from 'node:fs/promises';
import { createTrustedServiceExecutionIdentity } from './core/identity.js';
import { getRouteDefinition } from './governance/route-catalog.js';
import { VertexGeminiDecisionAdapter } from './orchestrator/vertex-gemini-decision-adapter.js';
import type { TocaOsRegistrySnapshot } from './orchestrator/toca-os-registry.js';

const projectId =
  process.env.AG01_VERTEX_PROJECT_ID?.trim() || process.env.GOOGLE_CLOUD_PROJECT?.trim();
const location = process.env.AG01_VERTEX_LOCATION?.trim() || 'global';
const model = process.env.AG01_VERTEX_MODEL?.trim() || 'gemini-2.5-flash';
const evidencePath = process.env.P2_2_EVIDENCE_PATH?.trim() || '/tmp/p2-2-ag01-vertex.json';
const injectedToken = process.env.GCP_ACCESS_TOKEN?.trim();

if (!projectId) throw new Error('AG01_VERTEX_PROJECT_ID_REQUIRED');

const route = getRouteDefinition('R17');
const identity = createTrustedServiceExecutionIdentity({
  principalId: 'p2-2-provider-smoke',
  tenantId: 'toca',
  workspaceId: 'toca',
  organizationId: 'toca',
  roles: ['READER'],
  allowedRouteIds: ['R17'],
  allowedCapabilityIds: [],
  allowedTargetAccounts: [],
  evidence: ['p2.2:provider-smoke', 'no-core-execution'],
});

const registry: TocaOsRegistrySnapshot = {
  routes: new Map([
    [
      'R17',
      {
        routeId: 'R17',
        demandType: 'Technology request',
        triggers: ['technology', 'system'],
        primaryAgent: route.primaryAgent,
        auxiliaryAgents: route.auxiliaryAgents,
        mandatorySources: ['TOCA_OS'],
        qualityGate: ['canonical', 'policy'],
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
        driveId: 'provider-smoke-no-drive-read',
        title: 'SOP INDEX',
        type: 'DOC',
        module: '14_SOPS',
        logicalPath: 'TOCA_OS/14_SOPS/SOP_INDEX',
        status: 'ACTIVE_CANONICAL',
        purpose: 'Canonical SOP index',
        lastValidatedAt: new Date().toISOString(),
        governanceStatus: 'CANONICAL',
      },
    ],
  ]),
  fetchedAt: new Date().toISOString(),
  evidence: ['p2.2:static-governance-smoke'],
};

const adapter = new VertexGeminiDecisionAdapter({
  projectId,
  location,
  model,
  timeoutMs: 30_000,
  maxRetries: 1,
  maxOutputTokens: 2048,
  ...(injectedToken
    ? { accessTokenProvider: { getAccessToken: () => Promise.resolve(injectedToken) } }
    : {}),
});

await adapter.readiness();
const result = await adapter.decide({
  message: 'Classify this provider-readiness smoke. Do not propose or execute any capability.',
  contextSummary: 'P2.2 provider-backed readiness verification only.',
  identity,
  routeHint: 'R17',
  registry,
  runtimeCapabilityIds: [],
});

if (result.decision.routeId !== 'R17') throw new Error('P2_2_VERTEX_ROUTE_READBACK_MISMATCH');
if (result.decision.agent !== route.primaryAgent)
  throw new Error('P2_2_VERTEX_AGENT_READBACK_MISMATCH');
if (result.decision.steps.length !== 0 || result.decision.proposedCapability !== null) {
  throw new Error('P2_2_VERTEX_UNEXPECTED_CAPABILITY_PROPOSAL');
}

const evidence = {
  schemaVersion: 'toca.p2.2.ag01-vertex-provider.v1',
  status: 'PROVIDER_VERIFIED',
  provider: 'google-vertex-ai',
  projectId,
  location,
  requestedModel: model,
  responseId: result.responseId,
  responseModel: result.model,
  routeId: result.decision.routeId,
  agent: result.decision.agent,
  capabilityProposed: false,
  coreCapabilityExecuted: false,
  externalSideEffectExecuted: false,
  authMode: injectedToken ? 'wif-access-token' : 'metadata-service',
  evidence: result.evidence,
  verifiedAt: new Date().toISOString(),
};
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(`P2_2_PROVIDER_READBACK ${JSON.stringify(evidence)}`);
