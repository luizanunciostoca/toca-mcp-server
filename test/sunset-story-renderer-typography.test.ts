import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildCanonicalSunsetStoryRenderPlan } from '../src/creative/sunset-story-render-plan.js';
import { loadSunsetStoryTemplateContract } from '../src/creative/sunset-story-template-contract.js';
import {
  SunsetStoryDynamicSvgRenderer,
  type SunsetStoryBrandAssetResolverPort,
  type SunsetStoryFontResolverPort,
} from '../src/creative/sunset-story-svg-renderer.js';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const assetBytes = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="white"/></svg>',
);

const brandAssets: SunsetStoryBrandAssetResolverPort = {
  resolve: (assetId) =>
    Promise.resolve({
      assetId,
      mimeType: 'image/svg+xml',
      bytes: assetBytes,
      sha256: sha256(assetBytes),
    }),
};

function profile() {
  return {
    width: 1080,
    height: 1920,
    sourceAspectRatio: 9 / 16,
    primarySubject: null,
    primarySubjectZone: null,
    negativeSpaceZones: ['CENTER'] as const,
    regionLuma: { CENTER: 0.3 },
    warmth: 0.7,
    crop9x16Fitness: 100,
    horizonY: 0.45,
    sceneClass: 'SEA_VIEW' as const,
    brightness: 'DARK' as const,
  };
}

const cropPlan = {
  cropWindow: { x: 0, y: 0, width: 1, height: 1 },
  transformedPrimarySubject: null,
  subjectCoverage: 1,
  protectedOverlap: 0,
  placementScore: 1,
  planScore: 100,
};

describe('Sunset Story renderer typography', () => {
  it('requests and emits the heavy manual-defined sans role for V2', async () => {
    const requestedRoles: string[] = [];
    const fonts: SunsetStoryFontResolverPort = {
      resolve: (fontRole) => {
        requestedRoles.push(fontRole);
        return Promise.resolve({
          fontRole,
          family: fontRole === 'GEOMETRIC_SANS_DISPLAY_HEAVY' ? 'Manual Heavy Sans' : 'Manual Utility Sans',
          sha256: 'b'.repeat(64),
        });
      },
    };
    const contract = await loadSunsetStoryTemplateContract('SUNSET_TEMPLATE_MASTER_V2');
    const renderer = new SunsetStoryDynamicSvgRenderer(brandAssets, fonts);
    const output = await renderer.render({
      imageBytes: new Uint8Array([0xff, 0xd8, 0xff]),
      imageMimeType: 'image/jpeg',
      plan: buildCanonicalSunsetStoryRenderPlan(contract, profile(), cropPlan),
    });
    const svg = new TextDecoder().decode(output.bytes);

    expect(requestedRoles).toContain('GEOMETRIC_SANS_DISPLAY_HEAVY');
    expect(requestedRoles).toContain('CLEAN_SANS_TIME');
    expect(svg).toContain('font-family="Manual Heavy Sans"');
    expect(svg).toContain('font-weight="900"');
  });

  it('requests Didone and support sans roles for the V5 manual contract', async () => {
    const requestedRoles: string[] = [];
    const fonts: SunsetStoryFontResolverPort = {
      resolve: (fontRole) => {
        requestedRoles.push(fontRole);
        return Promise.resolve({ fontRole, family: fontRole, sha256: 'c'.repeat(64) });
      },
    };
    const contract = await loadSunsetStoryTemplateContract('SUNSET_TEMPLATE_MASTER_V5');
    const renderer = new SunsetStoryDynamicSvgRenderer(brandAssets, fonts);
    await renderer.render({
      imageBytes: new Uint8Array([0xff, 0xd8, 0xff]),
      imageMimeType: 'image/jpeg',
      plan: buildCanonicalSunsetStoryRenderPlan(contract, profile(), cropPlan),
    });

    expect(requestedRoles).toContain('EDITORIAL_DIDONE_HEADLINE');
    expect(requestedRoles).toContain('GEOMETRIC_SANS_SUPPORT');
    expect(requestedRoles).toContain('CLEAN_SANS_CTA');
  });
});
