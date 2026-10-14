import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/staging-acceptance-command.yml', 'utf8');

function recoverySection(): string {
  const start = workflow.indexOf('  recovery-exercise:');
  expect(start).toBeGreaterThan(-1);
  return workflow.slice(start);
}

describe('staging runtime exercise controller', () => {
  it('reuses the canonical owner-only issue-comment control plane', () => {
    const section = recoverySection();
    expect(workflow).toContain('name: Staging Acceptance Command');
    expect(section).toContain("github.actor == 'luizanunciostoca'");
    expect(section).toContain('github.event.issue.number == 151');
    expect(section).toContain("startsWith(github.event.comment.body, '/toca-staging-recovery ')");
    expect(section).toContain('test "$GITHUB_ACTOR" = "$ALLOWED_ACTOR"');
    expect(section).toContain('test "$CONTROLLER_SHA" = "$MAIN_SHA"');
  });

  it('requires owner-authored exact-SHA authorization with the bounded staging scope', () => {
    const section = recoverySection();
    for (const marker of [
      'AUTHORIZATION_STATE=ACTIVE',
      'AUTHORIZED_CANDIDATE_SHA=$CONTROLLER_SHA',
      'AUTHORIZED_ENVIRONMENT=toca-mcp-next-staging',
      'AUTHORIZED_REGION=southamerica-east1',
      'AUTHORIZED_SERVICES=toca-mcp-next-staging,toca-webhook-next-staging',
      'PRODUCTION_MUTATION_AUTHORIZED=false',
      'PROVIDER_MUTATION_AUTHORIZED=false',
      'DATABASE_MUTATION_AUTHORIZED=false',
      'REAL_MONEY_AUTHORIZED=false',
      'NEW_PAID_RESOURCE_ALLOCATION_AUTHORIZED=false',
      'SECRETS_DISCLOSURE_AUTHORIZED=false',
      'ROLLBACK_REQUIRED=true',
      'READBACK_REQUIRED_AFTER_EACH_MUTATION=true',
    ]) {
      expect(section).toContain(marker);
    }
    expect(section).toContain('/issues/639');
  });

  it('derives rollback targets from immutable Evidence Ledger prestate instead of command input', () => {
    const section = recoverySection();
    expect(section).toContain('/issues/641');
    expect(section).toContain('TOCA-MAX STAGING ROLLBACK/KILL-SWITCH PRESTATE');
    expect(section).toContain("grep -F 'runtime release SHA:'");
    expect(section).toContain("grep -F 'image index digest:'");
    expect(section).toContain("grep -F 'MCP: toca-mcp-next-staging @'");
    expect(section).toContain("grep -F 'Webhook: toca-webhook-next-staging @'");
    expect(section).toContain('toca-mcp-next-staging-mcp-[a-z0-9-]+');
    expect(section).toContain('toca-webhook-next-staging-webhook-[a-z0-9-]+');
  });

  it('performs a fresh read-only prestate before the first mutation', () => {
    const section = recoverySection();
    const prestate = section.indexOf(
      'PRESTATE_RUN="$(dispatch_wait staging-runtime-observability.yml "$OBS_PAYLOAD" PRESTATE_READBACK)"',
    );
    const kill = section.indexOf('KILL_PAYLOAD=');
    expect(prestate).toBeGreaterThan(-1);
    expect(kill).toBeGreaterThan(prestate);
    expect(section).toContain('run_capacity:"false"');
  });

  it('executes only the authorized mutation sequence and returns to evidence-bound revisions', () => {
    const section = recoverySection();
    const kill = section.indexOf('operation":"kill_switch"');
    const clear = section.indexOf('operation":"clear_kill_switch"');
    const rollback = section.indexOf('operation:"rollback"');
    const finalReadback = section.indexOf(
      'FINAL_RUN="$(dispatch_wait staging-runtime-observability.yml "$OBS_PAYLOAD" FINAL_READBACK)"',
    );

    expect(kill).toBeGreaterThan(-1);
    expect(clear).toBeGreaterThan(kill);
    expect(rollback).toBeGreaterThan(clear);
    expect(finalReadback).toBeGreaterThan(rollback);
    expect(section).toContain('rollback_mcp_revision:$mcp');
    expect(section).toContain('rollback_webhook_revision:$webhook');
    expect(section).not.toContain('operation":"deploy"');
    expect(section).not.toContain('environment":"production"');
  });

  it('attempts bounded compensating rollback after kill or clear failure', () => {
    const section = recoverySection();
    expect(section).toContain('COMPENSATING_ROLLBACK_AFTER_KILL_FAILURE');
    expect(section).toContain('COMPENSATING_ROLLBACK_AFTER_CLEAR_FAILURE');
    expect(section).toContain('test -n "$ROLLBACK_RUN"');
    expect(section).toContain('FINAL_STATE=PRESTATE_RESTORED');
  });

  it('delegates Cloud Run mutation to canonical workflows and does not run gcloud directly', () => {
    const section = recoverySection();
    expect(section).toContain('dispatch_wait deploy-gcp.yml');
    expect(section).toContain('dispatch_wait staging-runtime-observability.yml');
    expect(section).not.toContain('gcloud run');
  });
});
