import type { ExecutionIdentity } from '../core/identity.js';
import type { ApprovalRecord } from '../governance/approval-governance.js';
import type { RouteId } from '../governance/types.js';

export const ORCHESTRATOR_CONVERSATION_STATUSES = [
  'ACTIVE',
  'WAITING_APPROVAL',
  'HUMAN_REQUIRED',
  'SUCCEEDED',
  'DEAD_LETTERED',
] as const;
export type OrchestratorConversationStatus = (typeof ORCHESTRATOR_CONVERSATION_STATUSES)[number];

export const ORCHESTRATOR_CHECKPOINT_STATUSES = [
  'READY',
  'RUNNING',
  'WAITING_APPROVAL',
  'HUMAN_REQUIRED',
  'SUCCEEDED',
  'DEAD_LETTERED',
] as const;
export type OrchestratorCheckpointStatus = (typeof ORCHESTRATOR_CHECKPOINT_STATUSES)[number];

export interface MessageRecord {
  readonly messageId: string;
  readonly conversationId: string;
  readonly tenantId: string;
  readonly userPrincipalId: string;
  readonly role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  /** Persisted content is always redacted. */
  readonly content: string;
  readonly sourceContentSha256: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly idempotencyKey: string;
  readonly promptInjectionDetected: boolean;
  readonly redactionCount: number;
  readonly createdAt: string;
}

export interface CanonicalArtifactRef {
  readonly artifactId: string;
  readonly version: string;
  readonly sourceRef: string;
  readonly evidence: readonly string[];
}

export interface OrchestratorPlanStep {
  readonly stepId: string;
  readonly name: string;
  readonly capabilityId: string;
  readonly payload: unknown;
  readonly maxAttempts: number;
}

export interface OrchestratorPlan {
  readonly routeId: RouteId;
  readonly primaryAgent: string;
  readonly auxiliaryAgents: readonly string[];
  readonly sop: CanonicalArtifactRef;
  readonly template: CanonicalArtifactRef | null;
  readonly steps: readonly OrchestratorPlanStep[];
  readonly evidence: readonly string[];
}

export interface OrchestratorCheckpoint {
  readonly runId: string;
  readonly messageId: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly plan: OrchestratorPlan;
  readonly nextStepIndex: number;
  readonly currentAttempt: number;
  readonly totalToolCalls: number;
  readonly approvalId: string | null;
  readonly status: OrchestratorCheckpointStatus;
  readonly humanReason: string | null;
  readonly lastErrorCode: string | null;
  readonly updatedAt: string;
}

export interface ConversationRecord {
  readonly conversationId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly userPrincipalId: string;
  readonly correlationId: string;
  readonly status: OrchestratorConversationStatus;
  readonly humanReason: string | null;
  readonly routeId: RouteId | null;
  readonly primaryAgent: string | null;
  readonly sopId: string | null;
  readonly templateId: string | null;
  readonly contextSummary: string;
  readonly summarizedMessageCount: number;
  readonly checkpoint: OrchestratorCheckpoint | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface CircuitBreakerState {
  readonly tenantId: string;
  readonly capabilityId: string;
  readonly failureCount: number;
  readonly openedUntil: string | null;
  readonly lastFailureCode: string | null;
  readonly updatedAt: string;
}

export interface ConversationStore {
  createConversation(record: ConversationRecord): Promise<ConversationRecord>;
  getConversation(
    tenantId: string,
    conversationId: string,
  ): Promise<ConversationRecord | undefined>;
  appendMessage(
    record: MessageRecord,
  ): Promise<{ readonly record: MessageRecord; readonly duplicate: boolean }>;
  listMessages(
    tenantId: string,
    conversationId: string,
    limit: number,
  ): Promise<readonly MessageRecord[]>;
  updateConversation(input: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly expectedVersion: number;
    readonly status: OrchestratorConversationStatus;
    readonly humanReason: string | null;
    readonly routeId: RouteId | null;
    readonly primaryAgent: string | null;
    readonly sopId: string | null;
    readonly templateId: string | null;
    readonly contextSummary: string;
    readonly summarizedMessageCount: number;
    readonly checkpoint: OrchestratorCheckpoint | null;
    readonly now: string;
  }): Promise<ConversationRecord>;
  getCircuit(tenantId: string, capabilityId: string): Promise<CircuitBreakerState | undefined>;
  recordCircuitFailure(input: {
    readonly tenantId: string;
    readonly capabilityId: string;
    readonly errorCode: string;
    readonly threshold: number;
    readonly openedUntil: string;
    readonly now: string;
  }): Promise<CircuitBreakerState>;
  resetCircuit(tenantId: string, capabilityId: string, now: string): Promise<void>;
}

export interface RouteResolutionInput {
  readonly message: string;
  readonly contextSummary: string;
  readonly identity: ExecutionIdentity;
  readonly routeHint?: RouteId;
}

export interface RouteResolution {
  readonly routeId: RouteId;
  readonly confidence: number;
  readonly evidence: readonly string[];
}

export interface IntentRouteResolver {
  resolve(input: RouteResolutionInput): Promise<RouteResolution>;
}

export interface CanonicalArtifactResolver {
  resolveSop(input: {
    readonly routeId: RouteId;
    readonly primaryAgent: string;
    readonly message: string;
  }): Promise<CanonicalArtifactRef>;
  resolveTemplate(input: {
    readonly routeId: RouteId;
    readonly primaryAgent: string;
    readonly message: string;
  }): Promise<CanonicalArtifactRef | null>;
}

export interface PlanBuilder {
  build(input: {
    readonly message: string;
    readonly contextSummary: string;
    readonly routeId: RouteId;
    readonly primaryAgent: string;
    readonly auxiliaryAgents: readonly string[];
    readonly sop: CanonicalArtifactRef;
    readonly template: CanonicalArtifactRef | null;
    readonly identity: ExecutionIdentity;
  }): Promise<readonly OrchestratorPlanStep[]>;
}

export interface CoreCapabilityInspection {
  readonly canonicalCapabilityId: string;
  readonly routeId: RouteId | null;
  readonly sideEffects: boolean;
  readonly approvalRequired: boolean;
  readonly idempotent: boolean;
}

export interface CoreCapabilityGateway {
  inspect(input: {
    readonly capabilityId: string;
    readonly payload: unknown;
    readonly identity: ExecutionIdentity;
  }): CoreCapabilityInspection;
  execute(input: {
    readonly capabilityId: string;
    readonly payload: unknown;
    readonly correlationId: string;
    readonly identity: ExecutionIdentity;
    readonly approvalId?: string;
  }): Promise<{
    readonly executionId: string;
    readonly capabilityId: string;
    readonly result: unknown;
    readonly providerReadbackVerified: boolean;
  }>;
  requestApproval(input: {
    readonly capabilityId: string;
    readonly payload: unknown;
    readonly correlationId: string;
    readonly expiresAt: string;
    readonly evidence: readonly string[];
    readonly identity: ExecutionIdentity;
  }): Promise<ApprovalRecord>;
  getApproval(approvalId: string): Promise<ApprovalRecord | undefined>;
}

export interface OrchestratorBudget {
  readonly maxToolCalls: number;
  readonly maxToolCallsPerResume: number;
  readonly maxTotalAttempts: number;
  readonly maxContextTokens: number;
  readonly runtimeTimeoutMs: number;
  readonly toolTimeoutMs: number;
  readonly circuitFailureThreshold: number;
  readonly circuitOpenMs: number;
  readonly approvalTtlMs: number;
}

export interface OrchestratorRequest {
  readonly conversationId?: string;
  readonly messageId?: string;
  readonly idempotencyKey: string;
  readonly message: string;
  readonly correlationId?: string;
  readonly causationId?: string | null;
  readonly routeHint?: RouteId;
  readonly identity: ExecutionIdentity;
}

export interface OrchestratorResponse {
  readonly conversationId: string;
  readonly runId: string | null;
  readonly correlationId: string;
  readonly status: OrchestratorCheckpointStatus;
  readonly routeId: RouteId | null;
  readonly primaryAgent: string | null;
  readonly nextStepIndex: number | null;
  readonly duplicate: boolean;
  readonly humanReason: string | null;
  readonly lastErrorCode: string | null;
  readonly outputs: readonly unknown[];
}
