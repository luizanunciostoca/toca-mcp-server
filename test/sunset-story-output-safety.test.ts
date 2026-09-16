import { describe, expect, it } from 'vitest';
import {
  buildCanonicalSunsetStoryRenderPlan,
  validateSunsetStoryAiRenderPlan,
} from '../src/creative/sunset-story-render-plan.js';
import type { SunsetStoryImageProfile } from '../src/creative/sunset-story-image-profile.js';
import type { SunsetStoryCropPlan } from '../src/creative/sunset-story-crop-planner.js';
import { loadSunsetStoryTemplateContract } from '../src/creative/sunset-story-template-contract.js';

const fullCrop: SunsetStoryCropPlan = {
  cropWindow: { x: 0, y: 0, width: 1, height: 1 },
  transformedPrimarySubject: null,
  subjectCoverage: 1,
  protectedOverlap: 0,
  protectedFeatureOverlap: 0,
  minimumProtectedFeatureCoverage: 1,
  placementScore: 1,
  planScore: 100,
};

function baseProfile(): SunsetStoryImageProfile {
  return {
    width: 1080,
    height: 1920,
    sourceAspectRatio: 9 / 16,
    subjects: [],
    protectedFeatures: [],
    primarySubject: null,
    primarySubjectZone: null,
    negativeSpaceZones: ['CENTER'],
    regionLuma: { CENTER: 0.4 },
    warmth: 0.7,
    crop9x16Fitness: 100,
    horizonY: null,
    sceneClass: 'LIFESTYLE',
    brightness: 'MEDIUM',
  };
}

describe('Sunset Story exact output safety', () => {
  it('accepts a canonical V5 render when the protected-feature audit is clean', async () => {
    const contract = await loadSunsetStoryTemplateContract('SUNSET_TEMPLATE_MASTER_V5');
    const profile = baseProfile();
    const plan = buildCanonicalSunsetStoryRenderPlan(contract, profile, fullCrop);
    expect(validateSunsetStoryAiRenderPlan(plan, contract, profile, fullCrop)).toEqual(plan);
  });

  it('rejects a canonical-looking render when copy covers a protected face', async () => {
    const contract = await loadSunsetStoryTemplateContract('SUNSET_TEMPLATE_MASTER_V5');
    const profile: SunsetStoryImageProfile = {
      ...baseProfile(),
      protectedFeatures: [
        {
          kind: 'FACE',
          box: { x: 0.08, y: 0.17, width: 0.38, height: 0.08 },
          salience: 1,
        },
      ],
    };
    const plan = buildCanonicalSunsetStoryRenderPlan(contract, profile, fullCrop);
    expect(() => validateSunsetStoryAiRenderPlan(plan, contract, profile, fullCrop)).toThrow(
      /SUNSET_RENDER_PROTECTED_FEATURE_OVERLAP:FACE/,
    );
  });
});
