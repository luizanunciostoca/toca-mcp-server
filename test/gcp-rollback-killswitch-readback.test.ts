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
      'TOCA_PLATFORM_KILL_SWITCH=true',
      'verify_kill_switch_value "$service" true',
      'PLATFORM_KILL_SWITCH_READBACK=true',
    ],
    [
      'clear',
      '- name: Clear emergency mutation kill switch',
      '- name: Automatic rollback after failed promotion',
      'TOCA_PLATFORM_KILL_SWITCH=false',
      'verify_kill_switch_value "$service" false',
      'PLATFORM_KILL_SWITCH_READBACK=false',
    ],
  ])(
    'reads back the serving revision after %s kill-switch mutation',
    (_label, startMarker, endMarker, mutation, verification, marker) => {
      const block = section(startMarker, endMarker);

      expect(block).toContain(mutation);
      expect(block).toContain('verify_kill_switch_value');
      expect(block).toContain('.status.traffic');
      expect(block).toContain('.status.latestReadyRevisionName');
      expect(block).toContain('gcloud run revisions describe "$revision"');
      expect(block).toContain('.name == "TOCA_PLATFORM_KILL_SWITCH"');
      expect(block).toContain(verification);
      expect(block).toContain(marker);
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
    expect(rollback).toContain(
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
