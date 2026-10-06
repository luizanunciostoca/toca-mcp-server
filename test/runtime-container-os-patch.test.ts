import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dockerfile = readFileSync('Dockerfile', 'utf8');

describe('runtime container OS patch contract', () => {
  it('patches fixable base-image packages before installing runtime dependencies', () => {
    const runtimeStage = dockerfile.indexOf(' AS runtime');
    const update = dockerfile.indexOf('apt-get update', runtimeStage);
    const upgrade = dockerfile.indexOf('apt-get upgrade -y --no-install-recommends', update);
    const install = dockerfile.indexOf('apt-get install -y --no-install-recommends', upgrade);

    expect(runtimeStage).toBeGreaterThanOrEqual(0);
    expect(update).toBeGreaterThan(runtimeStage);
    expect(upgrade).toBeGreaterThan(update);
    expect(install).toBeGreaterThan(upgrade);
  });

  it('keeps package metadata and mutable tool caches out of the final image', () => {
    expect(dockerfile).toContain('rm -rf /var/lib/apt/lists/* /var/cache/apt/*');
    expect(dockerfile).toContain('/root/.cache/pip');
    expect(dockerfile).toContain('/usr/local/lib/node_modules/npm');
  });
});
