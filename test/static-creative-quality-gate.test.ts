import { describe, expect, it } from 'vitest';
import {
  assertStaticCreativePublicationReady,
  evaluateStaticCreativeQuality,
} from '../src/creative/static-creative-quality-gate.js';

const sha = 'a'.repeat(64);

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    evidenceId: 'STATIC-QA-1',
    assetId: 'SC-1',
    outputSha256: sha,
    format: 'STORY_9_16' as const,
    sourceRole: 'ORIGINAL_MASTER' as const,
    sourceMasterSha256: 'b'.repeat(64),
    sourceWidth: 2160,
    sourceHeight: 3840,
    outputWidth: 1080,
    outputHeight: 1920,
    layoutElements: [
      { id: 'brand', role: 'BRAND' as const, x: 72, y: 280, width: 420, height: 54 },
      { id: 'headline', role: 'HEADLINE' as const, x: 72, y: 1160, width: 936, height: 250 },
      { id: 'cta', role: 'CTA' as const, x: 72, y: 1490, width: 936, height: 90 },
    ],
    overlayStyle: 'SOFT_GRADIENT' as const,
    typographyCanonicalPinned: true,
    typographyRequired: true,
    rightsStatus: 'PASS' as const,
    brandIntegrityStatus: 'PASS' as const,
    venueFidelityStatus: 'PASS' as const,
    copyQaStatus: 'PASS' as const,
    informationQaStatus: 'PASS' as const,
    ...overrides,
  };
}

describe('static creative quality gate', () => {
  it('passes a canonical Story master with safe layout and complete QA', () => {
    const evidence = evaluateStaticCreativeQuality(candidate());
    expect(evidence.overallStatus).toBe('PASS');
    expect(evidence.format).toBe('STORY_9_16');
    expect(evidence.safeAreaStatus).toBe('PASS');
    expect(evidence.exactSourceMasterBinding).toBe(true);
    expect(() =>
      assertStaticCreativePublicationReady(evidence, { assetId: 'SC-1', outputSha256: sha }),
    ).not.toThrow();
  });

  it('passes a canonical 4:5 Feed using the Feed safe-area profile', () => {
    const evidence = evaluateStaticCreativeQuality(
      candidate({
        format: 'FEED_4_5',
        sourceWidth: 2160,
        sourceHeight: 2700,
        outputHeight: 1350,
        layoutElements: [
          { id: 'brand', role: 'BRAND', x: 64, y: 90, width: 300, height: 70 },
          { id: 'headline', role: 'HEADLINE', x: 64, y: 270, width: 700, height: 180 },
          { id: 'cta', role: 'CTA', x: 64, y: 1110, width: 700, height: 90 },
        ],
      }),
    );
    expect(evidence.overallStatus).toBe('PASS');
    expect(evidence.format).toBe('FEED_4_5');
    expect(evidence.safeAreaStatus).toBe('PASS');
  });

  it('fails when a template raster is used as the final source', () => {
    const evidence = evaluateStaticCreativeQuality(
      candidate({ sourceRole: 'REFERENCE_TEMPLATE', sourceMasterSha256: undefined }),
    );
    expect(evidence.overallStatus).toBe('FAIL');
    expect(evidence.failureCodes).toContain('STATIC_CREATIVE_SOURCE_MASTER_REQUIRED');
  });

  it('fails when critical elements enter the Instagram Story safe area', () => {
    const evidence = evaluateStaticCreativeQuality(
      candidate({
        layoutElements: [
          { id: 'brand', role: 'BRAND', x: 72, y: 120, width: 420, height: 54 },
          { id: 'cta', role: 'CTA', x: 72, y: 1660, width: 936, height: 90 },
        ],
      }),
    );
    expect(evidence.safeAreaStatus).toBe('FAIL');
    expect(evidence.failureCodes).toContain('STATIC_CREATIVE_SAFE_AREA_VIOLATION');
  });

  it('fails a format/dimension mismatch instead of guessing a profile', () => {
    const evidence = evaluateStaticCreativeQuality(
      candidate({ format: 'FEED_4_5', outputWidth: 1080, outputHeight: 1920 }),
    );
    expect(evidence.safeAreaStatus).toBe('FAIL');
  });

  it('fails low-resolution upscales and unpinned typography', () => {
    const evidence = evaluateStaticCreativeQuality(
      candidate({
        sourceWidth: 530,
        sourceHeight: 270,
        typographyCanonicalPinned: false,
      }),
    );
    expect(evidence.sourceResolutionStatus).toBe('FAIL');
    expect(evidence.typographyStatus).toBe('FAIL');
    expect(evidence.failureCodes).toEqual(
      expect.arrayContaining([
        'STATIC_CREATIVE_SOURCE_RESOLUTION_TOO_LOW',
        'STATIC_CREATIVE_CANONICAL_FONT_PIN_REQUIRED',
      ]),
    );
  });

  it('rejects full-width hard panels that create visible render bands', () => {
    const evidence = evaluateStaticCreativeQuality(
      candidate({ overlayStyle: 'HARD_FULL_WIDTH_PANEL' }),
    );
    expect(evidence.visualArtifactStatus).toBe('FAIL');
    expect(evidence.failureCodes).toContain('STATIC_CREATIVE_HARD_PANEL_FORBIDDEN');
  });

  it('binds publication eligibility to the exact final output hash', () => {
    const evidence = evaluateStaticCreativeQuality(candidate());
    expect(() =>
      assertStaticCreativePublicationReady(evidence, {
        assetId: 'SC-1',
        outputSha256: 'c'.repeat(64),
      }),
    ).toThrow('STATIC_CREATIVE_QUALITY_OUTPUT_SHA256_MISMATCH');
  });
});
