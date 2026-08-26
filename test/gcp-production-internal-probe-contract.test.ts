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
  function productionVerify(): string {
    const verify = section(
      '- name: Verify health readiness and webhook route confinement',
      '- name: Restore production MCP default endpoint posture after private probes',
    );
    const start = verify.indexOf('if [[ "$DEPLOY_ENVIRONMENT" == production ]]');
    const end = verify.indexOf('\n          else\n', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return verify.slice(start, end);
  }

  it('validates production MCP through an ephemeral canonical internal service', () => {
    const production = productionVerify();

    expect(production).toContain(
      'PROBE_SERVICE="toca-mcp-accept-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"',
    );
    expect(production).toContain('gcloud run deploy "$PROBE_SERVICE" --image "$IMAGE"');
    expect(production).toContain('--ingress internal --default-url --no-allow-unauthenticated');
    expect(production).toContain(
      'PROBE_URL="https://${PROBE_SERVICE}-${GCP_PROJECT_NUMBER}.${GCP_REGION}.run.app"',
    );
    expect(production).not.toContain('PROBE_URL="$(jq -r');
    expect(production).toContain('create_scheduler_probe "$HEALTH_JOB" "${PROBE_URL}/healthz"');
    expect(production).toContain('create_scheduler_probe "$READY_JOB" "${PROBE_URL}/readyz"');
    expect(production).toContain('--oidc-token-audience="$PROBE_URL"');
    expect(production).not.toContain('create_scheduler_probe "$HEALTH_JOB" "${MCP_URL}/healthz"');
    expect(production).not.toContain('create_scheduler_probe "$READY_JOB" "${MCP_URL}/readyz"');
  });

  it('proves the ephemeral acceptance runtime represents the exact production candidate', () => {
    const production = productionVerify();

    expect(production).toContain('gcloud run revisions describe "$MCP_REVISION"');
    expect(production).toContain('gcloud run revisions describe "$PROBE_REVISION"');
    expect(production).toContain('CANDIDATE_RUNTIME_IMAGE=');
    expect(production).toContain('PROBE_RUNTIME_IMAGE=');
    expect(production).toContain('[[ "$CANDIDATE_RUNTIME_IMAGE" == "$PROBE_RUNTIME_IMAGE" ]]');
    expect(production).toContain('CANDIDATE_RELEASE_SHA=');
    expect(production).toContain('PROBE_RELEASE_SHA=');
    expect(production).toContain(
      '[[ "$CANDIDATE_RELEASE_SHA" == "$GITHUB_SHA" && "$PROBE_RELEASE_SHA" == "$GITHUB_SHA" ]]',
    );
    expect(production).toContain(
      '[[ "$CANDIDATE_RUNTIME_SA" == "$GCP_MCP_RUNTIME_SERVICE_ACCOUNT" && "$PROBE_RUNTIME_SA" == "$GCP_MCP_RUNTIME_SERVICE_ACCOUNT" ]]',
    );
    expect(production).toContain('[[ "$CANDIDATE_READY" == True && "$PROBE_READY" == True ]]');
  });

  it('keeps both production and acceptance ingress private without allUsers exposure', () => {
    const production = productionVerify();

    expect(production).toContain('internal|internal-and-cloud-load-balancing');
    expect(production).toContain('Production MCP ingress is not private');
    expect(production).toContain('Production MCP must not expose roles/run.invoker to allUsers');
    expect(production).toContain('[[ "$PROBE_INGRESS" == internal ]]');
    expect(production).toContain(
      'Ephemeral MCP acceptance service must not expose roles/run.invoker to allUsers',
    );
    expect(production).toContain(
      'PROBE_MEMBER="serviceAccount:${GCP_MCP_RUNTIME_SERVICE_ACCOUNT}"',
    );
    expect(production).not.toContain('--ingress all');
    expect(workflow).not.toContain(
      'gcloud run services update "$GCP_CLOUD_RUN_MCP_SERVICE" --ingress',
    );
  });

  it('records exact canonical acceptance evidence without production traffic mutation', () => {
    const production = productionVerify();

    expect(production).toContain('toca.platform.mcp-internal-probe.v2');
    expect(production).toContain('cloud-scheduler-ephemeral-canonical-service');
    expect(production).toContain('exactReleaseShaMatched:true');
    expect(production).toContain('sameRuntimeImageAsProductionCandidate:true');
    expect(production).toContain('productionTrafficMutation:false');
    expect(production).toContain('providerCallExecuted:false');
    expect(production).toContain('externalGitHubRunnerProbe:false');
    expect(production).toContain('healthHttpStatus:($health|tonumber)');
    expect(production).toContain('readyHttpStatus:($ready|tonumber)');
    expect(production).not.toContain('gcloud run services update-traffic');
  });

  it('cleans Scheduler jobs and ephemeral acceptance service before promotion', () => {
    const verify = section(
      '- name: Verify health readiness and webhook route confinement',
      '- name: Restore production MCP default endpoint posture after private probes',
    );

    expect(verify).toContain('trap cleanup_internal_mcp_probe EXIT');
    expect(verify).toContain('gcloud scheduler jobs delete');
    expect(verify).toContain('gcloud run services delete "$PROBE_SERVICE"');
    expect(verify).toContain('trap - EXIT');
    expect(verify).toContain('Internal MCP probe cleanup left scheduler job behind');
    expect(verify).toContain('Ephemeral MCP acceptance service remained after cleanup');

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
