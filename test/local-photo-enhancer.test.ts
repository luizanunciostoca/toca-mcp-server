import { writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { LocalPhotoEnhancer } from '../src/providers/local/local-photo-enhancer.js';

function boundInput() {
  return {
    sourceAssetId: 'MM-SUN-0211-V1',
    sourceDriveFileId: 'drive-file-0211',
    imageBytes: Buffer.from([0xff, 0xd8, 0x01, 0xff, 0xd9]),
    contentType: 'image/jpeg' as const,
    creativeTruth: {
      policyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1' as const,
      creativeMode: 'REAL_PLUS_ENHANCEMENT' as const,
    },
  };
}

describe('LocalPhotoEnhancer', () => {
  it('binds the exact source bytes and returns Creative Truth enhancement provenance', async () => {
    const runner = vi.fn(async (_command: string, args: readonly string[]) => {
      const outputPath = args.at(-1);
      if (!outputPath) throw new Error('missing output path');
      await writeFile(outputPath, Buffer.from([0xff, 0xd8, 0x02, 0xff, 0xd9]));
    });
    const enhancer = new LocalPhotoEnhancer(runner);

    const result = await enhancer.enhance(boundInput());

    expect(result).toMatchObject({
      sourceAssetId: 'MM-SUN-0211-V1',
      sourceDriveFileId: 'drive-file-0211',
      sourceImageBound: true,
      editMode: 'ENHANCE_EXISTING_IMAGE',
      editorProvider: 'LOCAL_IMAGEMAGICK',
      pipelineVersion: 'local-photo-enhancer-v1',
      requestedScale: '200%',
      outputContentType: 'image/jpeg',
      creativeTruthBound: true,
      requiresVenueFidelityGate: true,
    });
    expect(result.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.outputSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.sourceSha256).not.toBe(result.outputSha256);
    expect(runner).toHaveBeenCalledTimes(1);
    const args = runner.mock.calls[0]?.[1] ?? [];
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
  });

  it('fails closed when Creative Truth binding is absent or invalid', async () => {
    const runner = vi.fn();
    const enhancer = new LocalPhotoEnhancer(runner);
    const invalid = {
      ...boundInput(),
      creativeTruth: {
        policyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
        creativeMode: 'REAL_COMPOSITE',
      },
    } as unknown as Parameters<LocalPhotoEnhancer['enhance']>[0];

    await expect(enhancer.enhance(invalid)).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect(runner).not.toHaveBeenCalled();
  });

  it('fails closed when source bytes are empty', async () => {
    const enhancer = new LocalPhotoEnhancer(() => Promise.resolve());

    await expect(
      enhancer.enhance({
        ...boundInput(),
        sourceAssetId: 'SUN-0211',
        sourceDriveFileId: 'drive-file-0211',
        imageBytes: new Uint8Array(),
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_IMAGE_BINDING_FAILURE' });
  });

  it('maps a missing ImageMagick binary to CAPABILITY_UNAVAILABLE', async () => {
    const enhancer = new LocalPhotoEnhancer(() => {
      const error = new Error('spawn convert ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      return Promise.reject(error);
    });

    await expect(enhancer.enhance(boundInput())).rejects.toMatchObject({
      code: 'CAPABILITY_UNAVAILABLE',
    });
  });
});
