import type {
  CreativeEnhancementProvenance,
  CreativeMode,
  CreativeStandard,
  DeterministicRenderManifest,
  FidelityEvidence,
  GenerativeExceptionApproval,
  VenueAsset,
  VenueReference,
} from '../../contracts/creative-truth.js';
import { assertVideoThumbnailCreativeTruth } from '../../content/video-thumbnail-creative-truth.js';
import { ExecutionError } from '../../core/errors.js';
import {
  LocalCreativeComposer,
  type CreativeCanvas,
  type LocalCreativeComposerCommandRunner,
  type OfficialBrandAssetInput,
  type ThePartyEnvironment,
} from './local-creative-composer.js';

const THE_PARTY_VISUAL_STANDARD_IDS = new Set([
  'THE_PARTY_HYBRID_NETWORKS_V1',
  'THE_PARTY_HYBRID_MINIMALIST_V1',
]);

export type ThumbnailCanvas = CreativeCanvas;

export interface LocalThumbnailComposeInput {
  readonly thumbnailCreativeId: string;
  readonly contentItemId: string;
  readonly standard: CreativeStandard;
  readonly visualStandard?: CreativeStandard;
  readonly creativeMode: CreativeMode;
  readonly venueAsset?: VenueAsset;
  readonly imageBytes: Uint8Array;
  readonly contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly enhancementProvenance?: CreativeEnhancementProvenance;
  readonly canvas: ThumbnailCanvas;
  readonly headline?: string;
  readonly supportCopy?: string;
  readonly functionalInfo?: string;
  readonly partyEnvironment?: ThePartyEnvironment;
  readonly requiredBrands: readonly string[];
  readonly brandAssets: readonly OfficialBrandAssetInput[];
  readonly generativeException?: GenerativeExceptionApproval;
  readonly references?: readonly VenueReference[];
  readonly fidelityEvidence?: FidelityEvidence;
  readonly createdAt?: string;
}

export interface LocalThumbnailComposeResult {
  readonly thumbnailCreativeId: string;
  readonly contentItemId: string;
  readonly outputBytes: Uint8Array;
  readonly outputContentType: 'image/jpeg';
  readonly outputSha256: string;
  readonly dimensions: ThumbnailCanvas;
  readonly manifest: DeterministicRenderManifest;
  readonly provider: 'LOCAL_IMAGEMAGICK';
  readonly pipelineVersion: 'local-thumbnail-composer-v1';
  readonly readyForReview: true;
}

export class LocalThumbnailComposer {
  private readonly composer: LocalCreativeComposer;

  constructor(
    commandRunner?: LocalCreativeComposerCommandRunner,
    binary = process.env.IMAGE_MAGICK_CONVERT_BINARY?.trim() || 'convert',
  ) {
    this.composer = commandRunner
      ? new LocalCreativeComposer(commandRunner, binary)
      : new LocalCreativeComposer(undefined, binary);
  }

  async compose(input: LocalThumbnailComposeInput): Promise<LocalThumbnailComposeResult> {
    if (input.standard.standardId !== 'TOCA_THUMBNAIL_V1' || input.standard.format !== 'THUMBNAIL') {
      throw new ExecutionError('POLICY_DENIED', 'TOCA_THUMBNAIL_STANDARD_REQUIRED', false);
    }

    const renderStandard = resolveRenderStandard(input);
    const composed = await this.composer.compose({
      contentItemId: input.contentItemId,
      creativeId: input.thumbnailCreativeId,
      standard: renderStandard,
      creativeMode: input.creativeMode,
      ...(input.venueAsset ? { venueAsset: input.venueAsset } : {}),
      sourceImageBytes: input.imageBytes,
      sourceContentType: input.contentType,
      ...(input.enhancementProvenance
        ? { enhancementProvenance: input.enhancementProvenance }
        : {}),
      canvas: input.canvas,
      ...(input.headline?.trim() ? { headline: input.headline.trim() } : {}),
      ...(input.supportCopy?.trim() ? { supportCopy: input.supportCopy.trim() } : {}),
      ...(input.functionalInfo?.trim() ? { functionalInfo: input.functionalInfo.trim() } : {}),
      ...(input.partyEnvironment ? { partyEnvironment: input.partyEnvironment } : {}),
      requiredBrands: input.requiredBrands,
      brandAssets: input.brandAssets,
      ...(input.generativeException ? { generativeException: input.generativeException } : {}),
      ...(input.references ? { references: input.references } : {}),
      ...(input.fidelityEvidence ? { fidelityEvidence: input.fidelityEvidence } : {}),
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    });

    const manifest: DeterministicRenderManifest = {
      ...composed.manifest,
      standardId: input.standard.standardId,
    };
    const inheritedVisualStandardId =
      renderStandard.standardId === input.standard.standardId ? undefined : renderStandard.standardId;

    assertVideoThumbnailCreativeTruth(
      input.contentItemId,
      manifest,
      composed.outputSha256,
      inheritedVisualStandardId,
    );

    return {
      thumbnailCreativeId: input.thumbnailCreativeId,
      contentItemId: input.contentItemId,
      outputBytes: composed.outputBytes,
      outputContentType: composed.outputContentType,
      outputSha256: composed.outputSha256,
      dimensions: composed.dimensions,
      manifest,
      provider: composed.provider,
      pipelineVersion: 'local-thumbnail-composer-v1',
      readyForReview: true,
    };
  }
}

function resolveRenderStandard(input: LocalThumbnailComposeInput): CreativeStandard {
  const visualStandard = input.visualStandard;
  const isTheParty = input.requiredBrands.includes('THE_PARTY');

  if (isTheParty) {
    if (
      !visualStandard ||
      visualStandard.operation !== 'THE_PARTY' ||
      !THE_PARTY_VISUAL_STANDARD_IDS.has(visualStandard.standardId)
    ) {
      throw new ExecutionError('POLICY_DENIED', 'THE_PARTY_THUMBNAIL_VISUAL_STANDARD_REQUIRED', false);
    }
    if (
      visualStandard.standardId === 'THE_PARTY_HYBRID_NETWORKS_V1' &&
      !input.partyEnvironment
    ) {
      throw new ExecutionError('POLICY_DENIED', 'THE_PARTY_ENVIRONMENT_REQUIRED', false);
    }
    return visualStandard;
  }

  if (visualStandard) {
    if (
      input.venueAsset &&
      visualStandard.operation !== 'ALL' &&
      visualStandard.operation !== input.venueAsset.operation
    ) {
      throw new ExecutionError('POLICY_DENIED', 'FAILED_STANDARD_NOT_RESOLVED', false);
    }
    return visualStandard;
  }

  return input.standard;
}
