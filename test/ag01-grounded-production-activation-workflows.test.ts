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
const startupCloudReadback = readFileSync(
  '.github/workflows/ag01-grounded-startup-cloud-readback.yml',
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

  it('captures github-only sanitized startup diagnostics without production credentials', () => {
    expect(startupDiagnostics).toContain('AG-01 Grounded Runtime Activation');
    expect(startupDiagnostics).toContain("github.event.workflow_run.conclusion == 'failure'");
    expect(startupDiagnostics).toContain('actions: read');
    expect(startupDiagnostics).toContain('gh run view');
    expect(startupDiagnostics).toContain('AG01_PERSISTENCE_NOT_READY');
    expect(startupDiagnostics).toContain('CLOUD_RUN_STARTUP_PROBE_FAILURE');
    expect(startupDiagnostics).toContain('APPROVED_ERROR_TOKENS=');
    expect(startupDiagnostics).toContain('RAW_LOG_PAYLOAD_PUBLISHED=false');
    expect(startupDiagnostics).toContain('GCP_CREDENTIALS_USED=false');
    expect(startupDiagnostics).toContain('TRAFFIC_MUTATION=false');
    expect(startupDiagnostics).toContain('PROVIDER_CALLS=false');
    expect(startupDiagnostics).toContain('DATABASE_MUTATION=false');
    expect(startupDiagnostics).not.toContain('google-github-actions/auth');
    expect(startupDiagnostics).not.toContain('gcloud ');
    expect(startupDiagnostics).not.toContain('READY_REASON=');
    expect(startupDiagnostics).not.toContain("grep -Eo 'AG01_");
    expect(startupDiagnostics).not.toContain('update-traffic');
    expect(startupDiagnostics).not.toContain('run deploy');
  });

  it('performs bounded cloud startup readback without production mutation or raw log publication', () => {
    expect(startupCloudReadback).toContain('AG01_STARTUP_CLOUD_READBACK=AUTHORIZED');
    expect(startupCloudReadback).toContain('NO_TRAFFIC_MUTATION=true');
    expect(startupCloudReadback).toContain('NO_SERVICE_MUTATION=true');
    expect(startupCloudReadback).toContain('NO_IAM_MUTATION=true');
    expect(startupCloudReadback).toContain('NO_DATABASE_MUTATION=true');
    expect(startupCloudReadback).toContain('NO_PROVIDER_CALLS=true');
    expect(startupCloudReadback).toContain('RAW_LOG_PAYLOAD_PUBLISHED=false');
    expect(startupCloudReadback).toContain(
      'toca-ag01-diagnostic-reader@toca-mcp-production.iam.gserviceaccount.com',
    );
    expect(startupCloudReadback).not.toContain(
      'toca-mcp-deployer@toca-mcp-production.iam.gserviceaccount.com',
    );
    expect(startupCloudReadback).toContain('LIVE_ISSUE=');
    expect(startupCloudReadback).toContain('.state == "open"');
    expect(startupCloudReadback).toContain('gcloud run revisions describe');
    expect(startupCloudReadback).toContain('gcloud logging read');
    expect(startupCloudReadback).toContain('STARTUP_PROBE_TYPE=');
    expect(startupCloudReadback).toContain('startupProbe.tcpSocket');
    expect(startupCloudReadback).toContain('startupProbe.grpc');
    expect(startupCloudReadback).toContain('select(type == "string")');
    expect(startupCloudReadback).toContain('ENV_PRESENCE=');
    expect(startupCloudReadback).toContain('APPROVED_ERROR_TOKENS=');
    expect(startupCloudReadback).toContain('AUTHORIZATION_STATE=CONSUMED');
    expect(startupCloudReadback).not.toContain('gcloud run deploy');
    expect(startupCloudReadback).not.toContain('update-traffic');
    expect(startupCloudReadback).not.toContain('services update');
    expect(startupCloudReadback).not.toContain('scheduler jobs update');
    expect(startupCloudReadback).not.toContain('sql connect');
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

  it('restores canonical traffic idempotently from both full and split traffic states', () => {
    expect(guardian).toContain('AG-01 Grounded Runtime Activation');
    expect(guardian).toContain('Instagram Engagement AG-01 Fallback LIMITED Activation');
    expect(guardian).toContain("github.event.workflow_run.conclusion == 'failure'");
    expect(guardian).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(guardian).toContain('historicalVerification.canonicalProductionRevision');
    expect(guardian).toContain('ENGAGEMENT_PROMOTED_REVISION=');
    expect(guardian).toContain('restore_if_needed');
    expect(guardian).toContain('Canonical revision already owns 100% traffic');
    expect(guardian).toContain('--to-revisions "$previous=100"');
    expect(guardian).not.toContain('test -n "$current"');
    expect(guardian).not.toContain('scheduler jobs update');
  });
});