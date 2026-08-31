import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type {
  ArtistAsset,
  ArtistIntegrityEvidence,
  ArtistTransform,
} from '../../contracts/artist-integrity.js';
import { ExecutionError } from '../../core/errors.js';
import {
  evaluateArtistIntegrity,
  requireArtistIntegrity,
  sha256Artist,
} from '../../creative/artist-integrity.js';

const execFileAsync = promisify(execFile);

export type MultiLayerCanvas = '1080x1350' | '1080x1920' | '1080x1080';
export type ImageContentType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface MultiLayerImageAsset {
  readonly assetId: string;
  readonly driveFileId: string;
  readonly bytes: Uint8Array;
  readonly contentType: ImageContentType;
}

export interface LocalMultiLayerComposeInput {
  readonly artist: MultiLayerImageAsset & { readonly registry: ArtistAsset };
  readonly venue: MultiLayerImageAsset;
  readonly artistProtectionMaskBytes: Uint8Array;
  readonly maskContentType: ImageContentType;
  readonly maskForArtistSourceSha256: string;
  readonly canvas: MultiLayerCanvas;
  readonly venueOpacityPercent?: number;
  readonly orangeTint?: string;
  readonly fadeDirection?: 'LEFT_TO_RIGHT' | 'RIGHT_TO_LEFT' | 'TOP_TO_BOTTOM' | 'BOTTOM_TO_TOP';
  readonly artistTransforms?: readonly ArtistTransform[];
}

export interface LocalMultiLayerComposeResult {
  readonly outputBytes: Uint8Array;
  readonly outputContentType: 'image/png';
  readonly outputSha256: string;
  readonly artistSourceSha256: string;
  readonly venueSourceSha256: string;
  readonly protectionMaskSha256: string;
  readonly maskForArtistSourceSha256: string;
  readonly artistIntegrity: ReturnType<typeof evaluateArtistIntegrity>;
  readonly provider: 'LOCAL_IMAGEMAGICK';
  readonly pipelineVersion: 'local-multilayer-creative-composer-v2';
  readonly creativeMode: 'REAL_COMPOSITE';
  readonly nonGenerative: true;
}

export class LocalMultiLayerCreativeComposer {
  constructor(
    private readonly binary = process.env.IMAGE_MAGICK_CONVERT_BINARY?.trim() || 'convert',
    private readonly runner: (
      command: string,
      args: readonly string[],
    ) => Promise<void> = defaultRunner,
  ) {}

  async compose(input: LocalMultiLayerComposeInput): Promise<LocalMultiLayerComposeResult> {
    validateInput(input);
    const artistSha = sha256Artist(input.artist.bytes);
    const venueSha = sha256Artist(input.venue.bytes);
    const maskSha = sha256Artist(input.artistProtectionMaskBytes);

    if (input.maskForArtistSourceSha256.toLowerCase() !== artistSha.toLowerCase()) {
      throw new ExecutionError('POLICY_DENIED', 'FAILED_ARTIST_MASK_INTRUSION', false);
    }

    const evidence: ArtistIntegrityEvidence = {
      sourceSha256Observed: artistSha,
      aiOperationUsed: false,
      physicalGeometryChanged: false,
      unapprovedRetouchDetected: false,
      maskIntrusionDetected: false,
      allowedTransformsApplied: [...(input.artistTransforms ?? ['SCALE', 'POSITION'])],
      verifier: 'DETERMINISTIC_MASKED_PIXEL_COMPOSITOR_V2',
    };
    const artistIntegrity = evaluateArtistIntegrity({
      asset: input.artist.registry,
      sourceBytes: input.artist.bytes,
      evidence,
    });
    requireArtistIntegrity(artistIntegrity);

    const workspace = await mkdtemp(join(tmpdir(), 'toca-multilayer-'));
    const artistPath = join(workspace, `artist${extensionFor(input.artist.contentType)}`);
    const venuePath = join(workspace, `venue${extensionFor(input.venue.contentType)}`);
    const maskPath = join(workspace, `artist-mask${extensionFor(input.maskContentType)}`);
    const outputPath = join(workspace, 'composite.png');

    try {
      await Promise.all([
        writeFile(artistPath, input.artist.bytes),
        writeFile(venuePath, input.venue.bytes),
        writeFile(maskPath, input.artistProtectionMaskBytes),
      ]);
      await this.runner(this.binary, buildArgs(input, artistPath, venuePath, maskPath, outputPath));
      const outputBytes = await readFile(outputPath);
      if (!isPng(outputBytes)) {
        throw new ExecutionError(
          'QUALITY_GATE_FAILED',
          'MULTILAYER_COMPOSER_OUTPUT_INVALID',
          false,
        );
      }
      return {
        outputBytes,
        outputContentType: 'image/png',
        outputSha256: sha256Artist(outputBytes),
        artistSourceSha256: artistSha,
        venueSourceSha256: venueSha,
        protectionMaskSha256: maskSha,
        maskForArtistSourceSha256: input.maskForArtistSourceSha256,
        artistIntegrity,
        provider: 'LOCAL_IMAGEMAGICK',
        pipelineVersion: 'local-multilayer-creative-composer-v2',
        creativeMode: 'REAL_COMPOSITE',
        nonGenerative: true,
      };
    } catch (error) {
      if (error instanceof ExecutionError) throw error;
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        throw new ExecutionError(
          'CAPABILITY_UNAVAILABLE',
          `LOCAL_MULTILAYER_BINARY_UNAVAILABLE:${this.binary}`,
          false,
        );
      }
      throw new ExecutionError(
        'PROVIDER_UNAVAILABLE',
        `LOCAL_MULTILAYER_COMPOSER_FAILED:${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
}

function buildArgs(
  input: LocalMultiLayerComposeInput,
  artistPath: string,
  venuePath: string,
  maskPath: string,
  outputPath: string,
): string[] {
  const [width, height] = dimensionsFor(input.canvas);
  const opacity = Math.max(0, Math.min(100, input.venueOpacityPercent ?? 55));
  const orange = input.orangeTint ?? '#d96b16';
  const gradientArgs = buildGradientArgs(width, height, input.fadeDirection ?? 'RIGHT_TO_LEFT');

  return [
    artistPath,
    '-auto-orient',
    '-colorspace',
    'sRGB',
    '-filter',
    'Lanczos',
    '-resize',
    `${width}x${height}^`,
    '-gravity',
    'center',
    '-extent',
    `${width}x${height}`,
    '(',
    venuePath,
    '-auto-orient',
    '-colorspace',
    'sRGB',
    '-filter',
    'Lanczos',
    '-resize',
    `${width}x${height}^`,
    '-gravity',
    'center',
    '-extent',
    `${width}x${height}`,
    '(',
    '+clone',
    '-fill',
    orange,
    '-colorize',
    '28%',
    ')',
    '-compose',
    'softlight',
    '-composite',
    '(',
    ...gradientArgs,
    '(',
    maskPath,
    '-auto-orient',
    '-filter',
    'Lanczos',
    '-resize',
    `${width}x${height}^`,
    '-gravity',
    'center',
    '-extent',
    `${width}x${height}`,
    '-colorspace',
    'gray',
    '-threshold',
    '1%',
    '-negate',
    ')',
    '-compose',
    'multiply',
    '-composite',
    '-evaluate',
    'multiply',
    `${opacity}%`,
    ')',
    '-alpha',
    'off',
    '-compose',
    'CopyOpacity',
    '-composite',
    ')',
    '-compose',
    'over',
    '-composite',
    '-strip',
    outputPath,
  ];
}

function dimensionsFor(canvas: MultiLayerCanvas): readonly [number, number] {
  if (canvas === '1080x1920') return [1080, 1920];
  if (canvas === '1080x1080') return [1080, 1080];
  return [1080, 1350];
}

function buildGradientArgs(
  width: number,
  height: number,
  direction: NonNullable<LocalMultiLayerComposeInput['fadeDirection']>,
): string[] {
  if (direction === 'TOP_TO_BOTTOM') {
    return ['-size', `${width}x${height}`, 'gradient:black-white'];
  }
  if (direction === 'BOTTOM_TO_TOP') {
    return ['-size', `${width}x${height}`, 'gradient:white-black'];
  }
  if (direction === 'LEFT_TO_RIGHT') {
    return ['-size', `${height}x${width}`, 'gradient:black-white', '-rotate', '90'];
  }
  return ['-size', `${height}x${width}`, 'gradient:white-black', '-rotate', '90'];
}

function validateInput(input: LocalMultiLayerComposeInput): void {
  if (!input.artist.assetId.trim() || !input.venue.assetId.trim()) {
    throw new ExecutionError(
      'SOURCE_IMAGE_BINDING_FAILURE',
      'MULTILAYER_SOURCE_ASSET_ID_REQUIRED',
      false,
    );
  }
  if (!input.artist.registry.compositionAllowed) {
    throw new ExecutionError('POLICY_DENIED', 'FAILED_ARTIST_UNAPPROVED_RETOUCH', false);
  }
  if (input.artist.bytes.byteLength === 0 || input.venue.bytes.byteLength === 0) {
    throw new ExecutionError(
      'SOURCE_IMAGE_BINDING_FAILURE',
      'MULTILAYER_SOURCE_BYTES_REQUIRED',
      false,
    );
  }
  if (input.artistProtectionMaskBytes.byteLength === 0) {
    throw new ExecutionError('POLICY_DENIED', 'FAILED_ARTIST_MASK_INTRUSION', false);
  }
  if (!/^[a-f0-9]{64}$/i.test(input.maskForArtistSourceSha256)) {
    throw new ExecutionError('POLICY_DENIED', 'FAILED_ARTIST_LINEAGE_MISSING', false);
  }
}

function extensionFor(contentType: ImageContentType): string {
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
    bytes[3] === 0x47
  );
}

async function defaultRunner(command: string, args: readonly string[]): Promise<void> {
  await execFileAsync(command, [...args], { maxBuffer: 4 * 1024 * 1024 });
}
