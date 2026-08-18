import { describe, expect, it } from 'vitest';
import {
  creativeEnhancementProvenanceSchema,
  creativeTruthPolicySchema,
} from '../src/contracts/creative-truth.js';

const valid = {
  policyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
  creativeMode: 'REAL_PLUS_ENHANCEMENT',
  editorProvider: 'OPENAI_IMAGE_EDIT',
  sourceAssetId: 'MM-SUN-0244-V1',
  sourceDriveFileId: 'master-drive',
  sourceSha256: 'a'.repeat(64),
  outputSha256: 'b'.repeat(64),
  sourceImageBound: true,
  creativeTruthBound: true,
  requiresVenueFidelityGate: true,
} as const;

const policy = {
  schemaVersion: '1.1',
  policyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
  policyVersion: '1.1',
  status: 'ACTIVE_CANONICAL',
  brandScope: 'TOCA_DO_MORCEGO',
  validatedAt: '2026-08-18',
  sourceOfTruth: {
    provider: 'GOOGLE_DRIVE',
    implementationPlanDriveId: 'plan-drive-id',
    registrySpreadsheetId: '1bqF5zN5Lhesy_uls6gHMkOT-KLFRGo81OJMB_LPwXaU',
  },
  defaultCreativeModes: ['REAL_COMPOSITE', 'REAL_PLUS_ENHANCEMENT'],
  generativeMode: 'GENERATIVE_EXCEPTION',
  rules: {
    realVenueAssetRequiredByDefault: true,
    marketingReadyMasterRequiredForFinalPhotoCreative: true,
    officialBrandAssetsOnly: true,
    aiLogoReconstructionAllowed: false,
    syntheticVenueReplacementAllowedByDefault: false,
    architecturalInventionAllowed: false,
    environmentDriftAllowed: false,
    deterministicTextAndBrandCompositionRequired: true,
    assetLineageRequired: true,
    enhancementProvenanceRequired: true,
    videoRealPlusEnhancement: 'FAIL_CLOSED_UNTIL_SHOT_LEVEL_PROVENANCE',
    videoEnhancementFailure: 'VIDEO_ENHANCEMENT_PROVENANCE_UNSUPPORTED',
    videoGenerativeException: 'UNSUPPORTED_V1',
    exactApprovedAssetMustBePublished: true,
    failClosed: true,
  },
  generativeException: {
    explicitApprovalRequired: true,
    approvalRecordRequired: true,
    referenceStrategy: 'OPERATION_SCOPED_ONLY_V1',
    legacyReferenceSetId: 'TOCA_VENUE_REFERENCE_SET_V1',
    legacyReferenceSetStatus: 'DEPRECATED',
    sunsetReferenceSetId: 'TOCA_VENUE_REFERENCE_SET_SUNSET_V1',
    thePartyReferenceSetId: 'TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1',
    crossOperationReferenceReuse: 'FORBIDDEN',
    referenceSetOperationMatch: 'REQUIRED',
    legacyReferenceSetExecution: 'DENY',
    minimumVerifiedReferences: 3,
    venueFidelityGateStillRequired: true,
    officialBrandAssetsStillRequired: true,
    architecturalInventionStillForbidden: true,
    environmentDriftStillForbidden: true,
  },
  requiredGates: ['BRAND_INTEGRITY', 'VENUE_FIDELITY', 'QUALITY'],
  publicationBoundary: {
    allRequiredGatesMustPass: true,
    outputSha256Required: true,
    exactAssetBindingRequired: true,
    publicationMayNotRebuildCreative: true,
  },
  failureCodes: [
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
  ],
};

describe('Creative enhancement provenance contract', () => {
  it('accepts the canonical policy only with enhancement provenance, video fail-closed flags and operation-scoped generative truth', () => {
    const parsed = creativeTruthPolicySchema.parse(policy);
    expect(parsed.rules).toMatchObject({
      enhancementProvenanceRequired: true,
      videoRealPlusEnhancement: 'FAIL_CLOSED_UNTIL_SHOT_LEVEL_PROVENANCE',
      videoEnhancementFailure: 'VIDEO_ENHANCEMENT_PROVENANCE_UNSUPPORTED',
      videoGenerativeException: 'UNSUPPORTED_V1',
    });
    expect(parsed.generativeException).toMatchObject({
      referenceStrategy: 'OPERATION_SCOPED_ONLY_V1',
      legacyReferenceSetStatus: 'DEPRECATED',
      crossOperationReferenceReuse: 'FORBIDDEN',
      referenceSetOperationMatch: 'REQUIRED',
      legacyReferenceSetExecution: 'DENY',
    });
  });

  it('rejects canonical policy drift that weakens enhancement provenance', () => {
    expect(() =>
      creativeTruthPolicySchema.parse({
        ...policy,
        rules: { ...policy.rules, enhancementProvenanceRequired: false },
      }),
    ).toThrow();
  });

  it('rejects canonical policy drift that re-enables the deprecated global generative set', () => {
    expect(() =>
      creativeTruthPolicySchema.parse({
        ...policy,
        generativeException: {
          ...policy.generativeException,
          legacyReferenceSetExecution: 'ALLOW',
        },
      }),
    ).toThrow();
  });

  it('accepts a provenance record that binds one exact master/output to the canonical policy mode', () => {
    expect(creativeEnhancementProvenanceSchema.parse(valid)).toEqual(valid);
  });

  it('rejects provenance from another policy or creative mode', () => {
    expect(() =>
      creativeEnhancementProvenanceSchema.parse({ ...valid, policyId: 'OTHER_POLICY' }),
    ).toThrow();
    expect(() =>
      creativeEnhancementProvenanceSchema.parse({ ...valid, creativeMode: 'REAL_COMPOSITE' }),
    ).toThrow();
  });

  it('rejects an enhancement that is not Creative Truth bound', () => {
    expect(() =>
      creativeEnhancementProvenanceSchema.parse({ ...valid, creativeTruthBound: false }),
    ).toThrow();
  });

  it('rejects an enhancement that tries to bypass the post-edit Venue Fidelity gate', () => {
    expect(() =>
      creativeEnhancementProvenanceSchema.parse({ ...valid, requiresVenueFidelityGate: false }),
    ).toThrow();
  });

  it('rejects malformed source or output digests', () => {
    expect(() =>
      creativeEnhancementProvenanceSchema.parse({ ...valid, sourceSha256: 'not-a-sha' }),
    ).toThrow();
    expect(() =>
      creativeEnhancementProvenanceSchema.parse({ ...valid, outputSha256: 'not-a-sha' }),
    ).toThrow();
  });
});
