import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/deploy-gcp.yml', 'utf8');

function section(start: string, end?: string): string {
  const startIndex = workflow.indexOf(start);
  expect(startIndex).toBeGreaterThan(-1);
  if (!end) return workflow.slice(startIndex);
  const endIndex = workflow.indexOf(end, startIndex + start.length);
  expect(endIndex).toBeGreaterThan(startIndex);
  return workflow.slice(startIndex, endIndex);
}

describe('GCP production internal MCP probe contract', () => {
  it('probes production MCP from Cloud Scheduler instead of the external GitHub runner', () => {
    const verify = section(
      '- name: Verify health readiness and webhook route confinement',
      '- name: Restore production MCP default endpoint posture after private probes',
    );
    const start = verify.indexOf('if [[ "$DEPLOY_ENVIRONMENT" == production ]]');
    const end = verify.indexOf('\n          else\n', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const production = verify.slice(start, end);

    expect(production).toContain('gcloud scheduler jobs create http');
    expect(production).toContain('gcloud scheduler jobs run');
    expect(production).toContain(
      '--oidc-service-account-email="$GCP_MCP_RUNTIME_SERVICE_ACCOUNT"',
    );
    expect(production).toContain('--oidc-token-audience="$MCP_AUDIENCE"');
    expect(production).toContain(
      'create_scheduler_probe "$HEALTH_JOB" "${MCP_URL}/healthz"',
    );
    expect(production).toContain(
      'create_scheduler_probe "$READY_JOB" "${MCP_URL}/readyz"',
    );
    expect(production).toContain('resource.type=\\"cloud_scheduler_job\\"');
    expect(production).not.toMatch(/curl[^\n]*\$MCP_URL/);
  });

  it('fails closed on private network and IAM posture without broadening ingress', () => {
    const verify = section(
      '- name: Verify health readiness and webhook route confinement',
      '- name: Restore production MCP default endpoint posture after private probes',
    );

    expect(verify).toContain('internal|internal-and-cloud-load-balancing');
    expect(verify).toContain('Production MCP ingress is not private');
    expect(verify).toContain('Production MCP must not expose roles/run.invoker to allUsers');
    expect(verify).toContain(
      'PROBE_MEMBER="serviceAccount:${GCP_MCP_RUNTIME_SERVICE_ACCOUNT}"',
    );
    expect(verify).not.toContain('--ingress all');
    expect(workflow).not.toContain(
      'gcloud run services update "$GCP_CLOUD_RUN_MCP_SERVICE" --ingress',
    );
  });

  it('uses exact tagged targets with canonical audience', () => {
    const verify = section(
      '- name: Verify health readiness and webhook route confinement',
      '- name: Restore production MCP default endpoint posture after private probes',
    );

    expect(verify).toContain(
      'MCP_AUDIENCE: ${{ steps.resolve_candidates.outputs.mcp_audience }}',
    );
    expect(verify).toContain('--uri="$uri"');
    expect(verify).toContain('--oidc-token-audience="$MCP_AUDIENCE"');
    expect(verify).toContain('toca.platform.mcp-internal-probe.v1');
    expect(verify).toContain('externalGitHubRunnerProbe:false');
    expect(verify).toContain('healthHttpStatus:($health|tonumber)');
    expect(verify).toContain('readyHttpStatus:($ready|tonumber)');
  });

  it('cleans scheduler jobs and any temporary invoker binding before promotion', () => {
    const verify = section(
      '- name: Verify health readiness and webhook route confinement',
      '- name: Restore production MCP default endpoint posture after private probes',
    );

    expect(verify).toContain('trap cleanup_internal_mcp_probe EXIT');
    expect(verify).toContain('gcloud scheduler jobs delete');
    expect(verify).toContain('gcloud run services remove-iam-policy-binding');
    expect(verify).toContain('trap - EXIT');
    expect(verify).toContain('Internal MCP probe cleanup left scheduler job behind');
    expect(verify).toContain('Temporary MCP probe invoker binding remained after cleanup');

    const restoreIndex = workflow.indexOf(
      '- name: Restore production MCP default endpoint posture after private probes',
    );
    const evidenceIndex = workflow.indexOf(
      '- name: Capture database Audit Outbox Workflow Privacy and migration refs through runtime identity job',
    );
    const promotionIndex = workflow.indexOf('- name: Promote production canary');
    expect(restoreIndex).toBeGreaterThan(-1);
    expect(restoreIndex).toBeLessThan(evidenceIndex);
    expect(restoreIndex).toBeLessThan(promotionIndex);
  });
});
