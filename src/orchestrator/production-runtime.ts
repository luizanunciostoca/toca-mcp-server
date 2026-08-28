import { createTrustedServiceExecutionIdentity, type ExecutionIdentity } from '../core/identity.js';
import { EnvironmentSecretResolver } from '../core/secrets.js';
import { bindApprovalStoreToScope } from '../governance/approval-scope.js';
import { PostgresCrmSalesStore } from '../persistence/postgres-crm-sales-store.js';
import { createTocaRuntimeComposition } from '../server.js';
import { PostgresDeadLetterSink } from '../worker/postgres-dead-letter.js';
import { ExistingCoreCapabilityGateway } from './core-gateway.js';
import { DurableFollowupCoordinator } from './durable-followup.js';
import { GoogleOAuthRefreshSecretResolver } from './google-oauth-secret-resolver.js';
import { PostgresConversationStore } from './postgres-conversation-store.js';
import type { OrchestratorRequest, OrchestratorResponse } from './contracts.js';
import { OpenAiResponsesDecisionAdapter, type Ag01DecisionModelAdapter } from './openai-responses-adapter.js';
import {
  Ag01DecisionContext,
  ModelBackedIntentRouteResolver,
  StructuredDecisionPlanBuilder,
} from './production-planning.js';
import type { Ag01ProductionConfig } from './production-config.js';
import { TocaOrchestratorRuntime } from './runtime.js';
import { deterministicId } from './safety.js';
import {
  GoogleSheetsTocaOsRegistryClient,
  TocaOsCanonicalArtifactResolver,
} from './toca-os-registry.js';
import type { Ag01StructuredDecision } from './structured-decision.js';
import { VertexGeminiDecisionAdapter } from './vertex-gemini-decision-adapter.js';

export const AG01_SERVICE_NAME = 'toca-ag01-orchestrator';
export const AG01_SERVICE_VERSION = '0.2.0';

export interface Ag01RuntimeRequest {
  readonly conversationId?: string;
  readonly messageId?: string;
  readonly idempotencyKey: string;
  readonly message: string;
  readonly correlationId?: string;
  readonly causationId?: string | null;
  readonly routeHint?: OrchestratorRequest['routeHint'];
}

export interface Ag01RuntimeResult {
  readonly orchestration: OrchestratorResponse;
  readonly decision: Ag01StructuredDecision | null;
  readonly modelResponseId: string | null;
  readonly model: string | null;
}

export interface Ag01ProductionRuntime {
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly identity: ExecutionIdentity;
  readonly runtimeCapabilityIds: readonly string[];
  readonly followups: DurableFollowupCoordinator;
  execute(request: Ag01RuntimeRequest): Promise<Ag01RuntimeResult>;
  resume(conversationId: string): Promise<Ag01RuntimeResult>;
  readiness(): Promise<void>;
  close(): Promise<void>;
}

export function createAg01ProductionRuntime(
  config: Ag01ProductionConfig,
  env: NodeJS.ProcessEnv = process.env,
): Ag01ProductionRuntime {
  const identity = productionIdentity(config);
  const coreComposition = createTocaRuntimeComposition({
    env,
    executionIdentity: identity,
    defaultTenantId: config.tenantId,
    defaultWorkspaceId: config.workspaceId,
    defaultOrganizationId: config.organizationId,
  });
  const pool = coreComposition.pool;
  if (!pool) throw new Error('AG01_POSTGRES_REQUIRED');
  if (!coreComposition.approvalStore) throw new Error('AG01_APPROVAL_STORE_REQUIRED');
  if (!coreComposition.auditStore) throw new Error('AG01_AUDIT_STORE_REQUIRED');
  if (!coreComposition.workflowStore) throw new Error('AG01_WORKFLOW_STORE_REQUIRED');

  const scopedApprovalStore = bindApprovalStoreToScope(coreComposition.approvalStore, {
    tenantId: config.tenantId,
    workspaceId: config.workspaceId,
    organizationId: config.organizationId,
  });
  const core = new ExistingCoreCapabilityGateway({
    registry: coreComposition.registry,
    runtimeResolver: coreComposition.runtimeResolver,
    auditSink: coreComposition.auditStore,
    approvalStore: scopedApprovalStore,
  });
  const conversations = new PostgresConversationStore(pool);
  const deadLetters = new PostgresDeadLetterSink(pool, config.tenantId);
  const followups = new DurableFollowupCoordinator({
    workflows: coreComposition.workflowStore,
    sales: new PostgresCrmSalesStore(pool),
    core,
    deadLetters,
    resolveIdentity: () => identity,
  });
  const secrets = new EnvironmentSecretResolver(env);
  const googleOAuth = new GoogleOAuthRefreshSecretResolver({
    clientIdReference: { provider: 'env', key: config.googleOAuthClientIdEnvKey },
    clientSecretReference: { provider: 'env', key: config.googleOAuthClientSecretEnvKey },
    refreshTokenReference: { provider: 'env', key: config.googleOAuthRefreshTokenEnvKey },
    secrets,
    tokenEndpoint: config.googleOAuthTokenEndpoint,
    timeoutMs: config.registryTimeoutMs,
  });
  const tocaOs = new GoogleSheetsTocaOsRegistryClient({
    routingSpreadsheetId: config.routingSpreadsheetId,
    canonicalResourcesSpreadsheetId: config.canonicalResourcesSpreadsheetId,
    accessTokenReference: { provider: 'google-oauth', key: 'sheets-readonly' },
    secrets: googleOAuth,
    cacheTtlMs: config.registryCacheTtlMs,
    timeoutMs: config.registryTimeoutMs,
  });
  const model: Ag01DecisionModelAdapter =
    config.modelProvider === 'vertex'
      ? new VertexGeminiDecisionAdapter({
          projectId: config.vertexProjectId,
          location: config.vertexLocation,
          model: config.vertexModel,
          timeoutMs: config.openAiTimeoutMs,
          maxRetries: config.openAiMaxRetries,
          maxOutputTokens: config.openAiMaxOutputTokens,
        })
      : new OpenAiResponsesDecisionAdapter({
          baseUrl: config.openAiBaseUrl,
          model: config.openAiModel,
          apiKeyReference: { provider: 'env', key: config.openAiApiKeyEnvKey },
          secrets,
          timeoutMs: config.openAiTimeoutMs,
          maxRetries: config.openAiMaxRetries,
          maxOutputTokens: config.openAiMaxOutputTokens,
        });
  const runtimeCapabilityIds = Object.freeze(
    coreComposition.registry
      .list()
      .map((definition) => definition.name)
      .filter((capabilityId) => coreComposition.runtimeResolver(capabilityId) !== undefined),
  );
  const decisionContext = new Ag01DecisionContext();
  const routeResolver = new ModelBackedIntentRouteResolver(
    model,
    tocaOs,
    decisionContext,
    () => runtimeCapabilityIds,
  );
  const artifacts = new TocaOsCanonicalArtifactResolver(tocaOs, decisionContext);
  const planner = new StructuredDecisionPlanBuilder(decisionContext, () => runtimeCapabilityIds);
  const orchestrator = new TocaOrchestratorRuntime({
    conversations,
    routeResolver,
    artifacts,
    planner,
    core,
    deadLetters,
  });

  const execute = (request: Ag01RuntimeRequest): Promise<Ag01RuntimeResult> =>
    decisionContext.run(async () => {
      const conversationId =
        request.conversationId?.trim() ||
        deterministicId('ag01conv', identity.principal.tenantId, request.idempotencyKey);
      const correlationId =
        request.correlationId?.trim() ||
        deterministicId('ag01corr', identity.principal.tenantId, request.idempotencyKey);
      try {
        const orchestration = await orchestrator.handle({
          idempotencyKey: request.idempotencyKey,
          message: request.message,
          conversationId,
          correlationId,
          identity,
          ...(request.messageId ? { messageId: request.messageId } : {}),
          ...(request.causationId !== undefined ? { causationId: request.causationId } : {}),
          ...(request.routeHint ? { routeHint: request.routeHint } : {}),
        });
        const result = decisionContext.result();
        return {
          orchestration,
          decision: result?.decision ?? null,
          modelResponseId: result?.responseId ?? null,
          model: result?.model ?? null,
        };
      } catch (error) {
        await persistPlanningFailure(
          conversations,
          identity,
          conversationId,
          normalizeErrorCode(error),
        );
        throw error;
      }
    });

  const resume = (conversationId: string): Promise<Ag01RuntimeResult> =>
    decisionContext.run(async () => ({
      orchestration: await orchestrator.resume(conversationId, identity),
      decision: null,
      modelResponseId: null,
      model: null,
    }));

  return {
    serviceName: AG01_SERVICE_NAME,
    serviceVersion: AG01_SERVICE_VERSION,
    identity,
    runtimeCapabilityIds,
    followups,
    execute,
    resume,
    readiness: async () => {
      await Promise.all([pool.query('select 1'), model.readiness(), tocaOs.snapshot(true)]);
      if (runtimeCapabilityIds.length === 0)
        throw new Error('AG01_CORE_RUNTIME_CAPABILITIES_EMPTY');
    },
    close: () => pool.end(),
  };
}

function productionIdentity(config: Ag01ProductionConfig): ExecutionIdentity {
  return createTrustedServiceExecutionIdentity({
    principalId: config.servicePrincipalId,
    tenantId: config.tenantId,
    workspaceId: config.workspaceId,
    organizationId: config.organizationId,
    roles: config.authorizationRoles,
    allowedRouteIds: config.allowedRouteIds.length > 0 ? config.allowedRouteIds : null,
    allowedCapabilityIds: config.allowedCapabilityIds,
    allowedTargetAccounts: config.allowedTargetAccounts,
    evidence: [
      `ag01-runtime:${AG01_SERVICE_VERSION}`,
      `ag01-model-provider:${config.modelProvider}`,
      `runtime:tenant:${config.tenantId}`,
      'architecture:ag01-to-core-only',
      'deployment-contract:cloud-run-authenticated-boundary',
    ],
  });
}

async function persistPlanningFailure(
  conversations: PostgresConversationStore,
  identity: ExecutionIdentity,
  conversationId: string,
  errorCode: string,
): Promise<void> {
  const conversation = await conversations.getConversation(
    identity.principal.tenantId,
    conversationId,
  );
  if (
    !conversation ||
    conversation.status === 'SUCCEEDED' ||
    conversation.status === 'DEAD_LETTERED'
  )
    return;
  const now = new Date().toISOString();
  await conversations.updateConversation({
    tenantId: conversation.tenantId,
    conversationId: conversation.conversationId,
    expectedVersion: conversation.version,
    status: 'HUMAN_REQUIRED',
    humanReason: `AG01_FAIL_CLOSED:${errorCode}`,
    routeId: conversation.routeId,
    primaryAgent: conversation.primaryAgent,
    sopId: conversation.sopId,
    templateId: conversation.templateId,
    contextSummary: conversation.contextSummary,
    summarizedMessageCount: conversation.summarizedMessageCount,
    checkpoint: conversation.checkpoint,
    now,
  });
}

function normalizeErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return 'AG01_RUNTIME_ERROR';
  const message = error.message.trim();
  if (!message) return error.name || 'AG01_RUNTIME_ERROR';
  return message.split(':')[0] || 'AG01_RUNTIME_ERROR';
}
