import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { BrandAsset } from '../src/contracts/creative-truth.js';
import type {
  PhotoToVideoCandidateManifest,
  PhotoToVideoReviewEvidence,
} from '../src/contracts/photo-to-video.js';
import { ControlledPhotoToVideoFinalizationService } from '../src/creative/controlled-photo-to-video-finalization.js';
import type { PhotoToVideoArtifactStore } from '../src/providers/gcp/gcs-photo-to-video-artifact-store.js';
import type { CreativeTruthBrandAssetLoader } from '../src/providers/google-drive/creative-truth-brand-asset-loader.js';
import type { CreativeVideoSourceLoader } from '../src/providers/google-drive/creative-video-source-loader.js';
import type { PhotoToVideoContentWriteback } from '../src/providers/google-sheets/photo-to-video-content-writeback.js';
import type { PhotoToVideoParentPolicyGuard } from '../src/providers/google-sheets/photo-to-video-policy-guard.js';
import type {
  PhotoToVideoRegistry,
  ResolvedPhotoToVideoContext,
} from '../src/providers/google-sheets/photo-to-video-registry.js';

const outputBytes = Uint8Array.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]);
const outputSha256 = createHash('sha256').update(outputBytes).digest('hex');
const sourceSha256 = 'a'.repeat(64);
const heroBrandSha256 = 'd'.repeat(64);
const artifactRef =
  'gcs://toca-bucket/instagram/photo-motion-review-v1/photo-video-1234567890abcdef12345678-aaaaaaaaaaaaaaaa.mp4';
const artifactObjectName =
  'instagram/photo-motion-review-v1/photo-video-1234567890abcdef12345678-aaaaaaaaaaaaaaaa.mp4';

function brand(party = false): BrandAsset {
  return {
    brandAssetId: party ? 'BRAND-THE-PARTY-WHITE-V1' : 'BRAND-TOCA-WHITE-V1',
    brand: party ? 'THE_PARTY' : 'TOCA_DO_MORCEGO',
    variant: 'WHITE',
    driveFileId: party ? 'party-brand-drive' : 'brand-drive',
    fileName: party ? 'THE_PARTY_WHITE.png' : 'TOCA_WHITE.png',
    contentType: 'image/png',
    integrityMode: 'SHA256_PINNED',
    sha256: heroBrandSha256,
    status: 'ACTIVE_APPROVED',
    aiReconstructionAllowed: false,
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
    rights: { ...base.rights, sourceAssetId: 'TP-0130', operation: 'THE_PARTY' },
  };
}

function candidate(party = false): PhotoToVideoCandidateManifest {
  return {
    schemaVersion: 1,
    status: 'GENERATED_REVIEW_REQUIRED',
    policyId: 'TOCA_PHOTO_TO_VIDEO_POLICY_V1',
    contentItemId: party ? 'TP-CONTENT-1' : 'CONTENT-1',
    productId: party ? 'THE_PARTY' : 'SUNSET',
    operation: party ? 'THE_PARTY' : 'SUNSET',
    outputType: 'REEL',
    routeType: 'REAL_PHOTO_TO_MOTION_VIDEO',
    standardId: party ? 'THE_PARTY_REEL_PHOTO_MOTION_V1' : 'SUNSET_REEL_PHOTO_MOTION_V1',
    standardVersion: '1.0',
    inheritedVisualStandardId: party ? 'THE_PARTY_HYBRID_NETWORKS_V1' : 'SUNSET_FEED_V1',
    sourceAssetId: party ? 'TP-0130' : 'SUN-0244',
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
    ...(party
      ? {
          thePartyEditionId: 'TP-EDITION-1',
          thePartyIntent: 'EVENT',
          thePartyEnvironment: 'INTERNATIONAL' as const,
        }
      : {}),
    heroBrandAssetId: party ? 'BRAND-THE-PARTY-WHITE-V1' : 'BRAND-TOCA-WHITE-V1',
    heroBrandDriveFileId: party ? 'party-brand-drive' : 'brand-drive',
    heroBrandSha256,
    brandAssetIds: [party ? 'BRAND-THE-PARTY-WHITE-V1' : 'BRAND-TOCA-WHITE-V1'],
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

function dependencies(current = resolved(), policyFailure?: string) {
  const assertCanonical = vi.fn(async () => {
    if (policyFailure) throw new Error(policyFailure);
  });
  const resolve = vi.fn(async () => current);
  const recordFinalOutput = vi.fn(async () => undefined);
  const writeFinal = vi.fn(async () => undefined);
  const loadExact = vi.fn(async () => outputBytes);
  const sourceLoad = vi.fn(async () => ({
    bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
    contentType: 'image/jpeg' as const,
    driveFileId: 'master-drive',
    sha256: sourceSha256,
  }));
  const currentBrand = brand(current.content.operation === 'THE_PARTY');
  const brandLoad = vi.fn(async () => ({
    registry: currentBrand,
    bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    contentType: 'image/png' as const,
    driveFileId: currentBrand.driveFileId,
    aiGenerated: false as const,
  }));

  const policyGuard: PhotoToVideoParentPolicyGuard = { assertCanonical };
  const registry: PhotoToVideoRegistry = {
    resolve,
    getBrandAsset: async () => currentBrand,
    recordFinalOutput,
  };
  const writeback: PhotoToVideoContentWriteback = {
    writeCandidate: async () => undefined,
    writeFinal,
  };
  const artifactStore: PhotoToVideoArtifactStore = {
    loadExact,
    store: async () => ({
      artifactRef,
      objectName: artifactObjectName,
      sha256: outputSha256,
      sizeBytes: outputBytes.byteLength,
      contentType: 'video/mp4',
    }),
  };
  const sourceLoader: CreativeVideoSourceLoader = { load: sourceLoad };
  const brandLoader: CreativeTruthBrandAssetLoader = { load: brandLoad };
  return {
    options: { policyGuard, registry, writeback, artifactStore, sourceLoader, brandLoader },
    assertCanonical,
    resolve,
    recordFinalOutput,
    writeFinal,
    loadExact,
    sourceLoad,
    brandLoad,
  };
}

describe('ControlledPhotoToVideoFinalizationService', () => {
  it('finalizes only durable exact reviewed bytes after policy source and official brand revalidation', async () => {
    const deps = dependencies();
    const service = new ControlledPhotoToVideoFinalizationService({
      ...deps.options,
      now: () => new Date('2026-08-18T08:00:00.000Z'),
    });
    const result = await service.finalize({ candidateManifest: candidate(), reviewEvidence: review() });

    expect(deps.assertCanonical).toHaveBeenCalledWith('REAL_PHOTO_TO_MOTION_VIDEO');
    expect(deps.assertCanonical.mock.invocationCallOrder[0]).toBeLessThan(
      deps.resolve.mock.invocationCallOrder[0]!,
    );
    expect(deps.sourceLoad).toHaveBeenCalledWith({
      driveFileId: 'master-drive',
      expectedSha256: sourceSha256,
    });
    expect(deps.brandLoad).toHaveBeenCalledTimes(1);
    expect(deps.loadExact).toHaveBeenCalledWith(artifactRef, outputSha256);
    expect(result.finalArtifactRef).toBe(artifactRef);
    expect(result.publicationAuthorized).toBe(false);
    expect(deps.recordFinalOutput).toHaveBeenCalledTimes(1);
    expect(deps.writeFinal).toHaveBeenCalledWith(
      expect.objectContaining({ finalAssetSha256: outputSha256, finalArtifactRef: artifactRef }),
    );
  });

  it('fails closed when the canonical parent policy is no longer valid', async () => {
    const deps = dependencies(resolved(), 'PHOTO_TO_VIDEO_PARENT_POLICY_DRIFT');
    const service = new ControlledPhotoToVideoFinalizationService({
      ...deps.options,
      now: () => new Date('2026-08-18T08:00:00.000Z'),
    });
    await expect(
      service.finalize({ candidateManifest: candidate(), reviewEvidence: review() }),
    ).rejects.toThrow('PHOTO_TO_VIDEO_PARENT_POLICY_DRIFT');
    expect(deps.resolve).not.toHaveBeenCalled();
    expect(deps.loadExact).not.toHaveBeenCalled();
  });

  it('fails closed when canonical standard changes after generation', async () => {
    const base = resolved();
    const deps = dependencies({
      ...base,
      standard: { ...base.standard, standardId: 'SUNSET_REEL_PHOTO_MOTION_V2' },
    });
    const service = new ControlledPhotoToVideoFinalizationService(deps.options);
    await expect(
      service.finalize({ candidateManifest: candidate(), reviewEvidence: review() }),
    ).rejects.toThrow('PHOTO_TO_VIDEO_CANONICAL_CONTEXT_CHANGED');
    expect(deps.writeFinal).not.toHaveBeenCalled();
  });

  it('fails closed when The Party edition environment changes after generation', async () => {
    const deps = dependencies(partyResolved('NATIONAL'));
    const service = new ControlledPhotoToVideoFinalizationService({
      ...deps.options,
      now: () => new Date('2026-08-18T08:00:00.000Z'),
    });
    await expect(
      service.finalize({ candidateManifest: candidate(true), reviewEvidence: review() }),
    ).rejects.toThrow('PHOTO_TO_VIDEO_THE_PARTY_CONTEXT_CHANGED');
    expect(deps.writeFinal).not.toHaveBeenCalled();
  });

  it('rejects review evidence timestamped before candidate generation before policy/provider reads', async () => {
    const deps = dependencies();
    const service = new ControlledPhotoToVideoFinalizationService({
      ...deps.options,
      now: () => new Date('2026-08-18T08:00:00.000Z'),
    });
    await expect(
      service.finalize({
        candidateManifest: candidate(),
        reviewEvidence: { ...review(), reviewedAt: '2026-08-18T06:59:59.000Z' },
      }),
    ).rejects.toThrow('PHOTO_TO_VIDEO_REVIEW_TIME_INVALID');
    expect(deps.assertCanonical).not.toHaveBeenCalled();
    expect(deps.sourceLoad).not.toHaveBeenCalled();
    expect(deps.loadExact).not.toHaveBeenCalled();
  });
});
