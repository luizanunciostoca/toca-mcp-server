import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ExecutionError } from '../../core/errors.js';

const execFileAsync = promisify(execFile);

export interface GeneratedVideoPostProcessResult {
  readonly outputBytes: Uint8Array;
  readonly outputContentType: 'video/mp4';
  readonly outputSha256: string;
  readonly provider: 'LOCAL_FFMPEG';
}

export interface GeneratedVideoTrimInput {
  readonly videoBytes: Uint8Array;
  readonly startSeconds: number;
  readonly durationSeconds: number;
}

export interface GeneratedVideoOverlayInput {
  readonly videoBytes: Uint8Array;
  readonly overlayPngBytes: Uint8Array;
}

export type GeneratedVideoCommandRunner = (
  command: string,
  args: readonly string[],
) => Promise<void>;

export class LocalGeneratedVideoPostProcessor {
  constructor(
    private readonly commandRunner: GeneratedVideoCommandRunner = defaultRunner,
    private readonly binary = process.env.FFMPEG_BINARY?.trim() || 'ffmpeg',
  ) {}

  async trim(input: GeneratedVideoTrimInput): Promise<GeneratedVideoPostProcessResult> {
    assertMp4(input.videoBytes, 'GENERATED_VIDEO_TRIM_INPUT_INVALID_MP4');
    if (
      !Number.isFinite(input.startSeconds) ||
      input.startSeconds < 0 ||
      !Number.isFinite(input.durationSeconds) ||
      input.durationSeconds <= 0 ||
      input.durationSeconds > 600
    ) {
      throw new ExecutionError(
        'OUTPUT_TECH_SPEC_MISMATCH',
        'GENERATED_VIDEO_TRIM_RANGE_INVALID',
        false,
      );
    }

    return this.run('trim', input.videoBytes, undefined, [
      '-y',
      '-ss',
      formatSeconds(input.startSeconds),
      '-i',
      '{VIDEO}',
      '-t',
      formatSeconds(input.durationSeconds),
      '-map',
      '0:v:0',
      '-map',
      '0:a?',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '18',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '{OUTPUT}',
    ]);
  }

  async overlayStaticGraphics(
    input: GeneratedVideoOverlayInput,
  ): Promise<GeneratedVideoPostProcessResult> {
    assertMp4(input.videoBytes, 'GENERATED_VIDEO_OVERLAY_INPUT_INVALID_MP4');
    assertPng(input.overlayPngBytes);

    return this.run('overlay', input.videoBytes, input.overlayPngBytes, [
      '-y',
      '-i',
      '{VIDEO}',
      '-loop',
      '1',
      '-i',
      '{OVERLAY}',
      '-filter_complex',
      '[0:v][1:v]overlay=0:0:format=auto:shortest=1,format=yuv420p[v]',
      '-map',
      '[v]',
      '-map',
      '0:a?',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '18',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-shortest',
      '-movflags',
      '+faststart',
      '{OUTPUT}',
    ]);
  }

  private async run(
    operation: string,
    videoBytes: Uint8Array,
    overlayPngBytes: Uint8Array | undefined,
    argumentTemplate: readonly string[],
  ): Promise<GeneratedVideoPostProcessResult> {
    const workspace = await mkdtemp(join(tmpdir(), `toca-generated-video-${operation}-`));
    const videoPath = join(workspace, 'input.mp4');
    const overlayPath = join(workspace, 'overlay.png');
    const outputPath = join(workspace, 'output.mp4');
    try {
      await writeFile(videoPath, videoBytes);
      if (overlayPngBytes) await writeFile(overlayPath, overlayPngBytes);
      const args = argumentTemplate.map((value) => {
        if (value === '{VIDEO}') return videoPath;
        if (value === '{OVERLAY}') return overlayPath;
        if (value === '{OUTPUT}') return outputPath;
        return value;
      });
      await this.commandRunner(this.binary, args);
      const outputBytes = await readFile(outputPath);
      assertMp4(outputBytes, 'GENERATED_VIDEO_POSTPROCESS_OUTPUT_INVALID_MP4');
      return {
        outputBytes,
        outputContentType: 'video/mp4',
        outputSha256: sha256(outputBytes),
        provider: 'LOCAL_FFMPEG',
      };
    } catch (error) {
      if (error instanceof ExecutionError) throw error;
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        throw new ExecutionError(
          'CAPABILITY_UNAVAILABLE',
          `GENERATED_VIDEO_FFMPEG_UNAVAILABLE:${this.binary}`,
          false,
        );
      }
      throw new ExecutionError(
        'PROVIDER_UNAVAILABLE',
        `GENERATED_VIDEO_POSTPROCESS_FAILED:${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
}

async function defaultRunner(command: string, args: readonly string[]): Promise<void> {
  await execFileAsync(command, [...args], { maxBuffer: 8 * 1024 * 1024 });
}

function assertMp4(bytes: Uint8Array, code: string): void {
  if (bytes.byteLength < 12 || String.fromCharCode(...bytes.slice(4, 8)) !== 'ftyp') {
    throw new ExecutionError('OUTPUT_TECH_SPEC_MISMATCH', code, false);
  }
}

function assertPng(bytes: Uint8Array): void {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    bytes.byteLength < signature.length ||
    signature.some((value, index) => bytes[index] !== value)
  ) {
    throw new ExecutionError(
      'OUTPUT_TECH_SPEC_MISMATCH',
      'GENERATED_VIDEO_OVERLAY_INPUT_INVALID_PNG',
      false,
    );
  }
}

function formatSeconds(value: number): string {
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
