import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { SunsetStoryImageProfile } from '../../creative/sunset-story-image-profile.js';
import {
  validateSunsetStoryOverlayAsset,
  type SunsetStoryOverlayAsset,
} from '../../creative/sunset-story-overlay.js';
import type { SunsetStoryTemplateCandidate } from '../../creative/sunset-story-template-selector.js';
import { ExecutionError } from '../../core/errors.js';

const execFileAsync = promisify(execFile);

export type LocalSunsetStoryRenderCommandRunner = (
  command: string,
  args: readonly string[],
) => Promise<string>;

export interface LocalSunsetStoryPreviewRenderRequest {
  readonly imageBytes: Uint8Array;
  readonly profile: SunsetStoryImageProfile;
  readonly candidate: SunsetStoryTemplateCandidate;
  readonly overlay: SunsetStoryOverlayAsset;
}

export interface LocalSunsetStoryPreviewRenderResult {
  readonly outputBytes: Uint8Array;
  readonly outputContentType: 'image/png';
  readonly outputSha256: string;
  readonly sourceSha256: string;
  readonly overlaySha256: string;
  readonly templateId: SunsetStoryTemplateCandidate['templateId'];
  readonly renderer: 'LOCAL_IMAGEMAGICK_OVERLAY_V1';
  readonly width: 1080;
  readonly height: 1920;
  readonly publicationEligible: false;
}

export class LocalImagemagickSunsetStoryRenderer {
  constructor(
    private readonly commandRunner: LocalSunsetStoryRenderCommandRunner = defaultCommandRunner,
    private readonly convertBinary = process.env.IMAGE_MAGICK_CONVERT_BINARY?.trim() || 'convert',
    private readonly identifyBinary = process.env.IMAGE_MAGICK_IDENTIFY_BINARY?.trim() || 'identify',
  ) {}

  async renderPreview(
    request: LocalSunsetStoryPreviewRenderRequest,
  ): Promise<LocalSunsetStoryPreviewRenderResult> {
    validateRequest(request);
    const sourceContentType = detectContentType(request.imageBytes);
    const workspace = await mkdtemp(join(tmpdir(), 'toca-sunset-render-'));
    const sourcePath = join(workspace, `source${extensionFor(sourceContentType)}`);
    const overlayPath = join(workspace, 'overlay.png');
    const outputPath = join(workspace, 'preview.png');

    try {
      await writeFile(sourcePath, request.imageBytes);
      await writeFile(overlayPath, request.overlay.overlayBytes);

      const overlayDimensions = await this.commandRunner(this.identifyBinary, [
        '-format',
        '%w,%h',
        overlayPath,
      ]);
      if (overlayDimensions.trim() !== '1080,1920') {
        throw new ExecutionError(
          'OUTPUT_TECH_SPEC_MISMATCH',
          `SUNSET_OVERLAY_ACTUAL_DIMENSIONS_INVALID:${overlayDimensions.trim()}`,
          false,
        );
      }

      const crop = cropPixels(request.profile, request.candidate.cropPlan.cropWindow);
      await this.commandRunner(this.convertBinary, [
        sourcePath,
        '-auto-orient',
        '-crop',
        `${crop.width}x${crop.height}+${crop.x}+${crop.y}`,
        '+repage',
        '-filter',
        'Lanczos',
        '-resize',
        '1080x1920!',
        overlayPath,
        '-compose',
        'over',
        '-composite',
        '-strip',
        `PNG32:${outputPath}`,
      ]);

      const outputDimensions = await this.commandRunner(this.identifyBinary, [
        '-format',
        '%w,%h',
        outputPath,
      ]);
      if (outputDimensions.trim() !== '1080,1920') {
        throw new ExecutionError(
          'OUTPUT_TECH_SPEC_MISMATCH',
          `SUNSET_PREVIEW_DIMENSIONS_INVALID:${outputDimensions.trim()}`,
          false,
        );
      }

      const outputBytes = await readFile(outputPath);
      if (!isPng(outputBytes)) {
        throw new ExecutionError('QUALITY_GATE_FAILED', 'SUNSET_PREVIEW_OUTPUT_NOT_PNG', false);
      }

      return {
        outputBytes,
        outputContentType: 'image/png',
        outputSha256: sha256(outputBytes),
        sourceSha256: sha256(request.imageBytes),
        overlaySha256: request.overlay.sha256,
        templateId: request.candidate.templateId,
        renderer: 'LOCAL_IMAGEMAGICK_OVERLAY_V1',
        width: 1080,
        height: 1920,
        publicationEligible: false,
      };
    } catch (error) {
      if (error instanceof ExecutionError) throw error;
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        throw new ExecutionError(
          'CAPABILITY_UNAVAILABLE',
          'SUNSET_RENDERER_IMAGEMAGICK_UNAVAILABLE',
          false,
        );
      }
      throw new ExecutionError(
        'QUALITY_GATE_FAILED',
        `SUNSET_RENDERER_FAILED:${error instanceof Error ? error.message : String(error)}`,
        false,
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
}

function validateRequest(request: LocalSunsetStoryPreviewRenderRequest): void {
  if (request.imageBytes.byteLength === 0) {
    throw new ExecutionError('SOURCE_IMAGE_BINDING_FAILURE', 'SUNSET_RENDER_SOURCE_EMPTY', false);
  }
  if (request.candidate.hardRejected) {
    throw new ExecutionError('QUALITY_GATE_FAILED', 'SUNSET_RENDER_CANDIDATE_REJECTED', false);
  }
  if (request.profile.width <= 0 || request.profile.height <= 0) {
    throw new ExecutionError('OUTPUT_TECH_SPEC_MISMATCH', 'SUNSET_RENDER_PROFILE_INVALID', false);
  }
  validateSunsetStoryOverlayAsset(request.overlay, request.candidate.templateId);
}

function cropPixels(
  profile: SunsetStoryImageProfile,
  crop: SunsetStoryTemplateCandidate['cropPlan']['cropWindow'],
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const width = Math.max(1, Math.round(crop.width * profile.width));
  const height = Math.max(1, Math.round(crop.height * profile.height));
  const x = Math.max(0, Math.min(profile.width - width, Math.round(crop.x * profile.width)));
  const y = Math.max(0, Math.min(profile.height - height, Math.round(crop.y * profile.height)));
  return { x, y, width, height };
}

function detectContentType(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png';
  }
  if (
    bytes.byteLength >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) {
    return 'image/webp';
  }
  throw new ExecutionError(
    'SOURCE_IMAGE_BINDING_FAILURE',
    'SUNSET_RENDER_SOURCE_MIME_UNSUPPORTED',
    false,
  );
}

function extensionFor(contentType: 'image/jpeg' | 'image/png' | 'image/webp'): string {
  if (contentType === 'image/png') return '.png';
  if (contentType === 'image/webp') return '.webp';
  return '.jpg';
}

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function defaultCommandRunner(command: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync(command, [...args], { maxBuffer: 4 * 1024 * 1024 });
  return stdout;
}
