import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { LocalPhotoMotionVideoComposer } from '../src/providers/local/local-photo-motion-video-composer.js';

const sourceBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');

describe('LocalPhotoMotionVideoComposer', () => {
  it('creates motion without semantic generation or scene expansion', async () => {
    const runner = vi.fn(async (_command: string, args: readonly string[]) => {
      const output = args.at(-1);
      if (!output) throw new Error('missing output');
      await writeFile(output, Uint8Array.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]));
    });
    const composer = new LocalPhotoMotionVideoComposer(runner);
    const result = await composer.compose({
      sourceBytes,
      sourceContentType: 'image/jpeg',
      sourceSha256,
      seconds: 8,
      size: '720x1280',
      motionPreset: 'SLOW_PUSH_IN',
    });
    expect(result.provider).toBe('LOCAL_FFMPEG');
    expect(result.semanticGenerationUsed).toBe(false);
    expect(result.sceneExpansionAllowed).toBe(false);
    expect(runner.mock.calls[0]?.[1].join(' ')).toContain('zoompan=');
  });

  it('fails before ffmpeg when source bytes no longer match the canonical hash', async () => {
    const runner = vi.fn();
    const composer = new LocalPhotoMotionVideoComposer(runner);
    await expect(
      composer.compose({
        sourceBytes,
        sourceContentType: 'image/jpeg',
        sourceSha256: 'a'.repeat(64),
        seconds: 4,
        size: '720x1280',
        motionPreset: 'SLOW_PUSH_IN',
      }),
    ).rejects.toThrow('PHOTO_MOTION_SOURCE_HASH_MISMATCH');
    expect(runner).not.toHaveBeenCalled();
  });
});
