import * as z from 'zod/v4';

export const TOCA_CREATIVE_TRUTH_POLICY_ID = 'TOCA_CREATIVE_TRUTH_POLICY_V1' as const;
export const TOCA_VENUE_REFERENCE_SET_ID = 'TOCA_VENUE_REFERENCE_SET_V1' as const;
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
  'FAILED_GENERATIVE_OUTPUT_REVIEW_MISSING',
  'FAILED_FIDELITY_EVIDENCE_BINDING',
  'FAILED_STANDARD_NOT_RESOLVED',
  'FAILED_LINEAGE_MISSING',
  'FAILED_ENHANCEMENT_PROVENANCE',
  'FAILED_VENUE_FIDELITY_GATE',
  'FAILED_BRAND_INTEGRITY_GATE',
  'FAILED_QUALITY_GATE',
]);

export const creativeTruthGateNameSchema = z.enum([
  'BRAND_INTEGRITY',
  'VENUE_FIDELITY',
  'QUALITY',
]);

export const creativeAssetLocatorKindSchema = z.enum([
  'MEDIA_URL',
  'META_IMAGE_HASH',
  'META_VIDEO_ID',
  'META_SOURCE_CREATIVE_ID',
  'DRIVE_FILE_ID',
]);

export const creativeAssetLocatorSchema = z.object({
  kind: creativeAssetLocatorKindSchema,
  value: z.string().trim().min(1),
});

export const creativeTruthPolicySchema = z.object({
  schemaVersion: z.string().min(1),
  policyId: z.literal(TOCA_CREATIVE_TRUTH_POLICY_ID),
  policyVersion: z.string().min(1),
  status: z.literal('ACTIVE_CANONICAL'),
  brandScope: z.literal('TOCA_DO_MORCEGO'),
  validatedAt: z.string().min(1),
  sourceOfTruth: z.object({
    provider: z.literal('GOOGLE_DRIVE'),
    implementationPlanDriveId: z.string().min(1),
    registrySpreadsheetId: z.literal(CREATIVE_TRUTH_REGISTRY_DRIVE_ID),
  }),
  defaultCreativeModes: z.array(creativeModeSchema).min(1),
  generativeMode: z.literal('GENERATIVE_EXCEPTION'),
  rules: z.object({
    realVenueAssetRequiredByDefault: z.literal(true),
    marketingReadyMasterRequiredForFinalPhotoCreative: z.literal(true),
    officialBrandAssetsOnly: z.literal(true),
    aiLogoReconstructionAllowed: z.literal(false),
    syntheticVenueReplacementAllowedByDefault: z.literal(false),
    architecturalInventionAllowed: z.literal(false),
    environmentDriftAllowed: z.literal(false),
    deterministicTextAndBrandCompositionRequired: z.literal(true),
    assetLineageRequired: z.literal(true),
    enhancementProvenanceRequired: z.literal(true),
    videoRealPlusEnhancement: z.literal('FAIL_CLOSED_UNTIL_SHOT_LEVEL_PROVENANCE'),
    videoEnhancementFailure: z.literal('VIDEO_ENHANCEMENT_PROVENANCE_UNSUPPORTED'),
    videoGenerativeException: z.literal('UNSUPPORTED_V1'),
    exactApprovedAssetMustBePublished: z.literal(true),
    failClosed: z.literal(true),
  }),
  generativeException: z.object({
    explicitApprovalRequired: z.literal(true),
    approvalRecordRequired: z.literal(true),
    venueReferenceSetRequired: z.literal(TOCA_VENUE_REFERENCE_SET_ID),
    minimumVerifiedReferences: z.number().int().min(3),
    venueFidelityGateStillRequired: z.literal(true),
    officialBrandAssetsStillRequired: z.literal(true),
    architecturalInventionStillForbidden: z.literal(true),
    environmentDriftStillForbidden: z.literal(true),
  }),
  requiredGates: z
    .array(creativeTruthGateNameSchema)
    .length(3)
    .superRefine((gates, ctx) => {
      if (new Set(gates).size !== 3) {
        ctx.addIssue({
          code: 'custom',
          message: 'Creative Truth policy must require each canonical gate exactly once',
        });
      }
    }),
  publicationBoundary: z.object({
    allRequiredGatesMustPass: z.literal(true),
    outputSha256Required: z.literal(true),
    exactAssetBindingRequired: z.literal(true),
    publicationMayNotRebuildCreative: z.literal(true),
  }),
  failureCodes: z.array(creativeTruthFailureCodeSchema).min(1),
});

export const brandAssetSchema = z
  .object({
    brandAssetId: z.string().min(1),
    brand: z.string().min(1),
    variant: z.string().min(1),
    driveFileId: z.string().min(1),
    fileName: z.string().min(1),
    contentType: z.string().min(1),
    integrityMode: z.enum(['DRIVE_FILE_ID_PINNED', 'SHA256_PINNED']),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
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

export const venueAssetSchema = z
  .object({
    venueAssetId: z.string().min(1),
    sourceAssetId: z.string().min(1),
    sourceDriveFileId: z.string().min(1),
    masterAssetId: z.string().min(1).optional(),
    masterDriveFileId: z.string().min(1).optional(),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
    masterSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
    operation: z.string().min(1),
    locationSignature: z.string().min(1),
    dominantSubject: z.string().min(1),
    venueVerified: z.boolean(),
    marketingReady: z.boolean(),
    generativeReferenceAllowed: z.boolean(),
    protectedElements: z.array(z.string().min(1)).default([]),
    status: z.enum(['ACTIVE_APPROVED', 'VENUE_VERIFIED_SOURCE', 'REVOKED']),
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

export const videoShotSchema = z
  .object({
    shotId: z.string().min(1),
    sourceAssetId: z.string().min(1),
    sourceDriveFileId: z.string().min(1),
    masterAssetId: z.string().min(1).optional(),
    masterDriveFileId: z.string().min(1).optional(),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
    masterSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
    operation: z.string().min(1),
    locationSignature: z.string().min(1),
    shotClass: z.string().min(1),
    durationMs: z.number().int().positive().optional(),
    orientation: z.string().min(1),
    venueVerified: z.boolean(),
    marketingReady: z.boolean(),
    rightsStatus: z.string().min(1),
    status: z.enum(['ACTIVE_APPROVED', 'VENUE_VERIFIED_SOURCE', 'REVOKED']),
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
  status: z.enum(['ACTIVE', 'REVOKED']),
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
  referenceSetId: z.literal(TOCA_VENUE_REFERENCE_SET_ID),
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
});

export const fidelityVerificationMethodSchema = z.enum([
  'DETERMINISTIC_DIFF',
  'MULTIMODAL_REVIEW',
  'HUMAN_REVIEW',
  'MULTIMODAL_PLUS_HUMAN',
]);

export const fidelityEvidenceSchema = z.object({
  verifier: z.string().min(1),
  verificationMethod: fidelityVerificationMethodSchema,
  candidateSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  sourceIdentityPreserved: z.boolean(),
  architectureDriftDetected: z.boolean(),
  sceneInventionDetected: z.boolean(),
  logoReconstructionDetected: z.boolean(),
  referenceSetId: z.string().min(1).optional(),
  referenceAssetIds: z.array(z.string().min(1)).default([]),
  reviewRef: z.string().min(1).optional(),
  notes: z.array(z.string().min(1)).default([]),
});

export const creativeEnhancementProvenanceSchema = z.object({
  policyId: z.literal(TOCA_CREATIVE_TRUTH_POLICY_ID),
  creativeMode: z.literal('REAL_PLUS_ENHANCEMENT'),
  editorProvider: z.string().min(1),
  sourceAssetId: z.string().min(1),
  sourceDriveFileId: z.string().min(1),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  outputSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  sourceImageBound: z.literal(true),
  creativeTruthBound: z.literal(true),
  requiresVenueFidelityGate: z.literal(true),
});

export const creativeTruthGateResultSchema = z
  .object({
    gate: creativeTruthGateNameSchema,
    status: z.enum(['PASSED', 'FAILED']),
    failureCodes: z.array(creativeTruthFailureCodeSchema).default([]),
    evidence: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((value, ctx) => {
    if (value.status === 'PASSED' && value.failureCodes.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['failureCodes'],
        message: 'PASSED Creative Truth gates cannot contain failure codes',
      });
    }
    if (value.status === 'FAILED' && value.failureCodes.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['failureCodes'],
        message: 'FAILED Creative Truth gates require at least one failure code',
      });
    }
  });

export const creativeTruthPublicationBindingSchema = z.object({
  policyId: z.literal(TOCA_CREATIVE_TRUTH_POLICY_ID),
  standardId: z.string().min(1),
  creativeId: z.string().min(1),
  outputSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  brandIntegrityStatus: z.literal('PASSED'),
  venueFidelityStatus: z.literal('PASSED'),
  qualityGateStatus: z.literal('PASSED'),
  assetLocators: z.array(creativeAssetLocatorSchema).min(1),
  exactAssetBinding: z.literal(true),
});

export const deterministicRenderManifestSchema = z
  .object({
    contentItemId: z.string().min(1),
    creativeId: z.string().min(1),
    policyId: z.literal(TOCA_CREATIVE_TRUTH_POLICY_ID),
    standardId: z.string().min(1),
    creativeMode: creativeModeSchema,
    sourceAssetIds: z.array(z.string().min(1)).min(1),
    masterAssetIds: z.array(z.string().min(1)).default([]),
    brandAssetIds: z.array(z.string().min(1)).default([]),
    enhancementProvenance: creativeEnhancementProvenanceSchema.optional(),
    outputSha256: z.string().regex(/^[a-f0-9]{64}$/i),
    outputDimensions: z.string().regex(/^\d+x\d+$/),
    exactAssetBinding: z.literal(true),
    gates: z.array(creativeTruthGateResultSchema).length(3),
    createdAt: z.string().min(1),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.gates.map((gate) => gate.gate)).size !== 3) {
      ctx.addIssue({
        code: 'custom',
        path: ['gates'],
        message: 'Render manifests require BRAND_INTEGRITY, VENUE_FIDELITY and QUALITY exactly once',
      });
    }
    if (value.creativeMode === 'REAL_PLUS_ENHANCEMENT' && !value.enhancementProvenance) {
      ctx.addIssue({
        code: 'custom',
        path: ['enhancementProvenance'],
        message: 'REAL_PLUS_ENHANCEMENT manifests require enhancement provenance',
      });
    }
    if (value.creativeMode !== 'REAL_PLUS_ENHANCEMENT' && value.enhancementProvenance) {
      ctx.addIssue({
        code: 'custom',
        path: ['enhancementProvenance'],
        message: 'Enhancement provenance is only valid for REAL_PLUS_ENHANCEMENT',
      });
    }
  });

export type CreativeMode = z.infer<typeof creativeModeSchema>;
export type CreativeTruthFailureCode = z.infer<typeof creativeTruthFailureCodeSchema>;
export type CreativeTruthGateName = z.infer<typeof creativeTruthGateNameSchema>;
export type CreativeAssetLocatorKind = z.infer<typeof creativeAssetLocatorKindSchema>;
export type CreativeAssetLocator = z.infer<typeof creativeAssetLocatorSchema>;
export type CreativeTruthPolicy = z.infer<typeof creativeTruthPolicySchema>;
export type BrandAsset = z.infer<typeof brandAssetSchema>;
export type VenueAsset = z.infer<typeof venueAssetSchema>;
export type VideoShot = z.infer<typeof videoShotSchema>;
export type VenueReference = z.infer<typeof venueReferenceSchema>;
export type CreativeStandard = z.infer<typeof creativeStandardSchema>;
export type GenerativeExceptionApproval = z.infer<typeof generativeExceptionApprovalSchema>;
export type FidelityVerificationMethod = z.infer<typeof fidelityVerificationMethodSchema>;
export type FidelityEvidence = z.infer<typeof fidelityEvidenceSchema>;
export type CreativeEnhancementProvenance = z.infer<typeof creativeEnhancementProvenanceSchema>;
export type CreativeTruthGateResult = z.infer<typeof creativeTruthGateResultSchema>;
export type CreativeTruthPublicationBinding = z.infer<
  typeof creativeTruthPublicationBindingSchema
>;
export type DeterministicRenderManifest = z.infer<typeof deterministicRenderManifestSchema>;
