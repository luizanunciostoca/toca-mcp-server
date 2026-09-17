import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ag01 = readFileSync('.github/workflows/ag01-grounded-runtime-activation.yml', 'utf8');
const instagram = readFileSync(
  '.github/workflows/instagram-engagement-ag01-fallback-limited-activation.yml',
  'utf8',
);
const guardian = readFileSync(
  '.github/workflows/ag01-grounded-activation-rollback-guardian.yml',
  'utf8',
);
const startupDiagnostics = readFileSync(
  '.github/workflows/ag01-grounded-startup-failure-diagnostics.yml',
  'utf8',
);

describe('grounded production activation workflows', () => {
  it('keeps AG-01 private, zero-traffic first and provider-write free', () => {
    expect(ag01).toContain('AG01_GROUNDED_RUNTIME_ACTIVATION=AUTHORIZED');
    expect(ag01).toContain('DIRECT_PROVIDER_WRITE_AUTHORIZED=false');
    expect(ag01).toContain('EXTERNAL_BUSINESS_SIDE_EFFECTS_AUTHORIZED=false');
    expect(ag01).toContain('--no-traffic --no-allow-unauthenticated');
    expect(ag01).toContain('/v1/knowledge/answer');
    expect(ag01).toContain('.confidence>=0.85');
    expect(ag01).toContain('DRIVE_SCOPE=READ_ONLY');
    expect(ag01).toContain('roles/run.invoker');
    expect(ag01).toContain('traffic_changed=true');
    expect(ag01).toContain("if: failure() && steps.promote.outputs.traffic_changed == 'true'");
    expect(ag01).toContain('sanitized-evidence.env');
    expect(ag01).not.toContain('--allow-unauthenticated');
    expect(ag01).not.toContain('service-before.json');
    expect(ag01).not.toContain('ag01-grounded-evidence/grounded-answer.json');
  });

  it('captures sanitized startup diagnostics without side effects', () => {
    expect(startupDiagnostics).toContain('AG-01 Grounded Runtime Activation');
    expect(startupDiagnostics).toContain("github.event.workflow_run.conclusion == 'failure'");
    expect(startupDiagnostics).toContain('gcloud logging read');
    expect(startupDiagnostics).toContain('AG01_PERSISTENCE_NOT_READY');
    expect(startupDiagnostics).toContain('RAW_LOG_PAYLOAD_PUBLISHED=false');
    expect(startupDiagnostics).toContain('TRAFFIC_MUTATION=false');
    expect(startupDiagnostics).toContain('PROVIDER_CALLS=false');
    expect(startupDiagnostics).toContain('DATABASE_MUTATION=false');
    expect(startupDiagnostics).not.toContain('update-traffic');
    expect(startupDiagnostics).not.toContain('run deploy');
  });

  it('activates Instagram fallback without widening autonomy or changing scheduler', () => {
    expect(instagram).toContain('INSTAGRAM_AG01_GROUNDED_FALLBACK_LIMITED_ACTIVATION=AUTHORIZED');
    expect(instagram).toContain('AUTO_REPLY_CHANNELS=DIRECT,COMMENT');
    expect(instagram).toContain('GENERAL_AUTONOMY_PROMOTION_AUTHORIZED=false');
    expect(instagram).toContain('DATABASE_MUTATIONS_AUTHORIZED=false');
    expect(instagram).toContain('SCHEDULER_MUTATION_AUTHORIZED=false');
    expect(instagram).toContain('PROVIDER_CONFIG_MUTATION_AUTHORIZED=false');
    expect(instagram).toContain('INSTAGRAM_ENGAGEMENT_AG01_GROUNDED_FALLBACK_ENABLED=true');
    expect(instagram).toContain('--no-traffic --quiet');
    expect(instagram).toContain('DIRECT,COMMENT');
    expect(instagram).toContain('GENERAL_AUTONOMY=false');
    expect(instagram).toContain('roles/run.invoker');
    expect(instagram).toContain('traffic_changed=true');
    expect(instagram).toContain("if: failure() && steps.promote.outputs.traffic_changed == 'true'");
  });

  it('restores canonical traffic idempotently if either activation fails after mutation', () => {
    expect(guardian).toContain('AG-01 Grounded Runtime Activation');
    expect(guardian).toContain('Instagram Engagement AG-01 Fallback LIMITED Activation');
    expect(guardian).toContain("github.event.workflow_run.conclusion == 'failure'");
    expect(guardian).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(guardian).toContain('historicalVerification.canonicalProductionRevision');
    expect(guardian).toContain('ENGAGEMENT_PROMOTED_REVISION=');
    expect(guardian).toContain('restore_if_needed');
    expect(guardian).toContain('Canonical revision already owns 100% traffic');
    expect(guardian).toContain('--to-revisions "$previous=100"');
    expect(guardian).not.toContain('scheduler jobs update');
  });
});
