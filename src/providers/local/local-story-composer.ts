import type {
  CreativeMode,
  CreativeStandard,
  DeterministicRenderManifest,
  FidelityEvidence,
  GenerativeExceptionApproval,
  VenueAsset,
  VenueReference,
} from '../../contracts/creative-truth.js';
import { ExecutionError } from '../../core/errors.js';
import { sha256 } from '../../creative/creative-truth.js';
import {
  LocalCreativeComposer,
  type LocalCreativeComposerCommandRunner,
  type OfficialBrandAssetInput,
} from './local-creative-composer.js';

export type StoryTemplateId = 'PHOTO_ONLY' | 'EDITORIAL_TEXT' | 'EVENT_CTA';

export interface LocalStoryComposeInput {
  readonly storyCreativeId: string;
  readonly contentItemId: string;
  readonly masterAssetId?: string;
  readonly masterDriveFileId?: string;
  readonly imageBytes: Uint8Array;
  readonly contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly templateId: StoryTemplateId;
  readonly message?: string;
  readonly cta?: string;
  readonly standard: CreativeStandard;
  readonly creativeMode: CreativeMode;
  readonly venueAsset?: VenueAsset;
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

  constructor(
    commandRunner?: LocalStoryComposerCommandRunner,
    binary = process.env.IMAGE_MAGICK_CONVERT_BINARY?.trim() || 'convert',
  ) {
    this.composer = commandRunner
      ? new LocalCreativeComposer(commandRunner, binary)
      : new LocalCreativeComposer(undefined, binary);
  }

  async compose(input: LocalStoryComposeInput): Promise<LocalStoryComposeResult> {
    validateInput(input);
    assertStoryLineage(input);

    const composed = await this.composer.compose({
      contentItemId: input.contentItemId,
      creativeId: input.storyCreativeId,
      standard: input.standard,
      creativeMode: input.creativeMode,
      ...(input.venueAsset ? { venueAsset: input.venueAsset } : {}),
      sourceImageBytes: input.imageBytes,
      sourceContentType: input.contentType,
      canvas: '1080x1920',
      ...(input.templateId === 'PHOTO_ONLY' ? {} : { headline: input.message?.trim() }),
      ...(input.templateId === 'EVENT_CTA' && input.cta?.trim() ? { cta: input.cta.trim() } : {}),
      requiredBrands: input.requiredBrands,
      brandAssets: input.brandAssets,
      ...(input.generativeException ? { generativeException: input.generativeException } : {}),
      ...(input.references ? { references: input.references } : {}),
      ...(input.fidelityEvidence ? { fidelityEvidence: input.fidelityEvidence } : {}),
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    });

    const realMaster = input.creativeMode === 'GENERATIVE_EXCEPTION' ? undefined : sha256(input.imageBytes);
    return {
      storyCreativeId: input.storyCreativeId,
      contentItemId: input.contentItemId,
      ...(input.masterAssetId ? { masterAssetId: input.masterAssetId } : {}),
      ...(input.masterDriveFileId ? { masterDriveFileId: input.masterDriveFileId } : {}),
      ...(realMaster ? { masterSha256: realMaster } : {}),
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
  if (!input.standard.format.toUpperCase().includes('STOR')) {
    throw new ExecutionError('POLICY_DENIED', 'LOCAL_STORY_STANDARD_REQUIRED', false);
  }
  if (input.templateId !== 'PHOTO_ONLY' && !input.message?.trim()) {
    throw new ExecutionError('QUALITY_GATE_FAILED', 'LOCAL_STORY_COMPOSER_MESSAGE_REQUIRED', false);
  }
  if ((input.message?.trim().length ?? 0) > 90 || (input.cta?.trim().length ?? 0) > 60) {
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
