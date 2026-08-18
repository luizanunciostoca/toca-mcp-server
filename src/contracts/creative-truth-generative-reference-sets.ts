import * as z from 'zod/v4';

export const LEGACY_TOCA_VENUE_REFERENCE_SET_ID = 'TOCA_VENUE_REFERENCE_SET_V1' as const;
export const TOCA_SUNSET_VENUE_REFERENCE_SET_ID =
  'TOCA_VENUE_REFERENCE_SET_SUNSET_V1' as const;
export const TOCA_THE_PARTY_VENUE_REFERENCE_SET_ID =
  'TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1' as const;

export const tocaGenerativeOperationSchema = z.enum(['SUNSET', 'THE_PARTY']);
export type TocaGenerativeOperation = z.infer<typeof tocaGenerativeOperationSchema>;

export const tocaGenerativeVenueReferenceSetIdSchema = z.enum([
  TOCA_SUNSET_VENUE_REFERENCE_SET_ID,
  TOCA_THE_PARTY_VENUE_REFERENCE_SET_ID,
]);

export type TocaGenerativeVenueReferenceSetId = z.infer<
  typeof tocaGenerativeVenueReferenceSetIdSchema
>;

export const operationScopedGenerativeExceptionApprovalSchema = z
  .object({
    exceptionId: z.string().min(1),
    contentItemId: z.string().min(1),
    requestedBy: z.string().min(1),
    approvedBy: z.string().min(1),
    approvalRef: z.string().min(1),
    reason: z.string().min(1),
    referenceSetId: tocaGenerativeVenueReferenceSetIdSchema,
    minReferenceCount: z.number().int().min(3).default(3),
    allowArchitecturalInvention: z.literal(false),
    allowEnvironmentDrift: z.literal(false),
    allowAiLogoGeneration: z.literal(false),
    status: z.enum(['APPROVED', 'REVOKED', 'EXPIRED']),
    expiresAt: z
      .string()
      .min(1)
      .refine((value) => Number.isFinite(Date.parse(value)), {
        message: 'expiresAt must be a parseable timestamp',
      })
      .optional(),
    createdAt: z.string().min(1).refine((value) => Number.isFinite(Date.parse(value)), {
      message: 'createdAt must be a parseable timestamp',
    }),
    operation: tocaGenerativeOperationSchema,
  })
  .superRefine((approval, ctx) => {
    if (referenceSetOperation(approval.referenceSetId) !== approval.operation) {
      ctx.addIssue({
        code: 'custom',
        path: ['referenceSetId'],
        message: 'FAILED_GENERATIVE_REFERENCE_SET_OPERATION_MISMATCH',
      });
    }
  });

export type OperationScopedGenerativeExceptionApproval = z.infer<
  typeof operationScopedGenerativeExceptionApprovalSchema
>;

export function isTocaGenerativeVenueReferenceSetId(
  value: string,
): value is TocaGenerativeVenueReferenceSetId {
  return tocaGenerativeVenueReferenceSetIdSchema.safeParse(value).success;
}

export function referenceSetOperation(
  referenceSetId: TocaGenerativeVenueReferenceSetId,
): TocaGenerativeOperation {
  return referenceSetId === TOCA_SUNSET_VENUE_REFERENCE_SET_ID ? 'SUNSET' : 'THE_PARTY';
}
