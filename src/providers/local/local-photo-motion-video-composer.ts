import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import type {
  PhotoToVideoDurationSeconds,
  PhotoToVideoMotionPreset,
  PhotoToVideoSize,
} from '../../contracts/photo-to-video.js';
import { ExecutionError } from '../../core/errors.js';
import type { CreativeVideoSourceContentType } from '../google-drive/creative-video-source-loader.js';

const execFileAsync = promisify(execFile);

export interface LocalPhotoMotionVideoInput {
  readonly sourceBytes: Uint8Array;
  readonly sourceContentType: CreativeVideoSourceContentType;
  readonly sourceSha256: string;
  readonly seconds: PhotoToVideoDurationSeconds;
  readonly size: PhotoToVideoSize;
  readonly motionPreset: PhotoToVideoMotionPreset;
}

export interface LocalPhotoMotionVideoResult {
  readonly outputBytes: Uint8Array;
  readonly outputContentType: 'video/mp4';
  readonly outputSha256: string;
  readonly provider: 'LOCAL_FFMPEG';
  readonly pipelineVersion: 'local-photo-motion-video-v1';
  readonly sceneExpansionAllowed: false;
  readonly semanticGenerationUsed: false;
}

export type PhotoMotionCommandRunner = (
  command: string,
  args: readonly string[],
) => Promise<void>;

export class LocalPhotoMotionVideoComposer {
  constructor(
    private readonly commandRunner: PhotoMotionCommandRunner = defaultRunner,
    private readonly binary = process.env.FFMPEG_BINARY?.trim() || 'ffmpeg',
  ) {}

  async compose(input: LocalPhotoMotionVideoInput): Promise<LocalPhotoMotionVideoResult> {
    validateInput(input);
    const workspace = await mkdtemp(join(tmpdir(), 'toca-photo-motion-'));
    const sourcePath = join(workspace, `source${extension(input.sourceContentType)}`);
    const outputPath = join(workspace, 'motion.mp4');
    try {
      await writeFile(sourcePath, input.sourceBytes);
      await this.commandRunner(this.binary, buildArgs(input, sourcePath, outputPath));
      const outputBytes = await readFile(outputPath);
      if (!isMp4(outputBytes)) {
        throw new ExecutionError('OUTPUT_TECH_SPEC_MISMATCH', 'PHOTO_MOTION_OUTPUT_INVALID_MP4', false);
      }
      return {
        outputBytes,
        outputContentType: 'video/mp4',
        outputSha256: sha256(outputBytes),
        provider: 'LOCAL_FFMPEG',
        pipelineVersion: 'local-photo-motion-video-v1',
        sceneExpansionAllowed: false,
        semanticGenerationUsed: false,
      };
    } catch (error) {
      if (error instanceof ExecutionError) throw error;
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        throw new ExecutionError(
          'CAPABILITY_UNAVAILABLE',
          `PHOTO_MOTION_FFMPEG_UNAVAILABLE:${this.binary}`,
          false,
        );
      }
      throw new ExecutionError(
        'PROVIDER_UNAVAILABLE',
        `PHOTO_MOTION_FFMPEG_FAILED:${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
}

function validateInput(input: LocalPhotoMotionVideoInput): void {
  if (
    input.sourceBytes.byteLength === 0 ||
    !/^[a-f0-9]{64}$/i.test(input.sourceSha256) ||
    sha256(input.sourceBytes) !== input.sourceSha256.toLowerCase()
  ) {
    throw new ExecutionError('SOURCE_IMAGE_BINDING_FAILURE', 'PHOTO_MOTION_SOURCE_HASH_MISMATCH', false);
  }
}

function buildArgs(
  input: LocalPhotoMotionVideoInput,
  sourcePath: string,
  outputPath: string,
): string[] {
  const [width, height] = input.size.split('x').map(Number) as [number, number];
  const frames = input.seconds * 30;
  const zoompan = motionExpression(input.motionPreset, width, height, frames);
  const filter = [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`,
    zoompan,
    'format=yuv420p',
  ].join(',');
  return [
    '-y',
    '-loop',
    '1',
    '-framerate',
    '30',
    '-i',
    sourcePath,
    '-vf',
    filter,
    '-t',
    String(input.seconds),
    '-r',
    '30',
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    outputPath,
  ];
}

function motionExpression(
  preset: PhotoToVideoMotionPreset,
  width: number,
  height: number,
  frames: number,
): string {
  if (preset === 'SLOW_PULL_OUT') {
    return `zoompan=z='if(eq(on,0),1.08,max(1.0,zoom-0.08/${frames}))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=30`;
  }
  if (preset === 'PAN_LEFT_TO_RIGHT') {
    return `zoompan=z='1.06':x='(iw-iw/zoom)*on/${frames}':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=30`;
  }
  if (preset === 'PAN_RIGHT_TO_LEFT') {
    return `zoompan=z='1.06':x='(iw-iw/zoom)*(1-on/${frames})':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=30`;
  }
  return `zoompan=z='min(1.08,1+0.08*on/${frames})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=30`;
}

async function defaultRunner(command: string, args: readonly string[]): Promise<void> {
  await execFileAsync(command, [...args], { maxBuffer: 8 * 1024 * 1024 });
}

function extension(contentType: CreativeVideoSourceContentType): string {
  if (contentType === 'image/jpeg') return '.jpg';
  if (contentType === 'image/png') return '.png';
  return '.webp';
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isMp4(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp';
}
