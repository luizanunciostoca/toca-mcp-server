import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ExecutionError } from '../../core/errors.js';

const execFileAsync = promisify(execFile);

export interface LocalPhotoEnhanceInput {
  readonly sourceAssetId: string;
  readonly sourceDriveFileId: string;
  readonly imageBytes: Uint8Array;
  readonly contentType: 'image/jpeg' | 'image/png' | 'image/webp';
}

export interface LocalPhotoEnhanceResult {
  readonly sourceAssetId: string;
  readonly sourceDriveFileId: string;
  readonly sourceSha256: string;
  readonly outputSha256: string;
  readonly sourceImageBound: true;
  readonly editMode: 'ENHANCE_EXISTING_IMAGE';
  readonly editorProvider: 'LOCAL_IMAGEMAGICK';
  readonly pipelineVersion: 'local-photo-enhancer-v1';
  readonly requestedScale: '200%';
  readonly outputContentType: 'image/jpeg';
  readonly outputBytes: Uint8Array;
}

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
        '-filter',
        'Lanczos',
        '-resize',
        '200%',
        '-unsharp',
        '0x0.8+0.8+0.02',
        '-quality',
        '95',
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

      return {
        sourceAssetId: input.sourceAssetId,
        sourceDriveFileId: input.sourceDriveFileId,
        sourceSha256: sha256(input.imageBytes),
        outputSha256: sha256(outputBytes),
        sourceImageBound: true,
        editMode: 'ENHANCE_EXISTING_IMAGE',
        editorProvider: 'LOCAL_IMAGEMAGICK',
        pipelineVersion: 'local-photo-enhancer-v1',
        requestedScale: '200%',
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
