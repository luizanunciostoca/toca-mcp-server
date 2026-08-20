import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { BrandAsset } from '../src/contracts/creative-truth.js';
import { ControlledPhotoToVideoGenerationService } from '../src/creative/controlled-photo-to-video-generation.js';
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
import type { LocalPhotoMotionVideoComposer } from '../src/providers/local/local-photo-motion-video-composer.js';
import type { LocalPhotoToVideoBrandComposer } from '../src/providers/local/local-photo-to-video-brand-composer.js';
import type { OpenAiSceneContinuationVideoProvider } from '../src/providers/openai/openai-scene-continuation-video-provider.js';

const sourceBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
const motionBytes = Uint8Array.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 1, 1, 1, 1]);
const motionSha256 = createHash('sha256').update(motionBytes).digest('hex');
const brandedBytes = Uint8Array.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 2, 2, 2, 2]);
const brandedSha256 = createHash('sha256').update(brandedBytes).digest('hex');
const artifactRef =
  'gcs://toca-bucket/instagram/photo-motion-review-v1/photo-video-1234567890abcdef12345678-aaaaaaaaaaaaaaaa.mp4';
const artifactObjectName =
  'instagram/photo-motion-review-v1/photo-video-1234567890abcdef12345678-aaaaaaaaaaaaaaaa.mp4';

const brand: BrandAsset = {
  brandAssetId: 'BRAND-TOCA-WHITE-V1',
  brand: 'TOCA_DO_MORCEGO',
  variant: 'WHITE',
  driveFileId: 'brand-drive',
  fileName: 'TOCA_WHITE.png',
  contentType: 'image/png',
  integrityMode: 'SHA256_PINNED',
  sha256: 'b'.repeat(64),
  status: 'ACTIVE_APPROVED',
  aiReconstructionAllowed: false,
};

const loadedBrand: LoadedCreativeTruthBrandAsset = {
  registry: brand,
  bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  contentType: 'image/png',
  driveFileId: brand.driveFileId,
  aiGenerated: false,
};

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
      sourceSha256: 'a'.repeat(64),
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
      validatedAt: '2026-08-18T12:00:00.000Z',
    },
  };
}

function dependencies(storeFailure = false) {
  const writeCandidate = vi.fn(async () => {
    await Promise.resolve();
    return undefined;
  });
  const assertCanonical = vi.fn(async () => {
    await Promise.resolve();
    return undefined;
  });
  const resolve = vi.fn(async () => {
    await Promise.resolve();
    return resolved();
  });
  const registry: PhotoToVideoRegistry = {
    resolve,
    getBrandAsset: async () => {
      await Promise.resolve();
      return brand;
    },
    recordFinalOutput: async () => {
      await Promise.resolve();
      return undefined;
    },
  };
  const sourceLoader: CreativeVideoSourceLoader = {
    load: async () => {
      await Promise.resolve();
      return {
        bytes: sourceBytes,
        contentType: 'image/jpeg',
        driveFileId: 'master-drive',
        sha256: sourceSha256,
      };
    },
  };
  const brandLoader: CreativeTruthBrandAssetLoader = {
    load: async () => {
      await Promise.resolve();
      return loadedBrand;
    },
  };
  const writeback: PhotoToVideoContentWriteback = {
    writeCandidate,
    writeFinal: async () => {
      await Promise.resolve();
      return undefined;
    },
  };
  const store = vi.fn(async () => {
    await Promise.resolve();
    if (storeFailure) throw new Error('artifact store unavailable');
    return {
      artifactRef,
      objectName: artifactObjectName,
      sha256: brandedSha256,
      sizeBytes: brandedBytes.byteLength,
      contentType: 'video/mp4' as const,
    };
  });
  const artifactStore: PhotoToVideoArtifactStore = {
    store,
    loadExact: async () => {
      await Promise.resolve();
      return brandedBytes;
    },
  };
  const photoMotionComposer = {
    compose: async () => {
      await Promise.resolve();
      return {
        outputBytes: motionBytes,
        outputContentType: 'video/mp4' as const,
        outputSha256: motionSha256,
        provider: 'LOCAL_FFMPEG' as const,
        pipelineVersion: 'local-photo-motion-video-v1' as const,
        sceneExpansionAllowed: false as const,
        semanticGenerationUsed: false as const,
      };
    },
  } as unknown as LocalPhotoMotionVideoComposer;
  const sceneContinuationProvider = {
    generate: vi.fn(),
  } as unknown as OpenAiSceneContinuationVideoProvider;
  const brandComposer = {
    compose: async () => {
      await Promise.resolve();
      return {
        outputBytes: brandedBytes,
        outputSha256: brandedSha256,
        outputContentType: 'video/mp4' as const,
        brandAssetIds: [brand.brandAssetId],
        exactAssetBinding: true as const,
        compositor: 'LOCAL_FFMPEG_PHOTO_TO_VIDEO_BRAND_V1' as const,
      };
    },
  } as unknown as LocalPhotoToVideoBrandComposer;
  return {
    policyGuard: { assertCanonical },
    registry,
    sourceLoader,
    brandLoader,
    writeback,
    artifactStore,
    photoMotionComposer,
    sceneContinuationProvider,
    brandComposer,
    assertCanonical,
    resolve,
    store,
    writeCandidate,
  };
}

describe('ControlledPhotoToVideoGenerationService', () => {
  it('persists exact candidate bytes before marking the content item review-required', async () => {
    const deps = dependencies();
    const service = new ControlledPhotoToVideoGenerationService({
      ...deps,
      now: () => new Date('2026-08-18T12:30:00.000Z'),
    });

    const result = await service.generate({
      contentItemId: 'CONTENT-1',
      routeType: 'REAL_PHOTO_TO_MOTION_VIDEO',
    });

    expect(deps.assertCanonical).toHaveBeenCalledWith('REAL_PHOTO_TO_MOTION_VIDEO');
    expect(deps.assertCanonical.mock.invocationCallOrder[0]).toBeLessThan(
      deps.resolve.mock.invocationCallOrder[0]!,
    );
    expect(result.manifest.artifactRef).toBe(artifactRef);
    expect(result.manifest.outputSha256).toBe(brandedSha256);
    expect(result.manifest.heroBrandAssetId).toBe(brand.brandAssetId);
    expect(result.manifest.heroBrandDriveFileId).toBe(brand.driveFileId);
    expect(result.manifest.heroBrandSha256).toBe(brand.sha256);
    expect(result.manifest.publicationEligible).toBe(false);
    expect(deps.store).toHaveBeenCalledWith(
      expect.objectContaining({
        contentItemId: 'CONTENT-1',
        routeType: 'REAL_PHOTO_TO_MOTION_VIDEO',
        expectedSha256: brandedSha256,
      }),
    );
    expect(deps.writeCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateSha256: brandedSha256,
        candidateArtifactRef: artifactRef,
      }),
    );
    expect(deps.store.mock.invocationCallOrder[0]).toBeLessThan(
      deps.writeCandidate.mock.invocationCallOrder[0]!,
    );
  });

  it('does not write GENERATED_REVIEW_REQUIRED state when durable artifact persistence fails', async () => {
    const deps = dependencies(true);
    const service = new ControlledPhotoToVideoGenerationService(deps);

    await expect(
      service.generate({
        contentItemId: 'CONTENT-1',
        routeType: 'REAL_PHOTO_TO_MOTION_VIDEO',
      }),
    ).rejects.toThrow('artifact store unavailable');
    expect(deps.writeCandidate).not.toHaveBeenCalled();
  });

  it('fails before policy/canonical/provider work when the trusted clock is invalid', async () => {
    const deps = dependencies();
    const service = new ControlledPhotoToVideoGenerationService({
      ...deps,
      now: () => new Date(Number.NaN),
    });

    await expect(
      service.generate({
        contentItemId: 'CONTENT-1',
        routeType: 'REAL_PHOTO_TO_MOTION_VIDEO',
      }),
    ).rejects.toThrow('PHOTO_TO_VIDEO_TRUSTED_CLOCK_INVALID');
    expect(deps.assertCanonical).not.toHaveBeenCalled();
    expect(deps.resolve).not.toHaveBeenCalled();
    expect(deps.store).not.toHaveBeenCalled();
    expect(deps.writeCandidate).not.toHaveBeenCalled();
  });
});
