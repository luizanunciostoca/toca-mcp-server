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

  it('skips automatic rollback when no traffic promotion was attempted', () => {
    const rollback = section(
      '- name: Automatic rollback after failed promotion',
      '- name: Deployment evidence summary',
    );
    const guard = 'if [[ ! -f /tmp/toca-traffic-promotion-started ]]';
    const rollbackMutation = 'gcloud run services update-traffic';

    expect(rollback).toContain(guard);
    expect(rollback).toContain('AUTOMATIC_ROLLBACK=SKIPPED_NO_PROMOTION');
    expect(rollback.indexOf(guard)).toBeLessThan(rollback.indexOf(rollbackMutation));
  });
});