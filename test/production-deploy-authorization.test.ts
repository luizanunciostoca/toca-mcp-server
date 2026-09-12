import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflowPath = '.github/workflows/deploy-toca-managed-instagram-daemon-gcp.yml';
const workflow = readFileSync(workflowPath, 'utf8');

describe('retired Instagram GCP deployment authorization contract', () => {
  it('does not deploy production from a normal main push', () => {
    expect(workflow).toContain('on:\n  workflow_dispatch:');
    expect(workflow).not.toMatch(/\non:\n\s+push:/);
  });

  it('removes the former production-deployment authorization surface entirely', () => {
    expect(workflow).toContain('LEGACY_GCP_INSTAGRAM_DAEMON_RETIRED=1');
    expect(workflow).not.toContain('confirm_production:');
    expect(workflow).not.toContain('authorization_ref:');
    expect(workflow).not.toContain("inputs.confirm_production == 'DEPLOY_PRODUCTION'");
    expect(workflow).not.toContain("inputs.authorization_ref != ''");
    expect(workflow).not.toContain('google-github-actions/auth');
    expect(workflow).not.toMatch(/^\s*gcloud /m);
  });
});
