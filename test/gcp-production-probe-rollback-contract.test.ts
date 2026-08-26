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

describe('GCP production startup and rollback safety contract', () => {
  it('uses process health for startup probes and preserves explicit readiness acceptance', () => {
    const startupProbes = workflow.match(/--startup-probe 'httpGet\.path=\/healthz/g) ?? [];

    expect(startupProbes).toHaveLength(3);
    expect(workflow).not.toContain("--startup-probe 'httpGet.path=/readyz");
    expect(workflow).toContain('"$MCP_URL/readyz"');
    expect(workflow).toContain('"$WEBHOOK_URL/readyz"');
    expect(workflow).toContain('"${PROBE_URL}/readyz"');
  });

  it('keeps the production webhook traffic tag within the Cloud Run combined 46-character limit', () => {
    const webhookService = 'toca-webhook-next-production';
    const webhookTag = 'webhook-abcdef0';

    expect(webhookService.length + webhookTag.length).toBeLessThanOrEqual(46);
    expect(workflow).toContain('WEBHOOK_TAG=webhook-${GITHUB_SHA::7}');
    expect(workflow).not.toContain(
      'WEBHOOK_TAG=${{ inputs.environment }}-webhook-${GITHUB_SHA::7}',
    );
  });

  it('bootstraps a first webhook service privately instead of passing illegal no-traffic', () => {
    const webhookDeploy = section(
      '- name: Deploy controlled webhook candidate by digest',
      '- name: Resolve exact candidate revisions and URLs',
    );

    expect(webhookDeploy).toContain('WEBHOOK_TRAFFIC_ARGS=(--no-traffic)');
    expect(webhookDeploy).toContain('WEBHOOK_AUTH_ARGS=(--allow-unauthenticated)');
    expect(webhookDeploy).toContain(
      'if [[ "${PREVIOUS_WEBHOOK_SERVICE_EXISTED:-false}" != true ]]',
    );
    expect(webhookDeploy).toContain('WEBHOOK_TRAFFIC_ARGS=()');
    expect(webhookDeploy).toContain('WEBHOOK_AUTH_ARGS=(--no-allow-unauthenticated)');
    expect(webhookDeploy).toContain('WEBHOOK_FIRST_INTRODUCTION=true');
    expect(webhookDeploy).toContain('"${WEBHOOK_TRAFFIC_ARGS[@]}" "${WEBHOOK_AUTH_ARGS[@]}"');
  });

  it('resolves tagged candidate revision and URL from the Cloud Run traffic JSON', () => {
    const resolution = section(
      '- name: Resolve exact candidate revisions and URLs',
      '- name: Mint private MCP probe ID token through WIF',
    );

    expect(resolution).toContain('id: resolve_candidates');
    expect(resolution).toContain('--format=json');
    expect(resolution).toContain('select((.tag // "") == $tag)');
    expect(resolution).toContain('"$MCP_TAG" revisionName)');
    expect(resolution).toContain('"$MCP_TAG" url)');
    expect(resolution).toContain('"$WEBHOOK_TAG" revisionName)');
    expect(resolution).toContain('"$WEBHOOK_TAG" url)');
    expect(resolution).toContain('MCP_AUDIENCE="$(jq -r');
    expect(resolution).toContain('WEBHOOK_AUDIENCE="$(jq -r');
    expect(resolution).toContain('.status.url // empty');
    expect(resolution).toContain('Could not resolve exact tagged Cloud Run candidate');
    expect(resolution).toContain('echo "mcp_url=$MCP_URL" >> "$GITHUB_OUTPUT"');
    expect(resolution).toContain('mcp_audience=$MCP_AUDIENCE');
    expect(resolution).toContain('echo "webhook_url=$WEBHOOK_URL" >> "$GITHUB_OUTPUT"');
    expect(resolution).toContain('webhook_audience=$WEBHOOK_AUDIENCE');
    expect(resolution).not.toContain('status.traffic[tag=');
  });

  it('mints private candidate ID tokens directly through WIF without self-impersonation', () => {
    const probeAuth = section(
      '- name: Mint private MCP probe ID token through WIF',
      '- name: Capture database Audit Outbox Workflow Privacy and migration refs through runtime identity job',
    );

    expect(probeAuth).toContain('id: mcp_probe_auth');
    expect(probeAuth).toContain('id: webhook_probe_auth');
    expect(probeAuth).toContain(
      'uses: google-github-actions/auth@c200f3691d83b41bf9bbd8638997a462592937ed',
    );
    expect(probeAuth).toContain('token_format: id_token');
    expect(probeAuth).toContain(
      'id_token_audience: ${{ steps.resolve_candidates.outputs.mcp_audience }}',
    );
    expect(probeAuth).toContain(
      'id_token_audience: ${{ steps.resolve_candidates.outputs.webhook_audience }}',
    );
    expect(probeAuth).toContain('create_credentials_file: false');
    expect(probeAuth).toContain('export_environment_variables: false');
    expect(probeAuth).toContain('MCP_TOKEN: ${{ steps.mcp_probe_auth.outputs.id_token }}');
    expect(probeAuth).toContain('WEBHOOK_TOKEN: ${{ steps.webhook_probe_auth.outputs.id_token }}');
    expect(probeAuth).not.toContain('gcloud auth print-identity-token');
    expect(probeAuth).not.toContain('--impersonate-service-account');
    expect(probeAuth).toContain('test -n "$MCP_TOKEN"');
    expect(probeAuth).toContain('test -n "$WEBHOOK_TOKEN"');
    expect(probeAuth).toContain('WEBHOOK_AUTH=(-H "Authorization: Bearer $WEBHOOK_TOKEN")');
    expect(probeAuth).toContain('"$MCP_URL/healthz"');
    expect(probeAuth).toContain('"$MCP_URL/readyz"');
    expect(probeAuth).toContain('"${WEBHOOK_AUTH[@]}" "$WEBHOOK_URL/healthz"');
    expect(probeAuth).toContain('"${WEBHOOK_AUTH[@]}" "$WEBHOOK_URL/readyz"');
    expect(probeAuth).toContain('"${WEBHOOK_AUTH[@]}" "$WEBHOOK_URL/mcp"');
    expect(probeAuth).toContain('"${WEBHOOK_AUTH[@]}" "$WEBHOOK_URL/oauth/meta/start"');
  });

  it('temporarily opens and restores the authenticated MCP run.app probe endpoint', () => {
    const mcpDeploy = section(
      '- name: Deploy private MCP candidate by digest with no traffic',
      '- name: Deploy controlled webhook candidate by digest',
    );
    const restore = section(
      '- name: Restore production MCP default endpoint posture after private probes',
      '- name: Capture database Audit Outbox Workflow Privacy and migration refs through runtime identity job',
    );

    expect(mcpDeploy).toContain('MCP_PROBE_ENDPOINT_ARGS=()');
    expect(mcpDeploy).toContain('if [[ "$DEPLOY_ENVIRONMENT" == production ]]');
    expect(mcpDeploy).toContain('MCP_PROBE_ENDPOINT_ARGS=(--default-url)');
    expect(mcpDeploy).toContain('"${MCP_PROBE_ENDPOINT_ARGS[@]}"');
    expect(mcpDeploy).toContain('--no-allow-unauthenticated');
    expect(mcpDeploy).not.toContain('--allow-unauthenticated');
    expect(mcpDeploy).not.toContain('--ingress all');

    expect(restore).toContain(
      "if: inputs.operation == 'deploy' && inputs.environment == 'production'",
    );
    expect(restore).toContain('--no-default-url');
    expect(restore).toContain('run.googleapis.com/default-url-disabled');
    expect(restore).toContain('MCP_DEFAULT_URL_POSTURE_RESTORED=PASS');

    const verificationIndex = workflow.indexOf(
      '- name: Verify health readiness and webhook route confinement',
    );
    const restoreIndex = workflow.indexOf(
      '- name: Restore production MCP default endpoint posture after private probes',
    );
    const evidenceIndex = workflow.indexOf(
      '- name: Capture database Audit Outbox Workflow Privacy and migration refs through runtime identity job',
    );
    const promotionIndex = workflow.indexOf('- name: Promote production canary');
    expect(verificationIndex).toBeLessThan(restoreIndex);
    expect(restoreIndex).toBeLessThan(evidenceIndex);
    expect(restoreIndex).toBeLessThan(promotionIndex);
  });

  it('marks promotion before the first traffic mutation for canary and full rollouts', () => {
    const marker = 'touch /tmp/toca-traffic-promotion-started';
    const trafficMutation = 'gcloud run services update-traffic';

    const canary = section('- name: Promote production canary', '- name: Promote full traffic');
    const full = section('- name: Promote full traffic', '- name: Read back final traffic state');

    expect(canary.indexOf(marker)).toBeGreaterThan(-1);
    expect(canary.indexOf(marker)).toBeLessThan(canary.indexOf(trafficMutation));
    expect(full.indexOf(marker)).toBeGreaterThan(-1);
    expect(full.indexOf(marker)).toBeLessThan(full.indexOf(trafficMutation));
  });

  it('opens a first webhook publicly only after full promotion has started', () => {
    const full = section('- name: Promote full traffic', '- name: Read back final traffic state');
    const marker = 'touch /tmp/toca-traffic-promotion-started';
    const trafficMutation = 'gcloud run services update-traffic';
    const publicBinding = 'gcloud run services add-iam-policy-binding';

    expect(full).toContain('if [[ "${WEBHOOK_FIRST_INTRODUCTION:-false}" == true ]]');
    expect(full).toContain(publicBinding);
    expect(full.indexOf(marker)).toBeLessThan(full.indexOf(publicBinding));
    expect(full.lastIndexOf(trafficMutation)).toBeLessThan(full.indexOf(publicBinding));
    expect(full).toContain('WEBHOOK_FIRST_INTRODUCTION_PUBLIC_VALIDATION=PASS');
  });

  it('cleans an unpromoted first webhook bootstrap before a future retry', () => {
    const rollback = section(
      '- name: Automatic rollback after failed promotion',
      '- name: Deployment evidence summary',
    );
    const guard = 'if [[ ! -f /tmp/toca-traffic-promotion-started ]]';
    const cleanup = 'gcloud run services delete "$GCP_CLOUD_RUN_WEBHOOK_SERVICE"';
    const rollbackMutation = 'gcloud run services update-traffic';

    expect(rollback).toContain(guard);
    expect(rollback).toContain(cleanup);
    expect(rollback).toContain('WEBHOOK_BOOTSTRAP_CLEANUP=DELETED_UNPROMOTED_SERVICE');
    expect(rollback).toContain('AUTOMATIC_ROLLBACK=SKIPPED_NO_PROMOTION');
    expect(rollback).toContain('--no-default-url');
    expect(rollback).toContain('MCP_DEFAULT_URL_POSTURE_ROLLBACK=PASS');
    expect(rollback.indexOf(guard)).toBeLessThan(rollback.indexOf(cleanup));
    expect(rollback.indexOf(cleanup)).toBeLessThan(rollback.indexOf(rollbackMutation));
  });

  it('closes public webhook access when rolling back to an absent webhook target', () => {
    const explicitRollback = section(
      '- name: Roll back both services to explicit known revisions',
      '- name: Activate emergency mutation kill switch',
    );
    const automaticRollback = section(
      '- name: Automatic rollback after failed promotion',
      '- name: Deployment evidence summary',
    );

    for (const rollback of [explicitRollback, automaticRollback]) {
      expect(rollback).toContain('--no-default-url');
      expect(rollback).toContain('gcloud run services remove-iam-policy-binding');
      expect(rollback).toContain('--member=allUsers --role=roles/run.invoker');
    }
  });
});
