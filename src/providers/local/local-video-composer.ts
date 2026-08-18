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
  type VideoShot,
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
const APPROVED_RIGHTS_STATUSES = new Set([
  'APPROVED',
  'OWNED',
  'LICENSED',
  'CLEARED',
  'RIGHTS_CLEARED',
]);

export interface VerifiedVideoShotInput {
  readonly shotId: string;
  readonly registry?: VideoShot;
  readonly videoBytes: Uint8Array;
  readonly contentType: 'video/mp4' | 'video/quicktime' | 'video/webm';
  readonly fidelityEvidence?: FidelityEvidence;
}

export interface LocalVideoComposeInput {
  readonly contentItemId: string;
  readonly creativeId: string;
  readonly standard: CreativeStandard;
  readonly creativeMode: CreativeMode;
  readonly shots: readonly VerifiedVideoShotInput[];
  readonly requiredBrands: readonly string[];
  readonly brandAssets: readonly OfficialBrandAssetInput[];
  readonly generativeException?: GenerativeExceptionApproval;
  readonly references?: readonly VenueReference[];
  readonly createdAt?: string;
}

export interface LocalVideoEditManifestShot {
  readonly order: number;
  readonly shotId: string;
  readonly sourceAssetId: string | null;
  readonly masterAssetId: string | null;
  readonly masterSha256: string | null;
  readonly expectedDurationMs: number | null;
  readonly registryBound: boolean;
}

export interface LocalVideoEditManifest {
  readonly schemaVersion: 1;
  readonly creativeId: string;
  readonly standardId: string;
  readonly creativeMode: CreativeMode;
  readonly outputDimensions: '1080x1920';
  readonly shots: readonly LocalVideoEditManifestShot[];
  readonly referenceAssetIds: readonly string[];
  readonly exactMasterByteBinding: boolean;
}

export interface LocalVideoComposeResult {
  readonly outputBytes: Uint8Array;
  readonly outputContentType: 'video/mp4';
  readonly outputSha256: string;
  readonly dimensions: '1080x1920';
  readonly editManifest: LocalVideoEditManifest;
  readonly manifest: DeterministicRenderManifest;
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
    assertRegisteredShotBindings(input);
    const editManifest = buildVideoEditManifest(input);

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
        contentItemId: input.contentItemId,
        creativeMode: input.creativeMode,
        ...(shot.registry ? { venueAsset: videoShotAsVenueAsset(shot.registry) } : {}),
        ...(shot.fidelityEvidence ? { evidence: shot.fidelityEvidence } : {}),
        candidateSha256: sha256(shot.videoBytes),
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
        registeredShotIds: input.shots.flatMap((shot) =>
          shot.registry ? [shot.registry.shotId] : [],
        ),
        allShotsVerified: true,
        exactMasterByteBinding: true,
      },
    };

    const workspace = await mkdtemp(join(tmpdir(), 'toca-video-composer-'));
    const concatPath = join(workspace, 'concat.txt');
    const outputPath = join(workspace, 'creative.mp4');
    const logoPaths: string[] = [];

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

      await this.commandRunner(
        this.binary,
        buildFfmpegArgs(concatPath, outputPath, logoPaths),
      );
      const outputBytes = await readFile(outputPath);
      const qualityGate = evaluateQualityGate(isMp4(outputBytes), {
        dimensions: '1080x1920',
        outputContentType: 'video/mp4',
        deterministicComposition: true,
        sourceShotCount: input.shots.length,
        editManifestShotCount: editManifest.shots.length,
        registeredShotHashesVerified: true,
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
          shot.registry?.masterAssetId ? [shot.registry.masterAssetId] : [],
        ),
        brandAssetIds: input.brandAssets.map((entry) => entry.registry.brandAssetId),
        outputSha256,
        outputDimensions: '1080x1920',
        exactAssetBinding: true,
        gates: [brandGate, venueGate, qualityGate],
        createdAt,
      };

      return {
        outputBytes,
        outputContentType: 'video/mp4',
        outputSha256,
        dimensions: '1080x1920',
        editManifest,
        manifest,
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
  concatPath: string,
  outputPath: string,
  logoPaths: readonly string[],
): string[] {
  const args: string[] = ['-y', '-f', 'concat', '-safe', '0', '-i', concatPath];
  for (const logoPath of logoPaths) args.push('-loop', '1', '-i', logoPath);

  let chain = '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[base]';
  let previous = 'base';
  const logoCount = Math.max(logoPaths.length, 1);
  const slotWidth = Math.floor(900 / logoCount);
  for (const [index] of logoPaths.entries()) {
    const logoLabel = `logo${index}`;
    const outputLabel = `v${index}`;
    const x = 90 + index * slotWidth + Math.floor(slotWidth * 0.1);
    chain += `;[${index + 1}:v]scale=${Math.floor(slotWidth * 0.72)}:-1[${logoLabel}]`;
    chain += `;[${previous}][${logoLabel}]overlay=${x}:1740:format=auto[${outputLabel}]`;
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
  if (input.creativeMode === 'REAL_PLUS_ENHANCEMENT') {
    throw new ExecutionError(
      'POLICY_DENIED',
      'VIDEO_ENHANCEMENT_PROVENANCE_UNSUPPORTED',
      false,
    );
  }
  if (input.creativeMode === 'GENERATIVE_EXCEPTION') {
    throw new ExecutionError('POLICY_DENIED', 'VIDEO_GENERATIVE_EXCEPTION_UNSUPPORTED', false);
  }
  if (input.shots.some((shot) => !shot.registry)) {
    throw new ExecutionError('POLICY_DENIED', 'VIDEO_SHOT_REGISTRY_BINDING_REQUIRED', false);
  }
  if (input.generativeException || (input.references?.length ?? 0) > 0) {
    throw new ExecutionError('POLICY_DENIED', 'VIDEO_GENERATIVE_CONTEXT_NOT_ALLOWED', false);
  }
  if (input.requiredBrands.length === 0) {
    throw new ExecutionError('POLICY_DENIED', 'FAILED_BRAND_ASSET_MISSING', false);
  }
}

function assertRegisteredShotBindings(input: LocalVideoComposeInput): void {
  for (const shot of input.shots) {
    const registry = shot.registry;
    if (!registry || registry.shotId !== shot.shotId) {
      throw new ExecutionError('POLICY_DENIED', 'VIDEO_SHOT_REGISTRY_BINDING_REQUIRED', false);
    }
    if (
      registry.status !== 'ACTIVE_APPROVED' ||
      !registry.venueVerified ||
      !registry.marketingReady ||
      !registry.masterAssetId ||
      !registry.masterDriveFileId ||
      !registry.masterSha256
    ) {
      throw new ExecutionError('POLICY_DENIED', 'FAILED_NO_VENUE_VERIFIED_ASSET', false);
    }
    if (
      input.standard.operation !== 'ALL' &&
      registry.operation !== input.standard.operation
    ) {
      throw new ExecutionError('POLICY_DENIED', 'FAILED_STANDARD_NOT_RESOLVED', false);
    }
    if (!APPROVED_RIGHTS_STATUSES.has(registry.rightsStatus.trim().toUpperCase())) {
      throw new ExecutionError('POLICY_DENIED', 'VIDEO_SHOT_RIGHTS_NOT_CLEARED', false);
    }
    if (sha256(shot.videoBytes) !== registry.masterSha256) {
      throw new ExecutionError(
        'SOURCE_IMAGE_BINDING_FAILURE',
        'VIDEO_SHOT_MASTER_HASH_MISMATCH',
        false,
      );
    }
  }
}

function buildVideoEditManifest(input: LocalVideoComposeInput): LocalVideoEditManifest {
  const shots = input.shots.map((shot, index): LocalVideoEditManifestShot => ({
    order: index + 1,
    shotId: shot.shotId,
    sourceAssetId: shot.registry?.sourceAssetId ?? null,
    masterAssetId: shot.registry?.masterAssetId ?? null,
    masterSha256: shot.registry?.masterSha256 ?? null,
    expectedDurationMs: shot.registry?.durationMs ?? null,
    registryBound: Boolean(shot.registry),
  }));
  const exactMasterByteBinding = shots.every(
    (shot) =>
      shot.registryBound && Boolean(shot.sourceAssetId && shot.masterAssetId && shot.masterSha256),
  );
  if (!exactMasterByteBinding) {
    throw new ExecutionError('SOURCE_IMAGE_BINDING_FAILURE', 'VIDEO_EDIT_MANIFEST_INCOMPLETE', false);
  }
  return {
    schemaVersion: 1,
    creativeId: input.creativeId,
    standardId: input.standard.standardId,
    creativeMode: input.creativeMode,
    outputDimensions: '1080x1920',
    shots,
    referenceAssetIds: [],
    exactMasterByteBinding,
  };
}

function videoShotAsVenueAsset(shot: VideoShot): VenueAsset {
  return {
    venueAssetId: `VIDEO_SHOT:${shot.shotId}`,
    sourceAssetId: shot.sourceAssetId,
    sourceDriveFileId: shot.sourceDriveFileId,
    ...(shot.masterAssetId ? { masterAssetId: shot.masterAssetId } : {}),
    ...(shot.masterDriveFileId ? { masterDriveFileId: shot.masterDriveFileId } : {}),
    ...(shot.sourceSha256 ? { sourceSha256: shot.sourceSha256 } : {}),
    ...(shot.masterSha256 ? { masterSha256: shot.masterSha256 } : {}),
    operation: shot.operation,
    locationSignature: shot.locationSignature,
    dominantSubject: shot.shotClass,
    venueVerified: shot.venueVerified,
    marketingReady: shot.marketingReady,
    generativeReferenceAllowed: false,
    protectedElements: [],
    status: shot.status,
  };
}

function sourceAssetIdsFor(input: LocalVideoComposeInput): string[] {
  const realSourceIds = input.shots.flatMap((shot) =>
    shot.registry ? [shot.registry.sourceAssetId] : [],
  );
  if (realSourceIds.length === 0) {
    throw new ExecutionError('SOURCE_IMAGE_BINDING_FAILURE', 'FAILED_LINEAGE_MISSING', false);
  }
  return [...new Set(realSourceIds)];
}

async function defaultCommandRunner(command: string, args: readonly string[]): Promise<void> {
  await execFileAsync(command, [...args], { maxBuffer: 4 * 1024 * 1024 });
}

function videoExtension(contentType: VerifiedVideoShotInput['contentType']): string {
  if (contentType === 'video/quicktime') return '.mov';
  if (contentType === 'video/webm') return '.webm';
  return '.mp4';
}

function imageExtension(contentType: OfficialBrandAssetInput['contentType']): string {
  if (contentType === 'image/png') return '.png';
  if (contentType === 'image/webp') return '.webp';
  return '.jpg';
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
