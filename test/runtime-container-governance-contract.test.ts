import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dockerfile = readFileSync('Dockerfile', 'utf8');
const server = readFileSync('src/server.ts', 'utf8');
const autonomyPolicy = readFileSync('src/governance/autonomy-policy.ts', 'utf8');
const capabilityEvidence = readFileSync('src/governance/capability-validation-evidence.ts', 'utf8');

describe('runtime container governance assets', () => {
  it('packages the control plane loaded by the production server during startup', () => {
    expect(server).toContain('createEnvironmentAutonomyRuntimeContextResolver(env)');
    expect(server).toContain('loadCapabilityValidationEvidenceManifest');
    expect(autonomyPolicy).toContain('control/effective-autonomy-policy.v1.json');
    expect(capabilityEvidence).toContain('control/capability-validation-evidence.v1.json');
    expect(dockerfile).toContain('COPY control ./control');
  });

  it('keeps both required runtime governance manifests in the copied directory', () => {
    expect(existsSync('control/effective-autonomy-policy.v1.json')).toBe(true);
    expect(existsSync('control/capability-validation-evidence.v1.json')).toBe(true);
  });
});
