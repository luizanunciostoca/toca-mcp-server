import { describe, expect, it } from 'vitest';
import {
  photoToVideoCandidateManifestSchema,
  photoToVideoReviewEvidenceSchema,
  sceneContinuationApprovalSchema,
} from '../src/contracts/photo-to-video.js';

function sceneCandidate() {
  return {
    schemaVersion: 1 as const,
    status: 'GENERATED_REVIEW_REQUIRED' as const,
    policyId: 'TOCA_PHOTO_TO_VIDEO_POLICY_V1' as const,
    contentItemId: 'CONTENT-1',
    productId: 'SUNSET',
    operation: 'SUNSET',
    outputType: 'REEL' as const,
    routeType: 'GENERATIVE_SCENE_CONTINUATION_VIDEO' as const,
    standardId: 'SUNSET_REEL_SCENE_CONTINUATION_V1',
    standardVersion: '1.0',
    inheritedVisualStandardId: 'SUNSET_FEED_V1',
    sourceAssetId: 'SUN-0244',
    sourceDriveFileId: 'drive-master',
    sourceSha256: 'a'.repeat(64),
    providerCandidateSha256: 'b'.repeat(64),
    outputSha256: 'c'.repeat(64),
    artifactRef:
      'gcs://toca-bucket/instagram/scene-continuation-review-v1/photo-video-1234567890abcdef12345678-cccccccccccccccc.mp4',
    artifactObjectName:
      'instagram/scene-continuation-review-v1/photo-video-1234567890abcdef12345678-cccccccccccccccc.mp4',
    outputContentType: 'video/mp4' as const,
    size: '720x1280' as const,
    seconds: 8 as const,
    provider: 'OPENAI_VIDEO_API' as const,
    providerJobId: 'video_123',
    providerModel: 'sora-2',
    exceptionId: 'VEX-1',
    approvalRef: 'APP-1',
    heroBrandAssetId: 'BRAND-TOCA-WHITE-V1',
    heroBrandDriveFileId: 'brand-drive',
    heroBrandSha256: 'd'.repeat(64),
    brandAssetIds: ['BRAND-TOCA-WHITE-V1'],
    exactAssetBinding: true as const,
    requiresPostGenerationHumanReview: true as const,
    requiresSceneContinuationFidelityGate: true,
    publicationEligible: false as const,
    createdAt: '2026-08-18T08:00:00.000Z',
  };
}

describe('photo-to-video contracts', () => {
  it('accepts an exact-bound durable scene continuation candidate that remains non-publishable', () => {
    const parsed = photoToVideoCandidateManifestSchema.parse(sceneCandidate());
    expect(parsed.publicationEligible).toBe(false);
    expect(parsed.requiresSceneContinuationFidelityGate).toBe(true);
    expect(parsed.artifactRef).toMatch(/^gcs:/);
    expect(parsed.heroBrandSha256).toHaveLength(64);
  });

  it('rejects disagreement between artifactRef and artifactObjectName', () => {
    expect(
      photoToVideoCandidateManifestSchema.safeParse({
        ...sceneCandidate(),
        artifactObjectName:
          'instagram/scene-continuation-review-v1/photo-video-different-cccccccccccccccc.mp4',
      }).success,
    ).toBe(false);
  });

  it('requires canonical edition, intent and environment for The Party Hybrid Networks', () => {
    expect(
      photoToVideoCandidateManifestSchema.safeParse({
        ...sceneCandidate(),
        contentItemId: 'TP-CONTENT-1',
        productId: 'THE_PARTY',
        operation: 'THE_PARTY',
        inheritedVisualStandardId: 'THE_PARTY_HYBRID_NETWORKS_V1',
        heroBrandAssetId: 'BRAND-THE-PARTY-WHITE-V1',
        heroBrandDriveFileId: 'party-brand-drive',
        brandAssetIds: ['BRAND-THE-PARTY-WHITE-V1'],
      }).success,
    ).toBe(false);

    expect(
      photoToVideoCandidateManifestSchema.safeParse({
        ...sceneCandidate(),
        contentItemId: 'TP-CONTENT-1',
        productId: 'THE_PARTY',
        operation: 'THE_PARTY',
        inheritedVisualStandardId: 'THE_PARTY_HYBRID_NETWORKS_V1',
        thePartyEditionId: 'TP-EDITION-1',
        thePartyIntent: 'EVENT',
        thePartyEnvironment: 'INTERNATIONAL',
        heroBrandAssetId: 'BRAND-THE-PARTY-WHITE-V1',
        heroBrandDriveFileId: 'party-brand-drive',
        brandAssetIds: ['BRAND-THE-PARTY-WHITE-V1'],
      }).success,
    ).toBe(true);
  });

  it('rejects scene continuation approval that permits architectural invention', () => {
    const parsed = sceneContinuationApprovalSchema.safeParse({
      exceptionId: 'VEX-1',
      contentItemId: 'CONTENT-1',
      productId: 'SUNSET',
      operation: 'SUNSET',
      sourceAssetId: 'SUN-0244',
      sourceSha256: 'a'.repeat(64),
      requestedBy: 'LUIZ',
      approvedBy: 'LUIZ',
      approvalRef: 'APP-1',
      allowSceneContinuation: true,
      allowEnvironmentExpansion: false,
      allowArchitecturalInvention: true,
      allowAiLogoGeneration: false,
      peopleConsentConfirmed: false,
      status: 'APPROVED',
      createdAt: '2026-08-18T08:00:00.000Z',
    });
    expect(parsed.success).toBe(false);
  });

  it('requires exact PASS review bindings and explicit source-to-output evidence', () => {
    expect(
      photoToVideoReviewEvidenceSchema.safeParse({
        candidateSha256: 'a'.repeat(64),
        reviewer: 'LUIZ',
        reviewedAt: '2026-08-18T08:00:00.000Z',
        reviewMethod: 'MULTIMODAL_PLUS_HUMAN',
        evidenceRef: 'EVIDENCE-1',
        sourceImageCompared: true,
        architectureDriftDetected: false,
        environmentDriftDetected: false,
        aiLogoReconstructionDetected: false,
        venueFidelity: 'PASS',
        brandIntegrity: 'PASS',
        quality: 'FAIL',
        sceneContinuationFidelity: 'PASS',
      }).success,
    ).toBe(false);
  });

  it('rejects a review without durable evidence reference', () => {
    expect(
      photoToVideoReviewEvidenceSchema.safeParse({
        candidateSha256: 'a'.repeat(64),
        reviewer: 'LUIZ',
        reviewedAt: '2026-08-18T08:00:00.000Z',
        reviewMethod: 'HUMAN',
        sourceImageCompared: true,
        architectureDriftDetected: false,
        environmentDriftDetected: false,
        aiLogoReconstructionDetected: false,
        venueFidelity: 'PASS',
        brandIntegrity: 'PASS',
        quality: 'PASS',
        sceneContinuationFidelity: 'PASS',
      }).success,
    ).toBe(false);
  });
});
