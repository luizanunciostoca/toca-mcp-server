import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { LocalStoryComposer } from '../src/providers/local/local-story-composer.js';
import type { SunsetStoryTemplatePlan } from '../src/creative/sunset-story-template-engine.js';

const plan: SunsetStoryTemplatePlan = {
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
  protectedRegions: [{ regionId: 'drink', x: 350, y: 700, width: 360, height: 560 }],
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

function brand(brandName: string): { brand: string; bytes: Uint8Array; contentType: 'image/png' } {
  return { brand: brandName, bytes: Uint8Array.from([137, 80, 78, 71]), contentType: 'image/png' };
}

describe('LocalStoryComposer pure template integration', () => {
  it('requires a resolved template plan for Sunset reference templates', async () => {
    const composer = new LocalStoryComposer(() => Promise.resolve());
    await expect(
      composer.compose({
        storyCreativeId: 'SC-PURE-FAIL',
        contentItemId: 'MKT-PURE-FAIL',
        masterAssetId: 'MM-SUN-0263-V1',
        masterDriveFileId: 'drive-master',
        imageBytes: Buffer.from([1, 2, 3]),
        contentType: 'image/png',
        templateId: 'SUNSET_REF_03_ORANGE_LOWER_THIRD',
      }),
    ).rejects.toMatchObject({
      code: 'QUALITY_GATE_FAILED',
      message: 'FAILED_TEMPLATE_NOT_RESOLVED',
    });
  });

  it('renders a pure-template plan and exposes the TEMPLATE gate', async () => {
    const runner = vi.fn(async (_command: string, args: readonly string[]) => {
      const outputPath = args.at(-1);
      if (!outputPath) throw new Error('missing output path');
      await writeFile(outputPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    });
    const composer = new LocalStoryComposer(runner, 'convert');
    const result = await composer.compose({
      storyCreativeId: 'SC-PURE-001',
      contentItemId: 'MKT-PURE-001',
      masterAssetId: 'MM-SUN-0263-V1',
      masterDriveFileId: 'drive-master',
      imageBytes: Buffer.from([0xff, 0xd8, 0x02, 0xff, 0xd9]),
      contentType: 'image/png',
      templateId: plan.templateId,
      templatePlan: plan,
      brandAssets: [
        brand('TOCA_DO_MORCEGO'),
        brand('CORONA'),
        brand('RED_BULL'),
        brand('MORRO_DIGITAL'),
      ],
    });

    expect(result.pipelineVersion).toBe('local-story-composer-v2-pure-template');
    expect(result.templateGate?.status).toBe('PASSED');
    expect(result.templateGate?.gate).toBe('TEMPLATE');
    expect(result.templateGate?.evidence).toMatchObject({
      templateId: plan.templateId,
      templateFamily: 'ORANGE_LOWER_THIRD',
      referenceReviewStatus: 'PENDING',
    });
    const [, args = []] = runner.mock.calls[0] ?? [];
    expect(args).toContain(resolve(process.cwd(), 'assets/fonts/BodoniModa-Variable.ttf'));
    expect(args).toContain(resolve(process.cwd(), 'assets/fonts/Montserrat-Variable.ttf'));
    expect(args.join(' ')).not.toContain('DejaVu-Serif');
  });
});
