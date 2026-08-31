import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ExecutionError } from '../../core/errors.js';
import type {
  ArtistSegmentationProvider,
  ArtistSegmentationProviderInput,
  ArtistSegmentationProviderResult,
} from '../../creative/artist-segmentation.js';

const execFileAsync = promisify(execFile);

export class LocalRembgSegmentationProvider implements ArtistSegmentationProvider {
  constructor(
    private readonly binary = process.env.REMBG_BINARY?.trim() || 'rembg',
    private readonly model = process.env.REMBG_ARTIST_MODEL?.trim() || 'u2net_human_seg',
    private readonly runner: (command: string, args: readonly string[]) => Promise<void> =
      defaultRunner,
  ) {}

  async segment(
    input: ArtistSegmentationProviderInput,
  ): Promise<ArtistSegmentationProviderResult> {
    const workspace = await mkdtemp(join(tmpdir(), 'toca-rembg-'));
    const sourcePath = join(workspace, `source${extensionFor(input.contentType)}`);
    const outputPath = join(workspace, 'provider-cutout.png');

    try {
      await writeFile(sourcePath, input.sourceBytes);
      await this.runner(this.binary, [
        'i',
        '-m',
        this.model,
        '-a',
        sourcePath,
        outputPath,
      ]);
      const bytes = await readFile(outputPath);
      if (!isPng(bytes)) {
        throw new ExecutionError(
          'QUALITY_GATE_FAILED',
          'REMBG_SEGMENTATION_OUTPUT_INVALID',
          false,
        );
      }
      return {
        cutoutPngBytes: bytes,
        provider: `LOCAL_REMBG:${this.model}`,
        nonGenerative: true,
      };
    } catch (error) {
      if (error instanceof ExecutionError) throw error;
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        throw new ExecutionError(
          'CAPABILITY_UNAVAILABLE',
          `REMBG_BINARY_UNAVAILABLE:${this.binary}`,
          false,
        );
      }
      throw new ExecutionError(
        'PROVIDER_UNAVAILABLE',
        `REMBG_SEGMENTATION_FAILED:${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
}

function extensionFor(contentType: ArtistSegmentationProviderInput['contentType']): string {
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
