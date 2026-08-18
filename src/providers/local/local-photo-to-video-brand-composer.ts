import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { PhotoToVideoStandard } from '../../contracts/photo-to-video.js';
import { ExecutionError } from '../../core/errors.js';
import type { LoadedCreativeTruthBrandAsset } from '../google-drive/creative-truth-brand-asset-loader.js';

const execFileAsync = promisify(execFile);

export interface PhotoToVideoBrandComposeInput {
  readonly candidateBytes: Uint8Array;
  readonly candidateSha256: string;
  readonly standard: PhotoToVideoStandard;
  readonly heroBrand: LoadedCreativeTruthBrandAsset;
}

export interface PhotoToVideoBrandComposeResult {
  readonly outputBytes: Uint8Array;
  readonly outputSha256: string;
  readonly outputContentType: 'video/mp4';
  readonly brandAssetIds: readonly string[];
  readonly exactAssetBinding: true;
  readonly compositor: 'LOCAL_FFMPEG_PHOTO_TO_VIDEO_BRAND_V1';
}

export type PhotoToVideoBrandCommandRunner = (
  command: string,
  args: readonly string[],
) => Promise<void>;

export class LocalPhotoToVideoBrandComposer {
  constructor(
    private readonly commandRunner: PhotoToVideoBrandCommandRunner = defaultRunner,
    private readonly binary = process.env.FFMPEG_BINARY?.trim() || 'ffmpeg',
  ) {}

  async compose(input: PhotoToVideoBrandComposeInput): Promise<PhotoToVideoBrandComposeResult> {
    validateInput(input);
    const workspace = await mkdtemp(join(tmpdir(), 'toca-photo-video-brand-'));
    const candidatePath = join(workspace, 'candidate.mp4');
    const logoPath = join(workspace, `hero${brandExtension(input.heroBrand.contentType)}`);
    const outputPath = join(workspace, 'final.mp4');
    try {
      await writeFile(candidatePath, input.candidateBytes);
      await writeFile(logoPath, input.heroBrand.bytes);
      await this.commandRunner(
        this.binary,
        buildArgs(candidatePath, logoPath, outputPath, input.standard.brandPosition),
      );
      const outputBytes = await readFile(outputPath);
      if (!isMp4(outputBytes)) {
        throw new ExecutionError('OUTPUT_TECH_SPEC_MISMATCH', 'PHOTO_TO_VIDEO_BRAND_OUTPUT_INVALID_MP4', false);
      }
      return {
        outputBytes,
        outputSha256: sha256(outputBytes),
        outputContentType: 'video/mp4',
        brandAssetIds: [input.heroBrand.registry.brandAssetId],
        exactAssetBinding: true,
        compositor: 'LOCAL_FFMPEG_PHOTO_TO_VIDEO_BRAND_V1',
      };
    } catch (error) {
      if (error instanceof ExecutionError) throw error;
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        throw new ExecutionError(
          'CAPABILITY_UNAVAILABLE',
          `PHOTO_TO_VIDEO_BRAND_FFMPEG_UNAVAILABLE:${this.binary}`,
          false,
        );
      }
      throw new ExecutionError(
        'PROVIDER_UNAVAILABLE',
        `PHOTO_TO_VIDEO_BRAND_FFMPEG_FAILED:${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
}

function validateInput(input: PhotoToVideoBrandComposeInput): void {
  if (
    input.candidateBytes.byteLength === 0 ||
    !isMp4(input.candidateBytes) ||
    sha256(input.candidateBytes) !== input.candidateSha256.toLowerCase() ||
    input.heroBrand.aiGenerated !== false ||
    input.heroBrand.registry.status !== 'ACTIVE_APPROVED' ||
    input.heroBrand.registry.aiReconstructionAllowed !== false
  ) {
    throw new ExecutionError('SOURCE_IMAGE_BINDING_FAILURE', 'PHOTO_TO_VIDEO_BRAND_BINDING_INVALID', false);
  }
}

function buildArgs(
  candidatePath: string,
  logoPath: string,
  outputPath: string,
  position: 'TOP_CENTER' | 'BOTTOM_CENTER',
): string[] {
  const y = position === 'TOP_CENTER' ? '90' : 'H-h-90';
  return [
    '-y',
    '-i',
    candidatePath,
    '-loop',
    '1',
    '-i',
    logoPath,
    '-filter_complex',
    `[1:v]scale=360:-1[hero];[0:v][hero]overlay=(W-w)/2:${y}:format=auto[outv]`,
    '-map',
    '[outv]',
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    '-shortest',
    outputPath,
  ];
}

async function defaultRunner(command: string, args: readonly string[]): Promise<void> {
  await execFileAsync(command, [...args], { maxBuffer: 8 * 1024 * 1024 });
}

function brandExtension(contentType: string): string {
  if (contentType === 'image/png') return '.png';
  if (contentType === 'image/webp') return '.webp';
  return '.jpg';
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isMp4(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp';
}
