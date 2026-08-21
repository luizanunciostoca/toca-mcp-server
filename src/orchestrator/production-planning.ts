import { AsyncLocalStorage } from 'node:async_hooks';
import { resolveCapabilityDefinition } from '../governance/capability-resolution.js';
import { getRouteDefinition } from '../governance/route-catalog.js';
import type { IntentRouteResolver, OrchestratorPlanStep, PlanBuilder } from './contracts.js';
import type {
  Ag01DecisionModelAdapter,
  Ag01ModelDecisionResult,
} from './openai-responses-adapter.js';
import { parseDecisionPayload, type Ag01StructuredDecision } from './structured-decision.js';
import { resolveRequiredResources, type TocaOsRegistryClient } from './toca-os-registry.js';

interface DecisionState {
  result?: Ag01ModelDecisionResult;
}

export class Ag01DecisionContext {
  readonly #storage = new AsyncLocalStorage<DecisionState>();

  run<T>(operation: () => Promise<T>): Promise<T> {
    return this.#storage.run({}, operation);
  }

  setResult(result: Ag01ModelDecisionResult): void {
    const state = this.#storage.getStore();
    if (!state) throw new Error('AG01_DECISION_CONTEXT_REQUIRED');
    state.result = result;
  }

  result(): Ag01ModelDecisionResult | undefined {
    return this.#storage.getStore()?.result;
  }

  requireDecision(): Ag01StructuredDecision {
    const result = this.result();
    if (!result) throw new Error('AG01_STRUCTURED_DECISION_REQUIRED');
    return result.decision;
  }
}

export class Ag01HumanEscalationError extends Error {
  constructor(readonly reason: string) {
    super(`AG01_HUMAN_ESCALATION:${reason}`);
    this.name = 'Ag01HumanEscalationError';
  }
}

export class ModelBackedIntentRouteResolver implements IntentRouteResolver {
  constructor(
    private readonly model: Ag01DecisionModelAdapter,
    private readonly registry: TocaOsRegistryClient,
    private readonly context: Ag01DecisionContext,
    private readonly runtimeCapabilityIds: () => readonly string[],
  ) {}

  async resolve(input: Parameters<IntentRouteResolver['resolve']>[0]) {
    const snapshot = await this.registry.snapshot();
    const result = await this.model.decide({
      message: input.message,
      contextSummary: input.contextSummary,
      identity: input.identity,
      ...(input.routeHint ? { routeHint: input.routeHint } : {}),
      registry: snapshot,
      runtimeCapabilityIds: this.runtimeCapabilityIds(),
    });
    validateDecision(result.decision, input.identity, snapshot, this.runtimeCapabilityIds());
    this.context.setResult(result);
    if (result.decision.humanEscalationReason) {
      throw new Ag01HumanEscalationError(result.decision.humanEscalationReason);
    }
    return {
      routeId: result.decision.routeId,
      confidence: result.decision.confidence,
      evidence: [...snapshot.evidence, ...result.evidence],
    };
  }
}

export class StructuredDecisionPlanBuilder implements PlanBuilder {
  constructor(
    private readonly context: Ag01DecisionContext,
    private readonly runtimeCapabilityIds: () => readonly string[],
  ) {}

  build(input: Parameters<PlanBuilder['build']>[0]): Promise<readonly OrchestratorPlanStep[]> {
    const decision = this.context.requireDecision();
    if (decision.routeId !== input.routeId) throw new Error('AG01_PLAN_ROUTE_MISMATCH');
    if (decision.agent !== input.primaryAgent) throw new Error('AG01_PLAN_AGENT_MISMATCH');
    if (!decision.requiredArtifacts.includes(input.sop.artifactId)) {
      throw new Error(`AG01_PLAN_SOP_NOT_IN_DECISION:${input.sop.artifactId}`);
    }
    if (input.template && !decision.requiredArtifacts.includes(input.template.artifactId)) {
      throw new Error(`AG01_PLAN_TEMPLATE_NOT_IN_DECISION:${input.template.artifactId}`);
    }

    const routeCapabilities = new Set(getRouteDefinition(input.routeId).capabilityIds);
    const runtimeCapabilities = new Set(this.runtimeCapabilityIds());
    const authorized = input.identity.authorization.allowedCapabilityIds
      ? new Set(input.identity.authorization.allowedCapabilityIds)
      : null;
    const steps = decision.steps.map((step): OrchestratorPlanStep => {
      const capabilityId = canonicalCapability(step.capabilityId);
      if (!routeCapabilities.has(capabilityId)) {
        throw new Error(`AG01_CAPABILITY_NOT_ALLOWED_FOR_ROUTE:${input.routeId}:${capabilityId}`);
      }
      if (!runtimeCapabilities.has(capabilityId)) {
        throw new Error(`AG01_CAPABILITY_NOT_RUNTIME_BOUND:${capabilityId}`);
      }
      if (authorized && !authorized.has(capabilityId)) {
        throw new Error(`AG01_CAPABILITY_NOT_AUTHORIZED:${capabilityId}`);
      }
      return {
        stepId: step.stepId,
        name: step.name,
        capabilityId,
        payload: parseDecisionPayload(step.payloadJson),
        maxAttempts: step.maxAttempts,
      };
    });
    return Promise.resolve(steps);
  }
}

function validateDecision(
  decision: Ag01StructuredDecision,
  identity: Parameters<IntentRouteResolver['resolve']>[0]['identity'],
  snapshot: Awaited<ReturnType<TocaOsRegistryClient['snapshot']>>,
  runtimeCapabilityIds: readonly string[],
): void {
  const route = getRouteDefinition(decision.routeId);
  const driveRoute = snapshot.routes.get(decision.routeId);
  if (!driveRoute) throw new Error(`AG01_TOCA_OS_ROUTE_MISSING:${decision.routeId}`);
  if (decision.agent !== route.primaryAgent || decision.agent !== driveRoute.primaryAgent) {
    throw new Error(`AG01_MODEL_AGENT_INVALID:${decision.routeId}:${decision.agent}`);
  }
  const resources = resolveRequiredResources(decision.requiredArtifacts, snapshot);
  if (
    !resources.some(
      (item) => item.resourceId.startsWith('SOP-') || item.resourceId.startsWith('PIPE-'),
    )
  ) {
    throw new Error(`AG01_SOP_ARTIFACT_REQUIRED:${decision.routeId}`);
  }
  if (
    identity.authorization.allowedRouteIds &&
    !identity.authorization.allowedRouteIds.includes(decision.routeId)
  ) {
    throw new Error(`AG01_ROUTE_NOT_AUTHORIZED:${decision.routeId}`);
  }

  const routeCapabilities = new Set(route.capabilityIds);
  const runtimeCapabilities = new Set(runtimeCapabilityIds);
  const authorized = identity.authorization.allowedCapabilityIds
    ? new Set(identity.authorization.allowedCapabilityIds)
    : null;
  for (const step of decision.steps) {
    const capabilityId = canonicalCapability(step.capabilityId);
    if (!routeCapabilities.has(capabilityId))
      throw new Error(`AG01_CAPABILITY_NOT_ALLOWED_FOR_ROUTE:${decision.routeId}:${capabilityId}`);
    if (!runtimeCapabilities.has(capabilityId))
      throw new Error(`AG01_CAPABILITY_NOT_RUNTIME_BOUND:${capabilityId}`);
    if (authorized && !authorized.has(capabilityId))
      throw new Error(`AG01_CAPABILITY_NOT_AUTHORIZED:${capabilityId}`);
  }

  if (decision.proposedCapability) {
    const resolved = resolveCapabilityDefinition(decision.proposedCapability);
    if (!resolved) throw new Error(`AG01_CAPABILITY_UNKNOWN:${decision.proposedCapability}`);
    const definition = resolved.canonical_definition;
    if (decision.risk !== definition.risk_class) throw new Error('AG01_MODEL_RISK_MISMATCH');
    if (definition.approval_required && decision.approvalRequirement !== 'FORMAL_APPROVAL') {
      throw new Error('AG01_MODEL_APPROVAL_UNDERSTATED');
    }
    if (definition.side_effects && decision.expectedReadback.length === 0) {
      throw new Error('AG01_MODEL_EXPECTED_READBACK_REQUIRED');
    }
  }
}

function canonicalCapability(capabilityId: string): string {
  const resolved = resolveCapabilityDefinition(capabilityId);
  if (!resolved) throw new Error(`AG01_CAPABILITY_UNKNOWN:${capabilityId}`);
  return resolved.canonical_id;
}
