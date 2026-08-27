import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Sunset Story runtime packaging', () => {
  it('packages the deterministic rasterizer and pinned font assets into the production image', async () => {
    const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
    const dockerignore = await readFile(new URL('../.dockerignore', import.meta.url), 'utf8');

    expect(dockerfile).toContain('apt-get install -y --no-install-recommends imagemagick');
    expect(dockerfile).toContain('COPY assets ./assets');
    expect(dockerignore.split(/\r?\n/u)).not.toContain('assets');
    expect(dockerignore.split(/\r?\n/u)).not.toContain('assets/fonts');
  });
});
