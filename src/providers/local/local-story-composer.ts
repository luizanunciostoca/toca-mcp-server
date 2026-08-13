import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ExecutionError } from '../../core/errors.js';

const execFileAsync = promisify(execFile);

export interface LocalStoryComposeInput {
  readonly contentItemId: string;
  readonly storyCreativeId: string;
  readonly masterAssetId: string;
  readonly masterDriveFileId: string;
  readonly imageBytes: Uint8Array;
  readonly contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly templateId?: string;
  readonly headline?: string;
  readonly body?: string;
  readonly cta?: string;
}

export interface LocalStoryComposeResult {
  readonly contentItemId: string;
  readonly storyCreativeId: string;
  readonly masterAssetId: string;
  readonly masterDriveFileId: string;
  readonly sourceSha256: string;
  readonly outputSha256: string;
  readonly sourceImageBound: true;
  readonly renderMode: 'COMPOSE_STORY_FROM_MASTER';
  readonly editorProvider: 'LOCAL_IMAGEMAGICK';
  readonly pipelineVersion: 'local-story-composer-v1';
  readonly templateId: string;
  readonly dimensions: '1080x1920';
  readonly outputContentType: 'image/jpeg';
  readonly outputBytes: Uint8Array;
}

export type LocalStoryComposerCommandRunner = (
  command: string,
  args: readonly string[],
) => Promise<string>;

export class LocalStoryComposer {
  constructor(
    private readonly commandRunner: LocalStoryComposerCommandRunner =
      defaultCommandRunner,
    private readonly convertBinary =
      process.env.IMAGE_MAGICK_CONVERT_BINARY?.trim() || 'convert',
    private readonly identifyBinary =
      process.env.IMAGE_MAGICK_IDENTIFY_BINARY?.trim() || 'identify',
  ) {}

  async compose(input: LocalStoryComposeInput): Promise<LocalStoryComposeResult> {
    validateInput(input);
    const templateId = input.templateId?.trim() || 'TOCA_STORY_FULLBLEED_V1';
    const workspace = await mkdtemp(join(tmpdir(), 'toca-story-composer-'));
    const sourcePath = join(
      workspace,
      `source${extensionFor(input.contentType)}`,
    );
    const overlayPath = join(workspace, 'overlay.svg');
    const outputPath = join(workspace, 'story.jpg');

    try {
      await writeFile(sourcePath, input.imageBytes);
      const hasOverlay = Boolean(
        input.headline?.trim() || input.body?.trim() || input.cta?.trim(),
      );
      if (hasOverlay) await writeFile(overlayPath, renderOverlaySvg(input));

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
      if (hasOverlay) {
        args.push(
          overlayPath,
          '-gravity',
          'center',
          '-compose',
          'over',
          '-composite',
        );
      }
      args.push(
        '-quality',
        '95',
        '-define',
        'jpeg:dct-method=float',
        outputPath,
      );

      await this.commandRunner(this.convertBinary, args);
      const outputBytes = await readFile(outputPath);
      if (outputBytes.byteLength === 0 || !isJpeg(outputBytes)) {
        throw new ExecutionError(
          'QUALITY_GATE_FAILED',
          'LOCAL_STORY_COMPOSER_OUTPUT_INVALID',
          false,
        );
      }

      const dimensions = (
        await this.commandRunner(this.identifyBinary, [
          '-format',
          '%wx%h',
          outputPath,
        ])
      ).trim();
      if (dimensions !== '1080x1920') {
        throw new ExecutionError(
          'OUTPUT_TECH_SPEC_MISMATCH',
          `LOCAL_STORY_COMPOSER_DIMENSIONS_INVALID:${dimensions}`,
          false,
        );
      }

      return {
        contentItemId: input.contentItemId,
        storyCreativeId: input.storyCreativeId,
        masterAssetId: input.masterAssetId,
        masterDriveFileId: input.masterDriveFileId,
        sourceSha256: sha256(input.imageBytes),
        outputSha256: sha256(outputBytes),
        sourceImageBound: true,
        renderMode: 'COMPOSE_STORY_FROM_MASTER',
        editorProvider: 'LOCAL_IMAGEMAGICK',
        pipelineVersion: 'local-story-composer-v1',
        templateId,
        dimensions: '1080x1920',
        outputContentType: 'image/jpeg',
        outputBytes,
      };
    } catch (error) {
      if (error instanceof ExecutionError) throw error;
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        throw new ExecutionError(
          'CAPABILITY_UNAVAILABLE',
          'LOCAL_STORY_COMPOSER_IMAGEMAGICK_UNAVAILABLE',
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

async function defaultCommandRunner(
  command: string,
  args: readonly string[],
): Promise<string> {
  const { stdout } = await execFileAsync(command, [...args], {
    maxBuffer: 1024 * 1024,
  });
  return stdout;
}

function validateInput(input: LocalStoryComposeInput): void {
  if (
    !input.contentItemId.trim() ||
    !input.storyCreativeId.trim() ||
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
      'LOCAL_STORY_COMPOSER_SOURCE_BYTES_REQUIRED',
      false,
    );
  }
  for (const value of [input.headline, input.body, input.cta]) {
    if (value && value.length > 220) {
      throw new ExecutionError(
        'QUALITY_GATE_FAILED',
        'LOCAL_STORY_COMPOSER_TEXT_TOO_LONG',
        false,
      );
    }
  }
}

function renderOverlaySvg(input: LocalStoryComposeInput): string {
  const headline = escapeXml(input.headline?.trim() ?? '');
  const body = escapeXml(input.body?.trim() ?? '');
  const cta = escapeXml(input.cta?.trim() ?? '');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg width="1080" height="1920" viewBox="0 0 1080 1920" xmlns="http://www.w3.org/2000/svg">\n  <defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.72"/></linearGradient></defs>\n  <rect width="1080" height="1920" fill="url(#shade)"/>\n  <g fill="#fff" font-family="sans-serif"><text x="72" y="1470" font-size="72" font-weight="700">${headline}</text><text x="72" y="1560" font-size="38">${body}</text><text x="72" y="1735" font-size="34" font-weight="600">${cta}</text></g>\n</svg>`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
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
