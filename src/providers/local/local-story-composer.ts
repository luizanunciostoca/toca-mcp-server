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
import { ExecutionError } from '../../core/errors.js';
import {
  LocalCreativeComposer,
  type LocalCreativeComposerCommandRunner,
  type OfficialBrandAssetInput,
  type ThePartyEnvironment,
} from './local-creative-composer.js';
import {
  LocalSunsetStoryRenderer,
  SUNSET_STORY_STANDARD_ID,
  type SunsetStoryTemplateClass,
} from './local-sunset-story-renderer.js';

const THE_PARTY_STORY_STANDARD_IDS = new Set([
  'THE_PARTY_HYBRID_NETWORKS_V1',
  'THE_PARTY_HYBRID_MINIMALIST_V1',
]);
const SUNSET_STORY_TEMPLATE_CLASSES = new Set<string>([
  'SUNSET_HERO_LIFESTYLE',
  'SUNSET_VIEW_SCENERY',
  'SUNSET_SOCIAL_EXPERIENCE',
  'SUNSET_DRINKS_EXPERIENCE',
  'SUNSET_INFO_HOURS',
]);

export type StoryTemplateId = 'PHOTO_ONLY' | 'EDITORIAL_TEXT' | 'EVENT_CTA';

export interface LocalStoryComposeInput {
  readonly storyCreativeId: string;
  readonly contentItemId: string;
  readonly masterAssetId?: string;
  readonly masterDriveFileId?: string;
  readonly imageBytes: Uint8Array;
  readonly contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly enhancementProvenance?: CreativeEnhancementProvenance;
  readonly templateId: StoryTemplateId;
  readonly message?: string;
  readonly supportCopy?: string;
  readonly cta?: string;
  readonly functionalInfo?: string;
  readonly sunsetTemplateClass?: SunsetStoryTemplateClass;
  readonly standard: CreativeStandard;
  readonly creativeMode: CreativeMode;
  readonly venueAsset?: VenueAsset;
  readonly partyEnvironment?: ThePartyEnvironment;
  readonly requiredBrands: readonly string[];
  readonly brandAssets: readonly OfficialBrandAssetInput[];
  readonly generativeException?: GenerativeExceptionApproval;
  readonly references?: readonly VenueReference[];
  readonly fidelityEvidence?: FidelityEvidence;
  readonly createdAt?: string;
}

export interface LocalStoryComposeResult {
  readonly storyCreativeId: string;
  readonly contentItemId: string;
  readonly masterAssetId?: string;
  readonly masterDriveFileId?: string;
  readonly masterSha256?: string;
  readonly outputSha256: string;
  readonly sourceImageBound: true;
  readonly editorProvider: 'LOCAL_IMAGEMAGICK';
  readonly pipelineVersion: 'local-story-composer-v1';
  readonly dimensions: '1080x1920';
  readonly aspectRatio: '9:16';
  readonly templateId: StoryTemplateId;
  readonly outputContentType: 'image/jpeg';
  readonly outputBytes: Uint8Array;
  readonly manifest: DeterministicRenderManifest;
  readonly storyReady: true;
}

export type LocalStoryComposerCommandRunner = LocalCreativeComposerCommandRunner;

export class LocalStoryComposer {
  private readonly composer: LocalCreativeComposer;
  private readonly sunsetRenderer: LocalSunsetStoryRenderer;

  constructor(
    commandRunner?: LocalStoryComposerCommandRunner,
    binary = process.env.IMAGE_MAGICK_CONVERT_BINARY?.trim() || 'convert',
  ) {
    this.composer = commandRunner
      ? new LocalCreativeComposer(commandRunner, binary)
      : new LocalCreativeComposer(undefined, binary);
    this.sunsetRenderer = commandRunner
      ? new LocalSunsetStoryRenderer(commandRunner, binary)
      : new LocalSunsetStoryRenderer(undefined, binary);
  }

  async compose(input: LocalStoryComposeInput): Promise<LocalStoryComposeResult> {
    validateInput(input);
    assertStoryLineage(input);

    const composed =
      input.standard.standardId === SUNSET_STORY_STANDARD_ID
        ? await this.sunsetRenderer.compose({
            contentItemId: input.contentItemId,
            creativeId: input.storyCreativeId,
            standard: input.standard,
            creativeMode: input.creativeMode,
            venueAsset: input.venueAsset!,
            sourceImageBytes: input.imageBytes,
            sourceContentType: input.contentType,
            ...(input.enhancementProvenance
              ? { enhancementProvenance: input.enhancementProvenance }
              : {}),
            templateClass: resolveSunsetTemplateClass(input),
            ...(input.templateId === 'PHOTO_ONLY' ? {} : { headline: input.message!.trim() }),
            ...(input.supportCopy?.trim() ? { supportCopy: input.supportCopy.trim() } : {}),
            ...(input.cta?.trim() ? { cta: input.cta.trim() } : {}),
            ...(input.functionalInfo?.trim()
              ? { functionalInfo: input.functionalInfo.trim() }
              : {}),
            requiredBrands: input.requiredBrands,
            brandAssets: input.brandAssets,
            ...(input.fidelityEvidence ? { fidelityEvidence: input.fidelityEvidence } : {}),
            ...(input.createdAt ? { createdAt: input.createdAt } : {}),
          })
        : await this.composer.compose({
            contentItemId: input.contentItemId,
            creativeId: input.storyCreativeId,
            standard: input.standard,
            creativeMode: input.creativeMode,
            ...(input.venueAsset ? { venueAsset: input.venueAsset } : {}),
            sourceImageBytes: input.imageBytes,
            sourceContentType: input.contentType,
            ...(input.enhancementProvenance
              ? { enhancementProvenance: input.enhancementProvenance }
              : {}),
            canvas: '1080x1920',
            ...(input.templateId === 'PHOTO_ONLY' ? {} : { headline: input.message!.trim() }),
            ...(input.supportCopy?.trim() ? { supportCopy: input.supportCopy.trim() } : {}),
            ...(input.cta?.trim() ? { cta: input.cta.trim() } : {}),
            ...(input.functionalInfo?.trim()
              ? { functionalInfo: input.functionalInfo.trim() }
              : {}),
            ...(input.partyEnvironment ? { partyEnvironment: input.partyEnvironment } : {}),
            requiredBrands: input.requiredBrands,
            brandAssets: input.brandAssets,
            ...(input.generativeException ? { generativeException: input.generativeException } : {}),
            ...(input.references ? { references: input.references } : {}),
            ...(input.fidelityEvidence ? { fidelityEvidence: input.fidelityEvidence } : {}),
            ...(input.createdAt ? { createdAt: input.createdAt } : {}),
          });

    const realMasterSha256 =
      input.creativeMode === 'GENERATIVE_EXCEPTION' ? undefined : input.venueAsset?.masterSha256;
    return {
      storyCreativeId: input.storyCreativeId,
      contentItemId: input.contentItemId,
      ...(input.masterAssetId ? { masterAssetId: input.masterAssetId } : {}),
      ...(input.masterDriveFileId ? { masterDriveFileId: input.masterDriveFileId } : {}),
      ...(realMasterSha256 ? { masterSha256: realMasterSha256 } : {}),
      outputSha256: composed.outputSha256,
      sourceImageBound: true,
      editorProvider: 'LOCAL_IMAGEMAGICK',
      pipelineVersion: 'local-story-composer-v1',
      dimensions: '1080x1920',
      aspectRatio: '9:16',
      templateId: input.templateId,
      outputContentType: composed.outputContentType,
      outputBytes: composed.outputBytes,
      manifest: composed.manifest,
      storyReady: true,
    };
  }
}

function validateInput(input: LocalStoryComposeInput): void {
  if (!input.storyCreativeId.trim() || !input.contentItemId.trim()) {
    throw new ExecutionError(
      'SOURCE_IMAGE_BINDING_FAILURE',
      'LOCAL_STORY_COMPOSER_LINEAGE_REQUIRED',
      false,
    );
  }
  if (input.imageBytes.byteLength === 0) {
    throw new ExecutionError(
      'SOURCE_IMAGE_BINDING_FAILURE',
      'LOCAL_STORY_COMPOSER_MASTER_BYTES_REQUIRED',
      false,
    );
  }
  const thePartyStoryStandard = isThePartyStoryStandard(input.standard);
  if (!input.standard.format.toUpperCase().includes('STOR') && !thePartyStoryStandard) {
    throw new ExecutionError('POLICY_DENIED', 'LOCAL_STORY_STANDARD_REQUIRED', false);
  }
  if (
    thePartyStoryStandard &&
    input.standard.standardId === 'THE_PARTY_HYBRID_NETWORKS_V1' &&
    !input.partyEnvironment
  ) {
    throw new ExecutionError('POLICY_DENIED', 'THE_PARTY_ENVIRONMENT_REQUIRED', false);
  }
  if (input.templateId !== 'PHOTO_ONLY' && !input.message?.trim()) {
    throw new ExecutionError('QUALITY_GATE_FAILED', 'LOCAL_STORY_COMPOSER_MESSAGE_REQUIRED', false);
  }
  if (
    (input.message?.trim().length ?? 0) > 90 ||
    (input.supportCopy?.trim().length ?? 0) > 160 ||
    (input.cta?.trim().length ?? 0) > 60
  ) {
    throw new ExecutionError('QUALITY_GATE_FAILED', 'LOCAL_STORY_COMPOSER_TEXT_TOO_LONG', false);
  }
}

function assertStoryLineage(input: LocalStoryComposeInput): void {
  if (input.creativeMode === 'GENERATIVE_EXCEPTION') return;
  if (
    !input.venueAsset ||
    !input.masterAssetId?.trim() ||
    !input.masterDriveFileId?.trim() ||
    input.venueAsset.masterAssetId !== input.masterAssetId ||
    input.venueAsset.masterDriveFileId !== input.masterDriveFileId
  ) {
    throw new ExecutionError(
      'SOURCE_IMAGE_BINDING_FAILURE',
      'LOCAL_STORY_COMPOSER_MASTER_BINDING_MISMATCH',
      false,
    );
  }
}

function resolveSunsetTemplateClass(input: LocalStoryComposeInput): SunsetStoryTemplateClass {
  if (input.sunsetTemplateClass) {
    if (!SUNSET_STORY_TEMPLATE_CLASSES.has(input.sunsetTemplateClass)) {
      throw new ExecutionError('POLICY_DENIED', 'FAILED_STANDARD_NOT_RESOLVED', false);
    }
    return input.sunsetTemplateClass;
  }
  if (input.templateId === 'EVENT_CTA' && input.functionalInfo?.trim()) return 'SUNSET_INFO_HOURS';
  return 'SUNSET_VIEW_SCENERY';
}

function isThePartyStoryStandard(standard: CreativeStandard): boolean {
  return (
    standard.operation === 'THE_PARTY' &&
    THE_PARTY_STORY_STANDARD_IDS.has(standard.standardId)
  );
}
