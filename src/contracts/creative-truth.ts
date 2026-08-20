import * as z from 'zod/v4';

export const TOCA_CREATIVE_TRUTH_POLICY_ID = 'TOCA_CREATIVE_TRUTH_POLICY_V1' as const;
export const TOCA_VENUE_REFERENCE_SET_LEGACY_ID = 'TOCA_VENUE_REFERENCE_SET_V1' as const;
export const TOCA_VENUE_REFERENCE_SET_SUNSET_ID = 'TOCA_VENUE_REFERENCE_SET_SUNSET_V1' as const;
export const TOCA_VENUE_REFERENCE_SET_THE_PARTY_ID =
  'TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1' as const;
/** @deprecated Execution against the legacy global reference set is denied by policy v1.3. */
export const TOCA_VENUE_REFERENCE_SET_ID = TOCA_VENUE_REFERENCE_SET_LEGACY_ID;
export const CREATIVE_TRUTH_REGISTRY_DRIVE_ID =
  '1bqF5zN5Lhesy_uls6gHMkOT-KLFRGo81OJMB_LPwXaU' as const;

export const creativeModeSchema = z.enum([
  'REAL_COMPOSITE',
  'REAL_PLUS_ENHANCEMENT',
  'GENERATIVE_EXCEPTION',
]);

export const creativeTruthFailureCodeSchema = z.enum([
  'FAILED_NO_VENUE_VERIFIED_ASSET',
  'FAILED_BRAND_ASSET_MISSING',
  'FAILED_BRAND_ASSET_HASH_MISMATCH',
  'FAILED_AI_LOGO_RECONSTRUCTION',
  'FAILED_SCENE_INVENTION_DETECTED',
  'FAILED_ARCHITECTURE_DRIFT',
  'FAILED_UNAPPROVED_GENERATIVE_EXCEPTION',
  'FAILED_GENERATIVE_REFERENCE_MISSING',
  'FAILED_GENERATIVE_REFERENCE_OPERATION_MISMATCH',
  'FAILED_STANDARD_NOT_RESOLVED',
  'FAILED_LINEAGE_MISSING',
  'FAILED_ENHANCEMENT_PROVENANCE',
  'FAILED_VENUE_FIDELITY_GATE',
  'FAILED_BRAND_INTEGRITY_GATE',
  'FAILED_QUALITY_GATE',
  'FAILED_PUBLICATION_ASSET_HASH_MISMATCH',
]);

export const creativeTruthGateNameSchema = z.enum(['BRAND_INTEGRITY', 'VENUE_FIDELITY', 'QUALITY']);

export const brandAssetSchema = z
  .object({
    brandAssetId: z.string().min(1),
    brand: z.string().min(1),
    variant: z.string().min(1),
    driveFileId: z.string().min(1),
    fileName: z.string().min(1),
    contentType: z.string().min(1),
    integrityMode: z.enum(['DRIVE_FILE_ID_PINNED', 'SHA256_PINNED']),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/i)
      .optional(),
    status: z.enum(['ACTIVE_APPROVED', 'REVOKED']),
    aiReconstructionAllowed: z.literal(false),
  })
  .superRefine((value, ctx) => {
    if (value.integrityMode === 'SHA256_PINNED' && !value.sha256) {
      ctx.addIssue({
        code: 'custom',
        path: ['sha256'],
        message: 'SHA256_PINNED requires a sha256 digest',
      });
    }
  });

export const venueAssetStatusSchema = z.enum([
  'ACTIVE_APPROVED',
  'VENUE_VERIFIED_MARKETING_READY',
  'VENUE_VERIFIED_LEGACY_MASTER_REVALIDATION_REQUIRED',
  'VENUE_VERIFIED_SOURCE',
  'REVOKED',
]);

export const venueAssetSchema = z
  .object({
    venueAssetId: z.string().min(1),
    sourceAssetId: z.string().min(1),
    sourceDriveFileId: z.string().min(1),
    masterAssetId: z.string().min(1).optional(),
    masterDriveFileId: z.string().min(1).optional(),
    sourceSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/i)
      .optional(),
    masterSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/i)
      .optional(),
    operation: z.string().min(1),
    locationSignature: z.string().min(1),
    dominantSubject: z.string().min(1),
    venueVerified: z.boolean(),
    marketingReady: z.boolean(),
    generativeReferenceAllowed: z.boolean(),
    protectedElements: z.array(z.string().min(1)).default([]),
    status: venueAssetStatusSchema,
  })
  .superRefine((value, ctx) => {
    if (
      value.marketingReady &&
      (!value.masterAssetId || !value.masterDriveFileId || !value.masterSha256)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['marketingReady'],
        message: 'MARKETING_READY venue assets require master lineage and master SHA-256',
      });
    }
  });

export const venueReferenceSchema = z.object({
  referenceSetId: z.string().min(1),
  referenceId: z.string().min(1),
  assetId: z.string().min(1),
  driveFileId: z.string().min(1),
  referenceClass: z.string().min(1),
  purpose: z.string().min(1),
  requiredForGenerativeException: z.boolean(),
  venueVerified: z.boolean(),
  protectedElements: z.array(z.string().min(1)).default([]),
  status: z.enum(['ACTIVE', 'DEPRECATED', 'REVOKED']),
  operationScope: z.string().min(1),
});

export const creativeStandardSchema = z.object({
  standardId: z.string().min(1),
  version: z.string().min(1),
  brandScope: z.literal('TOCA_DO_MORCEGO'),
  operation: z.string().min(1),
  channel: z.string().min(1),
  format: z.string().min(1),
  parentPolicyId: z.literal(TOCA_CREATIVE_TRUTH_POLICY_ID),
  canonicalDriveId: z.string().min(1),
  repoMirrorPath: z.string().min(1),
  status: z.enum(['ACTIVE_CANONICAL', 'SUSPENDED', 'SUPERSEDED']),
  realAssetRequired: z.boolean(),
  deterministicBrandInsertion: z.boolean(),
  venueFidelityGateRequired: z.boolean(),
});

export const generativeExceptionApprovalSchema = z.object({
  exceptionId: z.string().min(1),
  contentItemId: z.string().min(1),
  requestedBy: z.string().min(1),
  approvedBy: z.string().min(1),
  approvalRef: z.string().min(1),
  reason: z.string().min(1),
  referenceSetId: z.string().min(1),
  minReferenceCount: z.number().int().min(1).default(3),
  allowArchitecturalInvention: z.boolean(),
  allowEnvironmentDrift: z.boolean(),
  allowAiLogoGeneration: z.boolean(),
  status: z.enum(['APPROVED', 'REVOKED', 'EXPIRED']),
  expiresAt: z.string().min(1).optional(),
  createdAt: z.string().min(1),
  operation: z.string().min(1),
});

export const videoShotSchema = z
  .object({
    shotId: z.string().min(1),
    sourceAssetId: z.string().min(1),
    sourceDriveFileId: z.string().min(1),
    masterAssetId: z.string().min(1).optional(),
    masterDriveFileId: z.string().min(1).optional(),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/i),
    masterSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/i)
      .optional(),
    operation: z.string().min(1),
    locationSignature: z.string().min(1),
    shotClass: z.string().min(1),
    durationMs: z.number().int().positive(),
    orientation: z.string().min(1),
    venueVerified: z.boolean(),
    marketingReady: z.boolean(),
    rightsStatus: z.string().min(1),
    status: venueAssetStatusSchema,
    notes: z.string().default(''),
  })
  .superRefine((value, ctx) => {
    if (
      value.marketingReady &&
      (!value.masterAssetId || !value.masterDriveFileId || !value.masterSha256)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['marketingReady'],
        message: 'MARKETING_READY video shots require master lineage and master SHA-256',
      });
    }
  });

export const fidelityEvidenceSchema = z.object({
  verifier: z.string().min(1),
  sourceIdentityPreserved: z.boolean(),
  architectureDriftDetected: z.boolean(),
  sceneInventionDetected: z.boolean(),
  logoReconstructionDetected: z.boolean(),
  referenceSetId: z.string().min(1).optional(),
  referenceAssetIds: z.array(z.string().min(1)).default([]),
  notes: z.array(z.string().min(1)).default([]),
});

export const creativeTruthGateResultSchema = z.object({
  gate: creativeTruthGateNameSchema,
  status: z.enum(['PASSED', 'FAILED']),
  failureCodes: z.array(creativeTruthFailureCodeSchema).default([]),
  evidence: z.record(z.string(), z.unknown()).default({}),
});

export const creativeAssetLineageNodeSchema = z.object({
  assetId: z.string().min(1),
  driveFileId: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
});

export const creativeAssetLineageSchema = z.object({
  source: creativeAssetLineageNodeSchema,
  master: creativeAssetLineageNodeSchema.optional(),
  derivative: creativeAssetLineageNodeSchema.optional(),
  final: creativeAssetLineageNodeSchema,
  transformations: z.array(z.string().min(1)).default([]),
});

export const creativeTruthPublicationBindingSchema = z.object({
  policyId: z.literal(TOCA_CREATIVE_TRUTH_POLICY_ID),
  standardId: z.string().min(1),
  creativeId: z.string().min(1),
  outputSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  brandIntegrityStatus: z.literal('PASSED'),
  venueFidelityStatus: z.literal('PASSED'),
  qualityGateStatus: z.literal('PASSED'),
  exactAssetBinding: z.literal(true),
});

export const deterministicRenderManifestSchema = z.object({
  contentItemId: z.string().min(1),
  creativeId: z.string().min(1),
  policyId: z.literal(TOCA_CREATIVE_TRUTH_POLICY_ID),
  standardId: z.string().min(1),
  creativeMode: creativeModeSchema,
  sourceAssetIds: z.array(z.string().min(1)).min(1),
  masterAssetIds: z.array(z.string().min(1)).default([]),
  brandAssetIds: z.array(z.string().min(1)).default([]),
  outputSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  outputDimensions: z.string().regex(/^\d+x\d+$/),
  exactAssetBinding: z.literal(true),
  gates: z.array(creativeTruthGateResultSchema).min(3),
  lineage: creativeAssetLineageSchema.optional(),
  createdAt: z.string().min(1),
});

export type CreativeMode = z.infer<typeof creativeModeSchema>;
export type CreativeTruthFailureCode = z.infer<typeof creativeTruthFailureCodeSchema>;
export type CreativeTruthGateName = z.infer<typeof creativeTruthGateNameSchema>;
export type BrandAsset = z.infer<typeof brandAssetSchema>;
export type VenueAssetStatus = z.infer<typeof venueAssetStatusSchema>;
export type VenueAsset = z.infer<typeof venueAssetSchema>;
export type VenueReference = z.infer<typeof venueReferenceSchema>;
export type CreativeStandard = z.infer<typeof creativeStandardSchema>;
export type GenerativeExceptionApproval = z.infer<typeof generativeExceptionApprovalSchema>;
export type VideoShot = z.infer<typeof videoShotSchema>;
export type FidelityEvidence = z.infer<typeof fidelityEvidenceSchema>;
export type CreativeTruthGateResult = z.infer<typeof creativeTruthGateResultSchema>;
export type CreativeAssetLineage = z.infer<typeof creativeAssetLineageSchema>;
export type CreativeTruthPublicationBinding = z.infer<typeof creativeTruthPublicationBindingSchema>;
export type DeterministicRenderManifest = z.infer<typeof deterministicRenderManifestSchema>;
