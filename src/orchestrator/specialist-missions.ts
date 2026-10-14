/**
 * AG-01 -> canonical WorkflowStore -> existing Core gateway.
 * Internal, opt-in READ-only bridge. No ChatGPT Tasks integration and no scheduler.
 */
import { assertExecutionIdentity, authorizeExecution, type ExecutionIdentity } from '../core/identity.js';
import { resolveCapabilityDefinition } from '../governance/capability-resolution.js';
import { getRouteDefinition } from '../governance/route-catalog.js';
import type { RouteId } from '../governance/types.js';
import type { WorkflowSnapshot, WorkflowStore } from '../workflow/workflow-contracts.js';
import type { CoreCapabilityGateway } from './contracts.js';
import { deterministicId, sourceContentSha256 } from './safety.js';

export const SPECIALIST_MISSION_DEFINITION_ID = 'ag01-internal-specialist-mission';
export const SPECIALIST_MISSION_STEP_ID = 'execute-core-capability';
export const SPECIALIST_MISSION_DEFINITION_VERSION = '1.1.0';
export const SPECIALIST_MISSION_MAX_TTL_MS = 24 * 60 * 60 * 1000;

export type SpecialistPriority = 'P0' | 'P1' | 'P2';
export type SpecialistMissionStatus = 'READY' | 'CLAIMED' | 'STARTED' | 'DONE' | 'FAILED';

export interface SpecialistMissionInput {
  readonly routeId: RouteId;
  readonly capabilityId: string;
  readonly payload: unknown;
  readonly owner: string;
  readonly priority: SpecialistPriority;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly expiresAt: string;
  readonly identity: ExecutionIdentity;
}

export interface SpecialistMissionView {
  readonly mission_id: string;
  readonly routeId: RouteId;
  readonly capability: string;
  readonly owner: string;
  readonly priority: SpecialistPriority;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly expiresAt: string;
  readonly status: SpecialistMissionStatus;
  readonly claimedBy: string | null;
  readonly coreExecutionId: string | null;
  readonly providerReadbackVerified: boolean | null;
  readonly evidence: readonly string[];
}

type CoreResult = Awaited<ReturnType<CoreCapabilityGateway['execute']>>;

type Manifest = {
  readonly mission_id: string;
  readonly routeId: RouteId;
  readonly capability: string;
  readonly owner: string;
  readonly priority: SpecialistPriority;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly expiresAt: string;
  readonly requesterPrincipalId: string;
  readonly payloadSha256: string;
  readonly immutableSha256: string;
};

export class Ag01SpecialistMissionCoordinator {
  constructor(
    private readonly workflows: WorkflowStore,
    private readonly core: CoreCapabilityGateway,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Support is deliberately limited to existing READ-risk, runtime-bound Core tools. */
  supports(capabilityId: string): boolean {
    const resolved = resolveCapabilityDefinition(capabilityId);
    if (!resolved || resolved.canonical_definition.risk_class !== 'READ') return false;
    if (/^(?:google_ads|whatsapp|email)\./.test(resolved.canonical_id)) return false;
    return true;
  }

  async dispatch(input: SpecialistMissionInput): Promise<SpecialistMissionView> {
    const now = this.now().toISOString();
    const { identity } = input;
    assertExecutionIdentity(identity, now);
    requireText(input.idempotencyKey, 'AG01_MISSION_IDEMPOTENCY_REQUIRED');
    requireText(input.correlationId, 'AG01_MISSION_CORRELATION_REQUIRED');
    if (!['P0', 'P1', 'P2'].includes(input.priority))
      throw new Error('AG01_MISSION_PRIORITY_INVALID');
    const expiresAt = requireFutureTimestamp(input.expiresAt, now);
    if (Date.parse(expiresAt) - Date.parse(now) > SPECIALIST_MISSION_MAX_TTL_MS)
      throw new Error('AG01_MISSION_TTL_EXCEEDS_MAXIMUM');
    const route = getRouteDefinition(input.routeId);
    if (!route.primaryAgent.includes('AG-')) throw new Error('AG01_MISSION_ROUTE_AGENT_INVALID');
    if (input.owner !== route.primaryAgent && !route.auxiliaryAgents.includes(input.owner))
      throw new Error('AG01_MISSION_OWNER_OUTSIDE_ROUTE');
    if (input.owner === 'AG-01') throw new Error('AG01_MISSION_SPECIALIST_REQUIRED');
    const resolved = resolveCapabilityDefinition(input.capabilityId);
    if (!resolved || !this.supports(resolved.canonical_id))
      throw new Error('AG01_MISSION_CAPABILITY_NOT_ELIGIBLE');
    const capability = resolved.canonical_id;
    if (!route.capabilityIds.includes(capability) && !route.capabilityIds.includes(input.capabilityId))
      throw new Error('AG01_MISSION_CAPABILITY_ROUTE_MISMATCH');
    const allowed = authorizeExecution(identity, { routeId: input.routeId, capabilityId: capability, riskClass: 'READ', now });
    if (!allowed.allowed) throw new Error(`AG01_MISSION_AUTHORIZATION_DENIED:${allowed.reason}`);
    const inspection = this.core.inspect({ capabilityId: capability, payload: input.payload, identity });
    if (inspection.canonicalCapabilityId !== capability || inspection.sideEffects || inspection.approvalRequired)
      throw new Error('AG01_MISSION_CORE_READONLY_BOUNDARY');
    if (inspection.routeId && inspection.routeId !== input.routeId)
      throw new Error('AG01_MISSION_CORE_ROUTE_MISMATCH');

    // Reject unserializable inputs before deriving idempotency evidence.
    if (input.payload === undefined) throw new Error('AG01_MISSION_PAYLOAD_REQUIRED');
    const mission_id = deterministicId('ag01mission', identity.principal.tenantId, input.idempotencyKey);
    const immutableSha256 = sourceContentSha256(JSON.stringify({
      routeId: input.routeId,
      capability,
      owner: input.owner,
      priority: input.priority,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
      expiresAt,
      requesterPrincipalId: identity.principal.principalId,
      tenantId: identity.principal.tenantId,
      workspaceId: identity.principal.workspaceId,
      organizationId: identity.principal.organizationId,
      payload: input.payload,
    }));
    const manifest: Manifest = {
      mission_id,
      routeId: input.routeId,
      capability,
      owner: input.owner,
      priority: input.priority,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
      expiresAt,
      requesterPrincipalId: identity.principal.principalId,
      payloadSha256: sourceContentSha256(JSON.stringify(input.payload ?? null)),
      immutableSha256,
    };
    const snapshot = await this.workflows.create({
      workflowId: mission_id,
      routeId: input.routeId,
      definitionId: SPECIALIST_MISSION_DEFINITION_ID,
      definitionVersion: SPECIALIST_MISSION_DEFINITION_VERSION,
      idempotencyKey: `ag01-internal-specialist:${input.idempotencyKey}`,
      correlationId: input.correlationId,
      tenantId: identity.principal.tenantId,
      workspaceId: identity.principal.workspaceId,
      organizationId: identity.principal.organizationId,
      requesterPrincipalId: identity.principal.principalId,
      input: manifest,
      steps: [{
        stepId: SPECIALIST_MISSION_STEP_ID,
        name: `Internal ${input.owner} Core capability`,
        capabilityId: capability,
        input: input.payload,
        maxAttempts: 1,
      }],
    }, now);
    const persisted = readManifest(snapshot);
    if (persisted.immutableSha256 !== immutableSha256)
      throw new Error('AG01_MISSION_IDEMPOTENCY_CONFLICT');
    return this.toView(snapshot, identity);
  }

  async status(missionId: string, identity: ExecutionIdentity): Promise<SpecialistMissionView> {
    const snapshot = await this.requireSnapshot(missionId);
    this.assertScope(snapshot, identity);
    this.assertAuthorized(identity, readManifest(snapshot));
    return this.toView(snapshot, identity);
  }

  /** The owning internal worker, not AG-01/ChatGPT Tasks, claims and produces Core ACK. */
  async executeOwned(missionId: string, owner: string, identity: ExecutionIdentity): Promise<CoreResult> {
    const snapshot = await this.requireSnapshot(missionId);
    const manifest = readManifest(snapshot);
    this.assertScope(snapshot, identity);
    if (owner !== manifest.owner) throw new Error('AG01_MISSION_WORKER_OWNER_MISMATCH');
    this.assertAuthorized(identity, manifest);
    const step = onlyStep(snapshot);
    if (step.status === 'SUCCEEDED') return resultFrom(step.output);
    if (step.status === 'FAILED') throw new Error('AG01_MISSION_ALREADY_FAILED');
    if (step.status !== 'READY') throw new Error('AG01_MISSION_ALREADY_CLAIMED');
    const now = this.now().toISOString();
    requireFutureTimestamp(manifest.expiresAt, now);
    const inspection = this.core.inspect({capabilityId: manifest.capability, payload: step.input, identity});
    if (!this.supports(manifest.capability) || inspection.canonicalCapabilityId !== manifest.capability || inspection.sideEffects || inspection.approvalRequired)
      throw new Error('AG01_MISSION_CORE_READONLY_BOUNDARY');
    const workerId = `ag01-internal:${owner}`;
    const claims = await this.workflows.claimReadySteps({workflowId:missionId, workerId, now, limit:1});
    const claim = claims[0];
    if (!claim) throw new Error('AG01_MISSION_ALREADY_CLAIMED');
    if (claim.workerId !== workerId || claim.stepId !== SPECIALIST_MISSION_STEP_ID)
      throw new Error('AG01_MISSION_INVALID_CLAIM');
    let execution: CoreResult;
    try {
      execution = await this.core.execute({
        capabilityId: manifest.capability,
        payload: step.input,
        correlationId: manifest.correlationId,
        identity,
      });
      if (!execution.executionId?.trim() || execution.capabilityId !== manifest.capability ||
          typeof execution.providerReadbackVerified !== 'boolean')
        throw new Error('AG01_MISSION_CORE_ACK_INVALID');
    } catch (error) {
      const code = error instanceof Error ? error.message.split(':')[0] : 'AG01_MISSION_CORE_EXECUTION_FAILED';
      await this.workflows.failStep({
        workflowId: missionId,
        stepId: claim.stepId,
        executionId: claim.executionId,
        errorCode: code || 'AG01_MISSION_CORE_EXECUTION_FAILED',
        evidence: [`ag01:worker:${owner}`, 'ag01:core-outcome-not-proven'],
        now: this.now().toISOString(),
      });
      throw error;
    }
    // A failed completion/readback leaves the claimed workflow uncertain: never reexecute blindly.
    await this.workflows.completeStep({
      workflowId: missionId,
      stepId: claim.stepId,
      executionId: claim.executionId,
      output: execution,
      evidence: [
        `ag01:worker:${owner}`,
        `ag01:core-execution:${execution.executionId}`,
        execution.providerReadbackVerified ? 'ag01:provider-readback-verified' : 'ag01:provider-readback-not-verified',
      ],
      now: this.now().toISOString(),
    });
    return execution;
  }

  /** Optional AG-01 planned-step integration: enqueue then let its internal worker execute. */
  async executePlannedStep(input: SpecialistMissionInput): Promise<CoreResult> {
    const mission = await this.dispatch(input);
    return this.executeOwned(mission.mission_id, input.owner, input.identity);
  }

  private async requireSnapshot(missionId: string): Promise<WorkflowSnapshot> {
    const snapshot = await this.workflows.get(missionId);
    if (!snapshot || snapshot.instance.definitionId !== SPECIALIST_MISSION_DEFINITION_ID)
      throw new Error('AG01_MISSION_NOT_FOUND');
    return snapshot;
  }

  private assertScope(snapshot: WorkflowSnapshot, identity: ExecutionIdentity): void {
    assertExecutionIdentity(identity, this.now().toISOString());
    const { principal } = identity;
    if (snapshot.instance.tenantId !== principal.tenantId || snapshot.instance.workspaceId !== principal.workspaceId ||
        snapshot.instance.organizationId !== principal.organizationId || snapshot.instance.requesterPrincipalId !== principal.principalId)
      throw new Error('AG01_MISSION_SCOPE_DENIED');
  }

  private assertAuthorized(identity: ExecutionIdentity, manifest: Manifest): void {
    const allowed = authorizeExecution(identity, {
      routeId: manifest.routeId,
      capabilityId: manifest.capability,
      riskClass: 'READ',
      now: this.now().toISOString(),
    });
    if (!allowed.allowed)
      throw new Error(`AG01_MISSION_AUTHORIZATION_DENIED:${allowed.reason}`);
  }

  private toView(snapshot: WorkflowSnapshot, identity: ExecutionIdentity): SpecialistMissionView {
    this.assertScope(snapshot, identity);
    const m = readManifest(snapshot);
    const s = onlyStep(snapshot);
    const status: SpecialistMissionStatus = s.status === 'READY' ? 'READY' :
      s.status === 'RUNNING' ? (s.startedAt ? 'STARTED' : 'CLAIMED') :
      s.status === 'SUCCEEDED' ? 'DONE' : 'FAILED';
    const output = s.status === 'SUCCEEDED' ? resultFrom(s.output) : null;
    return {
      mission_id: m.mission_id,
      routeId: m.routeId,
      capability: m.capability,
      owner: m.owner,
      priority: m.priority,
      correlationId: m.correlationId,
      idempotencyKey: m.idempotencyKey,
      expiresAt: m.expiresAt,
      status,
      claimedBy: s.claimedBy,
      coreExecutionId: output?.executionId ?? null,
      providerReadbackVerified: output?.providerReadbackVerified ?? null,
      evidence: s.evidence,
    };
  }
}

function onlyStep(snapshot: WorkflowSnapshot) {
  const step = snapshot.steps.find(item => item.stepId === SPECIALIST_MISSION_STEP_ID);
  if (!step || snapshot.steps.length !== 1) throw new Error('AG01_MISSION_STEP_INVALID');
  return step;
}

function readManifest(snapshot: WorkflowSnapshot): Manifest {
  if (snapshot.instance.definitionId !== SPECIALIST_MISSION_DEFINITION_ID)
    throw new Error('AG01_MISSION_DEFINITION_INVALID');
  const value = snapshot.instance.input as Manifest;
  if (!value || typeof value !== 'object' || value.mission_id !== snapshot.instance.workflowId ||
      typeof value.immutableSha256 !== 'string') throw new Error('AG01_MISSION_MANIFEST_INVALID');
  return value;
}

function resultFrom(value: unknown): CoreResult {
  const result = value as CoreResult | null;
  if (!result || typeof result.executionId !== 'string' || typeof result.capabilityId !== 'string' ||
      typeof result.providerReadbackVerified !== 'boolean')
    throw new Error('AG01_MISSION_CORE_ACK_NOT_PROVEN');
  return result;
}

function requireFutureTimestamp(value: string, now: string): string {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || ms <= Date.parse(now)) throw new Error('AG01_MISSION_TTL_EXPIRED_OR_INVALID');
  return new Date(ms).toISOString();
}

function requireText(value: string, code: string): void {
  if (!value.trim()) throw new Error(code);
}
