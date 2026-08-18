import { describe, expect, it } from 'vitest';
import { assertMarketingMasterPromotion } from '../src/providers/google-sheets/master-promotion-guard.js';

function validEvidence() {
  return {
    policyId: 'TOCA_PHOTO_RESTORATION_POLICY_V1' as const,
    restorationProfile: 'SOURCE_FAITHFUL_CINEMATIC_RESTORATION_V1' as const,
    pipelineVersion: 'local-photo-enhancer-v2' as const,
    sourceAssetId: 'SUN-0009',
    sourceDriveFileId: 'source-drive',
    sourceSha256: 'a'.repeat(64),
    outputSha256: 'b'.repeat(64),
    sourceImageBound: true as const,
    identityLock: true as const,
    compositionLock: true as const,
    structureLock: true as const,
    backgroundLock: true as const,
    generativeDetailSynthesisUsed: false as const,
    semanticAlterationDetected: false as const,
    restorationConfidence: 'HIGH' as const,
    textDetailConfidence: 'NOT_APPLICABLE' as const,
    iconDetailConfidence: 'NOT_APPLICABLE' as const,
    microDetailConfidence: 'HIGH' as const,
    outputLongEdgePixels: 3840,
    stillMasterFormat: 'JPEG_HIGH_QUALITY_4K' as const,
    proResApplicability: 'VIDEO_ONLY_NOT_APPLICABLE_TO_STILL' as const,
    masterAssetId: 'MM-SUN-0009-V2',
    masterDriveFileId: 'master-drive',
    qualityGate: 'PASSED' as const,
    brandGate: 'PASSED' as const,
    venueFidelityGate: 'PASSED' as const,
    promotionStatus: 'APPROVED_FOR_MARKETING' as const,
    targetFolderClass: '07_PRONTOS_PARA_MARKETING' as const,
    promotionReviewedBy: 'AG-01+AG-07',
    promotionReviewedAt: '2026-08-18T17:00:00-03:00',
    promotionDecisionReason: 'SOURCE_OUTPUT_REVIEW_AND_ALL_GATES_PASS',
  };
}

describe('assertMarketingMasterPromotion', () => {
  it('promotes only a fully reviewed source-faithful 4K master', () => {
    expect(assertMarketingMasterPromotion(validEvidence())).toMatchObject({
      eligible: true,
      status: 'MARKETING_READY',
      targetFolderClass: '07_PRONTOS_PARA_MARKETING',
      promotionGuardVersion: 'master-promotion-guard-v1',
      promotionReviewedBy: 'AG-01+AG-07',
    });
  });

  it('blocks unresolved restoration confidence', () => {
    expect(() =>
      assertMarketingMasterPromotion({
        ...validEvidence(),
        restorationConfidence: 'REVIEW_REQUIRED',
      }),
    ).toThrow('MASTER_PROMOTION_BLOCKED_DETAIL_CONFIDENCE');
  });

  it('blocks a sub-4K master with a technical-spec error', () => {
    expect(() =>
      assertMarketingMasterPromotion({
        ...validEvidence(),
        outputLongEdgePixels: 3000,
      }),
    ).toThrow('MASTER_PROMOTION_BLOCKED_TECH_SPEC');
  });

  it('blocks missing review identity as incomplete canonical metadata', () => {
    const invalid = { ...validEvidence(), promotionReviewedBy: '' };
    expect(() =>
      assertMarketingMasterPromotion(
        invalid as unknown as Parameters<typeof assertMarketingMasterPromotion>[0],
      ),
    ).toThrow('MASTER_PROMOTION_BLOCKED_MISSING_CANONICAL_METADATA');
  });

  it('blocks missing or failed gates', () => {
    const invalid = { ...validEvidence(), venueFidelityGate: 'FAILED' } as unknown as Parameters<
      typeof assertMarketingMasterPromotion
    >[0];
    expect(() => assertMarketingMasterPromotion(invalid)).toThrow(
      'MASTER_PROMOTION_BLOCKED_MISSING_CANONICAL_METADATA',
    );
  });
});
