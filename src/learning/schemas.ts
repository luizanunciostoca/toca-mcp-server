import { z } from 'zod';
import { EXPERIMENT_FACTORS, type ExperimentFactor } from './contracts.js';

function normalizeFactorValues(
  values: Readonly<Partial<Record<ExperimentFactor, string | undefined>>>,
): Readonly<Partial<Record<ExperimentFactor, string>>> {
  const normalized: Partial<Record<ExperimentFactor, string>> = {};
  for (const factor of EXPERIMENT_FACTORS) {
    const value = values[factor];
    if (value !== undefined) normalized[factor] = value;
  }
  return normalized;
}

const factorValuesSchema = z
  .object({
    creative: z.string().min(1).optional(),
    copy: z.string().min(1).optional(),
    cta: z.string().min(1).optional(),
    time: z.string().min(1).optional(),
    audience: z.string().min(1).optional(),
    placement: z.string().min(1).optional(),
    offer: z.string().min(1).optional(),
    budget: z.string().min(1).optional(),
  })
  .strict()
  .transform(normalizeFactorValues);

const metricDefinitionSchema = z.object({
  metricKey: z.string().min(1),
  type: z.enum(['RATE', 'MEAN']),
  direction: z.enum(['HIGHER_IS_BETTER', 'LOWER_IS_BETTER']),
  guardrail: z.boolean(),
});

const stopConditionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('MAX_SAMPLE_PER_VARIANT'), value: z.number().int().positive() }),
  z.object({ type: z.literal('MAX_DURATION_HOURS'), value: z.number().positive() }),
  z.object({ type: z.literal('METRIC_FLOOR'), metricKey: z.string().min(1), value: z.number() }),
  z.object({ type: z.literal('METRIC_CEILING'), metricKey: z.string().min(1), value: z.number() }),
]);

const rateMetricAggregateSchema = z.object({
  metricKey: z.string().min(1),
  type: z.literal('RATE'),
  sampleSize: z.number().int().nonnegative(),
  numerator: z.number().nonnegative(),
  denominator: z.number().nonnegative(),
});

const meanMetricAggregateSchema = z.object({
  metricKey: z.string().min(1),
  type: z.literal('MEAN'),
  sampleSize: z.number().int().nonnegative(),
  sum: z.number().finite(),
  sumSquares: z.number().nonnegative().finite(),
});

export const observationRecordSchema = z.object({
  observationId: z.string().min(1),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  organizationId: z.string().min(1),
  subjectType: z.string().min(1),
  subjectId: z.string().min(1),
  factorValues: factorValuesSchema,
  measurementRefs: z.array(z.string().min(1)),
  providerReadbackRefs: z.array(z.string().min(1)),
  occurredAt: z.iso.datetime(),
  observedAt: z.iso.datetime(),
});

export const experimentSchema = z.object({
  experimentId: z.string().min(1),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  organizationId: z.string().min(1),
  status: z.enum(['DRAFT', 'RUNNING', 'STOPPED', 'COMPLETED']),
  design: z.enum(['RANDOMIZED', 'RANDOMIZED_HOLDOUT', 'QUASI_EXPERIMENTAL', 'OBSERVATIONAL']),
  hypothesis: z.object({
    statement: z.string().min(1),
    factor: z.enum(['creative', 'copy', 'cta', 'time', 'audience', 'placement', 'offer', 'budget']),
    primaryMetricKey: z.string().min(1),
    expectedDirection: z.enum(['INCREASE', 'DECREASE']),
    rationale: z.string().min(1),
  }),
  variants: z
    .array(
      z.object({
        variantId: z.string().min(1),
        label: z.string().min(1),
        isControl: z.boolean(),
        factorValues: factorValuesSchema,
        allocationPercent: z.number().positive().max(100),
      }),
    )
    .min(2),
  primaryMetric: metricDefinitionSchema,
  secondaryMetrics: z.array(metricDefinitionSchema),
  minimumSampleSizePerVariant: z.number().int().min(2),
  minimumDistinctWindows: z.number().int().min(2),
  confidenceThreshold: z.number().min(0.8).lt(1),
  holdout: z
    .object({ variantId: z.string().min(1), allocationPercent: z.number().positive().max(100) })
    .nullable(),
  stopConditions: z.array(stopConditionSchema),
  seedRecommendationId: z.string().min(1).nullable(),
  startedAt: z.iso.datetime(),
  plannedEndAt: z.iso.datetime().nullable(),
});

export const outcomeSchema = z.object({
  outcomeId: z.string().min(1),
  experimentId: z.string().min(1),
  variantId: z.string().min(1),
  windowKey: z.string().min(1),
  metrics: z
    .array(z.discriminatedUnion('type', [rateMetricAggregateSchema, meanMetricAggregateSchema]))
    .min(1),
  measurementRefs: z.array(z.string().min(1)).min(1),
  providerReadbackRefs: z.array(z.string().min(1)),
  lineage: z.object({
    source: z.enum(['INDEPENDENT_PROVIDER_READBACK', 'MANUAL_VERIFIED', 'DERIVED_RECOMMENDATION']),
    recommendationIds: z.array(z.string().min(1)),
  }),
  measuredAt: z.iso.datetime(),
});

export const marketingAutopilotCycleEvidenceSchema = z.object({
  creativeTruthRefs: z.array(z.string().min(1)).min(1),
  assetRefs: z.array(z.string().min(1)).min(1),
  gateRefs: z.array(z.string().min(1)).min(1),
  approvalRefs: z.array(z.string().min(1)).min(1),
  scheduleOrPublishRefs: z.array(z.string().min(1)).min(1),
  providerReadbackRefs: z.array(z.string().min(1)).min(1),
  measurementRefs: z.array(z.string().min(1)).min(1),
});

export const r31LearningJobPayloadSchema = z.object({
  executionId: z.string().min(1),
  correlationId: z.string().min(1),
  actorPrincipalId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  evidence: z.array(z.string().min(1)).min(1),
  now: z.iso.datetime(),
  cycleEvidence: marketingAutopilotCycleEvidenceSchema,
  experiment: experimentSchema,
  observations: z.array(observationRecordSchema),
  outcomes: z.array(outcomeSchema).min(1),
});

export type R31LearningJobPayload = z.infer<typeof r31LearningJobPayloadSchema>;
