import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  TOCA_CREATIVE_TRUTH_POLICY_ID,
  type CreativeMode,
  type CreativeStandard,
  type CreativeTruthGateResult,
  type DeterministicRenderManifest,
  type FidelityEvidence,
  type GenerativeExceptionApproval,
  type VenueAsset,
  type VenueReference,
} from '../../contracts/creative-truth.js';
import { ExecutionError } from '../../core/errors.js';
import {
  assertCreativeStandard,
  evaluateBrandIntegrity,
  evaluateQualityGate,
  evaluateVenueFidelity,
  requireGatePassed,
  sha256,
} from '../../creative/creative-truth.js';
import type { OfficialBrandAssetInput } from './local-creative-composer.js';

const execFileAsync = promisify(execFile);

export interface VerifiedVideoShotInput {
  readonly shotId: string;
  readonly venueAsset?: VenueAsset;
  readonly videoBytes: Uint8Array;
  readonly contentType: 'video/mp4' | 'video/quicktime' | 'video/webm';
  readonly fidelityEvidence?: FidelityEvidence;
}

export type DeterministicVideoOverlayRole =
  'HEADLINE' | 'CTA' | 'CAPTION' | 'SUBTITLE' | 'END_CARD';

export interface DeterministicVideoOverlayInput {
  readonly overlayId: string;
  readonly role: DeterministicVideoOverlayRole;
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly contentType: 'image/png' | 'image/jpeg' | 'image/webp';
  readonly startMs: number;
  readonly endMs: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface LocalVideoComposeInput {
  readonly contentItemId: string;
  readonly creativeId: string;
  readonly standard: CreativeStandard;
  readonly creativeMode: CreativeMode;
  readonly shots: readonly VerifiedVideoShotInput[];
  readonly requiredBrands: readonly string[];
  readonly brandAssets: readonly OfficialBrandAssetInput[];
  readonly overlays?: readonly DeterministicVideoOverlayInput[];
  readonly brandPosition?: 'TOP_CENTER' | 'BOTTOM_CENTER';
  readonly generativeException?: GenerativeExceptionApproval;
  readonly references?: readonly VenueReference[];
  readonly createdAt?: string;
}

export interface LocalVideoOverlayBinding {
  readonly overlayId: string;
  readonly role: DeterministicVideoOverlayRole;
  readonly sha256: string;
  readonly startMs: number;
  readonly endMs: number;
}

export interface LocalVideoComposeResult {
  readonly outputBytes: Uint8Array;
  readonly outputContentType: 'video/mp4';
  readonly outputSha256: string;
  readonly dimensions: '1080x1920';
  readonly manifest: DeterministicRenderManifest;
  readonly overlayBindings: readonly LocalVideoOverlayBinding[];
  readonly brandPosition: 'TOP_CENTER' | 'BOTTOM_CENTER';
  readonly provider: 'LOCAL_FFMPEG';
  readonly pipelineVersion: 'local-video-composer-v1';
  readonly readyForReview: true;
}

export type LocalVideoComposerCommandRunner = (
  command: string,
  args: readonly string[],
) => Promise<void>;

export class LocalVideoComposer {
  constructor(
    private readonly commandRunner: LocalVideoComposerCommandRunner = defaultCommandRunner,
    private readonly binary = process.env.FFMPEG_BINARY?.trim() || 'ffmpeg',
  ) {}

  async compose(input: LocalVideoComposeInput): Promise<LocalVideoComposeResult> {
    validateInput(input);
    assertCreativeStandard(input.standard);

    const brandGate = evaluateBrandIntegrity(
      input.requiredBrands,
      input.brandAssets.map((entry) => ({
        asset: entry.registry,
        observedDriveFileId: entry.driveFileId,
        observedSha256: sha256(entry.bytes),
        ...(entry.aiGenerated === true ? { aiGenerated: true } : {}),
      })),
    );
    requireGatePassed(brandGate);

    const shotVenueGates = input.shots.map((shot) =>
      evaluateVenueFidelity({
        creativeMode: input.creativeMode,
        ...(shot.venueAsset ? { venueAsset: shot.venueAsset } : {}),
        ...(input.generativeException ? { generativeException: input.generativeException } : {}),
        ...(input.references ? { references: input.references } : {}),
        ...(shot.fidelityEvidence ? { evidence: shot.fidelityEvidence } : {}),
        nowIso: input.createdAt ?? new Date().toISOString(),
      }),
    );
    for (const gate of shotVenueGates) requireGatePassed(gate);
    const venueGate: CreativeTruthGateResult = {
      gate: 'VENUE_FIDELITY',
      status: 'PASSED',
      failureCodes: [],
      evidence: {
        shotIds: input.shots.map((shot) => shot.shotId),
        venueAssetIds: input.shots.flatMap((shot) =>
          shot.venueAsset ? [shot.venueAsset.venueAssetId] : [],
        ),
        referenceAssetIds: (input.references ?? []).map((reference) => reference.assetId),
        allShotsVerified: true,
      },
    };

    const workspace = await mkdtemp(join(tmpdir(), 'toca-video-composer-'));
    const concatPath = join(workspace, 'concat.txt');
    const outputPath = join(workspace, 'creative.mp4');
    const logoPaths: string[] = [];
    const overlayPaths: string[] = [];

    try {
      const shotPaths: string[] = [];
      for (const [index, shot] of input.shots.entries()) {
        const path = join(workspace, `shot-${index}${videoExtension(shot.contentType)}`);
        await writeFile(path, shot.videoBytes);
        shotPaths.push(path);
      }
      await writeFile(
        concatPath,
        shotPaths.map((path) => `file '${escapeConcatPath(path)}'`).join('\n'),
        'utf8',
      );

      for (const [index, brand] of input.brandAssets.entries()) {
        const path = join(workspace, `logo-${index}${imageExtension(brand.contentType)}`);
        await writeFile(path, brand.bytes);
        logoPaths.push(path);
      }

      for (const [index, overlay] of (input.overlays ?? []).entries()) {
        const path = join(workspace, `overlay-${index}${imageExtension(overlay.contentType)}`);
        await writeFile(path, overlay.bytes);
        overlayPaths.push(path);
      }

      await this.commandRunner(
        this.binary,
        buildFfmpegArgs(input, concatPath, outputPath, logoPaths, overlayPaths),
      );
      const outputBytes = await readFile(outputPath);
      const qualityGate = evaluateQualityGate(isMp4(outputBytes), {
        dimensions: '1080x1920',
        outputContentType: 'video/mp4',
        deterministicComposition: true,
        sourceShotCount: input.shots.length,
        deterministicOverlayCount: input.overlays?.length ?? 0,
        overlayPixelsHashBound: true,
      });
      requireGatePassed(qualityGate);

      const outputSha256 = sha256(outputBytes);
      const createdAt = input.createdAt ?? new Date().toISOString();
      const manifest: DeterministicRenderManifest = {
        contentItemId: input.contentItemId,
        creativeId: input.creativeId,
        policyId: TOCA_CREATIVE_TRUTH_POLICY_ID,
        standardId: input.standard.standardId,
        creativeMode: input.creativeMode,
        sourceAssetIds: sourceAssetIdsFor(input),
        masterAssetIds: input.shots.flatMap((shot) =>
          shot.venueAsset?.masterAssetId ? [shot.venueAsset.masterAssetId] : [],
        ),
        brandAssetIds: input.brandAssets.map((entry) => entry.registry.brandAssetId),
        outputSha256,
        outputDimensions: '1080x1920',
        exactAssetBinding: true,
        gates: [brandGate, venueGate, qualityGate],
        createdAt,
      };
      const overlayBindings = (input.overlays ?? []).map((overlay) => ({
        overlayId: overlay.overlayId,
        role: overlay.role,
        sha256: overlay.sha256.toLowerCase(),
        startMs: overlay.startMs,
        endMs: overlay.endMs,
      }));
      const brandPosition = input.brandPosition ?? 'BOTTOM_CENTER';

      return {
        outputBytes,
        outputContentType: 'video/mp4',
        outputSha256,
        dimensions: '1080x1920',
        manifest,
        overlayBindings,
        brandPosition,
        provider: 'LOCAL_FFMPEG',
        pipelineVersion: 'local-video-composer-v1',
        readyForReview: true,
      };
    } catch (error) {
      if (error instanceof ExecutionError) throw error;
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        throw new ExecutionError(
          'CAPABILITY_UNAVAILABLE',
          `LOCAL_VIDEO_COMPOSER_BINARY_UNAVAILABLE:${this.binary}`,
          false,
        );
      }
      throw new ExecutionError(
        'PROVIDER_UNAVAILABLE',
        `LOCAL_VIDEO_COMPOSER_FAILED:${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
}

function buildFfmpegArgs(
  input: LocalVideoComposeInput,
  concatPath: string,
  outputPath: string,
  logoPaths: readonly string[],
  overlayPaths: readonly string[],
): string[] {
  const args: string[] = ['-y', '-f', 'concat', '-safe', '0', '-i', concatPath];
  for (const logoPath of logoPaths) args.push('-loop', '1', '-i', logoPath);
  for (const overlayPath of overlayPaths) args.push('-loop', '1', '-i', overlayPath);

  let chain = '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[base]';
  let previous = 'base';
  const logoCount = Math.max(logoPaths.length, 1);
  const slotWidth = Math.floor(900 / logoCount);
  const brandY = (input.brandPosition ?? 'BOTTOM_CENTER') === 'TOP_CENTER' ? 90 : 1740;
  for (const [index] of logoPaths.entries()) {
    const logoLabel = `logo${index}`;
    const outputLabel = `v${index}`;
    const x = 90 + index * slotWidth + Math.floor(slotWidth * 0.1);
    chain += `;[${index + 1}:v]scale=${Math.floor(slotWidth * 0.72)}:-1[${logoLabel}]`;
    chain += `;[${previous}][${logoLabel}]overlay=${x}:${brandY}:format=auto[${outputLabel}]`;
    previous = outputLabel;
  }

  for (const [index, overlay] of (input.overlays ?? []).entries()) {
    const inputIndex = 1 + logoPaths.length + index;
    const overlayLabel = `overlay${index}`;
    const outputLabel = `ov${index}`;
    const startSeconds = millisecondsToSeconds(overlay.startMs);
    const endSeconds = millisecondsToSeconds(overlay.endMs);
    chain += `;[${inputIndex}:v]scale=${overlay.width}:${overlay.height}[${overlayLabel}]`;
    chain += `;[${previous}][${overlayLabel}]overlay=${overlay.x}:${overlay.y}:enable='between(t,${startSeconds},${endSeconds})'[${outputLabel}]`;
    previous = outputLabel;
  }

  args.push(
    '-filter_complex',
    chain,
    '-map',
    `[${previous}]`,
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'medium',
    '-crf',
    '18',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    '-shortest',
    outputPath,
  );
  return args;
}

function validateInput(input: LocalVideoComposeInput): void {
  if (!input.contentItemId.trim() || !input.creativeId.trim() || input.shots.length === 0) {
    throw new ExecutionError('SOURCE_IMAGE_BINDING_FAILURE', 'VIDEO_LINEAGE_REQUIRED', false);
  }
  if (input.shots.some((shot) => !shot.shotId.trim() || shot.videoBytes.byteLength === 0)) {
    throw new ExecutionError('SOURCE_IMAGE_BINDING_FAILURE', 'VIDEO_SHOT_BYTES_REQUIRED', false);
  }
  if (
    input.creativeMode !== 'GENERATIVE_EXCEPTION' &&
    input.shots.some((shot) => !shot.venueAsset)
  ) {
    throw new ExecutionError('POLICY_DENIED', 'FAILED_NO_VENUE_VERIFIED_ASSET', false);
  }
  if (
    input.creativeMode === 'GENERATIVE_EXCEPTION' &&
    (!input.generativeException || (input.references?.length ?? 0) === 0)
  ) {
    throw new ExecutionError('APPROVAL_REQUIRED', 'FAILED_GENERATIVE_REFERENCE_MISSING', false);
  }
  if (input.requiredBrands.length === 0) {
    throw new ExecutionError('POLICY_DENIED', 'FAILED_BRAND_ASSET_MISSING', false);
  }
  for (const overlay of input.overlays ?? []) {
    if (
      !overlay.overlayId.trim() ||
      overlay.bytes.byteLength === 0 ||
      !/^[a-f0-9]{64}$/i.test(overlay.sha256) ||
      createHash('sha256').update(overlay.bytes).digest('hex') !== overlay.sha256.toLowerCase()
    ) {
      throw new ExecutionError(
        'SOURCE_IMAGE_BINDING_FAILURE',
        'VIDEO_OVERLAY_HASH_BINDING_INVALID',
        false,
      );
    }
    if (
      !Number.isInteger(overlay.startMs) ||
      !Number.isInteger(overlay.endMs) ||
      overlay.startMs < 0 ||
      overlay.endMs <= overlay.startMs
    ) {
      throw new ExecutionError('QUALITY_GATE_FAILED', 'VIDEO_OVERLAY_TIME_RANGE_INVALID', false);
    }
    if (
      ![overlay.x, overlay.y, overlay.width, overlay.height].every(Number.isInteger) ||
      overlay.x < 0 ||
      overlay.y < 0 ||
      overlay.width <= 0 ||
      overlay.height <= 0 ||
      overlay.x + overlay.width > 1080 ||
      overlay.y + overlay.height > 1920
    ) {
      throw new ExecutionError('QUALITY_GATE_FAILED', 'VIDEO_OVERLAY_SAFE_AREA_INVALID', false);
    }
  }
}

function sourceAssetIdsFor(input: LocalVideoComposeInput): string[] {
  const realSourceIds = input.shots.flatMap((shot) =>
    shot.venueAsset ? [shot.venueAsset.sourceAssetId] : [],
  );
  if (realSourceIds.length > 0) return [...new Set(realSourceIds)];
  const referenceIds = [...new Set((input.references ?? []).map((reference) => reference.assetId))];
  if (referenceIds.length === 0) {
    throw new ExecutionError('SOURCE_IMAGE_BINDING_FAILURE', 'FAILED_LINEAGE_MISSING', false);
  }
  return referenceIds;
}

async function defaultCommandRunner(command: string, args: readonly string[]): Promise<void> {
  await execFileAsync(command, [...args], { maxBuffer: 4 * 1024 * 1024 });
}

function videoExtension(contentType: VerifiedVideoShotInput['contentType']): string {
  if (contentType === 'video/quicktime') return '.mov';
  if (contentType === 'video/webm') return '.webm';
  return '.mp4';
}

function imageExtension(contentType: DeterministicVideoOverlayInput['contentType']): string {
  if (contentType === 'image/png') return '.png';
  if (contentType === 'image/webp') return '.webp';
  return '.jpg';
}

function millisecondsToSeconds(milliseconds: number): string {
  return (milliseconds / 1000).toFixed(3);
}

function escapeConcatPath(path: string): string {
  return path.replaceAll("'", "'\\''");
}

function isMp4(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 12 &&
    String.fromCharCode(bytes[4]!, bytes[5]!, bytes[6]!, bytes[7]!) === 'ftyp'
  );
}
