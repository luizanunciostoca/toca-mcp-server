import * as z from 'zod/v4';

export const costCategorySchema = z.enum([
  'AI_TEXT',
  'AI_IMAGE',
  'AI_VIDEO',
  'COMPUTE',
  'STORAGE',
  'NETWORK',
  'MEDIA_SPEND',
  'OTHER',
]);
export type CostCategory = z.infer<typeof costCategorySchema>;

export const costEventPhaseSchema = z.enum(['ESTIMATE', 'ACTUAL', 'RECONCILIATION']);
export type CostEventPhase = z.infer<typeof costEventPhaseSchema>;

const nonNegativeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const costUsageSchema = z.object({
  inputTokens: nonNegativeInteger.optional(),
  cachedInputTokens: nonNegativeInteger.optional(),
  outputTokens: nonNegativeInteger.optional(),
  videoSeconds: nonNegativeInteger.optional(),
  imageCount: nonNegativeInteger.optional(),
  storageBytes: nonNegativeInteger.optional(),
  computeMilliseconds: nonNegativeInteger.optional(),
  providerOperations: nonNegativeInteger.optional(),
});
export type CostUsage = z.infer<typeof costUsageSchema>;

export const costEventSchema = z
  .object({
    eventId: z.string().trim().min(1),
    executionId: z.string().trim().min(1),
    correlationId: z.string().trim().min(1),
    tenantId: z.string().trim().min(1),
    workspaceId: z.string().trim().min(1),
    organizationId: z.string().trim().min(1),
    routeId: z.string().trim().min(1).optional(),
    agentId: z.string().trim().min(1).optional(),
    provider: z.string().trim().min(1),
    model: z.string().trim().min(1).optional(),
    category: costCategorySchema,
    phase: costEventPhaseSchema,
    priceCatalogVersion: z.string().trim().min(1),
    currency: z.literal('USD'),
    estimatedCostMicroUsd: nonNegativeInteger.optional(),
    actualCostMicroUsd: nonNegativeInteger.optional(),
    usage: costUsageSchema,
    contentItemId: z.string().trim().min(1).optional(),
    campaignId: z.string().trim().min(1).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    createdAt: z.iso.datetime(),
  })
  .superRefine((value, context) => {
    if (value.phase === 'ESTIMATE' && value.estimatedCostMicroUsd === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['estimatedCostMicroUsd'],
        message: 'FINOPS_ESTIMATE_COST_REQUIRED',
      });
    }
    if (value.phase === 'ACTUAL' && value.actualCostMicroUsd === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['actualCostMicroUsd'],
        message: 'FINOPS_ACTUAL_COST_REQUIRED',
      });
    }
    if (
      value.usage.cachedInputTokens !== undefined &&
      value.usage.inputTokens !== undefined &&
      value.usage.cachedInputTokens > value.usage.inputTokens
    ) {
      context.addIssue({
        code: 'custom',
        path: ['usage', 'cachedInputTokens'],
        message: 'FINOPS_CACHED_INPUT_EXCEEDS_INPUT',
      });
    }
  });

export type CostEvent = z.infer<typeof costEventSchema>;

export function parseCostEvent(value: unknown): CostEvent {
  return costEventSchema.parse(value);
}
