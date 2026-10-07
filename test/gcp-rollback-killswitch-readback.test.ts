import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/deploy-gcp.yml', 'utf8');

function section(startMarker: string, endMarker: string): string {
  const start = workflow.indexOf(startMarker);
  const end = workflow.indexOf(endMarker, start);
  expect(start, startMarker).toBeGreaterThanOrEqual(0);
  expect(end, endMarker).toBeGreaterThan(start);
  return workflow.slice(start, end);
}

describe('GCP rollback and mutation kill-switch readback', () => {
  it('requires explicit rollback traffic readback and preserves ABSENT_CLOSED verification', () => {
    const rollback = section(
      '- name: Roll back both services to explicit known revisions',
      '- name: Activate emergency mutation kill switch',
    );

    expect(rollback).toContain('verify_exact_traffic');
    expect(rollback).toContain('gcloud run services describe "$service"');
    expect(rollback).toContain('select((.percent // 0) > 0)');
    expect(rollback).toContain('unique) == [$revision]');
    expect(rollback).toContain('verify_closed_webhook');
    expect(rollback).toContain('run.googleapis.com/default-url-disabled');
    expect(rollback).toContain('gcloud run services get-iam-policy');
    expect(rollback).toContain('.role != "roles/run.invoker"');
    expect(rollback).toContain('. != "allUsers"');
    expect(rollback).toContain('EXPLICIT_ROLLBACK_READBACK=PASS');
  });

  it.each([
    [
      'activate',
      '- name: Activate emergency mutation kill switch',
      '- name: Clear emergency mutation kill switch',
      'true',
    ],
    [
      'clear',
      '- name: Clear emergency mutation kill switch',
      '- name: Automatic rollback after failed promotion',
      'false',
    ],
  ])(
    'stages exact %s kill-switch candidates before pair cutover and compensates failures',
    (_label, startMarker, endMarker, expected) => {
      const block = section(startMarker, endMarker);

      expect(block).toContain('serving_revision');
      expect(block).toContain('normalized_revision_spec');
      expect(block).toContain('stage_candidate');
      expect(block).toContain('rollback_pair');
      expect(block).toContain('verify_serving_kill_switch');
      expect(block).toContain('suffix="ks-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}-${role}"');
      expect(block).toContain('candidate="${service}-${suffix}"');
      expect(block).toContain('--revision-suffix "$suffix"');
      expect(block).toContain('--no-traffic');
      expect(block).toContain('--update-env-vars "TOCA_PLATFORM_KILL_SWITCH=$expected"');
      expect(block).toContain('test "$candidate_spec" = "$previous_spec"');
      expect(block).toContain('(.metadata.name == $candidate)');
      expect(block).toContain('.name == "TOCA_PLATFORM_KILL_SWITCH"');
      expect(block).toContain('(.percent // 0) == 0');
      expect(block).toContain('MCP_PREVIOUS_REVISION="$(serving_revision');
      expect(block).toContain('WEBHOOK_PREVIOUS_REVISION="$(serving_revision');
      expect(block).toContain('stage_candidate "$GCP_CLOUD_RUN_MCP_SERVICE" mcp');
      expect(block).toContain('stage_candidate "$GCP_CLOUD_RUN_WEBHOOK_SERVICE" webhook');
      expect(block).toContain('--to-revisions "${MCP_CANDIDATE_REVISION}=100"');
      expect(block).toContain('--to-revisions "${WEBHOOK_CANDIDATE_REVISION}=100"');
      expect(block).toContain('rollback_pair "$MCP_PREVIOUS_REVISION" "$WEBHOOK_PREVIOUS_REVISION"');
      expect(block).toContain(`verify_serving_kill_switch "$GCP_CLOUD_RUN_MCP_SERVICE" "$MCP_CANDIDATE_REVISION" ${expected}`);
      expect(block).toContain(`verify_serving_kill_switch "$GCP_CLOUD_RUN_WEBHOOK_SERVICE" "$WEBHOOK_CANDIDATE_REVISION" ${expected}`);

      const stageMcp = block.indexOf('stage_candidate "$GCP_CLOUD_RUN_MCP_SERVICE" mcp');
      const stageWebhook = block.indexOf('stage_candidate "$GCP_CLOUD_RUN_WEBHOOK_SERVICE" webhook');
      const promoteMcp = block.indexOf('--to-revisions "${MCP_CANDIDATE_REVISION}=100"');
      const promoteWebhook = block.indexOf('--to-revisions "${WEBHOOK_CANDIDATE_REVISION}=100"');
      expect(stageMcp).toBeGreaterThan(-1);
      expect(stageWebhook).toBeGreaterThan(stageMcp);
      expect(promoteMcp).toBeGreaterThan(stageWebhook);
      expect(promoteWebhook).toBeGreaterThan(promoteMcp);
    },
  );

  it('reads back automatic rollback traffic, closed webhook posture and unpromoted cleanup', () => {
    const rollback = section(
      '- name: Automatic rollback after failed promotion',
      '- name: Deployment evidence summary',
    );

    expect(rollback).toContain(
      'verify_exact_traffic "$GCP_CLOUD_RUN_MCP_SERVICE" "$PREVIOUS_MCP_REVISION"',
    );
    expect(rollback).toContain(
      'verify_exact_traffic "$GCP_CLOUD_RUN_WEBHOOK_SERVICE" "$PREVIOUS_WEBHOOK_REVISION"',
    );
    expect(rollback).toContain('verify_closed_webhook');
    expect(rollback).toContain('WEBHOOK_AUTOMATIC_ROLLBACK_MODE=ABSENT_CLOSED');
    expect(rollback).toContain('AUTOMATIC_ROLLBACK_READBACK=PASS');
    expect(rollback).toContain('bash scripts/verify-cloud-run-service-absence.sh');
    expect(rollback).not.toContain(
      '! gcloud run services describe "$GCP_CLOUD_RUN_WEBHOOK_SERVICE"',
    );
  });

  it('does not weaken the existing rollback compatibility or production gates', () => {
    expect(workflow).toContain('ROLLBACK_COMPATIBILITY_REF');
    expect(workflow).toContain('test -n "$ROLLBACK_COMPATIBILITY_REF"');
    expect(workflow).toContain('production_authorization_ref');
    expect(workflow).toContain('staging_evidence_ref');
    expect(workflow).toContain('dr_evidence_ref');
  });
});
