import * as z from 'zod/v4';

export const contentStatusSchema = z.enum([
  'IDEA',
  'BRIEFED',
  'IN_PRODUCTION',
  'REVIEW',
  'APPROVED',
  'SCHEDULED',
  'PUBLISHED',
  'MEASURED',
  'ARCHIVED',
  'CANCELED',
]);

export const executionContextSchema = z.object({
  brand: z.string().min(1),
  businessDomain: z.string().min(1),
  productOrEvent: z.string().min(1).optional(),
  eventDate: z.iso.date().optional(),
  campaignId: z.string().min(1).optional(),
  connectedAccountRef: z.string().min(1).optional(),
  adAccountRef: z.string().min(1).optional(),
  contentStatus: contentStatusSchema.optional(),
  budgetAuthorized: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  timezone: z.string().min(1),
  correlationId: z.string().min(1),
  assetRef: z.string().min(1).optional(),
});

export type ExecutionContext = z.infer<typeof executionContextSchema>;

export function parseExecutionContext(input: unknown): ExecutionContext {
  return executionContextSchema.parse(input);
}
