import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { BrandAsset } from '../src/contracts/creative-truth.js';
import { ControlledPhotoToVideoFinalizationService } from '../src/creative/controlled-photo-to-video-finalization.js';
import type {
  PhotoToVideoCandidateManifest,
  PhotoToVideoReviewEvidence,
} from '../src/contracts/photo-to-video.js';
import type { PhotoToVideoArtifactStore } from '../src/providers/gcp/gcs-photo-to-video-artifact-store.js';
import type {
  CreativeTruthBrandAssetLoader,
  LoadedCreativeTruthBrandAsset,
} from '../src/providers/google-drive/creative-truth-brand-asset-loader.js';
import type { CreativeVideoSourceLoader } from '../src/providers/google-drive/creative-video-source-loader.js';
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
const heroBrandSha256 = 'd'.repeat(64);
const artifactRef =
  'gcs://toca-bucket/instagram/photo-motion-review-v1/photo-video-1234567890abcdef12345678-aaaaaaaaaaaaaaaa.mp4';
const artifactObjectName =
  'instagram/photo-motion-review-v1/photo-video-1234567890abcdef12345678-aaaaaaaaaaaaaaaa.mp4';

function tocaBrand(): BrandAsset {
  return {
    brandAssetId: 'BRAND-TOCA-WHITE-V1',
    brand: 'TOCA_DO_MORCEGO',
    variant: 'WHITE',
    driveFileId: 'brand-drive',
    fileName: 'TOCA_WHITE.png',
    contentType: 'image/png',
    integrityMode: 'SHA256_PINNED',
    sha256: heroBrandSha256,
    status: 'ACTIVE_APPROVED',
    aiReconstructionAllowed: false,
  };
}

function partyBrand(): BrandAsset {
  return {
    ...tocaBrand(),
    brandAssetId: 'BRAND-THE-PARTY-WHITE-V1',
    brand: 'THE_PARTY',
    driveFileId: 'party-brand-drive',
    fileName: 'THE_PARTY_WHITE.png',
  };
}

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

function partyResolved(environment: 'INTERNATIONAL' | 'NATIONAL'): ResolvedPhotoToVideoContext {
  const base = resolved();
  return {
    ...base,
    content: {
      contentItemId: 'TP-CONTENT-1',
      productId: 'THE_PARTY',
      operation: 'THE_PARTY',
      outputType: 'REEL',
      inheritedVisualStandardId: 'THE_PARTY_HYBRID_NETWORKS_V1',
      sourceAssetId: 'TP-0130',
      thePartyContext: {
        contentItemId: 'TP-CONTENT-1',
        operation: 'THE_PARTY',
        editionId: 'TP-EDITION-1',
        intent: 'EVENT',
        environment,
        environmentSource: 'EDITION_CONTEXT',
        editionEnvironmentStatus: 'DECIDED',
        standardId: 'THE_PARTY_HYBRID_NETWORKS_V1',
        standardVersion: '1.0',
        visualStandardStatus: 'RESOLVED',
        persistedVisualStandardStatus: 'RESOLVED',
        heroBrandAssetId: 'BRAND-THE-PARTY-WHITE-V1',
        venueAssetId: 'VENUE-TP-0130',
        creativeTruthPolicyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
        brandIntegrityStatus: '',
        venueFidelityStatus: '',
        qualityGateStatus: '',
      },
    },
    productPolicy: {
      ...base.productPolicy,
      productId: 'THE_PARTY',
      operation: 'THE_PARTY',
      displayName: 'The Party',
      heroBrand: 'THE_PARTY',
    },
    standard: {
      ...base.standard,
      standardId: 'THE_PARTY_REEL_PHOTO_MOTION_V1',
      productId: 'THE_PARTY',
      operation: 'THE_PARTY',
      brandPosition: 'TOP_CENTER',
    },
    venueAsset: {
      ...base.venueAsset,
      venueAssetId: 'VENUE-TP-0130',
      sourceAssetId: 'TP-0130',
      masterAssetId: 'MM-TP-0130-V1',
      operation: 'THE_PARTY',
    },
    rights: {
      ...base.rights,
      sourceAssetId: 'TP-0130',
      operation: 'THE_PARTY',
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
    artifactRef,
    artifactObjectName,
    outputContentType: 'video/mp4',
    size: '720x1280',
    seconds: 8,
    provider: 'LOCAL_FFMPEG',
    heroBrandAssetId: 'BRAND-TOCA-WHITE-V1',
    heroBrandDriveFileId: 'brand-drive',
    heroBrandSha256,
    brandAssetIds: ['BRAND-TOCA-WHITE-V1'],
    exactAssetBinding: true,
    requiresPostGenerationHumanReview: true,
    requiresSceneContinuationFidelityGate: false,
    publicationEligible: false,
    createdAt: '2026-08-18T07:00:00.000Z',
  };
}

function partyCandidate(): PhotoToVideoCandidateManifest {
  return {
    ...candidate(),
    contentItemId: 'TP-CONTENT-1',
    productId: 'THE_PARTY',
    operation: 'THE_PARTY',
    standardId: 'THE_PARTY_REEL_PHOTO_MOTION_V1',
    inheritedVisualStandardId: 'THE_PARTY_HYBRID_NETWORKS_V1',
    sourceAssetId: 'TP-0130',
    thePartyEditionId: 'TP-EDITION-1',
    thePartyIntent: 'EVENT',
    thePartyEnvironment: 'INTERNATIONAL',
    heroBrandAssetId: 'BRAND-THE-PARTY-WHITE-V1',
    heroBrandDriveFileId: 'party-brand-drive',
    brandAssetIds: ['BRAND-THE-PARTY-WHITE-V1'],
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
  const brand = current.content.operation === 'THE_PARTY' ? partyBrand() : tocaBrand();
  const value: PhotoToVideoRegistry = {
    resolve: async () => current,
    getBrandAsset: async () => brand,
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

function artifactStore(bytes = outputBytes) {
  const loadExact = vi.fn(async () => bytes);
  const value: PhotoToVideoArtifactStore = {
    loadExact,
    store: async () => ({
      artifactRef,
      objectName: artifactObjectName,
      sha256: outputSha256,
      sizeBytes: outputBytes.byteLength,
      contentType: 'video/mp4',
    }),
  };
  return { value, loadExact };
}

function sourceLoader() {
  const load = vi.fn(async () => ({
    bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
    contentType: 'image/jpeg' as const,
    driveFileId: 'master-drive',
    sha256: sourceSha256,
  }));
  return { value: { load } satisfies CreativeVideoSourceLoader, load };
}

function brandLoader(brand = tocaBrand()) {
  const loaded: LoadedCreativeTruthBrandAsset = {
    registry: brand,
    bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    contentType: 'image/png',
    driveFileId: brand.driveFileId,
    aiGenerated: false,
  };
  const load = vi.fn(async () => loaded);
  return { value: { load } satisfies CreativeTruthBrandAssetLoader, load };
}

describe('ControlledPhotoToVideoFinalizationService', () => {
  it('finalizes only the durable exact reviewed bytes after source and official brand revalidation', async () => {
    const fake = registry();
    const state = writeback();
    const artifacts = artifactStore();
    const source = sourceLoader();
    const brand = brandLoader();
    const service = new ControlledPhotoToVideoFinalizationService({
      registry: fake.value,
      writeback: state.value,
      artifactStore: artifacts.value,
      sourceLoader: source.value,
      brandLoader: brand.value,
      now: () => new Date('2026-08-18T08:00:00.000Z'),
    });
    const result = await service.finalize({
      candidateManifest: candidate(),
      reviewEvidence: review(),
    });
    expect(result.status).toBe('VIDEO_CREATIVE_TRUTH_PASSED');
    expect(result.publicationAuthorized).toBe(false);
    expect(result.readyForPrepare).toBe(true);
    expect(result.finalArtifactRef).toBe(artifactRef);
    expect(source.load).toHaveBeenCalledWith({
      driveFileId: 'master-drive',
      expectedSha256: sourceSha256,
    });
    expect(brand.load).toHaveBeenCalledTimes(1);
    expect(artifacts.loadExact).toHaveBeenCalledWith(artifactRef, outputSha256);
    expect(fake.recordFinalOutput).toHaveBeenCalledTimes(1);
    expect(state.writeFinal).toHaveBeenCalledWith(
      expect.objectContaining({
        contentItemId: 'CONTENT-1',
        candidateSha256: outputSha256,
        finalAssetSha256: outputSha256,
        finalArtifactRef: artifactRef,
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
    const artifacts = artifactStore();
    const service = new ControlledPhotoToVideoFinalizationService({
      registry: fake.value,
      writeback: state.value,
      artifactStore: artifacts.value,
      sourceLoader: sourceLoader().value,
      brandLoader: brandLoader().value,
    });
    await expect(
      service.finalize({
        candidateManifest: candidate(),
        reviewEvidence: review(),
      }),
    ).rejects.toThrow('PHOTO_TO_VIDEO_CANONICAL_CONTEXT_CHANGED');
    expect(fake.recordFinalOutput).not.toHaveBeenCalled();
    expect(state.writeFinal).not.toHaveBeenCalled();
  });

  it('fails closed when The Party edition environment changes after generation', async () => {
    const fake = registry(partyResolved('NATIONAL'));
    const state = writeback();
    const service = new ControlledPhotoToVideoFinalizationService({
      registry: fake.value,
      writeback: state.value,
      artifactStore: artifactStore().value,
      sourceLoader: sourceLoader().value,
      brandLoader: brandLoader(partyBrand()).value,
      now: () => new Date('2026-08-18T08:00:00.000Z'),
    });
    await expect(
      service.finalize({
        candidateManifest: partyCandidate(),
        reviewEvidence: review(),
      }),
    ).rejects.toThrow('PHOTO_TO_VIDEO_THE_PARTY_CONTEXT_CHANGED');
    expect(state.writeFinal).not.toHaveBeenCalled();
  });

  it('rejects review evidence timestamped before candidate generation', async () => {
    const fake = registry();
    const state = writeback();
    const source = sourceLoader();
    const service = new ControlledPhotoToVideoFinalizationService({
      registry: fake.value,
      writeback: state.value,
      artifactStore: artifactStore().value,
      sourceLoader: source.value,
      brandLoader: brandLoader().value,
      now: () => new Date('2026-08-18T08:00:00.000Z'),
    });
    await expect(
      service.finalize({
        candidateManifest: candidate(),
        reviewEvidence: { ...review(), reviewedAt: '2026-08-18T06:59:59.000Z' },
      }),
    ).rejects.toThrow('PHOTO_TO_VIDEO_REVIEW_TIME_INVALID');
    expect(source.load).not.toHaveBeenCalled();
    expect(state.writeFinal).not.toHaveBeenCalled();
  });
});
