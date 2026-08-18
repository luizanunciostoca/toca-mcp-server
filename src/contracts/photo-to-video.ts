import * as z from 'zod/v4';

export const TOCA_PHOTO_TO_VIDEO_POLICY_ID = 'TOCA_PHOTO_TO_VIDEO_POLICY_V1' as const;

export const photoToVideoRouteTypeSchema = z.enum([
  'REAL_PHOTO_TO_MOTION_VIDEO',
  'GENERATIVE_SCENE_CONTINUATION_VIDEO',
]);
export type PhotoToVideoRouteType = z.infer<typeof photoToVideoRouteTypeSchema>;

export const photoToVideoOutputTypeSchema = z.enum(['STORY', 'REEL']);
export type PhotoToVideoOutputType = z.infer<typeof photoToVideoOutputTypeSchema>;

export const photoToVideoDurationSchema = z.union([z.literal(4), z.literal(8), z.literal(12)]);
export type PhotoToVideoDurationSeconds = z.infer<typeof photoToVideoDurationSchema>;

export const photoToVideoSizeSchema = z.enum(['720x1280', '1024x1792']);
export type PhotoToVideoSize = z.infer<typeof photoToVideoSizeSchema>;

export const photoToVideoMotionPresetSchema = z.enum([
  'SLOW_PUSH_IN',
  'SLOW_PULL_OUT',
  'PAN_LEFT_TO_RIGHT',
  'PAN_RIGHT_TO_LEFT',
]);
export type PhotoToVideoMotionPreset = z.infer<typeof photoToVideoMotionPresetSchema>;

export const photoToVideoRightsStatusSchema = z.enum([
  'OWNED',
  'LICENSED',
  'CLEARED',
  'RIGHTS_CLEARED',
  'UNVERIFIED',
  'REVOKED',
]);
export type PhotoToVideoRightsStatus = z.infer<typeof photoToVideoRightsStatusSchema>;

export const likenessConsentStatusSchema = z.enum([
  'NOT_APPLICABLE',
  'CONFIRMED',
  'UNVERIFIED',
  'REVOKED',
]);
export type LikenessConsentStatus = z.infer<typeof likenessConsentStatusSchema>;

export const productVideoPolicySchema = z.object({
  productId: z.string().trim().min(1),
  operation: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
  status: z.literal('ACTIVE'),
  photoMotionAllowed: z.boolean(),
  sceneContinuationAllowed: z.boolean(),
  heroBrand: z.string().trim().min(1),
  heroBrandVariant: z.string().trim().min(1),
  futureProductRuntimeMode: z.literal('REGISTRY_DRIVEN'),
});
export type ProductVideoPolicy = z.infer<typeof productVideoPolicySchema>;

export const photoToVideoStandardSchema = z.object({
  standardId: z.string().trim().min(1),
  version: z.string().trim().min(1),
  productId: z.string().trim().min(1),
  operation: z.string().trim().min(1),
  channel: z.literal('INSTAGRAM'),
  outputType: photoToVideoOutputTypeSchema,
  routeType: photoToVideoRouteTypeSchema,
  size: photoToVideoSizeSchema,
  seconds: photoToVideoDurationSchema,
  motionPreset: photoToVideoMotionPresetSchema,
  brandPosition: z.enum(['TOP_CENTER', 'BOTTOM_CENTER']),
  status: z.literal('ACTIVE_CANONICAL'),
  inheritsContentVisualStandard: z.literal(true),
  exactAssetBindingRequired: z.literal(true),
});
export type PhotoToVideoStandard = z.infer<typeof photoToVideoStandardSchema>;

export const photoToVideoSourceRightsSchema = z.object({
  sourceAssetId: z.string().trim().min(1),
  operation: z.string().trim().min(1),
  rightsStatus: photoToVideoRightsStatusSchema,
  containsPeople: z.boolean(),
  likenessConsentStatus: likenessConsentStatusSchema,
  approvedUses: z.array(z.string().trim().min(1)),
  evidenceRef: z.string().trim().min(1),
  status: z.enum(['ACTIVE', 'BLOCKED', 'REVOKED']),
  validatedAt: z.string().trim().min(1),
});
export type PhotoToVideoSourceRights = z.infer<typeof photoToVideoSourceRightsSchema>;

export const sceneContinuationApprovalSchema = z.object({
  exceptionId: z.string().trim().min(1),
  contentItemId: z.string().trim().min(1),
  productId: z.string().trim().min(1),
  operation: z.string().trim().min(1),
  sourceAssetId: z.string().trim().min(1),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  requestedBy: z.string().trim().min(1),
  approvedBy: z.string().trim().min(1),
  approvalRef: z.string().trim().min(1),
  allowSceneContinuation: z.literal(true),
  allowEnvironmentExpansion: z.boolean(),
  allowArchitecturalInvention: z.literal(false),
  allowAiLogoGeneration: z.literal(false),
  peopleConsentConfirmed: z.boolean(),
  status: z.literal('APPROVED'),
  expiresAt: z.string().trim().min(1).optional(),
  createdAt: z.string().trim().min(1),
});
export type SceneContinuationApproval = z.infer<typeof sceneContinuationApprovalSchema>;

export const photoToVideoCandidateManifestSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.literal('GENERATED_REVIEW_REQUIRED'),
  policyId: z.literal(TOCA_PHOTO_TO_VIDEO_POLICY_ID),
  contentItemId: z.string().trim().min(1),
  productId: z.string().trim().min(1),
  operation: z.string().trim().min(1),
  outputType: photoToVideoOutputTypeSchema,
  routeType: photoToVideoRouteTypeSchema,
  standardId: z.string().trim().min(1),
  standardVersion: z.string().trim().min(1),
  inheritedVisualStandardId: z.string().trim().min(1),
  sourceAssetId: z.string().trim().min(1),
  sourceDriveFileId: z.string().trim().min(1),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  providerCandidateSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  outputSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  artifactRef: z.string().regex(/^gcs:\/\/[^/]+\/instagram\/.+$/),
  artifactObjectName: z.string().regex(/^instagram\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/),
  outputContentType: z.literal('video/mp4'),
  size: photoToVideoSizeSchema,
  seconds: photoToVideoDurationSchema,
  provider: z.enum(['LOCAL_FFMPEG', 'OPENAI_VIDEO_API']),
  providerJobId: z.string().trim().min(1).optional(),
  providerModel: z.string().trim().min(1).optional(),
  exceptionId: z.string().trim().min(1).optional(),
  approvalRef: z.string().trim().min(1).optional(),
  brandAssetIds: z.array(z.string().trim().min(1)).min(1),
  exactAssetBinding: z.literal(true),
  requiresPostGenerationHumanReview: z.literal(true),
  requiresSceneContinuationFidelityGate: z.boolean(),
  publicationEligible: z.literal(false),
  createdAt: z.string().trim().min(1),
});
export type PhotoToVideoCandidateManifest = z.infer<typeof photoToVideoCandidateManifestSchema>;

export const photoToVideoReviewEvidenceSchema = z.object({
  candidateSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  reviewer: z.string().trim().min(1),
  reviewedAt: z.string().trim().min(1),
  reviewMethod: z.enum(['HUMAN', 'MULTIMODAL_PLUS_HUMAN']),
  evidenceRef: z.string().trim().min(1),
  sourceImageCompared: z.literal(true),
  architectureDriftDetected: z.literal(false),
  environmentDriftDetected: z.literal(false),
  aiLogoReconstructionDetected: z.literal(false),
  venueFidelity: z.literal('PASS'),
  brandIntegrity: z.literal('PASS'),
  quality: z.literal('PASS'),
  sceneContinuationFidelity: z.enum(['PASS', 'NOT_APPLICABLE']),
  notes: z.string().default(''),
});
export type PhotoToVideoReviewEvidence = z.infer<typeof photoToVideoReviewEvidenceSchema>;

export const photoToVideoFinalManifestSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.literal('VIDEO_CREATIVE_TRUTH_PASSED'),
  candidate: photoToVideoCandidateManifestSchema,
  review: photoToVideoReviewEvidenceSchema,
  finalAssetSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  finalArtifactRef: z.string().regex(/^gcs:\/\/[^/]+\/instagram\/.+$/),
  exactAssetBinding: z.literal(true),
  readyForPrepare: z.literal(true),
  publicationAuthorized: z.literal(false),
  finalizedAt: z.string().trim().min(1),
});
export type PhotoToVideoFinalManifest = z.infer<typeof photoToVideoFinalManifestSchema>;
