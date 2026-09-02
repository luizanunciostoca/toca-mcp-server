import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  evaluateStaticCreativeQuality,
  type StaticCreativeGateStatus,
  type StaticCreativeQualityEvidence,
  type StaticCreativeSourceRole,
} from '../../creative/static-creative-quality-gate.js';
import { ExecutionError } from '../../core/errors.js';

const execFileAsync = promisify(execFile);

const STORY_WIDTH = 1080;
const STORY_HEIGHT = 1920;
const STORY_CONTENT_WIDTH = 936;
const STORY_LEFT = 72;
const STORY_BRAND_TOP = 280;
const STORY_MESSAGE_TOP = 1160;
const STORY_CTA_TOP = 1490;
const REVIEW_FALLBACK_FONT = 'DejaVu-Sans';

export type StoryTemplateId = 'PHOTO_ONLY' | 'EDITORIAL_TEXT' | 'EVENT_CTA';
export type StoryPublicationIntent = 'REVIEW' | 'FINAL';

export interface LocalStoryTypographyBinding {
  readonly headlineFont: string;
  readonly bodyFont: string;
  readonly canonicalPinned: boolean;
}

export interface LocalStoryQaBinding {
  readonly rightsStatus: StaticCreativeGateStatus;
  readonly brandIntegrityStatus: StaticCreativeGateStatus;
  readonly venueFidelityStatus: StaticCreativeGateStatus;
  readonly copyQaStatus: StaticCreativeGateStatus;
  readonly informationQaStatus: StaticCreativeGateStatus;
}

export interface LocalStoryComposeInput {
  readonly storyCreativeId: string;
  readonly contentItemId: string;
  readonly outputAssetId: string;
  readonly masterAssetId: string;
  readonly masterDriveFileId: string;
  readonly sourceRole: StaticCreativeSourceRole;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly imageBytes: Uint8Array;
  readonly contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly templateId: StoryTemplateId;
  readonly publicationIntent: StoryPublicationIntent;
  readonly typography?: LocalStoryTypographyBinding;
  readonly qa: LocalStoryQaBinding;
  readonly message?: string;
  readonly cta?: string;
  readonly brandLabel?: string;
}

export interface LocalStoryComposeResult {
  readonly storyCreativeId: string;
  readonly contentItemId: string;
  readonly outputAssetId: string;
  readonly masterAssetId: string;
  readonly masterDriveFileId: string;
  readonly masterSha256: string;
  readonly outputSha256: string;
  readonly sourceImageBound: true;
  readonly exactSourceMasterBinding: boolean;
  readonly editorProvider: 'LOCAL_IMAGEMAGICK';
  readonly pipelineVersion: 'local-story-composer-v2';
  readonly dimensions: '1080x1920';
  readonly aspectRatio: '9:16';
  readonly templateId: StoryTemplateId;
  readonly outputContentType: 'image/jpeg';
  readonly outputBytes: Uint8Array;
  readonly qualityEvidence: StaticCreativeQualityEvidence;
  readonly storyReady: boolean;
  readonly publicationEligible: boolean;
}

export type LocalStoryComposerCommandRunner = (
  command: string,
  args: readonly string[],
) => Promise<void>;

export class LocalStoryComposer {
  constructor(
    private readonly commandRunner: LocalStoryComposerCommandRunner = defaultCommandRunner,
    private readonly binary = process.env.IMAGE_MAGICK_CONVERT_BINARY?.trim() || 'convert',
  ) {}

  async compose(input: LocalStoryComposeInput): Promise<LocalStoryComposeResult> {
    validateInput(input);
    const workspace = await mkdtemp(join(tmpdir(), 'toca-story-composer-'));
    const sourcePath = join(workspace, `master${extensionFor(input.contentType)}`);
    const outputPath = join(workspace, 'story.jpg');
    const masterSha256 = sha256(input.imageBytes);

    try {
      await writeFile(sourcePath, input.imageBytes);
      await this.commandRunner(this.binary, buildCommandArgs(input, sourcePath, outputPath));
      const outputBytes = await readFile(outputPath);
      if (outputBytes.byteLength === 0 || !isJpeg(outputBytes)) {
        throw new ExecutionError(
          'QUALITY_GATE_FAILED',
          'LOCAL_STORY_COMPOSER_OUTPUT_INVALID',
          false,
        );
      }

      const outputSha256 = sha256(outputBytes);
      const qualityEvidence = evaluateStaticCreativeQuality({
        evidenceId: `STATIC-QA:${input.storyCreativeId}:${outputSha256.slice(0, 16)}`,
        assetId: input.outputAssetId,
        outputSha256,
        format: 'STORY_9_16',
        sourceRole: input.sourceRole,
        ...(input.sourceRole === 'ORIGINAL_MASTER' ? { sourceMasterSha256: masterSha256 } : {}),
        sourceWidth: input.sourceWidth,
        sourceHeight: input.sourceHeight,
        outputWidth: STORY_WIDTH,
        outputHeight: STORY_HEIGHT,
        layoutElements: storyLayoutElements(input),
        overlayStyle: input.templateId === 'PHOTO_ONLY' ? 'NONE' : 'SOFT_GRADIENT',
        typographyCanonicalPinned: input.typography?.canonicalPinned === true,
        typographyRequired: input.templateId !== 'PHOTO_ONLY',
        ...input.qa,
      });

      if (input.publicationIntent === 'FINAL' && qualityEvidence.overallStatus !== 'PASS') {
        throw new ExecutionError(
          'QUALITY_GATE_FAILED',
          `LOCAL_STORY_COMPOSER_FINAL_NOT_READY:${qualityEvidence.failureCodes.join(',')}`,
          false,
        );
      }

      const publicationEligible =
        input.publicationIntent === 'FINAL' && qualityEvidence.overallStatus === 'PASS';

      return {
        storyCreativeId: input.storyCreativeId,
        contentItemId: input.contentItemId,
        outputAssetId: input.outputAssetId,
        masterAssetId: input.masterAssetId,
        masterDriveFileId: input.masterDriveFileId,
        masterSha256,
        outputSha256,
        sourceImageBound: true,
        exactSourceMasterBinding: qualityEvidence.exactSourceMasterBinding,
        editorProvider: 'LOCAL_IMAGEMAGICK',
        pipelineVersion: 'local-story-composer-v2',
        dimensions: '1080x1920',
        aspectRatio: '9:16',
        templateId: input.templateId,
        outputContentType: 'image/jpeg',
        outputBytes,
        qualityEvidence,
        storyReady: publicationEligible,
        publicationEligible,
      };
    } catch (error) {
      if (error instanceof ExecutionError) throw error;
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        throw new ExecutionError(
          'CAPABILITY_UNAVAILABLE',
          `LOCAL_STORY_COMPOSER_BINARY_UNAVAILABLE:${this.binary}`,
          false,
        );
      }
      throw new ExecutionError(
        'PROVIDER_UNAVAILABLE',
        `LOCAL_STORY_COMPOSER_FAILED:${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
}

function buildCommandArgs(
  input: LocalStoryComposeInput,
  sourcePath: string,
  outputPath: string,
): string[] {
  const args = [
    sourcePath,
    '-auto-orient',
    '-colorspace',
    'sRGB',
    '-filter',
    'Lanczos',
    '-resize',
    '1080x1920^',
    '-gravity',
    'center',
    '-extent',
    '1080x1920',
  ];

  if (input.templateId !== 'PHOTO_ONLY') {
    const headlineFont = input.typography?.headlineFont.trim() || REVIEW_FALLBACK_FONT;
    const bodyFont = input.typography?.bodyFont.trim() || REVIEW_FALLBACK_FONT;

    args.push(
      '(',
      '-size',
      '1080x760',
      'gradient:rgba(13,13,13,0)-rgba(13,13,13,0.78)',
      ')',
      '-gravity',
      'south',
      '-composite',
      '(',
      '-size',
      `${STORY_CONTENT_WIDTH}x250`,
      '-background',
      'none',
      '-font',
      headlineFont,
      '-fill',
      'white',
      '-pointsize',
      input.templateId === 'EVENT_CTA' ? '56' : '52',
      `caption:${input.message?.trim() ?? ''}`,
      ')',
      '-gravity',
      'northwest',
      '-geometry',
      `+${STORY_LEFT}+${STORY_MESSAGE_TOP}`,
      '-composite',
    );

    if (input.cta?.trim()) {
      args.push(
        '(',
        '-size',
        `${STORY_CONTENT_WIDTH}x90`,
        '-background',
        'none',
        '-font',
        bodyFont,
        '-fill',
        'white',
        '-pointsize',
        '34',
        `caption:${input.cta.trim()}`,
        ')',
        '-gravity',
        'northwest',
        '-geometry',
        `+${STORY_LEFT}+${STORY_CTA_TOP}`,
        '-composite',
      );
    }

    args.push(
      '-font',
      bodyFont,
      '-fill',
      'white',
      '-gravity',
      'northwest',
      '-pointsize',
      '28',
      '-annotate',
      `+${STORY_LEFT}+${STORY_BRAND_TOP}`,
      (input.brandLabel?.trim() || 'TOCA DO MORCEGO').toUpperCase(),
    );
  }

  args.push('-quality', '95', '-define', 'jpeg:dct-method=float', outputPath);
  return args;
}

function storyLayoutElements(input: LocalStoryComposeInput) {
  if (input.templateId === 'PHOTO_ONLY') return [];
  const elements = [
    {
      id: 'brand',
      role: 'BRAND' as const,
      x: STORY_LEFT,
      y: STORY_BRAND_TOP,
      width: 420,
      height: 54,
    },
    {
      id: 'message',
      role: 'HEADLINE' as const,
      x: STORY_LEFT,
      y: STORY_MESSAGE_TOP,
      width: STORY_CONTENT_WIDTH,
      height: 250,
    },
  ];
  if (input.cta?.trim()) {
    elements.push({
      id: 'cta',
      role: 'CTA' as const,
      x: STORY_LEFT,
      y: STORY_CTA_TOP,
      width: STORY_CONTENT_WIDTH,
      height: 90,
    });
  }
  return elements;
}

async function defaultCommandRunner(command: string, args: readonly string[]): Promise<void> {
  await execFileAsync(command, [...args], { maxBuffer: 1024 * 1024 });
}

function validateInput(input: LocalStoryComposeInput): void {
  if (
    !input.storyCreativeId.trim() ||
    !input.contentItemId.trim() ||
    !input.outputAssetId.trim() ||
    !input.masterAssetId.trim() ||
    !input.masterDriveFileId.trim()
  ) {
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
  if (!Number.isInteger(input.sourceWidth) || !Number.isInteger(input.sourceHeight)) {
    throw new ExecutionError(
      'SOURCE_IMAGE_BINDING_FAILURE',
      'LOCAL_STORY_COMPOSER_SOURCE_DIMENSIONS_REQUIRED',
      false,
    );
  }
  if (input.sourceWidth <= 0 || input.sourceHeight <= 0) {
    throw new ExecutionError(
      'SOURCE_IMAGE_BINDING_FAILURE',
      'LOCAL_STORY_COMPOSER_SOURCE_DIMENSIONS_INVALID',
      false,
    );
  }
  if (input.templateId !== 'PHOTO_ONLY' && !input.message?.trim()) {
    throw new ExecutionError('QUALITY_GATE_FAILED', 'LOCAL_STORY_COMPOSER_MESSAGE_REQUIRED', false);
  }
  if ((input.message?.trim().length ?? 0) > 90 || (input.cta?.trim().length ?? 0) > 60) {
    throw new ExecutionError('QUALITY_GATE_FAILED', 'LOCAL_STORY_COMPOSER_TEXT_TOO_LONG', false);
  }
  if (
    input.publicationIntent === 'FINAL' &&
    input.templateId !== 'PHOTO_ONLY' &&
    (!input.typography?.headlineFont.trim() ||
      !input.typography.bodyFont.trim() ||
      input.typography.canonicalPinned !== true)
  ) {
    throw new ExecutionError(
      'QUALITY_GATE_FAILED',
      'LOCAL_STORY_COMPOSER_CANONICAL_TYPOGRAPHY_REQUIRED',
      false,
    );
  }
}

function extensionFor(contentType: LocalStoryComposeInput['contentType']): string {
  if (contentType === 'image/png') return '.png';
  if (contentType === 'image/webp') return '.webp';
  return '.jpg';
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8;
}
