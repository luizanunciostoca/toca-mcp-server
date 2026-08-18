import { createHash } from 'node:crypto';
import {
  photoToVideoCandidateManifestSchema,
  photoToVideoFinalManifestSchema,
  photoToVideoReviewEvidenceSchema,
  type PhotoToVideoCandidateManifest,
  type PhotoToVideoFinalManifest,
  type PhotoToVideoReviewEvidence,
} from '../contracts/photo-to-video.js';
import { ExecutionError } from '../core/errors.js';
import type { PhotoToVideoArtifactStore } from '../providers/gcp/gcs-photo-to-video-artifact-store.js';
import type { CreativeTruthBrandAssetLoader } from '../providers/google-drive/creative-truth-brand-asset-loader.js';
import type { CreativeVideoSourceLoader } from '../providers/google-drive/creative-video-source-loader.js';
import type { PhotoToVideoContentWriteback } from '../providers/google-sheets/photo-to-video-content-writeback.js';
import type {
  PhotoToVideoRegistry,
  ResolvedPhotoToVideoContext,
} from '../providers/google-sheets/photo-to-video-registry.js';

export interface ControlledPhotoToVideoFinalizationOptions {
  readonly registry: PhotoToVideoRegistry;
  readonly writeback: PhotoToVideoContentWriteback;
  readonly artifactStore: PhotoToVideoArtifactStore;
  readonly sourceLoader: CreativeVideoSourceLoader;
  readonly brandLoader: CreativeTruthBrandAssetLoader;
  readonly now?: () => Date;
}

export interface ControlledPhotoToVideoFinalizationRequest {
  readonly candidateManifest: PhotoToVideoCandidateManifest;
  readonly reviewEvidence: PhotoToVideoReviewEvidence;
}

export class ControlledPhotoToVideoFinalizationService {
  private readonly now: () => Date;

  constructor(private readonly options: ControlledPhotoToVideoFinalizationOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async finalize(
    request: ControlledPhotoToVideoFinalizationRequest,
  ): Promise<PhotoToVideoFinalManifest> {
    const candidate = photoToVideoCandidateManifestSchema.parse(request.candidateManifest);
    const review = photoToVideoReviewEvidenceSchema.parse(request.reviewEvidence);
    const finalizedAt = trustedNow(this.now);
    assertReviewTime(candidate.createdAt, review.reviewedAt, finalizedAt);

    if (review.candidateSha256.toLowerCase() !== candidate.outputSha256.toLowerCase()) {
      throw new ExecutionError(
        'FIDELITY_GATE_FAILED',
        'PHOTO_TO_VIDEO_REVIEW_ASSET_BINDING_MISMATCH',
        false,
      );
    }
    if (
      candidate.routeType === 'GENERATIVE_SCENE_CONTINUATION_VIDEO' &&
      review.sceneContinuationFidelity !== 'PASS'
    ) {
      throw new ExecutionError(
        'FIDELITY_GATE_FAILED',
        'SCENE_CONTINUATION_FIDELITY_REVIEW_REQUIRED',
        false,
      );
    }
    if (
      candidate.routeType === 'REAL_PHOTO_TO_MOTION_VIDEO' &&
      review.sceneContinuationFidelity !== 'NOT_APPLICABLE'
    ) {
      throw new ExecutionError(
        'POLICY_DENIED',
        'PHOTO_MOTION_SCENE_CONTINUATION_REVIEW_INVALID',
        false,
      );
    }

    const current = await this.options.registry.resolve(
      candidate.contentItemId,
      candidate.routeType,
    );
    assertCanonicalContext(candidate, current);
    assertPartyContext(candidate, current);

    await this.options.sourceLoader.load({
      driveFileId: candidate.sourceDriveFileId,
      expectedSha256: candidate.sourceSha256,
    });

    const currentBrand = await this.options.registry.getBrandAsset(
      current.productPolicy.heroBrand,
      current.productPolicy.heroBrandVariant,
    );
    if (
      !currentBrand ||
      currentBrand.brandAssetId !== candidate.heroBrandAssetId ||
      currentBrand.driveFileId !== candidate.heroBrandDriveFileId ||
      currentBrand.sha256?.toLowerCase() !== candidate.heroBrandSha256.toLowerCase() ||
      candidate.brandAssetIds.length !== 1 ||
      candidate.brandAssetIds[0] !== candidate.heroBrandAssetId
    ) {
      throw new ExecutionError(
        'STATE_CONFLICT',
        'PHOTO_TO_VIDEO_HERO_BRAND_CONTEXT_CHANGED',
        false,
      );
    }
    await this.options.brandLoader.load(currentBrand);

    const outputBytes = await this.options.artifactStore.loadExact(
      candidate.artifactRef,
      candidate.outputSha256,
    );
    const outputSha256 = sha256(outputBytes);
    if (!isMp4(outputBytes) || outputSha256 !== candidate.outputSha256.toLowerCase()) {
      throw new ExecutionError(
        'SOURCE_IMAGE_BINDING_FAILURE',
        'PHOTO_TO_VIDEO_FINAL_ASSET_HASH_MISMATCH',
        false,
      );
    }

    if (candidate.routeType === 'GENERATIVE_SCENE_CONTINUATION_VIDEO') {
      if (
        !current.approval ||
        current.approval.exceptionId !== candidate.exceptionId ||
        current.approval.approvalRef !== candidate.approvalRef
      ) {
        throw new ExecutionError(
          'APPROVAL_REQUIRED',
          'VIDEO_SCENE_CONTINUATION_APPROVAL_CHANGED',
          false,
        );
      }
    }

    const outputEvidenceId = `VIDEO-${candidate.contentItemId}-${outputSha256.slice(0, 16)}`;
    const finalManifest = photoToVideoFinalManifestSchema.parse({
      schemaVersion: 1,
      status: 'VIDEO_CREATIVE_TRUTH_PASSED',
      candidate,
      review,
      finalAssetSha256: outputSha256,
      finalArtifactRef: candidate.artifactRef,
      exactAssetBinding: true,
      readyForPrepare: true,
      publicationAuthorized: false,
      finalizedAt,
    });

    await this.options.registry.recordFinalOutput({
      outputId: outputEvidenceId,
      contentItemId: candidate.contentItemId,
      productId: candidate.productId,
      operation: candidate.operation,
      routeType: candidate.routeType,
      standardId: candidate.standardId,
      sourceAssetId: candidate.sourceAssetId,
      sourceSha256: candidate.sourceSha256,
      outputSha256,
      reviewer: review.reviewer,
      reviewedAt: review.reviewedAt,
      venueFidelity: review.venueFidelity,
      brandIntegrity: review.brandIntegrity,
      quality: review.quality,
      sceneContinuationFidelity: review.sceneContinuationFidelity,
      status: 'VIDEO_CREATIVE_TRUTH_PASSED',
      finalizedAt,
      reviewMethod: review.reviewMethod,
      reviewEvidenceRef: review.evidenceRef,
      sourceImageCompared: review.sourceImageCompared,
    });
    await this.options.writeback.writeFinal({
      contentItemId: candidate.contentItemId,
      routeType: candidate.routeType,
      standardId: candidate.standardId,
      candidateSha256: candidate.outputSha256,
      finalAssetSha256: outputSha256,
      finalArtifactRef: candidate.artifactRef,
      outputEvidenceId,
    });

    return finalManifest;
  }
}

function assertCanonicalContext(
  candidate: PhotoToVideoCandidateManifest,
  current: ResolvedPhotoToVideoContext,
): void {
  if (
    current.content.productId !== candidate.productId ||
    current.content.operation !== candidate.operation ||
    current.content.outputType !== candidate.outputType ||
    current.content.inheritedVisualStandardId !== candidate.inheritedVisualStandardId ||
    current.content.sourceAssetId !== candidate.sourceAssetId ||
    current.standard.standardId !== candidate.standardId ||
    current.standard.version !== candidate.standardVersion ||
    current.standard.size !== candidate.size ||
    current.standard.seconds !== candidate.seconds ||
    current.venueAsset.masterDriveFileId !== candidate.sourceDriveFileId ||
    current.venueAsset.masterSha256?.toLowerCase() !== candidate.sourceSha256.toLowerCase()
  ) {
    throw new ExecutionError(
      'STATE_CONFLICT',
      'PHOTO_TO_VIDEO_CANONICAL_CONTEXT_CHANGED',
      false,
    );
  }
}

function assertPartyContext(
  candidate: PhotoToVideoCandidateManifest,
  current: ResolvedPhotoToVideoContext,
): void {
  if (candidate.operation !== 'THE_PARTY') return;
  const party = current.content.thePartyContext;
  if (
    !party ||
    party.editionId !== candidate.thePartyEditionId ||
    party.intent !== candidate.thePartyIntent ||
    (party.environment ?? undefined) !== (candidate.thePartyEnvironment ?? undefined)
  ) {
    throw new ExecutionError(
      'STATE_CONFLICT',
      'PHOTO_TO_VIDEO_THE_PARTY_CONTEXT_CHANGED',
      false,
    );
  }
}

function assertReviewTime(createdAt: string, reviewedAt: string, finalizedAt: string): void {
  const created = Date.parse(createdAt);
  const reviewed = Date.parse(reviewedAt);
  const finalized = Date.parse(finalizedAt);
  if (
    !Number.isFinite(created) ||
    !Number.isFinite(reviewed) ||
    !Number.isFinite(finalized) ||
    reviewed < created ||
    reviewed > finalized
  ) {
    throw new ExecutionError('POLICY_DENIED', 'PHOTO_TO_VIDEO_REVIEW_TIME_INVALID', false);
  }
}

function trustedNow(now: () => Date): string {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new ExecutionError('POLICY_DENIED', 'PHOTO_TO_VIDEO_TRUSTED_CLOCK_INVALID', false);
  }
  return value.toISOString();
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isMp4(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp';
}
