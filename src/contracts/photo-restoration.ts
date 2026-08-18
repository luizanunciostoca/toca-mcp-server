import { z } from 'zod';

export const TOCA_PHOTO_RESTORATION_POLICY_ID = 'TOCA_PHOTO_RESTORATION_POLICY_V1' as const;
export const SOURCE_FAITHFUL_CINEMATIC_RESTORATION_PROFILE =
  'SOURCE_FAITHFUL_CINEMATIC_RESTORATION_V1' as const;
export const MASTER_PROMOTION_GUARD_VERSION = 'master-promotion-guard-v1' as const;

export const restorationConfidenceSchema = z.enum(['HIGH', 'REVIEW_REQUIRED', 'NOT_APPLICABLE']);
export type RestorationConfidence = z.infer<typeof restorationConfidenceSchema>;

export const stillMasterFormatSchema = z.enum([
  'JPEG_HIGH_QUALITY_4K',
  'PNG_LOSSLESS_4K',
  'TIFF_MASTER_4K',
]);
export type StillMasterFormat = z.infer<typeof stillMasterFormatSchema>;

export const photoRestorationEvidenceSchema = z.object({
  policyId: z.literal(TOCA_PHOTO_RESTORATION_POLICY_ID),
  restorationProfile: z.literal(SOURCE_FAITHFUL_CINEMATIC_RESTORATION_PROFILE),
  pipelineVersion: z.literal('local-photo-enhancer-v2'),
  sourceAssetId: z.string().min(1),
  sourceDriveFileId: z.string().min(1),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  outputSha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourceImageBound: z.literal(true),
  identityLock: z.literal(true),
  compositionLock: z.literal(true),
  structureLock: z.literal(true),
  backgroundLock: z.literal(true),
  generativeDetailSynthesisUsed: z.literal(false),
  semanticAlterationDetected: z.literal(false),
  restorationConfidence: restorationConfidenceSchema,
  textDetailConfidence: restorationConfidenceSchema,
  iconDetailConfidence: restorationConfidenceSchema,
  microDetailConfidence: restorationConfidenceSchema,
  outputLongEdgePixels: z.number().int().positive(),
  stillMasterFormat: stillMasterFormatSchema,
  proResApplicability: z.literal('VIDEO_ONLY_NOT_APPLICABLE_TO_STILL'),
  reviewRequiredReason: z.string().optional(),
});
export type PhotoRestorationEvidence = z.infer<typeof photoRestorationEvidenceSchema>;

export const masterPromotionEvidenceSchema = photoRestorationEvidenceSchema.extend({
  masterAssetId: z.string().min(1),
  masterDriveFileId: z.string().min(1),
  qualityGate: z.literal('PASSED'),
  brandGate: z.literal('PASSED'),
  venueFidelityGate: z.literal('PASSED'),
  promotionStatus: z.literal('APPROVED_FOR_MARKETING'),
  targetFolderClass: z.literal('07_PRONTOS_PARA_MARKETING'),
  promotionReviewedBy: z.string().min(1),
  promotionReviewedAt: z.string().min(1),
  promotionDecisionReason: z.string().min(1),
});
export type MasterPromotionEvidence = z.infer<typeof masterPromotionEvidenceSchema>;
