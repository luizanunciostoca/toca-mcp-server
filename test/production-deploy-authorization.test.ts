import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflowPath = '.github/workflows/deploy-toca-managed-instagram-daemon-gcp.yml';
const workflow = readFileSync(workflowPath, 'utf8');

describe('production deployment authorization contract', () => {
  it('does not deploy production from a normal main push', () => {
    expect(workflow).toContain('on:\n  workflow_dispatch:');
    expect(workflow).not.toMatch(/\non:\n\s+push:/);
  });

  it('requires an explicit production confirmation and authorization reference', () => {
    expect(workflow).toContain('confirm_production:');
    expect(workflow).toContain('authorization_ref:');
    expect(workflow).toContain("inputs.confirm_production == 'DEPLOY_PRODUCTION'");
    expect(workflow).toContain("inputs.authorization_ref != ''");
  });
});
