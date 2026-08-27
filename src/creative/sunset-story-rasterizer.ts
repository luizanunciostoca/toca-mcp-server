import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

export interface SunsetStoryRasterizeRequest {
  readonly svgBytes: Uint8Array;
}

export interface SunsetStoryRasterizeResult {
  readonly mimeType: 'image/png';
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly width: 1080;
  readonly height: 1920;
}

export interface SunsetStoryRasterizerPort {
  rasterize(request: SunsetStoryRasterizeRequest): Promise<SunsetStoryRasterizeResult>;
}

export interface ImageMagickSunsetStoryRasterizerOptions {
  readonly command?: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function hasPngSignature(bytes: Uint8Array): boolean {
  if (bytes.byteLength < PNG_SIGNATURE.byteLength) return false;
  return PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

export class ImageMagickSunsetStoryRasterizer implements SunsetStoryRasterizerPort {
  private readonly command: string;
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;

  constructor(options: ImageMagickSunsetStoryRasterizerOptions = {}) {
    this.command = options.command ?? 'convert';
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.maxOutputBytes = options.maxOutputBytes ?? 15 * 1024 * 1024;
  }

  async rasterize(request: SunsetStoryRasterizeRequest): Promise<SunsetStoryRasterizeResult> {
    if (request.svgBytes.byteLength === 0) throw new Error('SUNSET_RASTERIZER_SVG_EMPTY');
    const output = await this.runConvert(request.svgBytes);
    if (!hasPngSignature(output)) throw new Error('SUNSET_RASTERIZER_OUTPUT_NOT_PNG');
    return {
      mimeType: 'image/png',
      bytes: output,
      sha256: sha256(output),
      width: 1080,
      height: 1920,
    };
  }

  private runConvert(svgBytes: Uint8Array): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        this.command,
        [
          'svg:-',
          '-resize',
          '1080x1920!',
          '-strip',
          '-define',
          'png:exclude-chunk=date,time',
          'png:-',
        ],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputBytes = 0;
      let settled = false;

      const finishWithError = (error: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill('SIGKILL');
        reject(error);
      };

      const timer = setTimeout(() => {
        finishWithError(new Error('SUNSET_RASTERIZER_TIMEOUT'));
      }, this.timeoutMs);

      child.on('error', (error) => {
        finishWithError(new Error(`SUNSET_RASTERIZER_PROCESS_ERROR:${error.message}`));
      });
      child.stdout.on('data', (chunk: Buffer) => {
        outputBytes += chunk.byteLength;
        if (outputBytes > this.maxOutputBytes) {
          finishWithError(new Error('SUNSET_RASTERIZER_OUTPUT_TOO_LARGE'));
          return;
        }
        stdout.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.reduce((sum, item) => sum + item.byteLength, 0) < 32_000) stderr.push(chunk);
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0) {
          const detail = Buffer.concat(stderr).toString('utf8').slice(0, 500);
          reject(new Error(`SUNSET_RASTERIZER_FAILED:${String(code)}:${detail}`));
          return;
        }
        resolve(new Uint8Array(Buffer.concat(stdout)));
      });

      child.stdin.on('error', () => undefined);
      child.stdin.end(Buffer.from(svgBytes));
    });
  }
}
