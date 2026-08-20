import { createHash } from 'node:crypto';
import type {
  Decision,
  Experiment,
  LearningEvaluation,
  LearningRecommendation,
  MeanMetricAggregate,
  MetricAggregate,
  Outcome,
  RateMetricAggregate,
  Variant,
} from './contracts.js';

interface AggregateSummary {
  readonly variantId: string;
  readonly value: number;
  readonly sampleSize: number;
  readonly variance: number | null;
  readonly windows: number;
  readonly evidenceRefs: readonly string[];
}

export interface EvaluateExperimentInput {
  readonly experiment: Experiment;
  readonly outcomes: readonly Outcome[];
  readonly now: string;
}

export function evaluateExperiment(input: EvaluateExperimentInput): LearningEvaluation {
  validateExperiment(input.experiment);
  assertTimestamp(input.now, 'R31_NOW_INVALID');

  const relevant = input.outcomes.filter(
    (outcome) => outcome.experimentId === input.experiment.experimentId,
  );
  validateOutcomes(input.experiment, relevant);

  const summaries = input.experiment.variants.map((variant) =>
    summarizeVariant(input.experiment, variant, relevant),
  );
  const sampleSizeByVariant = Object.fromEntries(
    summaries.map((summary) => [summary.variantId, summary.sampleSize]),
  );
  const distinctWindowsByVariant = Object.fromEntries(
    summaries.map((summary) => [summary.variantId, summary.windows]),
  );
  const evidenceRefs = uniqueSorted(summaries.flatMap((summary) => summary.evidenceRefs));
  const decisionId = deterministicId(
    'r31_decision',
    input.experiment.experimentId,
    relevant.map((outcome) => outcome.outcomeId),
  );

  if (hasFeedbackLoop(input.experiment, relevant)) {
    return {
      decision: {
        decisionId,
        experimentId: input.experiment.experimentId,
        status: 'BLOCKED_FEEDBACK_LOOP',
        selectedVariantId: null,
        claimType: 'NONE',
        confidence: null,
        effectEstimate: null,
        sampleSizeByVariant,
        distinctWindowsByVariant,
        reason: 'Outcome lineage is derived from a recommendation in the same learning chain.',
        evidenceRefs,
        decidedAt: input.now,
      },
      recommendation: null,
    };
  }

  const guardrailReason = evaluateGuardrails(input.experiment, relevant);
  if (guardrailReason) {
    return {
      decision: {
        decisionId,
        experimentId: input.experiment.experimentId,
        status: 'STOP_GUARDRAIL',
        selectedVariantId: null,
        claimType: 'NONE',
        confidence: null,
        effectEstimate: null,
        sampleSizeByVariant,
        distinctWindowsByVariant,
        reason: guardrailReason,
        evidenceRefs,
        decidedAt: input.now,
      },
      recommendation: null,
    };
  }

  const enoughEvidence = summaries.every(
    (summary) =>
      summary.sampleSize >= input.experiment.minimumSampleSizePerVariant &&
      summary.windows >= input.experiment.minimumDistinctWindows,
  );
  if (!enoughEvidence) {
    return {
      decision: {
        decisionId,
        experimentId: input.experiment.experimentId,
        status: 'INSUFFICIENT_EVIDENCE',
        selectedVariantId: null,
        claimType: 'NONE',
        confidence: null,
        effectEstimate: null,
        sampleSizeByVariant,
        distinctWindowsByVariant,
        reason: 'Minimum sample size and distinct measurement-window requirements are not met.',
        evidenceRefs,
        decidedAt: input.now,
      },
      recommendation: null,
    };
  }

  const control = summaries.find(
    (summary) =>
      input.experiment.variants.find((variant) => variant.variantId === summary.variantId)
        ?.isControl,
  );
  if (!control) throw new Error('R31_CONTROL_VARIANT_MISSING');
  const candidates = summaries.filter((summary) => summary.variantId !== control.variantId);
  const best = candidates.reduce((current, candidate) =>
    isBetter(input.experiment.primaryMetric.direction, candidate.value, current.value)
      ? candidate
      : current,
  );
  const comparison = compare(control, best, input.experiment.primaryMetric.type);
  const winnerIsBetter = isBetter(
    input.experiment.primaryMetric.direction,
    best.value,
    control.value,
  );
  const claimType = deriveClaimType(input.experiment, relevant);
  const reachedConfidence = comparison.confidence >= input.experiment.confidenceThreshold;

  if (winnerIsBetter && reachedConfidence) {
    const decision: Decision = {
      decisionId,
      experimentId: input.experiment.experimentId,
      status: 'STOP_WINNER',
      selectedVariantId: best.variantId,
      claimType,
      confidence: comparison.confidence,
      effectEstimate: comparison.effectEstimate,
      sampleSizeByVariant,
      distinctWindowsByVariant,
      reason:
        claimType === 'CAUSAL'
          ? 'Randomized evidence meets the configured confidence threshold.'
          : 'Associational evidence meets the configured confidence threshold; causality is not claimed.',
      evidenceRefs,
      decidedAt: input.now,
    };
    return {
      decision,
      recommendation: buildRecommendation(input.experiment, decision, input.now),
    };
  }

  const stopLimit = evaluateStopLimits(input.experiment, summaries, input.now);
  const continuationReason =
    stopLimit ?? 'Evidence is adequate to evaluate, but no winner meets the stop criteria yet.';
  return {
    decision: {
      decisionId,
      experimentId: input.experiment.experimentId,
      status: stopLimit ? 'STOP_LIMIT' : 'CONTINUE',
      selectedVariantId: null,
      claimType: 'NONE',
      confidence: comparison.confidence,
      effectEstimate: comparison.effectEstimate,
      sampleSizeByVariant,
      distinctWindowsByVariant,
      reason: continuationReason,
      evidenceRefs,
      decidedAt: input.now,
    },
    recommendation: null,
  };
}

function buildRecommendation(
  experiment: Experiment,
  decision: Decision,
  now: string,
): LearningRecommendation {
  if (
    !decision.selectedVariantId ||
    decision.claimType === 'NONE' ||
    decision.confidence === null ||
    decision.effectEstimate === null
  ) {
    throw new Error('R31_RECOMMENDATION_DECISION_INVALID');
  }
  const financial = experiment.hypothesis.factor === 'budget';
  const recommendationId = deterministicId('r31_recommendation', experiment.experimentId, [
    decision.decisionId,
  ]);
  return {
    recommendationId,
    experimentId: experiment.experimentId,
    decisionId: decision.decisionId,
    factor: experiment.hypothesis.factor,
    recommendedVariantId: decision.selectedVariantId,
    claimType: decision.claimType,
    confidence: decision.confidence,
    effectEstimate: decision.effectEstimate,
    evidenceRefs: decision.evidenceRefs,
    nextAction: financial ? 'REQUEST_BUDGET_APPROVAL' : 'APPLY_TO_NEXT_PLAN',
    requiresApproval: financial,
    financialWriteAllowed: false,
    generatedAt: now,
  };
}

function summarizeVariant(
  experiment: Experiment,
  variant: Variant,
  outcomes: readonly Outcome[],
): AggregateSummary {
  const variantOutcomes = outcomes.filter((outcome) => outcome.variantId === variant.variantId);
  const metrics = variantOutcomes
    .flatMap((outcome) => outcome.metrics)
    .filter((metric) => metric.metricKey === experiment.primaryMetric.metricKey);
  const evidenceRefs = uniqueSorted(
    variantOutcomes.flatMap((outcome) => [
      ...outcome.measurementRefs,
      ...outcome.providerReadbackRefs,
    ]),
  );
  const windows = new Set(variantOutcomes.map((outcome) => outcome.windowKey)).size;
  const aggregate = mergeMetrics(metrics, experiment.primaryMetric.type);
  return {
    variantId: variant.variantId,
    value: aggregate.value,
    sampleSize: aggregate.sampleSize,
    variance: aggregate.variance,
    windows,
    evidenceRefs,
  };
}

function mergeMetrics(
  metrics: readonly MetricAggregate[],
  type: 'RATE' | 'MEAN',
): { readonly value: number; readonly sampleSize: number; readonly variance: number | null } {
  if (type === 'RATE') {
    const rateMetrics = metrics.filter(
      (metric): metric is RateMetricAggregate => metric.type === 'RATE',
    );
    const numerator = rateMetrics.reduce((sum, metric) => sum + metric.numerator, 0);
    const denominator = rateMetrics.reduce((sum, metric) => sum + metric.denominator, 0);
    return {
      value: denominator === 0 ? 0 : numerator / denominator,
      sampleSize: denominator,
      variance: null,
    };
  }
  const meanMetrics = metrics.filter(
    (metric): metric is MeanMetricAggregate => metric.type === 'MEAN',
  );
  const sampleSize = meanMetrics.reduce((sum, metric) => sum + metric.sampleSize, 0);
  const sum = meanMetrics.reduce((total, metric) => total + metric.sum, 0);
  const sumSquares = meanMetrics.reduce((total, metric) => total + metric.sumSquares, 0);
  const value = sampleSize === 0 ? 0 : sum / sampleSize;
  const variance =
    sampleSize > 1 ? Math.max(0, (sumSquares - (sum * sum) / sampleSize) / (sampleSize - 1)) : null;
  return { value, sampleSize, variance };
}

function compare(
  control: AggregateSummary,
  candidate: AggregateSummary,
  metricType: 'RATE' | 'MEAN',
): { readonly confidence: number; readonly effectEstimate: number } {
  const effectEstimate = candidate.value - control.value;
  if (metricType === 'RATE') {
    const pooledNumerator =
      control.value * control.sampleSize + candidate.value * candidate.sampleSize;
    const pooledDenominator = control.sampleSize + candidate.sampleSize;
    if (pooledDenominator === 0) return { confidence: 0, effectEstimate };
    const pooled = pooledNumerator / pooledDenominator;
    const standardError = Math.sqrt(
      pooled * (1 - pooled) * (1 / control.sampleSize + 1 / candidate.sampleSize),
    );
    if (standardError === 0) {
      return { confidence: effectEstimate === 0 ? 0 : 1, effectEstimate };
    }
    return { confidence: twoSidedConfidence(effectEstimate / standardError), effectEstimate };
  }

  if (control.variance === null || candidate.variance === null) {
    return { confidence: 0, effectEstimate };
  }
  const standardError = Math.sqrt(
    control.variance / control.sampleSize + candidate.variance / candidate.sampleSize,
  );
  if (standardError === 0) return { confidence: effectEstimate === 0 ? 0 : 1, effectEstimate };
  return { confidence: twoSidedConfidence(effectEstimate / standardError), effectEstimate };
}

function twoSidedConfidence(z: number): number {
  const p = 2 * (1 - normalCdf(Math.abs(z)));
  return clamp(1 - p, 0, 1);
}

function normalCdf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const coefficients = [1.061405429, -1.453152027, 1.421413741, -0.284496736, 0.254829592] as const;
  const polynomial =
    ((((coefficients[0] * t + coefficients[1]) * t + coefficients[2]) * t + coefficients[3]) * t +
      coefficients[4]) *
    t;
  const erf = sign * (1 - polynomial * Math.exp(-x * x));
  return 0.5 * (1 + erf);
}

function deriveClaimType(
  experiment: Experiment,
  outcomes: readonly Outcome[],
): 'CAUSAL' | 'ASSOCIATIONAL' {
  const randomized =
    experiment.design === 'RANDOMIZED' || experiment.design === 'RANDOMIZED_HOLDOUT';
  const independent = outcomes.every(
    (outcome) =>
      outcome.lineage.source === 'INDEPENDENT_PROVIDER_READBACK' &&
      outcome.providerReadbackRefs.length > 0,
  );
  return randomized && independent ? 'CAUSAL' : 'ASSOCIATIONAL';
}

function hasFeedbackLoop(experiment: Experiment, outcomes: readonly Outcome[]): boolean {
  return outcomes.some(
    (outcome) =>
      outcome.lineage.source === 'DERIVED_RECOMMENDATION' ||
      (experiment.seedRecommendationId !== null &&
        outcome.lineage.recommendationIds.includes(experiment.seedRecommendationId)),
  );
}

function evaluateStopLimits(
  experiment: Experiment,
  summaries: readonly AggregateSummary[],
  now: string,
): string | null {
  for (const condition of experiment.stopConditions) {
    if (
      condition.type === 'MAX_SAMPLE_PER_VARIANT' &&
      summaries.every((summary) => summary.sampleSize >= condition.value)
    ) {
      return `Maximum sample per variant reached (${condition.value}) without a qualified winner.`;
    }
    if (condition.type === 'MAX_DURATION_HOURS') {
      const elapsedHours = (Date.parse(now) - Date.parse(experiment.startedAt)) / 3_600_000;
      if (elapsedHours >= condition.value) {
        return `Maximum experiment duration reached (${condition.value}h) without a qualified winner.`;
      }
    }
  }
  return null;
}

function evaluateGuardrails(experiment: Experiment, outcomes: readonly Outcome[]): string | null {
  const conditions = experiment.stopConditions.filter(
    (condition) => condition.type === 'METRIC_FLOOR' || condition.type === 'METRIC_CEILING',
  );
  for (const condition of conditions) {
    for (const variant of experiment.variants) {
      const metrics = outcomes
        .filter((outcome) => outcome.variantId === variant.variantId)
        .flatMap((outcome) => outcome.metrics)
        .filter((metric) => metric.metricKey === condition.metricKey);
      if (metrics.length === 0) continue;
      const metricType = metrics[0]?.type;
      if (!metricType) continue;
      const aggregate = mergeMetrics(metrics, metricType);
      if (condition.type === 'METRIC_FLOOR' && aggregate.value < condition.value) {
        return `Guardrail floor breached for ${condition.metricKey} by variant ${variant.variantId}.`;
      }
      if (condition.type === 'METRIC_CEILING' && aggregate.value > condition.value) {
        return `Guardrail ceiling breached for ${condition.metricKey} by variant ${variant.variantId}.`;
      }
    }
  }
  return null;
}

function validateExperiment(experiment: Experiment): void {
  requireText(experiment.experimentId, 'R31_EXPERIMENT_ID_REQUIRED');
  requireText(experiment.tenantId, 'R31_TENANT_ID_REQUIRED');
  requireText(experiment.workspaceId, 'R31_WORKSPACE_ID_REQUIRED');
  requireText(experiment.organizationId, 'R31_ORGANIZATION_ID_REQUIRED');
  requireText(experiment.hypothesis.statement, 'R31_HYPOTHESIS_REQUIRED');
  requireText(experiment.primaryMetric.metricKey, 'R31_PRIMARY_METRIC_REQUIRED');
  assertTimestamp(experiment.startedAt, 'R31_STARTED_AT_INVALID');
  if (experiment.plannedEndAt !== null) {
    assertTimestamp(experiment.plannedEndAt, 'R31_END_AT_INVALID');
  }
  if (experiment.variants.length < 2) throw new Error('R31_VARIANTS_MINIMUM_TWO');
  if (experiment.variants.filter((variant) => variant.isControl).length !== 1) {
    throw new Error('R31_CONTROL_VARIANT_EXACTLY_ONE');
  }
  if (
    !Number.isInteger(experiment.minimumSampleSizePerVariant) ||
    experiment.minimumSampleSizePerVariant < 2
  ) {
    throw new Error('R31_MIN_SAMPLE_INVALID');
  }
  if (
    !Number.isInteger(experiment.minimumDistinctWindows) ||
    experiment.minimumDistinctWindows < 2
  ) {
    throw new Error('R31_MIN_WINDOWS_INVALID');
  }
  if (experiment.confidenceThreshold < 0.8 || experiment.confidenceThreshold >= 1) {
    throw new Error('R31_CONFIDENCE_THRESHOLD_INVALID');
  }
  const allocation = experiment.variants.reduce(
    (sum, variant) => sum + variant.allocationPercent,
    0,
  );
  if (Math.abs(allocation - 100) > 0.001) throw new Error('R31_VARIANT_ALLOCATION_INVALID');
  if (experiment.design === 'RANDOMIZED_HOLDOUT') {
    if (!experiment.holdout) throw new Error('R31_HOLDOUT_REQUIRED');
    const holdoutVariant = experiment.variants.find(
      (variant) => variant.variantId === experiment.holdout?.variantId,
    );
    if (!holdoutVariant || !holdoutVariant.isControl) {
      throw new Error('R31_HOLDOUT_CONTROL_REQUIRED');
    }
  }
}

function validateOutcomes(experiment: Experiment, outcomes: readonly Outcome[]): void {
  const variants = new Set(experiment.variants.map((variant) => variant.variantId));
  for (const outcome of outcomes) {
    requireText(outcome.outcomeId, 'R31_OUTCOME_ID_REQUIRED');
    if (!variants.has(outcome.variantId)) throw new Error('R31_OUTCOME_VARIANT_UNKNOWN');
    requireText(outcome.windowKey, 'R31_OUTCOME_WINDOW_REQUIRED');
    assertTimestamp(outcome.measuredAt, 'R31_OUTCOME_MEASURED_AT_INVALID');
    for (const metric of outcome.metrics) validateMetricAggregate(metric);
  }
}

function validateMetricAggregate(metric: MetricAggregate): void {
  requireText(metric.metricKey, 'R31_METRIC_KEY_REQUIRED');
  if (!Number.isInteger(metric.sampleSize) || metric.sampleSize < 0) {
    throw new Error('R31_METRIC_SAMPLE_INVALID');
  }
  if (metric.type === 'RATE') {
    if (
      !Number.isFinite(metric.numerator) ||
      !Number.isFinite(metric.denominator) ||
      metric.numerator < 0 ||
      metric.denominator < 0 ||
      metric.numerator > metric.denominator ||
      metric.sampleSize !== metric.denominator
    ) {
      throw new Error('R31_RATE_METRIC_INVALID');
    }
  } else if (
    !Number.isFinite(metric.sum) ||
    !Number.isFinite(metric.sumSquares) ||
    metric.sumSquares < 0
  ) {
    throw new Error('R31_MEAN_METRIC_INVALID');
  }
}

function isBetter(
  direction: 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER',
  candidate: number,
  current: number,
): boolean {
  return direction === 'HIGHER_IS_BETTER' ? candidate > current : candidate < current;
}

function deterministicId(prefix: string, experimentId: string, parts: readonly string[]): string {
  const canonical = [experimentId, ...[...parts].sort()].join('|');
  return `${prefix}_${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}

function requireText(value: string, code: string): string {
  if (!value.trim()) throw new Error(code);
  return value.trim();
}

function assertTimestamp(value: string, code: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(code);
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
