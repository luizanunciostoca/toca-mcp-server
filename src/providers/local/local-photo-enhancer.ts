import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  TOCA_CREATIVE_TRUTH_POLICY_ID,
  creativeEnhancementProvenanceSchema,
  type CreativeEnhancementProvenance,
} from '../../contracts/creative-truth.js';
import {
  SOURCE_FAITHFUL_CINEMATIC_RESTORATION_PROFILE,
  TOCA_PHOTO_RESTORATION_POLICY_ID,
} from '../../contracts/photo-restoration.js';
import { ExecutionError } from '../../core/errors.js';

const execFileAsync = promisify(execFile);

export interface LocalPhotoEnhanceInput {
  readonly sourceAssetId: string;
  readonly sourceDriveFileId: string;
  readonly imageBytes: Uint8Array;
  readonly contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly creativeTruth: {
    readonly policyId: typeof TOCA_CREATIVE_TRUTH_POLICY_ID;
    readonly creativeMode: 'REAL_PLUS_ENHANCEMENT';
  };
}

export type LocalPhotoEnhanceResult = CreativeEnhancementProvenance & {
  readonly editMode: 'ENHANCE_EXISTING_IMAGE';
  readonly editorProvider: 'LOCAL_IMAGEMAGICK';
  readonly pipelineVersion: 'local-photo-enhancer-v2';
  readonly restorationPolicyId: typeof TOCA_PHOTO_RESTORATION_POLICY_ID;
  readonly restorationProfile: typeof SOURCE_FAITHFUL_CINEMATIC_RESTORATION_PROFILE;
  readonly requestedScale: '4K_LONG_EDGE';
  readonly outputLongEdgePixels: 3840;
  readonly stillMasterFormat: 'JPEG_HIGH_QUALITY_4K';
  readonly proResApplicability: 'VIDEO_ONLY_NOT_APPLICABLE_TO_STILL';
  readonly identityLock: true;
  readonly compositionLock: true;
  readonly structureLock: true;
  readonly backgroundLock: true;
  readonly generativeDetailSynthesisUsed: false;
  readonly semanticAlterationDetected: false;
  readonly restorationConfidence: 'REVIEW_REQUIRED';
  readonly textDetailConfidence: 'REVIEW_REQUIRED';
  readonly iconDetailConfidence: 'REVIEW_REQUIRED';
  readonly microDetailConfidence: 'REVIEW_REQUIRED';
  readonly reviewRequiredReason: 'SOURCE_FIDELITY_AND_DETAIL_REVIEW_REQUIRED';
  readonly promotionEligible: false;
  readonly outputContentType: 'image/jpeg';
  readonly outputBytes: Uint8Array;
};

export type LocalPhotoEnhancerCommandRunner = (
  command: string,
  args: readonly string[],
) => Promise<void>;

export class LocalPhotoEnhancer {
  constructor(
    private readonly commandRunner: LocalPhotoEnhancerCommandRunner = defaultCommandRunner,
    private readonly binary = process.env.IMAGE_MAGICK_CONVERT_BINARY?.trim() || 'convert',
  ) {}

  async enhance(input: LocalPhotoEnhanceInput): Promise<LocalPhotoEnhanceResult> {
    validateInput(input);

    const workspace = await mkdtemp(join(tmpdir(), 'toca-photo-enhancer-'));
    const sourcePath = join(workspace, `source${extensionFor(input.contentType)}`);
    const outputPath = join(workspace, 'output.jpg');

    try {
      await writeFile(sourcePath, input.imageBytes);
      await this.commandRunner(this.binary, [
        sourcePath,
        '-auto-orient',
        '-colorspace',
        'sRGB',
        '-despeckle',
        '-filter',
        'Lanczos',
        '-resize',
        '3840x3840',
        '-contrast-stretch',
        '0.15%x0.15%',
        '-unsharp',
        '0x1.1+0.9+0.015',
        '-quality',
        '98',
        '-define',
        'jpeg:dct-method=float',
        outputPath,
      ]);

      const outputBytes = await readFile(outputPath);
      if (outputBytes.byteLength === 0 || !isJpeg(outputBytes)) {
        throw new ExecutionError(
          'QUALITY_GATE_FAILED',
          'LOCAL_PHOTO_ENHANCER_OUTPUT_INVALID',
          false,
        );
      }

      const provenance = creativeEnhancementProvenanceSchema.parse({
        policyId: TOCA_CREATIVE_TRUTH_POLICY_ID,
        creativeMode: 'REAL_PLUS_ENHANCEMENT',
        sourceAssetId: input.sourceAssetId,
        sourceDriveFileId: input.sourceDriveFileId,
        sourceSha256: sha256(input.imageBytes),
        outputSha256: sha256(outputBytes),
        sourceImageBound: true,
        editorProvider: 'LOCAL_IMAGEMAGICK',
        creativeTruthBound: true,
        requiresVenueFidelityGate: true,
      });

      return {
        ...provenance,
        editMode: 'ENHANCE_EXISTING_IMAGE',
        editorProvider: 'LOCAL_IMAGEMAGICK',
        pipelineVersion: 'local-photo-enhancer-v2',
        restorationPolicyId: TOCA_PHOTO_RESTORATION_POLICY_ID,
        restorationProfile: SOURCE_FAITHFUL_CINEMATIC_RESTORATION_PROFILE,
        requestedScale: '4K_LONG_EDGE',
        outputLongEdgePixels: 3840,
        stillMasterFormat: 'JPEG_HIGH_QUALITY_4K',
        proResApplicability: 'VIDEO_ONLY_NOT_APPLICABLE_TO_STILL',
        identityLock: true,
        compositionLock: true,
        structureLock: true,
        backgroundLock: true,
        generativeDetailSynthesisUsed: false,
        semanticAlterationDetected: false,
        restorationConfidence: 'REVIEW_REQUIRED',
        textDetailConfidence: 'REVIEW_REQUIRED',
        iconDetailConfidence: 'REVIEW_REQUIRED',
        microDetailConfidence: 'REVIEW_REQUIRED',
        reviewRequiredReason: 'SOURCE_FIDELITY_AND_DETAIL_REVIEW_REQUIRED',
        promotionEligible: false,
        outputContentType: 'image/jpeg',
        outputBytes,
      };
    } catch (error) {
      if (error instanceof ExecutionError) throw error;
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        throw new ExecutionError(
          'CAPABILITY_UNAVAILABLE',
          `LOCAL_PHOTO_ENHANCER_BINARY_UNAVAILABLE:${this.binary}`,
          false,
        );
      }
      throw new ExecutionError(
        'PROVIDER_UNAVAILABLE',
        `LOCAL_PHOTO_ENHANCER_FAILED:${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
}

async function defaultCommandRunner(command: string, args: readonly string[]): Promise<void> {
  await execFileAsync(command, [...args], { maxBuffer: 1024 * 1024 });
}

function validateInput(input: LocalPhotoEnhanceInput): void {
  if (!input.sourceAssetId.trim() || !input.sourceDriveFileId.trim()) {
    throw new ExecutionError(
      'SOURCE_IMAGE_BINDING_FAILURE',
      'LOCAL_PHOTO_ENHANCER_SOURCE_ID_REQUIRED',
      false,
    );
  }
  if (input.imageBytes.byteLength === 0) {
    throw new ExecutionError(
      'SOURCE_IMAGE_BINDING_FAILURE',
      'LOCAL_PHOTO_ENHANCER_SOURCE_BYTES_REQUIRED',
      false,
    );
  }
  if (
    !input.creativeTruth ||
    input.creativeTruth.policyId !== TOCA_CREATIVE_TRUTH_POLICY_ID ||
    input.creativeTruth.creativeMode !== 'REAL_PLUS_ENHANCEMENT'
  ) {
    throw new ExecutionError(
      'POLICY_DENIED',
      'LOCAL_PHOTO_ENHANCER_CREATIVE_TRUTH_REQUIRED',
      false,
    );
  }
}

function extensionFor(contentType: LocalPhotoEnhanceInput['contentType']): string {
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
