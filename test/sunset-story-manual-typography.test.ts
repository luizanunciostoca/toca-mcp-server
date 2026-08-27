import { describe, expect, it } from 'vitest';
import { resolveSunsetStoryManualTypography } from '../src/creative/sunset-story-typography.js';

describe('Sunset Story manual-derived typography', () => {
  it('uses Didone for V1 editorial headline and utility sans for the remaining functional roles', () => {
    expect(resolveSunsetStoryManualTypography('SUNSET_TEMPLATE_MASTER_V1', 'ELEMENTS.HEADLINE')).toMatchObject({
      fontRole: 'EDITORIAL_DIDONE_HEADLINE',
      fontWeight: 400,
      sourceManualDocumentId: '1TIyMvn4w_WANPjD7jICSWjsUBtoU7nA6oTc3GjJJ8FY',
    });
    expect(resolveSunsetStoryManualTypography('SUNSET_TEMPLATE_MASTER_V1', 'ELEMENTS.SUPPORTSTRIPS.1')).toMatchObject({
      fontRole: 'GEOMETRIC_SANS_SUPPORT',
      fontWeight: 600,
    });
    expect(resolveSunsetStoryManualTypography('SUNSET_TEMPLATE_MASTER_V1', 'ELEMENTS.TIME')).toMatchObject({
      fontRole: 'CLEAN_SANS_TIME',
      fontWeight: 500,
    });
    expect(resolveSunsetStoryManualTypography('SUNSET_TEMPLATE_MASTER_V1', 'ELEMENTS.CTA')).toMatchObject({
      fontRole: 'CLEAN_SANS_CTA',
      fontWeight: 500,
    });
  });

  it('uses the heavy geometric display family for V2 and V3 headlines', () => {
    expect(resolveSunsetStoryManualTypography('SUNSET_TEMPLATE_MASTER_V2', 'ELEMENTS.HEADLINE.LINE1')).toMatchObject({
      fontRole: 'GEOMETRIC_SANS_DISPLAY_HEAVY',
      fontWeight: 900,
      letterSpacingEm: -0.03,
    });
    expect(resolveSunsetStoryManualTypography('SUNSET_TEMPLATE_MASTER_V3', 'ELEMENTS.HEADLINE')).toMatchObject({
      fontRole: 'GEOMETRIC_SANS_DISPLAY_HEAVY',
      fontWeight: 800,
      letterSpacingEm: -0.03,
    });
  });

  it('preserves the mixed support-strip weights documented for V6', () => {
    expect(resolveSunsetStoryManualTypography('SUNSET_TEMPLATE_MASTER_V6', 'ELEMENTS.SUPPORTSTRIPS.1').fontWeight).toBe(700);
    expect(resolveSunsetStoryManualTypography('SUNSET_TEMPLATE_MASTER_V6', 'ELEMENTS.SUPPORTSTRIPS.2').fontWeight).toBe(500);
    expect(resolveSunsetStoryManualTypography('SUNSET_TEMPLATE_MASTER_V6', 'ELEMENTS.SUPPORTSTRIPS.3').fontWeight).toBe(700);
    expect(resolveSunsetStoryManualTypography('SUNSET_TEMPLATE_MASTER_V6', 'ELEMENTS.SUPPORTSTRIPS.4').fontWeight).toBe(700);
  });

  it('uses the manual-defined Didone and clean sans roles in V9', () => {
    expect(resolveSunsetStoryManualTypography('SUNSET_TEMPLATE_MASTER_V9', 'ELEMENTS.HEADLINE.LINE2')).toMatchObject({
      fontRole: 'EDITORIAL_DIDONE_HEADLINE',
      fontWeight: 400,
    });
    expect(resolveSunsetStoryManualTypography('SUNSET_TEMPLATE_MASTER_V9', 'ELEMENTS.HASHTAG')).toMatchObject({
      fontRole: 'CLEAN_SANS_HASHTAG',
      fontWeight: 500,
    });
    expect(resolveSunsetStoryManualTypography('SUNSET_TEMPLATE_MASTER_V9', 'ELEMENTS.CTA')).toMatchObject({
      fontRole: 'CLEAN_SANS_CTA',
      fontWeight: 500,
    });
  });
});
