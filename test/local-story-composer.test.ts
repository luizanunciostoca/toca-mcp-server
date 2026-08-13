import { writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { LocalStoryComposer } from '../src/providers/local/local-story-composer.js';

describe('LocalStoryComposer', () => {
  it('fails closed when master bytes are missing', async () => {
    const composer = new LocalStoryComposer(() => Promise.resolve());

    await expect(
      composer.compose({
        storyCreativeId: 'SC-TEST-V1',
        contentItemId: 'MKT-TEST-STORY',
        masterAssetId: 'MM-SUN-0087-V1',
        masterDriveFileId: 'drive-master',
        imageBytes: new Uint8Array(),
        contentType: 'image/jpeg',
        templateId: 'PHOTO_ONLY',
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_IMAGE_BINDING_FAILURE' });
  });

  it('creates a deterministic 1080x1920 photo-only Story', async () => {
    const runner = vi.fn(async (_command: string, args: readonly string[]) => {
      const outputPath = args.at(-1);
      if (!outputPath) throw new Error('output path missing');
      await writeFile(outputPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    });
    const composer = new LocalStoryComposer(runner, 'convert');

    const result = await composer.compose({
      storyCreativeId: 'SC-TEST-V1',
      contentItemId: 'MKT-TEST-STORY',
      masterAssetId: 'MM-SUN-0087-V1',
      masterDriveFileId: 'drive-master',
      imageBytes: Buffer.from([0xff, 0xd8, 0x01, 0xff, 0xd9]),
      contentType: 'image/jpeg',
      templateId: 'PHOTO_ONLY',
    });

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
      editorProvider: 'LOCAL_IMAGEMAGICK',
      pipelineVersion: 'local-story-composer-v1',
      storyReady: true,
      outputContentType: 'image/jpeg',
    });
  });

  it('renders wrapped message, CTA and brand inside the Story safe area', async () => {
    const runner = vi.fn(async (_command: string, args: readonly string[]) => {
      const outputPath = args.at(-1);
      if (!outputPath) throw new Error('output path missing');
      await writeFile(outputPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    });
    const composer = new LocalStoryComposer(runner, 'convert');

    await composer.compose({
      storyCreativeId: 'SC-TEST-TEXT-V1',
      contentItemId: 'MKT-TEST-STORY-TEXT',
      masterAssetId: 'MM-SUN-0244-V1',
      masterDriveFileId: 'drive-master',
      imageBytes: Buffer.from([0xff, 0xd8, 0x02, 0xff, 0xd9]),
      contentType: 'image/jpeg',
      templateId: 'EDITORIAL_TEXT',
      message: 'A atmosfera da Toca começa antes do pôr do sol.',
      cta: 'Venha viver esse momento.',
    });

    const [, args] = runner.mock.calls[0] ?? [];
    expect(args).toEqual(
      expect.arrayContaining([
        '-draw',
        'rectangle 0,1250 1080,1920',
        '-size',
        '936x250',
        'caption:A atmosfera da Toca começa antes do pôr do sol.',
        '-geometry',
        '+72+250',
        '-composite',
        '936x90',
        'caption:Venha viver esse momento.',
        '+72+90',
        '-annotate',
        '+72+72',
        'TOCA DO MORCEGO',
      ]),
    );
  });

  it('rejects graphic templates without a message and overlong copy', async () => {
    const composer = new LocalStoryComposer(() => Promise.resolve());
    const base = {
      storyCreativeId: 'SC-TEST-V1',
      contentItemId: 'MKT-TEST-STORY',
      masterAssetId: 'MM-SUN-0087-V1',
      masterDriveFileId: 'drive-master',
      imageBytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      contentType: 'image/jpeg' as const,
    };

    await expect(composer.compose({ ...base, templateId: 'EDITORIAL_TEXT' })).rejects.toMatchObject(
      { code: 'QUALITY_GATE_FAILED' },
    );

    await expect(
      composer.compose({
        ...base,
        templateId: 'EDITORIAL_TEXT',
        message: 'x'.repeat(91),
      }),
    ).rejects.toMatchObject({ code: 'QUALITY_GATE_FAILED' });
  });
});
