import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import type { RouteId } from '../governance/types.js';
import { estimateAiTextCost, type AiTextUsage } from './cost-estimator.js';
import type { CostEvent } from './cost-event.js';
import type { CostLedger } from './postgres-cost-ledger.js';
import {
  FINOPS_PRICE_CATALOG_VERSION,
  isAiPricedModel,
  type AiPricedModel,
} from './pricing-catalog.js';

export interface Ag01RuntimeCostScope {
  readonly executionId: string;
  readonly correlationId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly startedAt: string;
}

interface Ag01RuntimeCostState {
  readonly scope: Ag01RuntimeCostScope;
  estimate?: RuntimeEstimate;
}

interface RuntimeEstimate {
  readonly model: AiPricedModel;
  readonly usage: AiTextUsage;
  readonly costMicroUsd: number;
}

export interface VertexCostEstimateObservation {
  readonly configuredModel: string;
  readonly estimatedInputTokens: number;
  readonly maxOutputTokens: number;
}

export interface VertexCostActualObservation {
  readonly configuredModel: string;
  readonly responseModel: string;
  readonly responseId: string;
  readonly routeId: RouteId;
  readonly agentId: string;
  readonly usage: AiTextUsage | null;
}

export interface VertexRuntimeCostObserver {
  beforeRequest(observation: VertexCostEstimateObservation): Promise<void>;
  afterResponse(observation: VertexCostActualObservation): Promise<void>;
}

export class Ag01RuntimeCostContext {
  readonly #storage = new AsyncLocalStorage<Ag01RuntimeCostState>();

  run<T>(scope: Ag01RuntimeCostScope, operation: () => Promise<T>): Promise<T> {
    validateScope(scope);
    return this.#storage.run({ scope }, operation);
  }

  current(): Ag01RuntimeCostState | undefined {
    return this.#storage.getStore();
  }

  require(): Ag01RuntimeCostState {
    const state = this.current();
    if (!state) throw new Error('FINOPS_RUNTIME_CONTEXT_REQUIRED');
    return state;
  }
}

export class Ag01VertexRuntimeCostObserver implements VertexRuntimeCostObserver {
  constructor(
    private readonly ledger: CostLedger,
    private readonly context: Ag01RuntimeCostContext,
  ) {}

  async beforeRequest(observation: VertexCostEstimateObservation): Promise<void> {
    const state = this.context.require();
    const model = pricedModel(observation.configuredModel);
    const usage: AiTextUsage = {
      inputTokens: safeUsage(observation.estimatedInputTokens, 'estimatedInputTokens'),
      cachedInputTokens: 0,
      outputTokens: safeUsage(observation.maxOutputTokens, 'maxOutputTokens'),
    };
    const estimate = estimateAiTextCost(model, 'STANDARD', usage);
    state.estimate = { model, usage, costMicroUsd: estimate.totalCostMicroUsd };
    await this.ledger.append(
      eventFor(state.scope, 'ESTIMATE', {
        model,
        usage,
        estimatedCostMicroUsd: estimate.totalCostMicroUsd,
      }),
    );
  }

  async afterResponse(observation: VertexCostActualObservation): Promise<void> {
    const state = this.context.require();
    const model = pricedModel(observation.configuredModel);
    const responseRef = opaqueHashRef('vertex:response', observation.responseId);
    const responseModelRef = opaqueHashRef('vertex:model', observation.responseModel);

    if (!observation.usage) {
      await this.ledger.append(
        eventFor(state.scope, 'RECONCILIATION', {
          model,
          usage: {},
          routeId: observation.routeId,
          agentId: observation.agentId,
          metadata: {
            providerReadbackRef: responseRef,
            reconciliationRef: reconciliationRef('MISSING_ACTUAL_USAGE', state.scope.executionId),
            evidenceRefs: [responseModelRef],
          },
        }),
      );
      return;
    }

    const actual = estimateAiTextCost(model, 'STANDARD', observation.usage);
    await this.ledger.append(
      eventFor(state.scope, 'ACTUAL', {
        model,
        usage: observation.usage,
        actualCostMicroUsd: actual.totalCostMicroUsd,
        routeId: observation.routeId,
        agentId: observation.agentId,
        metadata: {
          providerUsageRef: responseRef,
          providerReadbackRef: responseRef,
          evidenceRefs: [responseModelRef],
        },
      }),
    );

    const estimate = state.estimate;
    const status = !estimate
      ? 'MISSING_ESTIMATE'
      : actual.totalCostMicroUsd <= estimate.costMicroUsd
        ? 'WITHIN_ESTIMATE'
        : 'OVER_ESTIMATE';
    await this.ledger.append(
      eventFor(state.scope, 'RECONCILIATION', {
        model,
        usage: observation.usage,
        ...(estimate ? { estimatedCostMicroUsd: estimate.costMicroUsd } : {}),
        actualCostMicroUsd: actual.totalCostMicroUsd,
        routeId: observation.routeId,
        agentId: observation.agentId,
        metadata: {
          providerReadbackRef: responseRef,
          reconciliationRef: reconciliationRef(status, state.scope.executionId),
          evidenceRefs: [responseModelRef],
        },
      }),
    );
  }
}

interface EventFields {
  readonly model: string;
  readonly usage: CostEvent['usage'];
  readonly estimatedCostMicroUsd?: number;
  readonly actualCostMicroUsd?: number;
  readonly routeId?: RouteId;
  readonly agentId?: string;
  readonly metadata?: CostEvent['metadata'];
}

function eventFor(
  scope: Ag01RuntimeCostScope,
  phase: CostEvent['phase'],
  fields: EventFields,
): CostEvent {
  return {
    eventId: eventId(scope.executionId, phase),
    executionId: scope.executionId,
    correlationId: scope.correlationId,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    organizationId: scope.organizationId,
    ...(fields.routeId ? { routeId: fields.routeId } : {}),
    ...(fields.agentId ? { agentId: fields.agentId } : {}),
    provider: 'GOOGLE_VERTEX_AI',
    model: fields.model,
    category: 'AI_TEXT',
    phase,
    priceCatalogVersion: FINOPS_PRICE_CATALOG_VERSION,
    currency: 'USD',
    ...(fields.estimatedCostMicroUsd !== undefined
      ? { estimatedCostMicroUsd: fields.estimatedCostMicroUsd }
      : {}),
    ...(fields.actualCostMicroUsd !== undefined
      ? { actualCostMicroUsd: fields.actualCostMicroUsd }
      : {}),
    usage: fields.usage,
    ...(fields.metadata ? { metadata: fields.metadata } : {}),
    createdAt: scope.startedAt,
  };
}

function eventId(executionId: string, phase: CostEvent['phase']): string {
  return `finops-ag01-${phase.toLowerCase()}-${digest(executionId)}`;
}

function reconciliationRef(status: string, executionId: string): string {
  return `finops:reconciliation:${status}:${digest(executionId)}`;
}

function opaqueHashRef(prefix: string, value: string): string {
  return `${prefix}-sha256:${digest(value)}`;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function pricedModel(value: string): AiPricedModel {
  if (!isAiPricedModel(value)) throw new Error(`FINOPS_RUNTIME_PRICE_UNKNOWN:${value}`);
  return value;
}

function safeUsage(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`FINOPS_RUNTIME_USAGE_INVALID:${field}`);
  }
  return value;
}

function validateScope(scope: Ag01RuntimeCostScope): void {
  for (const [field, value] of Object.entries(scope)) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`FINOPS_RUNTIME_SCOPE_REQUIRED:${field}`);
    }
  }
  if (Number.isNaN(new Date(scope.startedAt).getTime())) {
    throw new Error('FINOPS_RUNTIME_SCOPE_TIMESTAMP_INVALID');
  }
}
