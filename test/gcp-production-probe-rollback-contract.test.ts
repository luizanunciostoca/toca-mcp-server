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

    expect(startupProbes).toHaveLength(2);
    expect(workflow).not.toContain("--startup-probe 'httpGet.path=/readyz");
    expect(workflow).toContain('"$MCP_URL/readyz"');
    expect(workflow).toContain('"$WEBHOOK_URL/readyz"');
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

  it('validates webhook candidates with an identity token before any first public exposure', () => {
    const verification = section(
      '- name: Verify health readiness and webhook route confinement',
      '- name: Capture database Audit Outbox Workflow Privacy and migration refs through runtime identity job',
    );

    expect(verification).toContain(
      'WEBHOOK_TOKEN="$(gcloud auth print-identity-token --audiences="$WEBHOOK_URL")"',
    );
    expect(verification).toContain('WEBHOOK_AUTH=(-H "Authorization: Bearer $WEBHOOK_TOKEN")');
    expect(verification).toContain('"${WEBHOOK_AUTH[@]}" "$WEBHOOK_URL/healthz"');
    expect(verification).toContain('"${WEBHOOK_AUTH[@]}" "$WEBHOOK_URL/readyz"');
    expect(verification).toContain('"${WEBHOOK_AUTH[@]}" "$WEBHOOK_URL/mcp"');
    expect(verification).toContain('"${WEBHOOK_AUTH[@]}" "$WEBHOOK_URL/oauth/meta/start"');
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
