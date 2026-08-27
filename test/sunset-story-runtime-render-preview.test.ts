import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildSunsetStoryImageProfile } from '../src/creative/sunset-story-image-profile.js';
import { selectSunsetStoryTemplate } from '../src/creative/sunset-story-template-selector.js';
import type { SunsetStorySemanticAnalyzerPort } from '../src/creative/sunset-story-semantic-analysis.js';
import { FilesystemSunsetStoryOverlayResolver } from '../src/providers/local/filesystem-sunset-story-overlay-resolver.js';
import { LocalImagemagickSunsetStoryImageAnalyzer } from '../src/providers/local/local-imagemagick-sunset-image-analyzer.js';
import { LocalImagemagickSunsetStoryRenderer } from '../src/providers/local/local-imagemagick-sunset-story-renderer.js';
import { ExecutionError } from '../src/core/errors.js';

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function gridText(red = 180, green = 120, blue = 80): string {
  const lines = ['# ImageMagick pixel enumeration: 30,30,0,255,srgb'];
  for (let y = 0; y < 30; y += 1) {
    for (let x = 0; x < 30; x += 1) {
      lines.push(`${x},${y}: (${red},${green},${blue}) #000000 srgb(${red},${green},${blue})`);
    }
  }
  return lines.join('\n');
}

describe('Sunset runtime render and analysis foundation', () => {
  it('combines deterministic local image signals with semantic subject analysis', async () => {
    const semanticAnalyzer: SunsetStorySemanticAnalyzerPort = {
      analyzeSemantic: () =>
        Promise.resolve({
          subjects: [
            {
              kind: 'PERSON',
              box: { x: 0.66, y: 0.28, width: 0.22, height: 0.32 },
              salience: 0.96,
            },
          ],
          horizonY: 0.48,
          sceneHints: ['PEOPLE_GOLDEN_HOUR'],
        }),
    };
    const analyzer = new LocalImagemagickSunsetStoryImageAnalyzer(semanticAnalyzer, (command) =>
      Promise.resolve(command === 'identify' ? '1080,1920' : gridText()),
    );

    const observation = await analyzer.analyze({ assetId: 'asset-1', imageBytes: JPEG_BYTES });
    const profile = buildSunsetStoryImageProfile(observation);

    expect(observation.width).toBe(1080);
    expect(observation.height).toBe(1920);
    expect(observation.negativeSpaceZones).toHaveLength(9);
    expect(profile.primarySubjectZone).toBe('CENTER_RIGHT');
    expect(profile.sceneClass).toBe('PEOPLE_GOLDEN_HOUR');
    expect(profile.warmth).toBeGreaterThan(0.5);
    expect(profile.crop9x16Fitness).toBe(100);
  });

  it('fails closed while approved overlay assets are not pinned', async () => {
    const resolver = new FilesystemSunsetStoryOverlayResolver();
    await expect(resolver.resolve('SUNSET_TEMPLATE_MASTER_V1')).rejects.toMatchObject({
      code: 'CAPABILITY_UNAVAILABLE',
    } satisfies Partial<ExecutionError>);
  });

  it('renders a 1080x1920 preview only when the overlay hash is pinned and valid', async () => {
    const profile = buildSunsetStoryImageProfile({
      width: 1080,
      height: 1920,
      subjects: [],
      negativeSpaceZones: ['CENTER', 'CENTER_LEFT', 'CENTER_RIGHT'],
      regionLuma: { CENTER: 0.3, CENTER_LEFT: 0.3, CENTER_RIGHT: 0.3 },
      warmth: 0.6,
      crop9x16Fitness: 100,
      horizonY: 0.48,
      sceneHints: ['SEA_VIEW'],
    });
    const selection = selectSunsetStoryTemplate({ profile, intent: 'SCENERY' });
    const candidate = selection.candidates.find((item) => !item.hardRejected);
    expect(candidate).toBeDefined();
    if (!candidate) throw new Error('candidate required');

    const overlaySha256 = createHash('sha256').update(PNG_BYTES).digest('hex');
    const renderer = new LocalImagemagickSunsetStoryRenderer(async (command, args) => {
      if (command === 'identify') return '1080,1920';
      const destination = args.at(-1);
      if (!destination?.startsWith('PNG32:')) throw new Error('preview destination missing');
      await writeFile(destination.slice('PNG32:'.length), PNG_BYTES);
      return '';
    });

    const result = await renderer.renderPreview({
      imageBytes: JPEG_BYTES,
      profile,
      candidate,
      overlay: {
        templateId: candidate.templateId,
        overlayBytes: PNG_BYTES,
        sha256: overlaySha256,
        width: 1080,
        height: 1920,
        source: 'PINNED_APPROVED_OVERLAY',
      },
    });

    expect(result.templateId).toBe(candidate.templateId);
    expect(result.outputContentType).toBe('image/png');
    expect(result.width).toBe(1080);
    expect(result.height).toBe(1920);
    expect(result.publicationEligible).toBe(false);
    expect(result.outputSha256).toBe(overlaySha256);
  });
});
