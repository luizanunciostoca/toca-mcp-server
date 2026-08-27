import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ImageMagickSunsetStoryRasterizer } from '../src/creative/sunset-story-rasterizer.js';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+4k1Z1QAAAABJRU5ErkJggg==';

describe('ImageMagick Sunset Story rasterizer', () => {
  it('rejects an empty SVG before invoking the native renderer', async () => {
    const rasterizer = new ImageMagickSunsetStoryRasterizer();
    await expect(rasterizer.rasterize({ svgBytes: new Uint8Array() })).rejects.toThrow(
      'SUNSET_RASTERIZER_SVG_EMPTY',
    );
  });

  it('hands ImageMagick a real temporary SVG file and removes it after conversion', async () => {
    const fixtureDirectory = await mkdtemp(join(tmpdir(), 'toca-sunset-raster-test-'));
    const converterPath = join(fixtureDirectory, 'fake-convert.mjs');
    const observedPathFile = join(fixtureDirectory, 'observed-svg-path.txt');
    const converterSource = `#!/usr/bin/env node\nimport { existsSync, readFileSync, writeFileSync } from 'node:fs';\nconst svgPath = process.argv[2];\nif (!svgPath || !existsSync(svgPath)) process.exit(41);\nconst svg = readFileSync(svgPath, 'utf8');\nif (!svg.includes('<svg')) process.exit(42);\nwriteFileSync(${JSON.stringify(observedPathFile)}, svgPath, 'utf8');\nprocess.stdout.write(Buffer.from(${JSON.stringify(PNG_BASE64)}, 'base64'));\n`;

    try {
      await writeFile(converterPath, converterSource, { mode: 0o700 });
      await chmod(converterPath, 0o700);
      const rasterizer = new ImageMagickSunsetStoryRasterizer({ command: converterPath });
      const result = await rasterizer.rasterize({
        svgBytes: new TextEncoder().encode(
          '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"></svg>',
        ),
      });

      expect(result.mimeType).toBe('image/png');
      const observedSvgPath = await readFile(observedPathFile, 'utf8');
      await expect(stat(observedSvgPath)).rejects.toThrow();
    } finally {
      await rm(fixtureDirectory, { recursive: true, force: true });
    }
  });
});
