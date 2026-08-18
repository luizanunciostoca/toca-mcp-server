import {
  TOCA_PHOTO_TO_VIDEO_POLICY_ID,
  photoToVideoCandidateManifestSchema,
  type PhotoToVideoCandidateManifest,
  type PhotoToVideoRouteType,
} from '../contracts/photo-to-video.js';
import { ExecutionError } from '../core/errors.js';
import type { CreativeTruthBrandAssetLoader } from '../providers/google-drive/creative-truth-brand-asset-loader.js';
import type { CreativeVideoSourceLoader } from '../providers/google-drive/creative-video-source-loader.js';
import type { PhotoToVideoContentWriteback } from '../providers/google-sheets/photo-to-video-content-writeback.js';
import type { PhotoToVideoRegistry } from '../providers/google-sheets/photo-to-video-registry.js';
import type { LocalPhotoMotionVideoComposer } from '../providers/local/local-photo-motion-video-composer.js';
import type { LocalPhotoToVideoBrandComposer } from '../providers/local/local-photo-to-video-brand-composer.js';
import type { OpenAiSceneContinuationVideoProvider } from '../providers/openai/openai-scene-continuation-video-provider.js';

export interface ControlledPhotoToVideoGenerationOptions {
  readonly registry: PhotoToVideoRegistry;
  readonly writeback: PhotoToVideoContentWriteback;
  readonly sourceLoader: CreativeVideoSourceLoader;
  readonly brandLoader: CreativeTruthBrandAssetLoader;
  readonly photoMotionComposer: LocalPhotoMotionVideoComposer;
  readonly sceneContinuationProvider: OpenAiSceneContinuationVideoProvider;
  readonly brandComposer: LocalPhotoToVideoBrandComposer;
  readonly now?: () => Date;
}

export interface ControlledPhotoToVideoGenerationRequest {
  readonly contentItemId: string;
  readonly routeType: PhotoToVideoRouteType;
  readonly creativeDirection?: string;
}

export interface ControlledPhotoToVideoGenerationResult {
  readonly outputBytes: Uint8Array;
  readonly manifest: PhotoToVideoCandidateManifest;
}

export class ControlledPhotoToVideoGenerationService {
  private readonly now: () => Date;

  constructor(private readonly options: ControlledPhotoToVideoGenerationOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async generate(
    request: ControlledPhotoToVideoGenerationRequest,
  ): Promise<ControlledPhotoToVideoGenerationResult> {
    if (!request.contentItemId.trim()) {
      throw new ExecutionError('POLICY_DENIED', 'PHOTO_TO_VIDEO_CONTENT_ITEM_ID_REQUIRED', false);
    }
    if (
      request.routeType === 'GENERATIVE_SCENE_CONTINUATION_VIDEO' &&
      !request.creativeDirection?.trim()
    ) {
      throw new ExecutionError(
        'POLICY_DENIED',
        'SCENE_CONTINUATION_CREATIVE_DIRECTION_REQUIRED',
        false,
      );
    }

    const resolved = await this.options.registry.resolve(request.contentItemId, request.routeType);
    const masterDriveFileId = resolved.venueAsset.masterDriveFileId;
    const masterSha256 = resolved.venueAsset.masterSha256;
    if (!masterDriveFileId || !masterSha256) {
      throw new ExecutionError(
        'SOURCE_IMAGE_BINDING_FAILURE',
        'PHOTO_TO_VIDEO_MASTER_BINDING_REQUIRED',
        false,
      );
    }
    const source = await this.options.sourceLoader.load({
      driveFileId: masterDriveFileId,
      expectedSha256: masterSha256,
    });

    let providerCandidate:
      | {
          readonly outputBytes: Uint8Array;
          readonly outputSha256: string;
          readonly provider: 'LOCAL_FFMPEG';
        }
      | {
          readonly outputBytes: Uint8Array;
          readonly outputSha256: string;
          readonly provider: 'OPENAI_VIDEO_API';
          readonly providerJobId: string;
          readonly providerModel: 'sora-2' | 'sora-2-pro';
        };

    if (request.routeType === 'REAL_PHOTO_TO_MOTION_VIDEO') {
      providerCandidate = await this.options.photoMotionComposer.compose({
        sourceBytes: source.bytes,
        sourceContentType: source.contentType,
        sourceSha256: source.sha256,
        seconds: resolved.standard.seconds,
        size: resolved.standard.size,
        motionPreset: resolved.standard.motionPreset,
      });
    } else {
      const approval = resolved.approval;
      if (!approval) {
        throw new ExecutionError(
          'APPROVAL_REQUIRED',
          'VIDEO_SCENE_CONTINUATION_APPROVAL_REQUIRED',
          false,
        );
      }
      providerCandidate = await this.options.sceneContinuationProvider.generate({
        contentItemId: resolved.content.contentItemId,
        operation: resolved.content.operation,
        productId: resolved.content.productId,
        inheritedVisualStandardId: resolved.content.inheritedVisualStandardId,
        source,
        approval,
        prompt: request.creativeDirection!.trim(),
        seconds: resolved.standard.seconds,
        size: resolved.standard.size,
        ...(resolved.content.thePartyContext?.environment
          ? { thePartyEnvironment: resolved.content.thePartyContext.environment }
          : {}),
        ...(resolved.content.thePartyContext?.editionId
          ? { thePartyEditionId: resolved.content.thePartyContext.editionId }
          : {}),
      });
    }

    const brandAsset = await this.options.registry.getBrandAsset(
      resolved.productPolicy.heroBrand,
      resolved.productPolicy.heroBrandVariant,
    );
    if (!brandAsset) {
      throw new ExecutionError('POLICY_DENIED', 'FAILED_BRAND_ASSET_MISSING', false);
    }
    const heroBrand = await this.options.brandLoader.load(brandAsset);
    const branded = await this.options.brandComposer.compose({
      candidateBytes: providerCandidate.outputBytes,
      candidateSha256: providerCandidate.outputSha256,
      standard: resolved.standard,
      heroBrand,
    });
    const createdAt = trustedNow(this.now);
    const manifest = photoToVideoCandidateManifestSchema.parse({
      schemaVersion: 1,
      status: 'GENERATED_REVIEW_REQUIRED',
      policyId: TOCA_PHOTO_TO_VIDEO_POLICY_ID,
      contentItemId: resolved.content.contentItemId,
      productId: resolved.content.productId,
      operation: resolved.content.operation,
      outputType: resolved.content.outputType,
      routeType: request.routeType,
      standardId: resolved.standard.standardId,
      standardVersion: resolved.standard.version,
      inheritedVisualStandardId: resolved.content.inheritedVisualStandardId,
      sourceAssetId: resolved.content.sourceAssetId,
      sourceDriveFileId: source.driveFileId,
      sourceSha256: source.sha256,
      providerCandidateSha256: providerCandidate.outputSha256,
      outputSha256: branded.outputSha256,
      outputContentType: branded.outputContentType,
      size: resolved.standard.size,
      seconds: resolved.standard.seconds,
      provider: providerCandidate.provider,
      ...('providerJobId' in providerCandidate
        ? {
            providerJobId: providerCandidate.providerJobId,
            providerModel: providerCandidate.providerModel,
            exceptionId: resolved.approval?.exceptionId,
            approvalRef: resolved.approval?.approvalRef,
          }
        : {}),
      brandAssetIds: branded.brandAssetIds,
      exactAssetBinding: true,
      requiresPostGenerationHumanReview: true,
      requiresSceneContinuationFidelityGate:
        request.routeType === 'GENERATIVE_SCENE_CONTINUATION_VIDEO',
      publicationEligible: false,
      createdAt,
    });

    await this.options.writeback.writeCandidate({
      contentItemId: manifest.contentItemId,
      productId: manifest.productId,
      routeType: manifest.routeType,
      standardId: manifest.standardId,
      candidateSha256: manifest.outputSha256,
      ...(manifest.providerJobId ? { providerJobId: manifest.providerJobId } : {}),
    });

    return { outputBytes: branded.outputBytes, manifest };
  }
}

function trustedNow(now: () => Date): string {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new ExecutionError('POLICY_DENIED', 'PHOTO_TO_VIDEO_TRUSTED_CLOCK_INVALID', false);
  }
  return value.toISOString();
}
