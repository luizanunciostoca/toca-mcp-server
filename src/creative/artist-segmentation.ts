import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ArtistAsset } from '../contracts/artist-integrity.js';
import { ExecutionError } from '../core/errors.js';
import {
  evaluateArtistIntegrity,
  requireArtistIntegrity,
  sha256Artist,
} from './artist-integrity.js';

const execFileAsync = promisify(execFile);

export type ArtistSegmentationContentType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface ArtistSegmentationProviderInput {
  readonly sourceBytes: Uint8Array;
  readonly contentType: ArtistSegmentationContentType;
}

export interface ArtistSegmentationProviderResult {
  readonly cutoutPngBytes: Uint8Array;
  readonly provider: string;
  readonly nonGenerative: true;
}

export interface ArtistSegmentationProvider {
  segment(input: ArtistSegmentationProviderInput): Promise<ArtistSegmentationProviderResult>;
}

export interface ArtistSegmentationInput {
  readonly artistAsset: ArtistAsset;
  readonly sourceBytes: Uint8Array;
  readonly sourceContentType: ArtistSegmentationContentType;
}

export interface ArtistSegmentationResult {
  readonly artistCutoutPngBytes: Uint8Array;
  readonly protectionMaskPngBytes: Uint8Array;
  readonly artistSourceSha256: string;
  readonly artistCutoutSha256: string;
  readonly protectionMaskSha256: string;
  readonly provider: string;
  readonly nonGenerative: true;
  readonly pixelSourcePreserved: true;
  readonly pipelineVersion: 'artist-segmentation-integrity-v1';
  readonly artistIntegrity: ReturnType<typeof evaluateArtistIntegrity>;
}

export class ArtistSegmentationService {
  constructor(
    private readonly provider: ArtistSegmentationProvider,
    private readonly binary = process.env.IMAGE_MAGICK_CONVERT_BINARY?.trim() || 'convert',
    private readonly runner: (
      command: string,
      args: readonly string[],
    ) => Promise<void> = defaultRunner,
  ) {}

  async segment(input: ArtistSegmentationInput): Promise<ArtistSegmentationResult> {
    if (input.sourceBytes.byteLength === 0) {
      throw new ExecutionError(
        'SOURCE_IMAGE_BINDING_FAILURE',
        'ARTIST_SEGMENTATION_SOURCE_BYTES_REQUIRED',
        false,
      );
    }

    const artistSourceSha256 = sha256Artist(input.sourceBytes);
    const artistIntegrity = evaluateArtistIntegrity({
      asset: input.artistAsset,
      sourceBytes: input.sourceBytes,
      evidence: {
        sourceSha256Observed: artistSourceSha256,
        aiOperationUsed: false,
        physicalGeometryChanged: false,
        unapprovedRetouchDetected: false,
        maskIntrusionDetected: false,
        allowedTransformsApplied: [],
        verifier: 'ARTIST_SEGMENTATION_SOURCE_GATE_V1',
      },
    });
    requireArtistIntegrity(artistIntegrity);

    const providerResult = await this.provider.segment({
      sourceBytes: input.sourceBytes,
      contentType: input.sourceContentType,
    });
    if (!providerResult.nonGenerative || providerResult.cutoutPngBytes.byteLength === 0) {
      throw new ExecutionError(
        'QUALITY_GATE_FAILED',
        'ARTIST_SEGMENTATION_PROVIDER_OUTPUT_INVALID',
        false,
      );
    }

    const workspace = await mkdtemp(join(tmpdir(), 'toca-artist-segment-'));
    const sourcePath = join(workspace, `source${extensionFor(input.sourceContentType)}`);
    const providerCutoutPath = join(workspace, 'provider-cutout.png');
    const maskPath = join(workspace, 'protection-mask.png');
    const artistCutoutPath = join(workspace, 'artist-cutout-original-rgb.png');

    try {
      await Promise.all([
        writeFile(sourcePath, input.sourceBytes),
        writeFile(providerCutoutPath, providerResult.cutoutPngBytes),
      ]);

      // Trust only the segmentation provider's alpha channel. Provider RGB is discarded.
      await this.runner(this.binary, [
        providerCutoutPath,
        '-alpha',
        'extract',
        '-colorspace',
        'gray',
        '-strip',
        maskPath,
      ]);

      // Apply that alpha to the approved original. This prevents any segmentation model
      // from contributing reconstructed RGB pixels to face, hair, skin, body or clothing.
      await this.runner(this.binary, [
        sourcePath,
        maskPath,
        '-alpha',
        'off',
        '-compose',
        'CopyOpacity',
        '-composite',
        '-strip',
        artistCutoutPath,
      ]);

      const [artistCutoutPngBytes, protectionMaskPngBytes] = await Promise.all([
        readFile(artistCutoutPath),
        readFile(maskPath),
      ]);
      if (!isPng(artistCutoutPngBytes) || !isPng(protectionMaskPngBytes)) {
        throw new ExecutionError(
          'QUALITY_GATE_FAILED',
          'ARTIST_SEGMENTATION_OUTPUT_INVALID',
          false,
        );
      }

      return {
        artistCutoutPngBytes,
        protectionMaskPngBytes,
        artistSourceSha256,
        artistCutoutSha256: sha256Artist(artistCutoutPngBytes),
        protectionMaskSha256: sha256Artist(protectionMaskPngBytes),
        provider: providerResult.provider,
        nonGenerative: true,
        pixelSourcePreserved: true,
        pipelineVersion: 'artist-segmentation-integrity-v1',
        artistIntegrity,
      };
    } catch (error) {
      if (error instanceof ExecutionError) throw error;
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        throw new ExecutionError(
          'CAPABILITY_UNAVAILABLE',
          `ARTIST_SEGMENTATION_BINARY_UNAVAILABLE:${this.binary}`,
          false,
        );
      }
      throw new ExecutionError(
        'PROVIDER_UNAVAILABLE',
        `ARTIST_SEGMENTATION_RECOMPOSE_FAILED:${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
}

function extensionFor(contentType: ArtistSegmentationContentType): string {
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
