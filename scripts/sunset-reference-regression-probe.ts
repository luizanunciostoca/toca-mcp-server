import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildCanonicalSunsetStoryRenderPlan } from '../src/creative/sunset-story-render-plan.js';
import { ImageMagickSunsetStoryRasterizer } from '../src/creative/sunset-story-rasterizer.js';
import { RepositorySunsetStoryPinnedFontResolver } from '../src/creative/sunset-story-pinned-font-resolver.js';
import { loadSunsetStoryTemplateContract } from '../src/creative/sunset-story-template-contract.js';
import {
  SunsetStoryDynamicSvgRenderer,
  type SunsetStoryBrandAssetResolverPort,
} from '../src/creative/sunset-story-svg-renderer.js';
import type { SunsetStoryTemplateId } from '../src/creative/sunset-story-template-registry.js';

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
  ...contract.texts.map((item) => ({ id: item.id, kind: 'TEXT', region: item.region })),
  ...contract.shapes.map((item) => ({ id: item.id, kind: 'SHAPE', region: item.region })),
].filter((item) => {
  const key = `${item.kind}:${item.region.x}:${item.region.y}:${item.region.width}:${item.region.height}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

await mkdir(outputDirectory, { recursive: true });
await writeFile(path.join(outputDirectory, `v${version}.rendered.png`), png.bytes);
await writeFile(
  path.join(outputDirectory, `v${version}.regions.json`),
  `${JSON.stringify({ templateId, referenceSha256: contract.referenceSha256, regions }, null, 2)}\n`,
  'utf8',
);
console.log(`SUNSET_REGRESSION_RENDERED=${templateId}`);
console.log(`SUNSET_REGRESSION_REGIONS=${regions.length}`);
console.log(`SUNSET_REGRESSION_FONT_SHAS=${JSON.stringify(svg.fontShas)}`);
