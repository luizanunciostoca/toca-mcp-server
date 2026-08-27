import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { SunsetStoryImageAnalyzerPort } from '../../creative/sunset-story-template-selection-service.js';
import type {
  SunsetStoryImageObservation,
  SunsetStoryZone,
} from '../../creative/sunset-story-image-profile.js';
import type { SunsetStorySemanticAnalyzerPort } from '../../creative/sunset-story-semantic-analysis.js';
import { ExecutionError } from '../../core/errors.js';

const execFileAsync = promisify(execFile);
const GRID_SIZE = 30;
const CELL_SIZE = GRID_SIZE / 3;

export type LocalImagemagickSunsetAnalyzerCommandRunner = (
  command: string,
  args: readonly string[],
) => Promise<string>;

export class LocalImagemagickSunsetStoryImageAnalyzer implements SunsetStoryImageAnalyzerPort {
  constructor(
    private readonly semanticAnalyzer: SunsetStorySemanticAnalyzerPort | null = null,
    private readonly commandRunner: LocalImagemagickSunsetAnalyzerCommandRunner = defaultCommandRunner,
    private readonly identifyBinary = process.env.IMAGE_MAGICK_IDENTIFY_BINARY?.trim() ||
      'identify',
    private readonly convertBinary = process.env.IMAGE_MAGICK_CONVERT_BINARY?.trim() || 'convert',
  ) {}

  async analyze(request: {
    readonly assetId: string;
    readonly imageBytes: Uint8Array;
  }): Promise<SunsetStoryImageObservation> {
    if (!request.assetId.trim() || request.imageBytes.byteLength === 0) {
      throw new ExecutionError(
        'SOURCE_IMAGE_BINDING_FAILURE',
        'SUNSET_IMAGE_ANALYZER_SOURCE_REQUIRED',
        false,
      );
    }

    const contentType = detectContentType(request.imageBytes);
    const workspace = await mkdtemp(join(tmpdir(), 'toca-sunset-analyzer-'));
    const sourcePath = join(workspace, `source${extensionFor(contentType)}`);

    try {
      await writeFile(sourcePath, request.imageBytes);
      const dimensionsRaw = await this.commandRunner(this.identifyBinary, [
        '-format',
        '%w,%h',
        sourcePath,
      ]);
      const { width, height } = parseDimensions(dimensionsRaw);
      const pixelsRaw = await this.commandRunner(this.convertBinary, [
        sourcePath,
        '-auto-orient',
        '-resize',
        `${GRID_SIZE}x${GRID_SIZE}!`,
        '-colorspace',
        'sRGB',
        '-depth',
        '8',
        'txt:-',
      ]);
      const signal = analyzeGrid(pixelsRaw);
      const semantic = this.semanticAnalyzer
        ? await this.semanticAnalyzer.analyzeSemantic({
            assetId: request.assetId,
            imageBytes: request.imageBytes,
            contentType,
          })
        : { subjects: [], horizonY: null, sceneHints: [] };

      return {
        width,
        height,
        subjects: semantic.subjects,
        negativeSpaceZones: signal.negativeSpaceZones,
        regionLuma: signal.regionLuma,
        warmth: signal.warmth,
        crop9x16Fitness: cropFitness(width, height),
        horizonY: semantic.horizonY,
        sceneHints: semantic.sceneHints,
      };
    } catch (error) {
      if (error instanceof ExecutionError) throw error;
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        throw new ExecutionError(
          'CAPABILITY_UNAVAILABLE',
          'SUNSET_IMAGE_ANALYZER_IMAGEMAGICK_UNAVAILABLE',
          false,
        );
      }
      throw new ExecutionError(
        'QUALITY_GATE_FAILED',
        `SUNSET_IMAGE_ANALYZER_FAILED:${error instanceof Error ? error.message : String(error)}`,
        false,
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
}

interface GridSignal {
  readonly regionLuma: Readonly<Partial<Record<SunsetStoryZone, number>>>;
  readonly negativeSpaceZones: readonly SunsetStoryZone[];
  readonly warmth: number;
}

interface PixelSample {
  readonly x: number;
  readonly y: number;
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

function analyzeGrid(raw: string): GridSignal {
  const samples = parsePixels(raw);
  if (samples.length < GRID_SIZE * GRID_SIZE * 0.9) {
    throw new Error('SUNSET_IMAGE_ANALYZER_PIXEL_GRID_INCOMPLETE');
  }

  const lumaBuckets = new Map<SunsetStoryZone, number[]>();
  let warmthSum = 0;
  for (const sample of samples) {
    const zone = zoneForGridPoint(sample.x, sample.y);
    const luma = (0.2126 * sample.red + 0.7152 * sample.green + 0.0722 * sample.blue) / 255;
    const bucket = lumaBuckets.get(zone) ?? [];
    bucket.push(luma);
    lumaBuckets.set(zone, bucket);
    warmthSum += clamp01(0.5 + (sample.red - sample.blue) / 510);
  }

  const regionLuma: Partial<Record<SunsetStoryZone, number>> = {};
  const negativeSpaceZones: SunsetStoryZone[] = [];
  for (const [zone, values] of lumaBuckets) {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    const standardDeviation = Math.sqrt(variance);
    regionLuma[zone] = round(mean, 4);
    if (standardDeviation <= 0.11) negativeSpaceZones.push(zone);
  }

  return {
    regionLuma,
    negativeSpaceZones,
    warmth: round(warmthSum / samples.length, 4),
  };
}

function parsePixels(raw: string): readonly PixelSample[] {
  const samples: PixelSample[] = [];
  const pattern = /^\s*(\d+),(\d+):\s+\((\d+),(\d+),(\d+)/;
  for (const line of raw.split(/\r?\n/)) {
    const match = pattern.exec(line);
    if (!match) continue;
    const [, x, y, red, green, blue] = match;
    samples.push({
      x: Number(x),
      y: Number(y),
      red: Number(red),
      green: Number(green),
      blue: Number(blue),
    });
  }
  return samples;
}

function zoneForGridPoint(x: number, y: number): SunsetStoryZone {
  const horizontal = x < CELL_SIZE ? 'LEFT' : x < CELL_SIZE * 2 ? 'CENTER' : 'RIGHT';
  const vertical = y < CELL_SIZE ? 'TOP' : y < CELL_SIZE * 2 ? 'CENTER' : 'BOTTOM';
  if (vertical === 'CENTER' && horizontal === 'CENTER') return 'CENTER';
  return `${vertical}_${horizontal}` as SunsetStoryZone;
}

function parseDimensions(raw: string): { readonly width: number; readonly height: number } {
  const match = /^\s*(\d+),(\d+)\s*$/.exec(raw);
  if (!match) throw new Error('SUNSET_IMAGE_ANALYZER_DIMENSIONS_INVALID');
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('SUNSET_IMAGE_ANALYZER_DIMENSIONS_INVALID');
  }
  return { width, height };
}

function cropFitness(width: number, height: number): number {
  const sourceAspectRatio = width / height;
  const targetAspectRatio = 9 / 16;
  const retainedArea =
    sourceAspectRatio >= targetAspectRatio
      ? targetAspectRatio / sourceAspectRatio
      : sourceAspectRatio / targetAspectRatio;
  return round(Math.min(1, retainedArea) * 100, 2);
}

function detectContentType(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (
    bytes.byteLength >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) {
    return 'image/webp';
  }
  throw new ExecutionError(
    'SOURCE_IMAGE_BINDING_FAILURE',
    'SUNSET_IMAGE_ANALYZER_MIME_UNSUPPORTED',
    false,
  );
}

function extensionFor(contentType: 'image/jpeg' | 'image/png' | 'image/webp'): string {
  if (contentType === 'image/png') return '.png';
  if (contentType === 'image/webp') return '.webp';
  return '.jpg';
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

async function defaultCommandRunner(command: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync(command, [...args], { maxBuffer: 4 * 1024 * 1024 });
  return stdout;
}
