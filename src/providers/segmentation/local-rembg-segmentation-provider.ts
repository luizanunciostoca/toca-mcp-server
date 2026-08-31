import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ExecutionError } from '../../core/errors.js';
import type {
  ArtistSegmentationProvider,
  ArtistSegmentationProviderInput as SegmentationInput,
  ArtistSegmentationProviderResult as SegmentationResult,
} from '../../creative/artist-segmentation.js';

const execFileAsync = promisify(execFile);
type Runner = (command: string, args: readonly string[]) => Promise<void>;
type ContentType = SegmentationInput['contentType'];

const REMBG_PYTHON_SCRIPT = [
  'from pathlib import Path',
  'import sys',
  'from rembg import new_session, remove',
  'source_path, output_path, model_name = sys.argv[1:4]',
  'source = Path(source_path).read_bytes()',
  'session = new_session(model_name)',
  'output = remove(source, session=session, alpha_matting=True)',
  'Path(output_path).write_bytes(output)',
].join('; ');

export class LocalRembgSegmentationProvider implements ArtistSegmentationProvider {
  constructor(
    private readonly pythonBinary = process.env.PYTHON_BINARY?.trim() || 'python3',
    private readonly model = process.env.REMBG_ARTIST_MODEL?.trim() || 'u2net_human_seg',
    private readonly runner: Runner = defaultRunner,
  ) {}

  async segment(input: SegmentationInput): Promise<SegmentationResult> {
    const workspace = await mkdtemp(join(tmpdir(), 'toca-rembg-'));
    const sourcePath = join(workspace, `source${extensionFor(input.contentType)}`);
    const outputPath = join(workspace, 'provider-cutout.png');

    try {
      await writeFile(sourcePath, input.sourceBytes);
      const args = ['-c', REMBG_PYTHON_SCRIPT, sourcePath, outputPath, this.model];
      await this.runner(this.pythonBinary, args);

      const bytes = await readFile(outputPath);
      if (!isPng(bytes)) {
        throw new ExecutionError('QUALITY_GATE_FAILED', 'REMBG_SEGMENTATION_OUTPUT_INVALID', false);
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
          `PYTHON_BINARY_UNAVAILABLE:${this.pythonBinary}`,
          false,
        );
      }

      const detail = error instanceof Error ? error.message : String(error);
      throw new ExecutionError('PROVIDER_UNAVAILABLE', `REMBG_SEGMENTATION_FAILED:${detail}`, true);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
}

function extensionFor(contentType: ContentType): string {
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
