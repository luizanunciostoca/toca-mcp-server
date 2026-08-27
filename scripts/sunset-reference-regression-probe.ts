import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { RepositorySunsetStoryPinnedFontResolver } from '../src/creative/sunset-story-pinned-font-resolver.js';
import { ImageMagickSunsetStoryRasterizer } from '../src/creative/sunset-story-rasterizer.js';
import { buildCanonicalSunsetStoryRenderPlan } from '../src/creative/sunset-story-render-plan.js';
import { loadSunsetStoryTemplateContract } from '../src/creative/sunset-story-template-contract.js';
import type { SunsetStoryTemplateId } from '../src/creative/sunset-story-template-registry.js';
import {
  SunsetStoryDynamicSvgRenderer,
  type SunsetStoryBrandAssetResolverPort,
} from '../src/creative/sunset-story-svg-renderer.js';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const transparentPng = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+4k1Z1QAAAABJRU5ErkJggg==',
    'base64',
  ),
);

const transparentBrandAssets: SunsetStoryBrandAssetResolverPort = {
  resolve: (assetId) =>
    Promise.resolve({
      assetId,
      mimeType: 'image/png',
      bytes: transparentPng,
      sha256: sha256(transparentPng),
    }),
};

function parseVersion(value: string | undefined): number {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1 || version > 9) {
    throw new Error('SUNSET_REGRESSION_VERSION_INVALID');
  }
  return version;
}

interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function runCommand(
  command: string,
  args: readonly string[],
  acceptedExitCodes: readonly number[] = [0],
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      const normalizedCode = code ?? -1;
      const result = {
        code: normalizedCode,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };
      if (!acceptedExitCodes.includes(normalizedCode)) {
        reject(
          new Error(
            `SUNSET_REGRESSION_COMMAND_FAILED:${command}:${normalizedCode}:${result.stderr.slice(0, 500)}`,
          ),
        );
        return;
      }
      resolve(result);
    });
  });
}

function parseSsim(value: string): number {
  const match = /(?:^|\s)([01](?:\.\d+)?(?:e[-+]?\d+)?)(?:\s|$|\s*\()/i.exec(value.trim());
  if (!match?.[1]) throw new Error(`SUNSET_REGRESSION_SSIM_UNPARSEABLE:${value.slice(0, 120)}`);
  const score = Number(match[1]);
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new Error(`SUNSET_REGRESSION_SSIM_INVALID:${match[1]}`);
  }
  return score;
}

function safeFilePart(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_.-]/g, '_');
}

const version = parseVersion(process.argv[2]);
const sourcePath = process.argv[3];
const outputDirectory = process.argv[4];
if (!sourcePath || !outputDirectory) throw new Error('SUNSET_REGRESSION_ARGUMENT_MISSING');

const templateId = `SUNSET_TEMPLATE_MASTER_V${version}` as SunsetStoryTemplateId;
const contract = await loadSunsetStoryTemplateContract(templateId);
const sourceBytes = new Uint8Array(await readFile(sourcePath));

const profile = {
  width: 1080,
  height: 1920,
  sourceAspectRatio: 9 / 16,
  primarySubject: null,
  primarySubjectZone: null,
  negativeSpaceZones: ['CENTER'] as const,
  regionLuma: { CENTER: 0.5 },
  warmth: 0.5,
  crop9x16Fitness: 100,
  horizonY: 0.5,
  sceneClass: 'SEA_VIEW' as const,
  brightness: 'MEDIUM' as const,
};

const cropPlan = {
  cropWindow: { x: 0, y: 0, width: 1, height: 1 },
  transformedPrimarySubject: null,
  subjectCoverage: 1,
  protectedOverlap: 0,
  placementScore: 1,
  planScore: 100,
};

const plan = buildCanonicalSunsetStoryRenderPlan(contract, profile, cropPlan);
const renderer = new SunsetStoryDynamicSvgRenderer(
  transparentBrandAssets,
  new RepositorySunsetStoryPinnedFontResolver(),
);
const svg = await renderer.render({ imageBytes: sourceBytes, imageMimeType: 'image/png', plan });
const rasterizer = new ImageMagickSunsetStoryRasterizer();
const png = await rasterizer.rasterize({ svgBytes: svg.bytes });

const seen = new Set<string>();
const regions = [
  ...contract.texts.map((item) => ({ id: item.id, kind: 'TEXT' as const, region: item.region })),
  ...contract.shapes.map((item) => ({ id: item.id, kind: 'SHAPE' as const, region: item.region })),
].filter((item) => {
  const key = `${item.kind}:${item.region.x}:${item.region.y}:${item.region.width}:${item.region.height}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

await mkdir(outputDirectory, { recursive: true });
const renderedPath = path.join(outputDirectory, `v${version}.rendered.png`);
await writeFile(renderedPath, png.bytes);

const metrics: Array<{
  readonly id: string;
  readonly kind: 'TEXT' | 'SHAPE';
  readonly ssim: number;
}> = [];
for (const item of regions) {
  const x = Math.round(item.region.x);
  const y = Math.round(item.region.y);
  const width = Math.round(item.region.width);
  const height = Math.round(item.region.height);
  const geometry = `${width}x${height}+${x}+${y}`;
  const base = `v${version}.${safeFilePart(item.kind)}.${safeFilePart(item.id)}`;
  const referenceCrop = path.join(outputDirectory, `${base}.reference.png`);
  const renderedCrop = path.join(outputDirectory, `${base}.rendered.png`);
  await runCommand('convert', [sourcePath, '-crop', geometry, '+repage', referenceCrop]);
  await runCommand('convert', [renderedPath, '-crop', geometry, '+repage', renderedCrop]);
  const comparison = await runCommand('compare', ['-metric', 'SSIM', referenceCrop, renderedCrop, 'null:'], [0, 1]);
  const ssim = parseSsim(comparison.stderr);
  metrics.push({ id: item.id, kind: item.kind, ssim });
  console.log(`SUNSET_REGRESSION_REGION=V${version}:${item.kind}:${item.id}:SSIM=${ssim.toFixed(9)}`);
  await Promise.all([rm(referenceCrop, { force: true }), rm(renderedCrop, { force: true })]);
}

const textScores = metrics.filter((item) => item.kind === 'TEXT').map((item) => item.ssim);
const shapeScores = metrics.filter((item) => item.kind === 'SHAPE').map((item) => item.ssim);
const minTextSsim = textScores.length > 0 ? Math.min(...textScores) : null;
const minShapeSsim = shapeScores.length > 0 ? Math.min(...shapeScores) : null;
const averageTextSsim =
  textScores.length > 0 ? textScores.reduce((sum, value) => sum + value, 0) / textScores.length : null;

await writeFile(
  path.join(outputDirectory, `v${version}.metrics.json`),
  `${JSON.stringify(
    {
      templateId,
      referenceSha256: contract.referenceSha256,
      renderedSha256: png.sha256,
      fontShas: svg.fontShas,
      minTextSsim,
      averageTextSsim,
      minShapeSsim,
      metrics,
    },
    null,
    2,
  )}\n`,
  'utf8',
);
console.log(`SUNSET_REGRESSION_RENDERED=${templateId}`);
console.log(`SUNSET_REGRESSION_REGIONS=${regions.length}`);
console.log(`SUNSET_REGRESSION_MIN_TEXT_SSIM=${minTextSsim ?? 'NONE'}`);
console.log(`SUNSET_REGRESSION_AVG_TEXT_SSIM=${averageTextSsim ?? 'NONE'}`);
console.log(`SUNSET_REGRESSION_MIN_SHAPE_SSIM=${minShapeSsim ?? 'NONE'}`);
console.log(`SUNSET_REGRESSION_FONT_SHAS=${JSON.stringify(svg.fontShas)}`);
