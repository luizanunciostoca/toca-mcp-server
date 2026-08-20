import type { Experiment, ObservationRecord, Outcome } from '../learning/contracts.js';
import { R31LearningEngine } from '../learning/learning-engine.js';
import { assertLearningBoundary } from '../learning/marketing-autopilot-cycle.js';
import { r31LearningJobPayloadSchema, type R31LearningJobPayload } from '../learning/schemas.js';
import type { LearningRecordStore, LearningRecordType } from '../learning/store.js';
import type { JobHandler } from './worker.js';

export const R31_LEARNING_TOOL_NAME = 'marketing.autopilot.r31.learn';

export interface MarketingAutopilotR31HandlerOptions {
  readonly store: LearningRecordStore;
  readonly engine?: R31LearningEngine;
}

export class MarketingAutopilotR31Handler implements JobHandler {
  readonly #engine: R31LearningEngine;

  constructor(private readonly options: MarketingAutopilotR31HandlerOptions) {
    this.#engine = options.engine ?? new R31LearningEngine();
  }

  async execute(payload: unknown): Promise<void> {
    const input = r31LearningJobPayloadSchema.parse(payload);
    assertLearningBoundary(input.cycleEvidence);
    assertScopeConsistency(input);

    await this.#append('EXPERIMENT', input.experiment.experimentId, input.experiment, input);
    for (const observation of input.observations) {
      await this.#append('OBSERVATION', observation.observationId, observation, input);
    }
    for (const outcome of input.outcomes) {
      await this.#append('OUTCOME', outcome.outcomeId, outcome, input);
    }

    const evaluation = this.#engine.evaluate({
      experiment: input.experiment,
      outcomes: input.outcomes,
      now: input.now,
    });
    await this.#append('DECISION', evaluation.decision.decisionId, evaluation.decision, input);
    if (evaluation.recommendation) {
      await this.#append(
        'RECOMMENDATION',
        evaluation.recommendation.recommendationId,
        evaluation.recommendation,
        input,
      );
    }
  }

  async #append(
    recordType: LearningRecordType,
    recordId: string,
    recordPayload: unknown,
    input: R31LearningJobPayload,
  ): Promise<void> {
    const experimentId = input.experiment.experimentId;
    await this.options.store.append({
      recordId,
      recordType,
      tenantId: input.experiment.tenantId,
      workspaceId: input.experiment.workspaceId,
      organizationId: input.experiment.organizationId,
      experimentId,
      idempotencyKey: `${input.idempotencyKey}:${recordType.toLowerCase()}:${recordId}`,
      payload: recordPayload,
      createdAt: input.now,
      executionId: input.executionId,
      correlationId: input.correlationId,
      actorPrincipalId: input.actorPrincipalId,
      evidence: mergeEvidence(input),
    });
  }
}

export function withMarketingAutopilotR31Handler(
  handlers: ReadonlyMap<string, JobHandler>,
  handler: MarketingAutopilotR31Handler,
): ReadonlyMap<string, JobHandler> {
  const next = new Map(handlers);
  if (next.has(R31_LEARNING_TOOL_NAME)) throw new Error('R31_HANDLER_ALREADY_REGISTERED');
  next.set(R31_LEARNING_TOOL_NAME, handler);
  return next;
}

function assertScopeConsistency(input: R31LearningJobPayload): void {
  const experiment = input.experiment;
  for (const observation of input.observations) {
    if (!sameScope(experiment, observation)) throw new Error('R31_OBSERVATION_SCOPE_MISMATCH');
  }
  for (const outcome of input.outcomes) {
    if (outcome.experimentId !== experiment.experimentId) {
      throw new Error('R31_OUTCOME_EXPERIMENT_MISMATCH');
    }
  }
}

function sameScope(experiment: Experiment, observation: ObservationRecord): boolean {
  return (
    experiment.tenantId === observation.tenantId &&
    experiment.workspaceId === observation.workspaceId &&
    experiment.organizationId === observation.organizationId
  );
}

function mergeEvidence(input: R31LearningJobPayload): readonly string[] {
  return [
    ...new Set([
      ...input.evidence,
      ...input.cycleEvidence.creativeTruthRefs,
      ...input.cycleEvidence.assetRefs,
      ...input.cycleEvidence.gateRefs,
      ...input.cycleEvidence.approvalRefs,
      ...input.cycleEvidence.scheduleOrPublishRefs,
      ...input.cycleEvidence.providerReadbackRefs,
      ...input.cycleEvidence.measurementRefs,
      ...input.outcomes.flatMap((outcome: Outcome) => [
        ...outcome.measurementRefs,
        ...outcome.providerReadbackRefs,
      ]),
    ]),
  ].sort();
}
