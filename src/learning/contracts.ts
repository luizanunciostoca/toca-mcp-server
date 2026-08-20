export const EXPERIMENT_FACTORS = [
  'creative',
  'copy',
  'cta',
  'time',
  'audience',
  'placement',
  'offer',
  'budget',
] as const;

export type ExperimentFactor = (typeof EXPERIMENT_FACTORS)[number];

export type ExperimentDesign =
  'RANDOMIZED' | 'RANDOMIZED_HOLDOUT' | 'QUASI_EXPERIMENTAL' | 'OBSERVATIONAL';

export type CausalClaimType = 'CAUSAL' | 'ASSOCIATIONAL' | 'NONE';

export interface ObservationRecord {
  readonly observationId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly factorValues: Readonly<Partial<Record<ExperimentFactor, string>>>;
  readonly measurementRefs: readonly string[];
  readonly providerReadbackRefs: readonly string[];
  readonly occurredAt: string;
  readonly observedAt: string;
}

export interface Hypothesis {
  readonly statement: string;
  readonly factor: ExperimentFactor;
  readonly primaryMetricKey: string;
  readonly expectedDirection: 'INCREASE' | 'DECREASE';
  readonly rationale: string;
}

export interface Variant {
  readonly variantId: string;
  readonly label: string;
  readonly isControl: boolean;
  readonly factorValues: Readonly<Partial<Record<ExperimentFactor, string>>>;
  readonly allocationPercent: number;
}

export interface MetricDefinition {
  readonly metricKey: string;
  readonly type: 'RATE' | 'MEAN';
  readonly direction: 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER';
  readonly guardrail: boolean;
}

export type ExperimentStopCondition =
  | { readonly type: 'MAX_SAMPLE_PER_VARIANT'; readonly value: number }
  | { readonly type: 'MAX_DURATION_HOURS'; readonly value: number }
  | {
      readonly type: 'METRIC_FLOOR';
      readonly metricKey: string;
      readonly value: number;
    }
  | {
      readonly type: 'METRIC_CEILING';
      readonly metricKey: string;
      readonly value: number;
    };

export interface ExperimentHoldout {
  readonly variantId: string;
  readonly allocationPercent: number;
}

export interface Experiment {
  readonly experimentId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly status: 'DRAFT' | 'RUNNING' | 'STOPPED' | 'COMPLETED';
  readonly design: ExperimentDesign;
  readonly hypothesis: Hypothesis;
  readonly variants: readonly Variant[];
  readonly primaryMetric: MetricDefinition;
  readonly secondaryMetrics: readonly MetricDefinition[];
  readonly minimumSampleSizePerVariant: number;
  readonly minimumDistinctWindows: number;
  readonly confidenceThreshold: number;
  readonly holdout: ExperimentHoldout | null;
  readonly stopConditions: readonly ExperimentStopCondition[];
  readonly seedRecommendationId: string | null;
  readonly startedAt: string;
  readonly plannedEndAt: string | null;
}

export interface RateMetricAggregate {
  readonly metricKey: string;
  readonly type: 'RATE';
  readonly sampleSize: number;
  readonly numerator: number;
  readonly denominator: number;
}

export interface MeanMetricAggregate {
  readonly metricKey: string;
  readonly type: 'MEAN';
  readonly sampleSize: number;
  readonly sum: number;
  readonly sumSquares: number;
}

export type MetricAggregate = RateMetricAggregate | MeanMetricAggregate;

export interface OutcomeLineage {
  readonly source: 'INDEPENDENT_PROVIDER_READBACK' | 'MANUAL_VERIFIED' | 'DERIVED_RECOMMENDATION';
  readonly recommendationIds: readonly string[];
}

export interface Outcome {
  readonly outcomeId: string;
  readonly experimentId: string;
  readonly variantId: string;
  readonly windowKey: string;
  readonly metrics: readonly MetricAggregate[];
  readonly measurementRefs: readonly string[];
  readonly providerReadbackRefs: readonly string[];
  readonly lineage: OutcomeLineage;
  readonly measuredAt: string;
}

export interface Decision {
  readonly decisionId: string;
  readonly experimentId: string;
  readonly status:
    | 'CONTINUE'
    | 'STOP_WINNER'
    | 'STOP_GUARDRAIL'
    | 'STOP_LIMIT'
    | 'INSUFFICIENT_EVIDENCE'
    | 'BLOCKED_FEEDBACK_LOOP';
  readonly selectedVariantId: string | null;
  readonly claimType: CausalClaimType;
  readonly confidence: number | null;
  readonly effectEstimate: number | null;
  readonly sampleSizeByVariant: Readonly<Record<string, number>>;
  readonly distinctWindowsByVariant: Readonly<Record<string, number>>;
  readonly reason: string;
  readonly evidenceRefs: readonly string[];
  readonly decidedAt: string;
}

export interface LearningRecommendation {
  readonly recommendationId: string;
  readonly experimentId: string;
  readonly decisionId: string;
  readonly factor: ExperimentFactor;
  readonly recommendedVariantId: string;
  readonly claimType: Exclude<CausalClaimType, 'NONE'>;
  readonly confidence: number;
  readonly effectEstimate: number;
  readonly evidenceRefs: readonly string[];
  readonly nextAction: 'APPLY_TO_NEXT_PLAN' | 'REQUEST_BUDGET_APPROVAL';
  readonly requiresApproval: boolean;
  readonly financialWriteAllowed: false;
  readonly generatedAt: string;
}

export interface LearningEvaluation {
  readonly decision: Decision;
  readonly recommendation: LearningRecommendation | null;
}
