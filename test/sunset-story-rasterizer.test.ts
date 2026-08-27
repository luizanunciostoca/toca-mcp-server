import { describe, expect, it } from 'vitest';
import { ImageMagickSunsetStoryRasterizer } from '../src/creative/sunset-story-rasterizer.js';

describe('ImageMagick Sunset Story rasterizer', () => {
  it('rejects an empty SVG before invoking the native renderer', async () => {
    const rasterizer = new ImageMagickSunsetStoryRasterizer();
    await expect(rasterizer.rasterize({ svgBytes: new Uint8Array() })).rejects.toThrow(
      'SUNSET_RASTERIZER_SVG_EMPTY',
    );
  });
});
