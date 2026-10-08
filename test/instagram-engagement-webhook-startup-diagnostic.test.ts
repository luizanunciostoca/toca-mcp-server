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
      'READ_ONLY=true',
      'SERVICE_MUTATIONS_AUTHORIZED=false',
      'TRAFFIC_MUTATIONS_AUTHORIZED=false',
      'DATABASE_MUTATIONS_AUTHORIZED=false',
      'PROVIDER_CALLS_AUTHORIZED=false',
      'EXTERNAL_REPLY_WRITES_AUTHORIZED=false',
      'MAIN_STABILITY=PASS',
      'MERGE_RESERVATION=NONE',
    ]) {
      expect(workflow).toContain(marker);
    }
  });

  it('reads only the exact Cloud Run revision and sanitized logs', () => {
    for (const marker of [
      'gcloud run revisions describe "$EXPECTED_REVISION"',
      'gcloud logging read',
      'resource.type="cloud_run_revision"',
      'SANITIZED_STARTUP_ERRORS_BEGIN',
      'RAW_USER_DATA_LOGGED=false',
      'SECRETS_PRINTED=false',
      'STARTUP_META_WEBHOOK_SECRET_CONFIG',
      'STARTUP_SECRET_REFERENCE_MISSING',
      'STARTUP_DATABASE_CONFIG_OR_CONNECTIVITY',
      'STARTUP_PORT_OR_PROCESS_EXIT',
      'STARTUP_CONFIG_VALIDATION',
    ]) {
      expect(workflow).toContain(marker);
    }
  });

  it('cannot mutate Cloud Run, traffic, database, provider or external replies', () => {
    expect(workflow).not.toContain('gcloud run deploy');
    expect(workflow).not.toContain('gcloud run services update ');
    expect(workflow).not.toContain('gcloud run services update-traffic');
    expect(workflow).not.toContain('gcloud run jobs deploy');
    expect(workflow).not.toContain("method: 'POST'");
    expect(workflow).not.toContain('--member=allUsers');
  });
});
