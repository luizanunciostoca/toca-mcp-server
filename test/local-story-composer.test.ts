import { writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { LocalStoryComposer } from '../src/providers/local/local-story-composer.js';

const passQa = {
  rightsStatus: 'PASS' as const,
  brandIntegrityStatus: 'PASS' as const,
  venueFidelityStatus: 'PASS' as const,
  copyQaStatus: 'PASS' as const,
  informationQaStatus: 'PASS' as const,
};

function base(overrides: Record<string, unknown> = {}) {
  return {
    storyCreativeId: 'SC-TEST-V1',
    contentItemId: 'MKT-TEST-STORY',
    outputAssetId: 'SC-TEST-V1',
    masterAssetId: 'MM-SUN-0087-V1',
    masterDriveFileId: 'drive-master',
    sourceRole: 'ORIGINAL_MASTER' as const,
    sourceWidth: 2160,
    sourceHeight: 3840,
    imageBytes: Buffer.from([0xff, 0xd8, 0x01, 0xff, 0xd9]),
    contentType: 'image/jpeg' as const,
    templateId: 'PHOTO_ONLY' as const,
    publicationIntent: 'FINAL' as const,
    qa: passQa,
    ...overrides,
  };
}

function renderer() {
  return vi.fn(async (_command: string, args: readonly string[]) => {
    const outputPath = args.at(-1);
    if (!outputPath) throw new Error('output path missing');
    await writeFile(outputPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  });
}

describe('LocalStoryComposer', () => {
  it('fails closed when master bytes are missing', async () => {
    const composer = new LocalStoryComposer(() => Promise.resolve());
    await expect(composer.compose(base({ imageBytes: new Uint8Array() }))).rejects.toMatchObject({
      code: 'SOURCE_IMAGE_BINDING_FAILURE',
    });
  });

  it('creates a deterministic final photo-only Story with quality evidence', async () => {
    const runner = renderer();
    const composer = new LocalStoryComposer(runner, 'convert');
    const result = await composer.compose(base());

    const [, args] = runner.mock.calls[0] ?? [];
    expect(args).toEqual(
      expect.arrayContaining(['-resize', '1080x1920^', '-extent', '1080x1920', '-quality', '95']),
    );
    expect(args).not.toContain('-annotate');
    expect(result).toMatchObject({
      dimensions: '1080x1920',
      aspectRatio: '9:16',
      templateId: 'PHOTO_ONLY',
      sourceImageBound: true,
      exactSourceMasterBinding: true,
      editorProvider: 'LOCAL_IMAGEMAGICK',
      pipelineVersion: 'local-story-composer-v2',
      storyReady: true,
      publicationEligible: true,
      outputContentType: 'image/jpeg',
      qualityEvidence: { overallStatus: 'PASS', safeAreaStatus: 'PASS' },
    });
  });

  it('uses a soft gradient and keeps brand, message and CTA inside the Story safe area', async () => {
    const runner = renderer();
    const composer = new LocalStoryComposer(runner, 'convert');

    const result = await composer.compose(
      base({
        storyCreativeId: 'SC-TEST-TEXT-V1',
        outputAssetId: 'SC-TEST-TEXT-V1',
        templateId: 'EDITORIAL_TEXT',
        typography: {
          headlineFont: '/runtime/fonts/canonical-headline.otf',
          bodyFont: '/runtime/fonts/canonical-body.otf',
          canonicalPinned: true,
        },
        message: 'A atmosfera da Toca começa antes do pôr do sol.',
        cta: 'Venha viver esse momento.',
      }),
    );

    const [, args] = runner.mock.calls[0] ?? [];
    expect(args).toEqual(
      expect.arrayContaining([
        'gradient:rgba(13,13,13,0)-rgba(13,13,13,0.78)',
        '936x250',
        'caption:A atmosfera da Toca começa antes do pôr do sol.',
        '+72+1160',
        '936x90',
        'caption:Venha viver esse momento.',
        '+72+1490',
        '-annotate',
        '+72+280',
        'TOCA DO MORCEGO',
      ]),
    );
    expect(args).not.toContain('rectangle 0,1250 1080,1920');
    expect(result.qualityEvidence.safeAreaStatus).toBe('PASS');
    expect(result.qualityEvidence.visualArtifactStatus).toBe('PASS');
  });

  it('allows an unpinned-font review draft but never marks it publication-ready', async () => {
    const runner = renderer();
    const composer = new LocalStoryComposer(runner, 'convert');
    const result = await composer.compose(
      base({
        templateId: 'EDITORIAL_TEXT',
        publicationIntent: 'REVIEW',
        message: 'Draft para revisão.',
        typography: {
          headlineFont: 'DejaVu-Sans',
          bodyFont: 'DejaVu-Sans',
          canonicalPinned: false,
        },
      }),
    );

    expect(result.storyReady).toBe(false);
    expect(result.publicationEligible).toBe(false);
    expect(result.qualityEvidence.typographyStatus).toBe('FAIL');
    expect(result.qualityEvidence.overallStatus).toBe('FAIL');
  });

  it('rejects a final Story when a reference template is used instead of an original master', async () => {
    const composer = new LocalStoryComposer(renderer(), 'convert');
    await expect(
      composer.compose(base({ sourceRole: 'REFERENCE_TEMPLATE' })),
    ).rejects.toThrow('LOCAL_STORY_COMPOSER_FINAL_NOT_READY');
  });

  it('rejects low-resolution final source imagery before it can be declared ready', async () => {
    const composer = new LocalStoryComposer(renderer(), 'convert');
    await expect(
      composer.compose(base({ sourceWidth: 530, sourceHeight: 270 })),
    ).rejects.toThrow('STATIC_CREATIVE_SOURCE_RESOLUTION_TOO_LOW');
  });

  it('rejects final graphic templates without canonical typography', async () => {
    const composer = new LocalStoryComposer(() => Promise.resolve());
    await expect(
      composer.compose(
        base({
          templateId: 'EDITORIAL_TEXT',
          message: 'Headline',
          typography: {
            headlineFont: 'DejaVu-Sans',
            bodyFont: 'DejaVu-Sans',
            canonicalPinned: false,
          },
        }),
      ),
    ).rejects.toThrow('LOCAL_STORY_COMPOSER_CANONICAL_TYPOGRAPHY_REQUIRED');
  });

  it('rejects graphic templates without a message and overlong copy', async () => {
    const composer = new LocalStoryComposer(() => Promise.resolve());
    await expect(
      composer.compose(base({ templateId: 'EDITORIAL_TEXT' })),
    ).rejects.toMatchObject({ code: 'QUALITY_GATE_FAILED' });

    await expect(
      composer.compose(
        base({
          templateId: 'EDITORIAL_TEXT',
          message: 'x'.repeat(91),
          publicationIntent: 'REVIEW',
        }),
      ),
    ).rejects.toMatchObject({ code: 'QUALITY_GATE_FAILED' });
  });
});
