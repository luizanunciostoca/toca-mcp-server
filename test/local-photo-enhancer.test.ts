import { writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { LocalPhotoEnhancer } from '../src/providers/local/local-photo-enhancer.js';

describe('LocalPhotoEnhancer', () => {
  it('fails closed when source bytes are missing', async () => {
    const enhancer = new LocalPhotoEnhancer(() => Promise.resolve());

    await expect(
      enhancer.enhance({
        sourceAssetId: 'SUN-0087',
        sourceDriveFileId: 'drive-file',
        imageBytes: new Uint8Array(),
        contentType: 'image/jpeg',
      }),
    ).rejects.toMatchObject({
      code: 'SOURCE_IMAGE_BINDING_FAILURE',
    });
  });

  it('uses the deterministic enhancement command and returns binding evidence', async () => {
    const runner = vi.fn(async (_command: string, args: readonly string[]) => {
      const outputPath = args.at(-1);
      if (!outputPath) throw new Error('output path missing');
      await writeFile(outputPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    });
    const enhancer = new LocalPhotoEnhancer(runner, 'convert');
    const source = Buffer.from([0xff, 0xd8, 0x00, 0x01, 0xff, 0xd9]);

    const result = await enhancer.enhance({
      sourceAssetId: 'SUN-0087',
      sourceDriveFileId: 'drive-file',
      imageBytes: source,
      contentType: 'image/jpeg',
    });

    expect(runner).toHaveBeenCalledTimes(1);
    const [command, args] = runner.mock.calls[0] ?? [];
    expect(command).toBe('convert');
    expect(args).toEqual(
      expect.arrayContaining([
        '-auto-orient',
        '-colorspace',
        'sRGB',
        '-filter',
        'Lanczos',
        '-resize',
        '200%',
        '-unsharp',
        '0x0.8+0.8+0.02',
        '-quality',
        '95',
      ]),
    );
    expect(result).toMatchObject({
      sourceAssetId: 'SUN-0087',
      sourceDriveFileId: 'drive-file',
      sourceImageBound: true,
      editMode: 'ENHANCE_EXISTING_IMAGE',
      editorProvider: 'LOCAL_IMAGEMAGICK',
      pipelineVersion: 'local-photo-enhancer-v1',
      requestedScale: '200%',
      outputContentType: 'image/jpeg',
    });
    expect(result.sourceSha256).not.toBe(result.outputSha256);
  });

  it('classifies a missing ImageMagick binary as capability unavailable', async () => {
    const error = new Error('missing') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    const runner = () => Promise.reject(error);
    const enhancer = new LocalPhotoEnhancer(runner, 'missing-convert');

    await expect(
      enhancer.enhance({
        sourceAssetId: 'SUN-0087',
        sourceDriveFileId: 'drive-file',
        imageBytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
        contentType: 'image/jpeg',
      }),
    ).rejects.toMatchObject({
      code: 'CAPABILITY_UNAVAILABLE',
      retryable: false,
    });
  });
});
