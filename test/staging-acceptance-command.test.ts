import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflowPath = '.github/workflows/staging-acceptance-command.yml';
const workflow = readFileSync(workflowPath, 'utf8');

describe('staging acceptance command control-plane', () => {
  it('is triggered only by issue comments and is locked to the canonical evidence issue and actor', () => {
    expect(workflow).toContain('issue_comment:');
    expect(workflow).toContain('types: [created]');
    expect(workflow).toContain("github.repository == 'luizanunciostoca/toca-mcp-server'");
    expect(workflow).toContain("github.actor == 'luizanunciostoca'");
    expect(workflow).toContain('github.event.issue.number == 151');
    expect(workflow).toContain("startsWith(github.event.comment.body, '/toca-staging-final ')");
    expect(workflow).toContain("COMMAND_PREFIX: '/toca-staging-final '");
  });

  it('requires an exact 40-hex candidate equal to the current main SHA', () => {
    expect(workflow).toContain('[[ "$CANDIDATE_SHA" =~ ^[0-9a-f]{40}$ ]]');
    expect(workflow).toContain('branches/main');
    expect(workflow).toContain('test "$CANDIDATE_SHA" = "$MAIN_SHA"');
    expect(workflow).toContain('ref: ${{ steps.gate.outputs.candidate_sha }}');
    expect(workflow).toContain('test "$(git rev-parse HEAD)" = "${{ steps.gate.outputs.candidate_sha }}"');
  });

  it('has no GCP identity token and cannot directly mutate cloud resources', () => {
    expect(workflow).not.toContain('id-token: write');
    expect(workflow).not.toContain('google-github-actions/auth');
    expect(workflow).not.toContain('gcloud ');
    expect(workflow).not.toContain('toca-mcp-production');
    expect(workflow).not.toContain('environment: production');
  });

  it('can dispatch only the canonical staging acceptance workflows', () => {
    const allowed = [
      'deploy-gcp-staging-canonical.yml/dispatches',
      'staging-runtime-observability.yml/dispatches',
      'staging-reliability-alerts.yml/dispatches',
      'staging-synthetic-alert.yml/dispatches',
    ];

    for (const item of allowed) expect(workflow).toContain(item);

    expect(workflow).not.toContain('deploy-gcp.yml/dispatches');
    expect(workflow).not.toContain('r29-production-runtime-verification.yml');
    expect(workflow).not.toContain('meta-ads-create-paused-provider-smoke.yml');
    expect(workflow).not.toContain('email-provider-gate.yml');
    expect(workflow).not.toContain('google-ads-provider-read.yml');
  });

  it('pins every dispatched workflow to main and carries exact candidate/policy evidence', () => {
    expect((workflow.match(/\{ref:\"main\"/g) ?? []).length).toBe(4);
    expect(workflow).toContain('expected_candidate_sha:$sha');
    expect(workflow).toContain('expected_source_sha:$sha');
    expect(workflow).toContain('expected_policy_sha256:$policy');
    expect(workflow).toContain('expected_image_digest:$digest');
    expect(workflow).toContain('candidate_sha:$sha');
  });

  it('waits for each canonical run to complete successfully before advancing', () => {
    expect(workflow).toContain("test \"$CONCLUSION\" = success");
    expect(workflow).toContain('STAGING_ACCEPTANCE_DEPLOY_RUN=');
    expect(workflow).toContain('STAGING_ACCEPTANCE_RUNTIME_RUN=');
    expect(workflow).toContain('STAGING_ACCEPTANCE_ALERTS_RUN=');
    expect(workflow).toContain('STAGING_ACCEPTANCE_SYNTHETIC_RUN=');
    expect(workflow).toContain('CANONICAL_CHAIN_PASS');
  });
});
