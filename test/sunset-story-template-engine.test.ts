import { describe, expect, it } from 'vitest';
import {
  evaluateSunsetStoryTemplateGate,
  expectedTextColor,
  getSunsetStoryTemplate,
  listSunsetStoryTemplates,
  type SunsetStoryTemplatePlan,
} from '../src/creative/sunset-story-template-engine.js';

const validPlan: SunsetStoryTemplatePlan = {
  templateId: 'SUNSET_REF_03_ORANGE_LOWER_THIRD',
  canvas: '1080x1920',
  sourceAssetId: 'SUN-0263',
  analysisId: 'ANALYSIS-SUN-0263-V1',
  analysisStatus: 'PASS',
  referenceReviewStatus: 'PENDING',
  safeRegions: [
    {
      regionId: 'headline',
      x: 80,
      y: 180,
      width: 920,
      height: 480,
      meanLuminance: 38,
      textColor: 'WHITE',
    },
    {
      regionId: 'cta',
      x: 760,
      y: 1040,
      width: 260,
      height: 100,
      meanLuminance: 35,
      textColor: 'WHITE',
    },
    {
      regionId: 'orange',
      x: 0,
      y: 1320,
      width: 1080,
      height: 360,
      meanLuminance: 90,
      textColor: 'WHITE',
    },
    {
      regionId: 'footer',
      x: 40,
      y: 1680,
      width: 1000,
      height: 150,
      meanLuminance: 25,
      textColor: 'WHITE',
    },
  ],
  protectedRegions: [
    { regionId: 'drink', x: 350, y: 700, width: 360, height: 560 },
    { regionId: 'hands', x: 220, y: 900, width: 520, height: 280 },
  ],
  elements: [
    {
      kind: 'HEADLINE',
      regionId: 'headline',
      text: 'Pôr do Sol na Toca',
      fontRole: 'HEADLINE_SERIF',
      textColor: 'WHITE',
      fontSizePx: 92,
    },
    {
      kind: 'CTA_OUTLINE',
      regionId: 'cta',
      text: 'Vem pra Toca',
      fontRole: 'CTA_SANS',
      textColor: 'WHITE',
      fontSizePx: 32,
    },
    { kind: 'ORANGE_LOWER_THIRD', regionId: 'orange' },
    { kind: 'FOUR_LOGO_FOOTER', regionId: 'footer' },
  ],
  footerMode: 'FOUR_LOGOS_WHITE',
  backgroundTreatment: 'ORANGE_LOWER_THIRD',
};

describe('SunsetStoryTemplateEngine', () => {
  it('exposes the eleven reference templates and resolves a descriptor explicitly', () => {
    expect(listSunsetStoryTemplates()).toHaveLength(11);
    expect(getSunsetStoryTemplate('SUNSET_REF_03_ORANGE_LOWER_THIRD').family).toBe(
      'ORANGE_LOWER_THIRD',
    );
  });

  it('passes a complete plan with local contrast and no protected-region overlap', () => {
    const gate = evaluateSunsetStoryTemplateGate(validPlan);
    expect(gate.status).toBe('PASSED');
    expect(gate.failureCodes).toEqual([]);
    expect(gate.evidence).toMatchObject({
      templateId: validPlan.templateId,
      templateFamily: 'ORANGE_LOWER_THIRD',
      referenceReviewStatus: 'PENDING',
    });
  });

  it('fails closed when a required element is missing', () => {
    const plan: SunsetStoryTemplatePlan = {
      ...validPlan,
      elements: validPlan.elements.filter((element) => element.kind !== 'CTA_OUTLINE'),
    };
    const gate = evaluateSunsetStoryTemplateGate(plan);
    expect(gate.status).toBe('FAILED');
    expect(gate.failureCodes).toContain('FAILED_TEMPLATE_REQUIRED_ELEMENT_MISSING');
  });

  it('fails closed when a text region overlaps a protected region', () => {
    const plan: SunsetStoryTemplatePlan = {
      ...validPlan,
      safeRegions: validPlan.safeRegions.map((region) =>
        region.regionId === 'headline' ? { ...region, x: 300, y: 800 } : region,
      ),
    };
    const gate = evaluateSunsetStoryTemplateGate(plan);
    expect(gate.status).toBe('FAILED');
    expect(gate.failureCodes).toContain('FAILED_TEMPLATE_ELEMENT_OVERLAP');
  });

  it('chooses black on light regions and white on dark regions', () => {
    expect(expectedTextColor(180)).toBe('BLACK');
    expect(expectedTextColor(40)).toBe('WHITE');
  });
});
