import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SunsetStoryDynamicReplicationService } from '../src/creative/sunset-story-dynamic-replication-service.js';
import {
  buildCanonicalSunsetStoryRenderPlan,
  validateSunsetStoryAiRenderPlan,
  type SunsetStoryAiRenderPlannerPort,
} from '../src/creative/sunset-story-render-plan.js';
import type { SunsetStoryImageObservation } from '../src/creative/sunset-story-image-profile.js';
import { SunsetStoryTemplateSelectionService } from '../src/creative/sunset-story-template-selection-service.js';
import {
  loadSunsetStoryTemplateContract,
  type SunsetStoryCanonicalTemplateContract,
} from '../src/creative/sunset-story-template-contract.js';
import {
  SunsetStoryDynamicSvgRenderer,
  type SunsetStoryBrandAssetResolverPort,
  type SunsetStoryFontResolverPort,
} from '../src/creative/sunset-story-svg-renderer.js';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function lifestyleObservation(): SunsetStoryImageObservation {
  return {
    width: 1080,
    height: 1920,
    subjects: [
      {
        kind: 'PERSON',
        box: { x: 0.65, y: 0.3, width: 0.26, height: 0.27 },
        salience: 0.95,
      },
    ],
    negativeSpaceZones: ['TOP_LEFT', 'CENTER_LEFT'],
    regionLuma: { TOP_LEFT: 0.28, CENTER_LEFT: 0.32, BOTTOM_CENTER: 0.44 },
    warmth: 0.78,
    crop9x16Fitness: 96,
    horizonY: null,
    sceneHints: ['PEOPLE_GOLDEN_HOUR'],
  };
}

const fontResolver: SunsetStoryFontResolverPort = {
  resolve: (fontRole) =>
    Promise.resolve({
      fontRole,
      family: 'Pinned Test Font',
      sha256: 'a'.repeat(64),
    }),
};

const brandAssetBytes = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><rect width="100" height="40" fill="white"/></svg>',
);

const brandAssetResolver: SunsetStoryBrandAssetResolverPort = {
  resolve: (assetId) =>
    Promise.resolve({
      assetId,
      mimeType: 'image/svg+xml',
      bytes: brandAssetBytes,
      sha256: sha256(brandAssetBytes),
    }),
};

describe('Sunset Story AI dynamic replication', () => {
  it('normalizes all nine approved template contracts from the canonical library', async () => {
    for (let version = 1; version <= 9; version += 1) {
      const contract = await loadSunsetStoryTemplateContract(
        `SUNSET_TEMPLATE_MASTER_V${version}` as Parameters<
          typeof loadSunsetStoryTemplateContract
        >[0],
      );
      expect(contract.templateId).toBe(`SUNSET_TEMPLATE_MASTER_V${version}`);
      expect(contract.canvas).toEqual({ width: 1080, height: 1920 });
      expect(contract.referenceSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(contract.texts.length + contract.assets.length).toBeGreaterThan(0);
    }
  });

  it('rejects AI copy drift instead of allowing the model to rewrite an approved template', async () => {
    const contract = await loadSunsetStoryTemplateContract('SUNSET_TEMPLATE_MASTER_V5');
    const selector = new SunsetStoryTemplateSelectionService({
      analyze: () => Promise.resolve(lifestyleObservation()),
    });
    const selected = await selector.select({
      assetId: 'asset-1',
      imageBytes: new Uint8Array([1]),
      intent: 'LIFESTYLE',
    });
    const candidate = selected.selection.candidates.find(
      (item) => item.templateId === 'SUNSET_TEMPLATE_MASTER_V5',
    );
    expect(candidate).toBeDefined();
    if (!candidate) throw new Error('TEST_CANDIDATE_MISSING');
    const plan = buildCanonicalSunsetStoryRenderPlan(
      contract,
      selected.profile,
      candidate.cropPlan,
    );
    const first = plan.texts[0];
    expect(first).toBeDefined();
    if (!first) throw new Error('TEST_TEXT_MISSING');
    const drifted = {
      ...plan,
      texts: [{ ...first, text: 'Copy inventada pela IA' }, ...plan.texts.slice(1)],
    };
    expect(() =>
      validateSunsetStoryAiRenderPlan(drifted, contract, selected.profile, candidate.cropPlan),
    ).toThrow(/SUNSET_RENDER_COPY_DRIFT/);
  });

  it('renders a fresh vector composition from the photo and official assets without a template PNG', async () => {
    const contract = await loadSunsetStoryTemplateContract('SUNSET_TEMPLATE_MASTER_V9');
    const profile = {
      width: 1080,
      height: 1920,
      sourceAspectRatio: 9 / 16,
      primarySubject: null,
      primarySubjectZone: null,
      negativeSpaceZones: ['CENTER'] as const,
      regionLuma: { CENTER: 0.4 },
      warmth: 0.7,
      crop9x16Fitness: 100,
      horizonY: 0.45,
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
    const renderer = new SunsetStoryDynamicSvgRenderer(brandAssetResolver, fontResolver);
    const rendered = await renderer.render({
      imageBytes: new Uint8Array([255, 216, 255]),
      imageMimeType: 'image/jpeg',
      plan,
    });
    const svg = new TextDecoder().decode(rendered.bytes);
    expect(rendered.mimeType).toBe('image/svg+xml');
    expect(svg).toContain('data:image/jpeg;base64,');
    expect(svg).toContain('#VemPraToca');
    expect(svg).toContain('Hoje tem um pôr do sol');
    expect(svg).not.toContain('INSIRA A IMAGEM DE FUNDO');
    expect(svg).not.toContain('SUNSET_TEMPLATE_MASTER_V9_REFERENCE');
  });

  it('keeps the generated preview non-publishable even when visual QA passes', async () => {
    const selector = new SunsetStoryTemplateSelectionService({
      analyze: () => Promise.resolve(lifestyleObservation()),
    });
    let selectedContract: SunsetStoryCanonicalTemplateContract | null = null;
    const contractLoader = {
      load: async (templateId: Parameters<typeof loadSunsetStoryTemplateContract>[0]) => {
        const contract = await loadSunsetStoryTemplateContract(templateId);
        selectedContract = contract;
        return contract;
      },
    };
    const aiPlanner: SunsetStoryAiRenderPlannerPort = {
      plan: ({ canonicalContract, imageProfile, cropPlan }) =>
        Promise.resolve(
          buildCanonicalSunsetStoryRenderPlan(canonicalContract, imageProfile, cropPlan),
        ),
    };
    const renderer = new SunsetStoryDynamicSvgRenderer(brandAssetResolver, fontResolver);
    const service = new SunsetStoryDynamicReplicationService(
      selector,
      contractLoader,
      aiPlanner,
      renderer,
      {
        evaluate: () =>
          Promise.resolve({
            layoutSimilarity: 0.97,
            typographySimilarity: 0.96,
            brandIntegrity: 1,
            blockingReasons: [],
          }),
      },
    );
    const result = await service.replicate({
      assetId: 'asset-lifestyle-1',
      imageBytes: new Uint8Array([1, 2, 3]),
      imageMimeType: 'image/jpeg',
      intent: 'LIFESTYLE',
      referenceImageBytes: new Uint8Array([9, 8, 7]),
    });
    expect(selectedContract).not.toBeNull();
    expect(result.visualQaStatus).toBe('PASS');
    expect(result.storyReady).toBe(false);
    expect(result.publicationEligible).toBe(false);
  });

  it('fails visual QA when the dynamic replication does not match the approved reference closely enough', async () => {
    const selector = new SunsetStoryTemplateSelectionService({
      analyze: () => Promise.resolve(lifestyleObservation()),
    });
    const aiPlanner: SunsetStoryAiRenderPlannerPort = {
      plan: ({ canonicalContract, imageProfile, cropPlan }) =>
        Promise.resolve(
          buildCanonicalSunsetStoryRenderPlan(canonicalContract, imageProfile, cropPlan),
        ),
    };
    const service = new SunsetStoryDynamicReplicationService(
      selector,
      { load: (templateId) => loadSunsetStoryTemplateContract(templateId) },
      aiPlanner,
      new SunsetStoryDynamicSvgRenderer(brandAssetResolver, fontResolver),
      {
        evaluate: () =>
          Promise.resolve({
            layoutSimilarity: 0.81,
            typographySimilarity: 0.95,
            brandIntegrity: 1,
            blockingReasons: [],
          }),
      },
    );
    const result = await service.replicate({
      assetId: 'asset-lifestyle-2',
      imageBytes: new Uint8Array([1, 2, 3]),
      imageMimeType: 'image/jpeg',
      intent: 'LIFESTYLE',
      referenceImageBytes: new Uint8Array([9, 8, 7]),
    });
    expect(result.visualQaStatus).toBe('FAIL');
    expect(result.publicationEligible).toBe(false);
  });
});
