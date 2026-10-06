import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dockerfiles = ['Dockerfile', 'Dockerfile.orchestrator'] as const;

describe('runtime container OS patch contract', () => {
  it.each(dockerfiles)(
    '%s patches fixable base-image packages before installing runtime dependencies',
    (path) => {
      const dockerfile = readFileSync(path, 'utf8');
      const runtimeStage = dockerfile.indexOf(' AS runtime');
      const update = dockerfile.indexOf('apt-get update', runtimeStage);
      const upgrade = dockerfile.indexOf('apt-get upgrade -y --no-install-recommends', update);
      const install = dockerfile.indexOf('apt-get install -y --no-install-recommends', upgrade);

      expect(runtimeStage).toBeGreaterThanOrEqual(0);
      expect(update).toBeGreaterThan(runtimeStage);
      expect(upgrade).toBeGreaterThan(update);
      expect(install).toBeGreaterThan(upgrade);
    },
  );

  it.each(dockerfiles)('%s removes package metadata and npm tooling from runtime', (path) => {
    const dockerfile = readFileSync(path, 'utf8');
    expect(dockerfile).toContain('rm -rf /var/lib/apt/lists/* /var/cache/apt/*');
    expect(dockerfile).toContain('/usr/local/lib/node_modules/npm');
    expect(dockerfile).toContain('/usr/local/bin/npm');
    expect(dockerfile).toContain('/usr/local/bin/npx');
  });
});
