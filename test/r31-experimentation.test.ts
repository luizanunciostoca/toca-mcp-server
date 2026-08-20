import { describe, expect, it } from 'vitest';
import type { Experiment, ExperimentFactor, Outcome } from '../src/learning/contracts.js';
import { evaluateExperiment } from '../src/learning/experimentation-engine.js';

function experiment(
  input: {
    factor?: ExperimentFactor;
    design?: Experiment['design'];
    seedRecommendationId?: string | null;
  } = {},
): Experiment {
  const factor = input.factor ?? 'creative';
  return {
    experimentId: `exp-${factor}`,
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    organizationId: 'org-1',
    status: 'RUNNING',
    design: input.design ?? 'RANDOMIZED_HOLDOUT',
    hypothesis: {
      statement: `${factor} variant B improves conversion`,
      factor,
      primaryMetricKey: 'conversion_rate',
      expectedDirection: 'INCREASE',
      rationale: 'Test one controlled factor using independent provider readback.',
    },
    variants: [
      {
        variantId: 'control',
        label: 'Control',
        isControl: true,
        factorValues: { [factor]: 'A' },
        allocationPercent: 50,
      },
      {
        variantId: 'variant-b',
        label: 'Variant B',
        isControl: false,
        factorValues: { [factor]: 'B' },
        allocationPercent: 50,
      },
    ],
    primaryMetric: {
      metricKey: 'conversion_rate',
      type: 'RATE',
      direction: 'HIGHER_IS_BETTER',
      guardrail: false,
    },
    secondaryMetrics: [],
    minimumSampleSizePerVariant: 100,
    minimumDistinctWindows: 2,
    confidenceThreshold: 0.95,
    holdout: { variantId: 'control', allocationPercent: 50 },
    stopConditions: [{ type: 'MAX_SAMPLE_PER_VARIANT', value: 1000 }],
    seedRecommendationId: input.seedRecommendationId ?? null,
    startedAt: '2026-08-20T01:00:00.000Z',
    plannedEndAt: '2026-08-22T01:00:00.000Z',
  };
}

function rateOutcome(input: {
  experimentId?: string;
  outcomeId: string;
  variantId: string;
  windowKey: string;
  numerator: number;
  denominator: number;
  source?: Outcome['lineage']['source'];
  recommendationIds?: readonly string[];
}): Outcome {
  return {
    outcomeId: input.outcomeId,
    experimentId: input.experimentId ?? 'exp-creative',
    variantId: input.variantId,
    windowKey: input.windowKey,
    metrics: [
      {
        metricKey: 'conversion_rate',
        type: 'RATE',
        sampleSize: input.denominator,
        numerator: input.numerator,
        denominator: input.denominator,
      },
    ],
    measurementRefs: [`measurement:${input.outcomeId}`],
    providerReadbackRefs: [`provider:${input.outcomeId}`],
    lineage: {
      source: input.source ?? 'INDEPENDENT_PROVIDER_READBACK',
      recommendationIds: input.recommendationIds ?? [],
    },
    measuredAt: '2026-08-20T03:00:00.000Z',
  };
}

function strongOutcomes(experimentId = 'exp-creative'): readonly Outcome[] {
  return [
    rateOutcome({
      experimentId,
      outcomeId: 'c1',
      variantId: 'control',
      windowKey: 'w1',
      numerator: 10,
      denominator: 50,
    }),
    rateOutcome({
      experimentId,
      outcomeId: 'c2',
      variantId: 'control',
      windowKey: 'w2',
      numerator: 10,
      denominator: 50,
    }),
    rateOutcome({
      experimentId,
      outcomeId: 'b1',
      variantId: 'variant-b',
      windowKey: 'w1',
      numerator: 25,
      denominator: 50,
    }),
    rateOutcome({
      experimentId,
      outcomeId: 'b2',
      variantId: 'variant-b',
      windowKey: 'w2',
      numerator: 25,
      denominator: 50,
    }),
  ];
}

describe('R31 experimentation and learning engine', () => {
  it('creates a causal recommendation only after adequate randomized independent evidence', () => {
    const result = evaluateExperiment({
      experiment: experiment(),
      outcomes: strongOutcomes(),
      now: '2026-08-20T04:00:00.000Z',
    });

    expect(result.decision).toMatchObject({
      status: 'STOP_WINNER',
      selectedVariantId: 'variant-b',
      claimType: 'CAUSAL',
    });
    expect(result.decision.confidence).toBeGreaterThanOrEqual(0.95);
    expect(result.recommendation).toMatchObject({
      factor: 'creative',
      recommendedVariantId: 'variant-b',
      claimType: 'CAUSAL',
      nextAction: 'APPLY_TO_NEXT_PLAN',
      requiresApproval: false,
      financialWriteAllowed: false,
    });
  });

  it('refuses single-window learning even with a large apparent lift', () => {
    const outcomes = strongOutcomes().filter((outcome) => outcome.windowKey === 'w1');
    const result = evaluateExperiment({
      experiment: { ...experiment(), minimumSampleSizePerVariant: 50 },
      outcomes,
      now: '2026-08-20T04:00:00.000Z',
    });

    expect(result.decision.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(result.recommendation).toBeNull();
  });

  it('labels observational evidence as associational instead of causal', () => {
    const result = evaluateExperiment({
      experiment: { ...experiment({ design: 'OBSERVATIONAL' }), holdout: null },
      outcomes: strongOutcomes(),
      now: '2026-08-20T04:00:00.000Z',
    });

    expect(result.decision).toMatchObject({
      status: 'STOP_WINNER',
      claimType: 'ASSOCIATIONAL',
    });
    expect(result.recommendation?.claimType).toBe('ASSOCIATIONAL');
  });

  it('blocks feedback-loop contamination from recommendation-derived outcomes', () => {
    const base = strongOutcomes();
    const contaminated = base.map((outcome, index) =>
      index === 0
        ? {
            ...outcome,
            lineage: {
              source: 'DERIVED_RECOMMENDATION' as const,
              recommendationIds: ['recommendation-seed'],
            },
          }
        : outcome,
    );
    const result = evaluateExperiment({
      experiment: experiment({ seedRecommendationId: 'recommendation-seed' }),
      outcomes: contaminated,
      now: '2026-08-20T04:00:00.000Z',
    });

    expect(result.decision.status).toBe('BLOCKED_FEEDBACK_LOOP');
    expect(result.recommendation).toBeNull();
  });

  it('never turns a budget result into an unrestricted financial write', () => {
    const budgetExperiment = experiment({ factor: 'budget' });
    const result = evaluateExperiment({
      experiment: budgetExperiment,
      outcomes: strongOutcomes(budgetExperiment.experimentId),
      now: '2026-08-20T04:00:00.000Z',
    });

    expect(result.recommendation).toMatchObject({
      factor: 'budget',
      nextAction: 'REQUEST_BUDGET_APPROVAL',
      requiresApproval: true,
      financialWriteAllowed: false,
    });
  });
});
