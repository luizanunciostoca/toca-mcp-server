import * as z from 'zod/v4';
import {
  tocaGenerativeOperationSchema,
  tocaGenerativeVenueReferenceSetIdSchema,
} from './creative-truth-generative-reference-sets.js';
import { TOCA_CREATIVE_TRUTH_POLICY_ID } from './creative-truth.js';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const operationScopedGenerativeCandidateManifestSchema = z
  .object({
    status: z.literal('GENERATED_REVIEW_REQUIRED'),
    contentItemId: z.string().min(1),
    creativeMode: z.literal('GENERATIVE_EXCEPTION'),
    policyId: z.literal(TOCA_CREATIVE_TRUTH_POLICY_ID),
    operation: tocaGenerativeOperationSchema,
    referenceSetId: tocaGenerativeVenueReferenceSetIdSchema,
    exceptionId: z.string().min(1),
    approvalRef: z.string().min(1),
    candidateSha256: sha256Schema,
    referenceAssetIds: z.array(z.string().min(1)).min(3),
    referenceSha256s: z.array(sha256Schema).min(3),
    provider: z.literal('OPENAI_IMAGE_GENERATION'),
    generationMode: z.literal(
      'FULL_STATIC_IMAGE_WITH_OPERATION_SCOPED_VERIFIED_REFERENCES',
    ),
    responseModel: z.string().min(1),
    imageToolModelSelection: z.literal('RESPONSES_TOOL_MANAGED'),
    outputContentType: z.literal('image/jpeg'),
    outputSizeBytes: z.number().int().positive().optional(),
    outputPath: z.string().min(1).optional(),
    requiresPostGenerationHumanReview: z.literal(true),
    requiresVenueFidelityGate: z.literal(true),
    readyForFinalComposition: z.literal(false),
    publicationEligible: z.literal(false),
  })
  .superRefine((manifest, context) => {
    if (manifest.referenceAssetIds.length !== manifest.referenceSha256s.length) {
      context.addIssue({
        code: 'custom',
        path: ['referenceSha256s'],
        message: 'GENERATIVE_CANDIDATE_REFERENCE_LINEAGE_LENGTH_MISMATCH',
      });
    }
    if (new Set(manifest.referenceAssetIds).size !== manifest.referenceAssetIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['referenceAssetIds'],
        message: 'GENERATIVE_CANDIDATE_REFERENCE_LINEAGE_DUPLICATE',
      });
    }
  });

export type OperationScopedGenerativeCandidateManifest = z.infer<
  typeof operationScopedGenerativeCandidateManifestSchema
>;
