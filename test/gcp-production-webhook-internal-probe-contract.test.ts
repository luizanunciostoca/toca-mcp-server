import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/deploy-gcp.yml', 'utf8');

function verifySection(): string {
  const start = workflow.indexOf(
    '- name: Verify production webhook health readiness and route confinement',
  );
  const end = workflow.indexOf(
    '- name: Restore production MCP default endpoint posture after private probes',
  );
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return workflow.slice(start, end);
}

describe('GCP production webhook internal probe contract', () => {
  it('uses an internal ephemeral canonical service for production webhook acceptance', () => {
    const verify = verifySection();
    const marker = '# Cloud Scheduler is a supported internal Cloud Run caller';
    const start = verify.indexOf(marker);
    const end = verify.indexOf('\n          else\n            test -n "$WEBHOOK_TOKEN"', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const productionWebhook = verify.slice(start, end);

    expect(productionWebhook).toContain(
      'WEBHOOK_PROBE_SERVICE="toca-webhook-accept-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"',
    );
    expect(productionWebhook).toContain(
      'gcloud run deploy "$WEBHOOK_PROBE_SERVICE" --image "$IMAGE"',
    );
    expect(productionWebhook).toContain('--service-account "$GCP_WEBHOOK_RUNTIME_SERVICE_ACCOUNT"');
    expect(productionWebhook).toContain(
      '--update-secrets "$WEBHOOK_RUNTIME_SECRETS" --update-env-vars "$WEBHOOK_RUNTIME_ENV"',
    );
    expect(productionWebhook).toContain(
      '--ingress internal --default-url --no-allow-unauthenticated',
    );
    expect(productionWebhook).toContain("--startup-probe 'httpGet.path=/readyz");
    expect(productionWebhook).toContain(
      'create_webhook_scheduler_probe "$WEBHOOK_HEALTH_JOB" "${WEBHOOK_PROBE_URL}/healthz"',
    );
    expect(productionWebhook).toContain(
      'create_webhook_scheduler_probe "$WEBHOOK_READY_JOB" "${WEBHOOK_PROBE_URL}/readyz"',
    );
    expect(productionWebhook).toContain(
      'create_webhook_scheduler_probe "$WEBHOOK_MCP_JOB" "${WEBHOOK_PROBE_URL}/mcp"',
    );
    expect(productionWebhook).toContain(
      'create_webhook_scheduler_probe "$WEBHOOK_OAUTH_JOB" "${WEBHOOK_PROBE_URL}/oauth/meta/start"',
    );
    expect(productionWebhook).toContain('--oidc-token-audience="$WEBHOOK_PROBE_URL"');
    expect(productionWebhook).not.toContain('"${WEBHOOK_AUTH[@]}" "$WEBHOOK_URL/');
  });

  it('binds the ephemeral runtime to the exact production candidate identity', () => {
    const verify = verifySection();
    expect(verify).toContain('gcloud run revisions describe "$WEBHOOK_REVISION"');
    expect(verify).toContain(
      '[[ "$WEBHOOK_CANDIDATE_RUNTIME_IMAGE" == "$WEBHOOK_PROBE_RUNTIME_IMAGE" ]]',
    );
    expect(verify).toContain(
      '[[ "$WEBHOOK_CANDIDATE_RELEASE_SHA" == "$GITHUB_SHA" && "$WEBHOOK_PROBE_RELEASE_SHA" == "$GITHUB_SHA" ]]',
    );
    expect(verify).toContain(
      '[[ "$WEBHOOK_CANDIDATE_RUNTIME_SA" == "$GCP_WEBHOOK_RUNTIME_SERVICE_ACCOUNT" && "$WEBHOOK_PROBE_RUNTIME_SA" == "$GCP_WEBHOOK_RUNTIME_SERVICE_ACCOUNT" ]]',
    );
    expect(verify).toContain('[[ "$WEBHOOK_PROBE_STARTUP_PATH" == /readyz ]]');
    expect(verify).toContain('[[ "$WEBHOOK_PROBE_LIVENESS_PATH" == /healthz ]]');
    expect(verify).toContain('sameRuntimeImageAsProductionCandidate:true');
    expect(verify).toContain('exactReleaseShaMatched:true');
  });

  it('proves route confinement internally and records non-mutating evidence', () => {
    const verify = verifySection();
    expect(verify).toContain('wait_for_webhook_scheduler_status "$WEBHOOK_HEALTH_JOB" 200');
    expect(verify).toContain('wait_for_webhook_scheduler_status "$WEBHOOK_READY_JOB" 200');
    expect(verify).toContain('wait_for_webhook_scheduler_status "$WEBHOOK_MCP_JOB" 404');
    expect(verify).toContain('wait_for_webhook_scheduler_status "$WEBHOOK_OAUTH_JOB" 404');
    expect(verify).toContain('toca.platform.webhook-internal-probe.v1');
    expect(verify).toContain('cloud-scheduler-ephemeral-canonical-service');
    expect(verify).toContain('externalGitHubRunnerProbe:false');
    expect(verify).toContain('productionTrafficMutation:false');
    expect(verify).toContain('providerCallExecuted:false');
    expect(verify).toContain('secretPayloadDisclosed:false');
  });

  it('preserves external GitHub-runner webhook probes for staging only', () => {
    const verify = verifySection();
    const stagingStart = verify.indexOf(
      '\n          else\n            test -n "$WEBHOOK_TOKEN"',
      verify.indexOf('WEBHOOK_GCP_INTERNAL_PROBE=PASS'),
    );
    expect(stagingStart).toBeGreaterThan(-1);
    const stagingWebhook = verify.slice(stagingStart);
    expect(stagingWebhook).toContain('WEBHOOK_AUTH=(-H "Authorization: Bearer $WEBHOOK_TOKEN")');
    expect(stagingWebhook).toContain('"${WEBHOOK_AUTH[@]}" "$WEBHOOK_URL/healthz"');
    expect(stagingWebhook).toContain('"${WEBHOOK_AUTH[@]}" "$WEBHOOK_URL/readyz"');
    expect(stagingWebhook).toContain('"${WEBHOOK_AUTH[@]}" "$WEBHOOK_URL/mcp"');
    expect(stagingWebhook).toContain('"${WEBHOOK_AUTH[@]}" "$WEBHOOK_URL/oauth/meta/start"');
  });

  it('cleans all temporary GCP probe resources before promotion', () => {
    const verify = verifySection();
    expect(verify).toContain('trap cleanup_internal_webhook_probe EXIT');
    expect(verify).toContain('gcloud scheduler jobs delete "$job"');
    expect(verify).toContain('gcloud run services delete "$WEBHOOK_PROBE_SERVICE"');
    expect(verify).toContain('Webhook internal probe cleanup left scheduler job behind');
    expect(verify).toContain('Ephemeral webhook acceptance service remained after cleanup');
    expect(verify).not.toContain('gcloud run services update-traffic');
  });
});
