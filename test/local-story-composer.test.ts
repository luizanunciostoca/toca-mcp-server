import { writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { LocalStoryComposer } from '../src/providers/local/local-story-composer.js';

describe('LocalStoryComposer', () => {
  it('fails closed without lineage or source bytes', async () => {
    const composer = new LocalStoryComposer(() => Promise.resolve('1080x1920'));
    await expect(
      composer.compose({
        contentItemId: '',
        storyCreativeId: 'SC-1',
        masterAssetId: 'MM-1',
        masterDriveFileId: 'drive-1',
        imageBytes: new Uint8Array(),
        contentType: 'image/jpeg',
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_IMAGE_BINDING_FAILURE' });
  });

  it('renders a deterministic 1080x1920 JPEG with lineage evidence', async () => {
    const runner = vi.fn(async (command: string, args: readonly string[]) => {
      if (command === 'identify') return '1080x1920';
      const outputPath = args.at(-1);
      if (!outputPath) throw new Error('output path missing');
      await writeFile(outputPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      return '';
    });
    const composer = new LocalStoryComposer(runner, 'convert', 'identify');
    const result = await composer.compose({
      contentItemId: 'MKT-20260813-SUNSET-STORY-1600',
      storyCreativeId: 'SC-MKT-20260813-SUNSET-STORY-1600-V1',
      masterAssetId: 'MM-SUN-0244-V1',
      masterDriveFileId: 'master-drive',
      imageBytes: Buffer.from([0xff, 0xd8, 0x01, 0xff, 0xd9]),
      contentType: 'image/jpeg',
      headline: 'Celebre a vida',
      body: 'O Sunset já começou.',
      cta: 'Viva esse momento.',
    });

    expect(runner).toHaveBeenCalledTimes(2);
    const convertCall = runner.mock.calls[0];
    expect(convertCall?.[0]).toBe('convert');
    expect(convertCall?.[1]).toEqual(
      expect.arrayContaining(['-resize', '1080x1920^', '-extent', '1080x1920', '-quality', '95']),
    );
    expect(result).toMatchObject({
      contentItemId: 'MKT-20260813-SUNSET-STORY-1600',
      storyCreativeId: 'SC-MKT-20260813-SUNSET-STORY-1600-V1',
      masterAssetId: 'MM-SUN-0244-V1',
      sourceImageBound: true,
      renderMode: 'COMPOSE_STORY_FROM_MASTER',
      editorProvider: 'LOCAL_IMAGEMAGICK',
      pipelineVersion: 'local-story-composer-v1',
      dimensions: '1080x1920',
      outputContentType: 'image/jpeg',
    });
    expect(result.sourceSha256).not.toBe(result.outputSha256);
  });

  it('fails when the rendered dimensions drift', async () => {
    const runner = vi.fn(async (command: string, args: readonly string[]) => {
      if (command === 'identify') return '1080x1919';
      const outputPath = args.at(-1);
      if (!outputPath) throw new Error('output path missing');
      await writeFile(outputPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      return '';
    });
    const composer = new LocalStoryComposer(runner, 'convert', 'identify');
    await expect(
      composer.compose({
        contentItemId: 'item',
        storyCreativeId: 'story',
        masterAssetId: 'master',
        masterDriveFileId: 'drive',
        imageBytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
        contentType: 'image/jpeg',
      }),
    ).rejects.toMatchObject({ code: 'OUTPUT_TECH_SPEC_MISMATCH' });
  });
});
