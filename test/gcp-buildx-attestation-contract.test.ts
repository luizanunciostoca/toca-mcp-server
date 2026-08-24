import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/deploy-gcp.yml', 'utf8');

describe('GCP deploy Buildx attestation contract', () => {
  it('uses a pinned docker-container builder before provenance and SBOM build', () => {
    const setupIndex = workflow.indexOf(
      'docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f',
    );
    const buildIndex = workflow.indexOf('docker buildx build');

    expect(setupIndex).toBeGreaterThan(-1);
    expect(buildIndex).toBeGreaterThan(setupIndex);
    expect(workflow).toContain('driver: docker-container');
    expect(workflow).toContain('--provenance=mode=max');
    expect(workflow).toContain('--sbom=true');
  });
});
