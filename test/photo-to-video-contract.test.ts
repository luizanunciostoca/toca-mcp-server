import { describe, expect, it } from 'vitest';
import {
  photoToVideoCandidateManifestSchema,
  photoToVideoReviewEvidenceSchema,
  sceneContinuationApprovalSchema,
} from '../src/contracts/photo-to-video.js';

describe('photo-to-video contracts', () => {
  it('accepts an exact-bound durable scene continuation candidate that remains non-publishable', () => {
    const parsed = photoToVideoCandidateManifestSchema.parse({
      schemaVersion: 1,
      status: 'GENERATED_REVIEW_REQUIRED',
      policyId: 'TOCA_PHOTO_TO_VIDEO_POLICY_V1',
      contentItemId: 'CONTENT-1',
      productId: 'SUNSET',
      operation: 'SUNSET',
      outputType: 'REEL',
      routeType: 'GENERATIVE_SCENE_CONTINUATION_VIDEO',
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
      outputContentType: 'video/mp4',
      size: '720x1280',
      seconds: 8,
      provider: 'OPENAI_VIDEO_API',
      providerJobId: 'video_123',
      providerModel: 'sora-2',
      exceptionId: 'VEX-1',
      approvalRef: 'APP-1',
      brandAssetIds: ['BRAND-TOCA-WHITE-V1'],
      exactAssetBinding: true,
      requiresPostGenerationHumanReview: true,
      requiresSceneContinuationFidelityGate: true,
      publicationEligible: false,
      createdAt: '2026-08-18T08:00:00.000Z',
    });
    expect(parsed.publicationEligible).toBe(false);
    expect(parsed.requiresSceneContinuationFidelityGate).toBe(true);
    expect(parsed.artifactRef).toMatch(/^gcs:/);
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
