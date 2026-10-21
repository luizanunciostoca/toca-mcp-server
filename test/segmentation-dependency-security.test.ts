import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
const documentation = readFileSync(
  new URL('../docs/operations/artist-safe-segmentation.md', import.meta.url),
  'utf8',
);
const provider = readFileSync(
  new URL('../src/providers/segmentation/local-rembg-segmentation-provider.ts', import.meta.url),
  'utf8',
);

// These contract checks prevent removal of the real Python checks executed at
// image build time. They do not pretend that Node tests run model inference.
describe('segmentation dependency security', () => {
  it('resolves the Pillow-compatible CPU-only rembg and patched Pillow together', () => {
    const installs = dockerfile.split('\n').filter((line) => line.includes('pip install'));
    expect(installs).toHaveLength(1);
    expect(installs[0]).toContain('"rembg[cpu]==2.0.86" "pillow==13.0.0"');
    expect(installs[0]).not.toMatch(/--no-deps|--ignore-installed|rembg\[.*cli/);
    expect(documentation).toContain('`rembg[cpu]==2.0.86`');
    expect(documentation).toContain('`pillow==13.0.0`');
  });

  it('fails the image build on dependency, API or image-codec incompatibility', () => {
    expect(dockerfile).toContain('&& python3 -m pip check');
    const smoke = dockerfile.split('\n').find((line) => line.includes('&& python3 -c'));
    expect(smoke).toBeDefined();
    expect(smoke).toContain('from rembg import new_session, remove');
    expect(smoke).toContain("version('rembg') == '2.0.86'");
    expect(smoke).toContain("version('pillow') == '13.0.0'");
    expect(smoke).toContain("{'session', 'alpha_matting'} <= set(signature(remove).parameters)");
    expect(smoke).toContain("('PNG', 'JPEG', 'WEBP')");
    expect(smoke).toContain('Image.open(buf).load()');
    expect(smoke).toContain("Image.open(buffers['PNG']).tobytes() == image.tobytes()");
    expect(smoke).not.toMatch(/\|\|\s*true/);
  });

  it('does not download or execute a model in the build smoke', () => {
    const smoke = dockerfile.split('\n').find((line) => line.includes('&& python3 -c'));
    expect(smoke).toContain("Image.new('RGB', (2, 2), (17, 83, 149))");
    expect(smoke).toContain("cls.name() == 'u2net_human_seg'");
    expect(smoke).not.toMatch(/\b(?:new_session|remove)\s*\(/);
    expect(smoke).not.toMatch(/https?:\/\/|requests\.|urlopen|download_models/);
  });

  it('preserves the existing local human model and alpha-matting invocation', () => {
    expect(dockerfile).toContain('ENV REMBG_ARTIST_MODEL=u2net_human_seg');
    expect(dockerfile).toContain('ENV U2NET_HOME=/tmp/rembg-models');
    expect(provider).toContain('session = new_session(model_name)');
    expect(provider).toContain('remove(source, session=session, alpha_matting=True)');
    expect(documentation).toContain('ImageMagick `CopyOpacity`');
    expect(documentation).toContain('original-pixel/alpha-only composition invariant');
  });
});
