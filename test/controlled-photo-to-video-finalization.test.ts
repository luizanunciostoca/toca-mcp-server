import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ControlledPhotoToVideoFinalizationService } from '../src/creative/controlled-photo-to-video-finalization.js';
import type {
  PhotoToVideoCandidateManifest,
  PhotoToVideoReviewEvidence,
} from '../src/contracts/photo-to-video.js';
import type { PhotoToVideoContentWriteback } from '../src/providers/google-sheets/photo-to-video-content-writeback.js';
import type {
  PhotoToVideoRegistry,
  ResolvedPhotoToVideoContext,
} from '../src/providers/google-sheets/photo-to-video-registry.js';

const outputBytes = Uint8Array.from([
  0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0,
]);
const outputSha256 = createHash('sha256').update(outputBytes).digest('hex');
const sourceSha256 = 'a'.repeat(64);

function resolved(): ResolvedPhotoToVideoContext {
  return {
    content: {
      contentItemId: 'CONTENT-1',
      productId: 'SUNSET',
      operation: 'SUNSET',
      outputType: 'REEL',
      inheritedVisualStandardId: 'SUNSET_FEED_V1',
      sourceAssetId: 'SUN-0244',
    },
    productPolicy: {
      productId: 'SUNSET',
      operation: 'SUNSET',
      displayName: 'Sunset',
      status: 'ACTIVE',
      photoMotionAllowed: true,
      sceneContinuationAllowed: true,
      heroBrand: 'TOCA_DO_MORCEGO',
      heroBrandVariant: 'WHITE',
      futureProductRuntimeMode: 'REGISTRY_DRIVEN',
    },
    standard: {
      standardId: 'SUNSET_REEL_PHOTO_MOTION_V1',
      version: '1.0',
      productId: 'SUNSET',
      operation: 'SUNSET',
      channel: 'INSTAGRAM',
      outputType: 'REEL',
      routeType: 'REAL_PHOTO_TO_MOTION_VIDEO',
      size: '720x1280',
      seconds: 8,
      motionPreset: 'SLOW_PUSH_IN',
      brandPosition: 'BOTTOM_CENTER',
      status: 'ACTIVE_CANONICAL',
      inheritsContentVisualStandard: true,
      exactAssetBindingRequired: true,
    },
    venueAsset: {
      venueAssetId: 'VENUE-SUN-0244',
      sourceAssetId: 'SUN-0244',
      sourceDriveFileId: 'source-drive',
      masterAssetId: 'MM-SUN-0244-V1',
      masterDriveFileId: 'master-drive',
      sourceSha256: 'b'.repeat(64),
      masterSha256: sourceSha256,
      operation: 'SUNSET',
      locationSignature: 'ambiente_toca',
      dominantSubject: 'experiencia',
      venueVerified: true,
      marketingReady: true,
      generativeReferenceAllowed: true,
      protectedElements: ['DECK'],
      status: 'ACTIVE_APPROVED',
    },
    rights: {
      sourceAssetId: 'SUN-0244',
      operation: 'SUNSET',
      rightsStatus: 'OWNED',
      containsPeople: false,
      likenessConsentStatus: 'NOT_APPLICABLE',
      approvedUses: ['PHOTO_TO_MOTION'],
      evidenceRef: 'RIGHTS-1',
      status: 'ACTIVE',
      validatedAt: '2026-08-18T07:00:00.000Z',
    },
  };
}

function candidate(): PhotoToVideoCandidateManifest {
  return {
    schemaVersion: 1,
    status: 'GENERATED_REVIEW_REQUIRED',
    policyId: 'TOCA_PHOTO_TO_VIDEO_POLICY_V1',
    contentItemId: 'CONTENT-1',
    productId: 'SUNSET',
    operation: 'SUNSET',
    outputType: 'REEL',
    routeType: 'REAL_PHOTO_TO_MOTION_VIDEO',
    standardId: 'SUNSET_REEL_PHOTO_MOTION_V1',
    standardVersion: '1.0',
    inheritedVisualStandardId: 'SUNSET_FEED_V1',
    sourceAssetId: 'SUN-0244',
    sourceDriveFileId: 'master-drive',
    sourceSha256,
    providerCandidateSha256: 'c'.repeat(64),
    outputSha256,
    outputContentType: 'video/mp4',
    size: '720x1280',
    seconds: 8,
    provider: 'LOCAL_FFMPEG',
    brandAssetIds: ['BRAND-TOCA-WHITE-V1'],
    exactAssetBinding: true,
    requiresPostGenerationHumanReview: true,
    requiresSceneContinuationFidelityGate: false,
    publicationEligible: false,
    createdAt: '2026-08-18T07:00:00.000Z',
  };
}

function review(): PhotoToVideoReviewEvidence {
  return {
    candidateSha256: outputSha256,
    reviewer: 'LUIZ',
    reviewedAt: '2026-08-18T07:30:00.000Z',
    reviewMethod: 'MULTIMODAL_PLUS_HUMAN',
    evidenceRef: 'EVIDENCE-VIDEO-REVIEW-1',
    sourceImageCompared: true,
    architectureDriftDetected: false,
    environmentDriftDetected: false,
    aiLogoReconstructionDetected: false,
    venueFidelity: 'PASS',
    brandIntegrity: 'PASS',
    quality: 'PASS',
    sceneContinuationFidelity: 'NOT_APPLICABLE',
    notes: '',
  };
}

function registry(current = resolved()) {
  const recordFinalOutput = vi.fn(async () => undefined);
  const value: PhotoToVideoRegistry = {
    resolve: async () => current,
    getBrandAsset: async () => undefined,
    recordFinalOutput,
  };
  return { value, recordFinalOutput };
}

function writeback() {
  const writeCandidate = vi.fn(async () => undefined);
  const writeFinal = vi.fn(async () => undefined);
  const value: PhotoToVideoContentWriteback = { writeCandidate, writeFinal };
  return { value, writeCandidate, writeFinal };
}

describe('ControlledPhotoToVideoFinalizationService', () => {
  it('finalizes only the exact reviewed bytes and records evidence plus content state', async () => {
    const fake = registry();
    const state = writeback();
    const service = new ControlledPhotoToVideoFinalizationService({
      registry: fake.value,
      writeback: state.value,
      now: () => new Date('2026-08-18T08:00:00.000Z'),
    });
    const result = await service.finalize({
      outputBytes,
      candidateManifest: candidate(),
      reviewEvidence: review(),
    });
    expect(result.status).toBe('VIDEO_CREATIVE_TRUTH_PASSED');
    expect(result.publicationAuthorized).toBe(false);
    expect(result.readyForPrepare).toBe(true);
    expect(fake.recordFinalOutput).toHaveBeenCalledTimes(1);
    expect(state.writeFinal).toHaveBeenCalledWith(
      expect.objectContaining({
        contentItemId: 'CONTENT-1',
        candidateSha256: outputSha256,
        finalAssetSha256: outputSha256,
      }),
    );
  });

  it('fails closed when canonical standard changes after generation', async () => {
    const base = resolved();
    const changed: ResolvedPhotoToVideoContext = {
      ...base,
      standard: { ...base.standard, standardId: 'SUNSET_REEL_PHOTO_MOTION_V2' },
    };
    const fake = registry(changed);
    const state = writeback();
    const service = new ControlledPhotoToVideoFinalizationService({
      registry: fake.value,
      writeback: state.value,
    });
    await expect(
      service.finalize({
        outputBytes,
        candidateManifest: candidate(),
        reviewEvidence: review(),
      }),
    ).rejects.toThrow('PHOTO_TO_VIDEO_CANONICAL_CONTEXT_CHANGED');
    expect(fake.recordFinalOutput).not.toHaveBeenCalled();
    expect(state.writeFinal).not.toHaveBeenCalled();
  });
});
