import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-webhook-startup-diagnostic.yml',
  'utf8',
);

describe('Instagram webhook startup diagnostic', () => {
  it('is exact-head, owner-authorized and read-only', () => {
    for (const marker of [
      'INSTAGRAM_WEBHOOK_STARTUP_DIAGNOSTIC=AUTHORIZED',
      'EXPECTED_SERVICE=toca-webhook-next-production',
      'EXPECTED_HEALTHY_REVISION=',
      'READ_ONLY=true',
      'SERVICE_MUTATIONS_AUTHORIZED=false',
      'TRAFFIC_MUTATIONS_AUTHORIZED=false',
      'DATABASE_MUTATIONS_AUTHORIZED=false',
      'PROVIDER_CALLS_AUTHORIZED=false',
      'EXTERNAL_REPLY_WRITES_AUTHORIZED=false',
      'RAW_LOG_PAYLOAD_PUBLISHED=false',
      'MAIN_STABILITY=PASS',
      'MERGE_RESERVATION=NONE',
    ]) {
      expect(workflow).toContain(marker);
    }
  });

  it('uses the dedicated least-privilege diagnostic reader', () => {
    expect(workflow).toContain(
      'GCP_DIAGNOSTIC_SERVICE_ACCOUNT: toca-ag01-diagnostic-reader@toca-mcp-production.iam.gserviceaccount.com',
    );
    expect(workflow).toContain('Authenticate dedicated diagnostic reader');
    expect(workflow).not.toContain(
      'GCP_DIAGNOSTIC_SERVICE_ACCOUNT: toca-mcp-deployer@toca-mcp-production.iam.gserviceaccount.com',
    );
  });

  it('binds both revisions to the authorized webhook service and reads retained logs', () => {
    for (const marker of [
      'gcloud run revisions describe "$EXPECTED_REVISION"',
      'gcloud run revisions describe "$HEALTHY_REVISION"',
      '.metadata.labels["serving.knative.dev/service"] == $service',
      'cloud_run_revision',
      'resource.labels.service_name',
      'resource.labels.revision_name',
      '--freshness=7d',
      'APPROVED_ERROR_TOKENS=',
      'ENV_PRESENCE=',
      'COMMAND_MATCH=',
      'ARGS_MATCH=',
      'APPROVED_WEBHOOK_STARTUP_ERROR',
      'STARTUP_DEPENDENCY_CONNECTIVITY_FAILURE',
      'STARTUP_PERMISSION_FAILURE',
      'STARTUP_MODULE_LOAD_FAILURE',
      'CLOUD_RUN_STARTUP_PROBE_FAILURE',
      'STARTUP_CONFIG_VALIDATION',
      'RAW_LOG_PAYLOAD_PUBLISHED=false',
    ]) {
      expect(workflow).toContain(marker);
    }
    expect(workflow).not.toContain("|| printf '[]");
  });

  it('publishes only allowlisted classifications rather than raw startup strings', () => {
    expect(workflow).toContain('approved_tokens=(');
    expect(workflow).not.toContain('SANITIZED_STARTUP_ERRORS_BEGIN');
    expect(workflow).not.toContain('startup-errors.txt');
    expect(workflow).not.toContain('SECRETS_PRINTED=false');
    expect(workflow).not.toContain('RAW_USER_DATA_LOGGED=false');
  });

  it('cannot mutate Cloud Run, traffic, database, IAM, provider or external replies', () => {
    expect(workflow).not.toContain('gcloud run deploy');
    expect(workflow).not.toContain('gcloud run services update ');
    expect(workflow).not.toContain('gcloud run services update-traffic');
    expect(workflow).not.toContain('gcloud run jobs deploy');
    expect(workflow).not.toContain('gcloud projects add-iam-policy-binding');
    expect(workflow).not.toContain('gcloud iam service-accounts add-iam-policy-binding');
    expect(workflow).not.toContain("method: 'POST'");
    expect(workflow).not.toContain('--member=allUsers');
  });
});
