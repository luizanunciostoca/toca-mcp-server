import { describe, expect, it } from 'vitest';
import {
  buildSunsetStoryImageProfile,
  type SunsetStoryImageObservation,
} from '../src/creative/sunset-story-image-profile.js';
import { SunsetStoryTemplateSelectionService } from '../src/creative/sunset-story-template-selection-service.js';
import {
  decideSunsetStoryTemplate,
  rankSunsetStoryTemplates,
  selectSunsetStoryTemplate,
  type SunsetStoryTemplateCandidate,
} from '../src/creative/sunset-story-template-selector.js';
import type {
  SunsetStoryImageAnalyzerPort,
  SunsetStoryPreviewEvaluatorPort,
} from '../src/creative/sunset-story-template-selection-service.js';
import type { SunsetStoryTemplateId } from '../src/creative/sunset-story-template-registry.js';

function observation(
  overrides: Partial<SunsetStoryImageObservation> = {},
): SunsetStoryImageObservation {
  return {
    width: 1080,
    height: 1920,
    subjects: [],
    protectedFeatures: [],
    negativeSpaceZones: ['TOP_LEFT', 'TOP_CENTER', 'CENTER_LEFT'],
    regionLuma: {
      TOP_LEFT: 0.28,
      TOP_CENTER: 0.3,
      CENTER_LEFT: 0.32,
      CENTER: 0.4,
      BOTTOM_CENTER: 0.45,
    },
    warmth: 0.75,
    crop9x16Fitness: 94,
    horizonY: null,
    sceneHints: [],
    ...overrides,
  };
}

function personRightObservation(): SunsetStoryImageObservation {
  return observation({
    subjects: [
      {
        kind: 'PERSON',
        box: { x: 0.65, y: 0.3, width: 0.26, height: 0.27 },
        salience: 0.95,
      },
    ],
    sceneHints: ['PEOPLE_GOLDEN_HOUR'],
  });
}

function drinkObservation(): SunsetStoryImageObservation {
  return observation({
    subjects: [
      {
        kind: 'DRINK',
        box: { x: 0.36, y: 0.1, width: 0.28, height: 0.3 },
        salience: 0.96,
      },
      {
        kind: 'PERSON',
        box: { x: 0.7, y: 0.25, width: 0.18, height: 0.3 },
        salience: 0.55,
      },
    ],
    negativeSpaceZones: ['BOTTOM_CENTER', 'BOTTOM_LEFT', 'BOTTOM_RIGHT'],
    sceneHints: ['DRINKS'],
  });
}

function productOnlyDrinkObservation(): SunsetStoryImageObservation {
  return observation({
    subjects: [
      {
        kind: 'DRINK',
        box: { x: 0.36, y: 0.1, width: 0.28, height: 0.3 },
        salience: 0.96,
      },
    ],
    negativeSpaceZones: ['BOTTOM_CENTER', 'BOTTOM_LEFT', 'BOTTOM_RIGHT'],
    sceneHints: ['DRINKS'],
  });
}

function fakeCandidate(
  templateId: SunsetStoryTemplateId,
  score: number,
): SunsetStoryTemplateCandidate {
  return {
    templateId,
    templateClass:
      templateId === 'SUNSET_TEMPLATE_MASTER_V9' ? 'SUNSET_VIEW_SCENERY' : 'SUNSET_HERO_LIFESTYLE',
    score,
    hardRejected: false,
    rejectionReasons: [],
    components: {
      subjectPreservation: 100,
      textSpaceCompatibility: 100,
      collisionClearance: 100,
      semanticCompatibility: 100,
      contrastReadability: 100,
      cropQuality: 100,
      antiRepeat: 100,
    },
    cropPlan: {
      cropWindow: { x: 0, y: 0, width: 1, height: 1 },
      transformedPrimarySubject: null,
      subjectCoverage: 1,
      protectedOverlap: 0,
      protectedFeatureOverlap: 0,
      minimumProtectedFeatureCoverage: 1,
      placementScore: 1,
      planScore: 100,
    },
  };
}

describe('Sunset Story intelligent template selection', () => {
  it('builds a deterministic profile and infers a golden-hour person scene', () => {
    const profile = buildSunsetStoryImageProfile(personRightObservation());
    expect(profile.sceneClass).toBe('PEOPLE_GOLDEN_HOUR');
    expect(profile.primarySubjectZone).toBe('CENTER_RIGHT');
    expect(profile.brightness).toBe('MEDIUM');
    expect(profile.protectedFeatures).toEqual([]);
  });

  it('prefers V5 for a right-side lifestyle subject with left-side negative space', () => {
    const selection = selectSunsetStoryTemplate({
      profile: buildSunsetStoryImageProfile(personRightObservation()),
      intent: 'LIFESTYLE',
    });
    expect(selection.selectedTemplateId).toBe('SUNSET_TEMPLATE_MASTER_V5');
    expect(selection.mode).not.toBe('NO_SAFE_TEMPLATE');
  });

  it('prefers V4 for a drinks-led image that preserves human service context', () => {
    const selection = selectSunsetStoryTemplate({
      profile: buildSunsetStoryImageProfile(drinkObservation()),
      intent: 'DRINKS',
    });
    expect(selection.selectedTemplateId).toBe('SUNSET_TEMPLATE_MASTER_V4');
  });

  it('rejects a product-only drink crop when experience context is required', () => {
    const selection = selectSunsetStoryTemplate({
      profile: buildSunsetStoryImageProfile(productOnlyDrinkObservation()),
      intent: 'DRINKS',
    });
    expect(selection.mode).toBe('NO_SAFE_TEMPLATE');
    expect(
      selection.candidates.some((candidate) =>
        candidate.rejectionReasons.includes('PRODUCT_ONLY_COMPOSITION'),
      ),
    ).toBe(true);
  });

  it('rejects a dominant person for an ambience editorial slot', () => {
    const selection = selectSunsetStoryTemplate({
      profile: buildSunsetStoryImageProfile(personRightObservation()),
      intent: 'AMBIENCE',
    });
    expect(selection.mode).toBe('NO_SAFE_TEMPLATE');
    expect(
      selection.candidates.some((candidate) =>
        candidate.rejectionReasons.includes(
          'ASSET_EDITORIAL_MISMATCH:AMBIENCE_PERSON_DOMINANT',
        ),
      ),
    ).toBe(true);
  });

  it('requires explicit DJ or music gear evidence for a music slot and selects V8 when present', () => {
    const missingMusicEvidence = selectSunsetStoryTemplate({
      profile: buildSunsetStoryImageProfile(personRightObservation()),
      intent: 'MUSIC',
    });
    expect(missingMusicEvidence.mode).toBe('NO_SAFE_TEMPLATE');

    const musicObservation = observation({
      subjects: [
        {
          kind: 'DJ_GEAR',
          box: { x: 0.68, y: 0.42, width: 0.18, height: 0.12 },
          salience: 0.96,
        },
      ],
      negativeSpaceZones: ['TOP_CENTER', 'CENTER_LEFT'],
      sceneHints: ['MUSIC_DJ'],
      warmth: 0.45,
    });
    const selection = selectSunsetStoryTemplate({
      profile: buildSunsetStoryImageProfile(musicObservation),
      intent: 'MUSIC',
    });
    expect(selection.selectedTemplateId).toBe('SUNSET_TEMPLATE_MASTER_V8');
  });

  it('prefers V9 for scenery with usable central negative space', () => {
    const profile = buildSunsetStoryImageProfile(
      observation({
        sceneHints: ['SEA_VIEW'],
        horizonY: 0.46,
        negativeSpaceZones: ['CENTER', 'CENTER_LEFT', 'CENTER_RIGHT', 'TOP_CENTER'],
      }),
    );
    const selection = selectSunsetStoryTemplate({ profile, intent: 'SCENERY' });
    expect(selection.selectedTemplateId).toBe('SUNSET_TEMPLATE_MASTER_V9');
  });

  it('fails closed when the source cannot support a safe 9:16 crop', () => {
    const profile = buildSunsetStoryImageProfile(observation({ crop9x16Fitness: 20 }));
    const selection = selectSunsetStoryTemplate({ profile, intent: 'EXPERIENCE' });
    expect(selection.mode).toBe('NO_SAFE_TEMPLATE');
    expect(selection.selectedTemplateId).toBeNull();
    expect(selection.candidates.every((candidate) => candidate.hardRejected)).toBe(true);
  });

  it('fails closed when a protected photo feature collides with every layout', () => {
    const profile = buildSunsetStoryImageProfile(
      observation({
        sceneHints: ['SEA_VIEW'],
        horizonY: 0.48,
        protectedFeatures: [
          {
            kind: 'SUN_REFLECTION',
            box: { x: 0, y: 0, width: 1, height: 1 },
            salience: 1,
          },
        ],
      }),
    );
    const selection = selectSunsetStoryTemplate({ profile, intent: 'SCENERY' });
    expect(selection.mode).toBe('NO_SAFE_TEMPLATE');
    expect(
      selection.candidates.some((candidate) =>
        candidate.rejectionReasons.includes('PROTECTED_FEATURE_OVERLAP'),
      ),
    ).toBe(true);
  });

  it('applies anti-repeat as a penalty without making it a hard rejection', () => {
    const profile = buildSunsetStoryImageProfile(personRightObservation());
    const withoutHistory = rankSunsetStoryTemplates({ profile, intent: 'LIFESTYLE' });
    const withHistory = rankSunsetStoryTemplates({
      profile,
      intent: 'LIFESTYLE',
      history: [
        {
          templateId: 'SUNSET_TEMPLATE_MASTER_V5',
          selectedAt: '2026-08-27T00:00:00-03:00',
          approved: true,
        },
      ],
    });
    const baselineV5 = withoutHistory.find(
      (candidate) => candidate.templateId === 'SUNSET_TEMPLATE_MASTER_V5',
    );
    const penalizedV5 = withHistory.find(
      (candidate) => candidate.templateId === 'SUNSET_TEMPLATE_MASTER_V5',
    );
    expect(baselineV5).toBeDefined();
    expect(penalizedV5).toBeDefined();
    expect(penalizedV5?.hardRejected).toBe(false);
    expect(penalizedV5?.score).toBeLessThan(baselineV5?.score ?? 0);
  });

  it('requires review when two strong candidates have a narrow winning margin', () => {
    const selection = decideSunsetStoryTemplate([
      fakeCandidate('SUNSET_TEMPLATE_MASTER_V5', 90),
      fakeCandidate('SUNSET_TEMPLATE_MASTER_V8', 88),
    ]);
    expect(selection.mode).toBe('REVIEW_REQUIRED');
    expect(selection.winningMargin).toBe(2);
  });

  it('uses preview QA to reject a geometrically strong candidate before final selection', async () => {
    const imageAnalyzer: SunsetStoryImageAnalyzerPort = {
      analyze: () => Promise.resolve(drinkObservation()),
    };
    const previewEvaluator: SunsetStoryPreviewEvaluatorPort = {
      evaluate: ({ candidate }) =>
        Promise.resolve({
          templateId: candidate.templateId,
          qualityScore: 92,
          blockingReasons:
            candidate.templateId === 'SUNSET_TEMPLATE_MASTER_V4'
              ? ['PREVIEW_TEXT_COVERS_ESSENTIAL_SUBJECT']
              : [],
        }),
    };
    const service = new SunsetStoryTemplateSelectionService(imageAnalyzer, previewEvaluator);
    const result = await service.select({
      assetId: 'asset-drink-1',
      imageBytes: new Uint8Array([1, 2, 3]),
      intent: 'DRINKS',
    });
    const v4 = result.selection.candidates.find(
      (candidate) => candidate.templateId === 'SUNSET_TEMPLATE_MASTER_V4',
    );
    expect(result.previewEvaluations).toHaveLength(1);
    expect(v4?.hardRejected).toBe(true);
    expect(result.selection.selectedTemplateId).not.toBe('SUNSET_TEMPLATE_MASTER_V4');
  });

  it('returns identical ranking for identical inputs', () => {
    const request = {
      profile: buildSunsetStoryImageProfile(personRightObservation()),
      intent: 'LIFESTYLE' as const,
    };
    expect(rankSunsetStoryTemplates(request)).toEqual(rankSunsetStoryTemplates(request));
  });
});
