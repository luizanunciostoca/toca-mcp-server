import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readonlyWorkflow = readFileSync(
  '.github/workflows/instagram-engagement-webhook-callback-readonly.yml',
  'utf8',
);
const restoreWorkflow = readFileSync(
  '.github/workflows/instagram-engagement-webhook-callback-restore.yml',
  'utf8',
);
const limited = readFileSync(
  '.github/workflows/instagram-engagement-limited-activation.yml',
  'utf8',
);
const comment = readFileSync(
  '.github/workflows/instagram-engagement-comment-limited-promotion.yml',
  'utf8',
);
const ag01 = readFileSync(
  '.github/workflows/instagram-engagement-ag01-fallback-limited-activation.yml',
  'utf8',
);

describe('Instagram engagement webhook callback control', () => {
  it('provides an exact-main read-only callback posture probe', () => {
    for (const marker of [
      'INSTAGRAM_ENGAGEMENT_WEBHOOK_CALLBACK_READONLY=AUTHORIZED',
      'SERVICE_MUTATIONS_AUTHORIZED=false',
      'DATABASE_MUTATIONS_AUTHORIZED=false',
      'PROVIDER_CALLS_AUTHORIZED=false',
      'EXTERNAL_REPLY_WRITES_AUTHORIZED=false',
      'run.googleapis.com/default-url-disabled',
      'run.googleapis.com/invoker-iam-disabled',
      'META_WEBHOOK_ENABLED',
      'META_WEBHOOK_PERSISTENCE_ENABLED',
      'BLOCKED_DEFAULT_URL_DISABLED',
      'BLOCKED_INVOKER_IAM_CHECK_ENABLED',
      'PUBLIC_CALLBACK_READY',
    ]) {
      expect(readonlyWorkflow).toContain(marker);
    }
    expect(readonlyWorkflow).not.toContain(
      'gcloud run services update "$WEBHOOK_SERVICE_NAME"',
    );
  });

  it('limits restoration to reversible service-level callback exposure', () => {
    for (const marker of [
      'MUTATION_SCOPE=DEFAULT_URL_AND_INVOKER_IAM_CHECK_ONLY',
      'TRAFFIC_MUTATION_AUTHORIZED=false',
      'REVISION_DEPLOY_AUTHORIZED=false',
      'ROLLBACK_REQUIRED=true',
      '--default-url --no-invoker-iam-check',
      'Roll back exact service-level prestate on failure',
      'test "$POST_TRAFFIC_SHA" = "$PRE_TRAFFIC_SHA"',
      'test "$CURRENT_REVISION" = "$EXPECTED_REVISION"',
      'INVALID_CHALLENGE_HTTP_STATUS',
      'PROVIDER_WRITES=false',
      'EXTERNAL_REPLY_WRITES=false',
    ]) {
      expect(restoreWorkflow).toContain(marker);
    }
    expect(restoreWorkflow).not.toContain('gcloud run services update-traffic');
    expect(restoreWorkflow).not.toContain('gcloud run deploy');
    expect(restoreWorkflow).not.toContain('--member=allUsers');
  });

  it('requires the DRS-safe callback posture before every LIMITED daemon promotion', () => {
    for (const workflow of [limited, comment, ag01]) {
      expect(workflow).toContain(
        'INSTAGRAM_ENGAGEMENT_WEBHOOK_CALLBACK_PRECONDITION=PASS',
      );
      expect(workflow).toContain('run.googleapis.com/default-url-disabled');
      expect(workflow).toContain('run.googleapis.com/invoker-iam-disabled');
      expect(workflow).toContain('META_WEBHOOK_ENABLED');
      expect(workflow).toContain('META_WEBHOOK_PERSISTENCE_ENABLED');
    }
  });
});
