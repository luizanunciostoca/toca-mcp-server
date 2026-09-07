import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-direct-limited-prestate-readonly.yml',
  'utf8',
);

describe('Instagram engagement Direct LIMITED prestate read-only diagnostic', () => {
  it('requires live owner-authored single-use authority and exact current main/runtime provenance', () => {
    for (const marker of [
      'INSTAGRAM_ENGAGEMENT_DIRECT_LIMITED_PRESTATE_READONLY=AUTHORIZED',
      'READ_ONLY_DIRECT_PRESTATE=true',
      'PROVIDER_CALLS_AUTHORIZED=false',
      'DATABASE_MUTATIONS_AUTHORIZED=false',
      'SERVICE_MUTATIONS_AUTHORIZED=false',
      'EXTERNAL_REPLY_WRITES_AUTHORIZED=false',
      'DIRECT_STATE_MUTATION_AUTHORIZED=false',
      'AUTO_REAL_CANARY_AUTHORIZED=false',
      'PERSISTENT_COMMENT_PROMOTION_AUTHORIZED=false',
      'GENERAL_AUTONOMY_MUST_REMAIN_DISABLED=true',
    ]) {
      expect(workflow).toContain(marker);
    }

    expect(workflow).toContain(
      'ISSUE_JSON="$(gh api "repos/${GITHUB_REPOSITORY}/issues/${ISSUE_NUMBER}")"',
    );
    expect(workflow).toContain('(.state == "open") and');
    expect(workflow).toContain('(.user.login == $owner)');
    expect(workflow).toContain('test "$CURRENT_MAIN_SHA" = "$GITHUB_SHA"');
    expect(workflow).toContain('test "$RUNTIME_SHA" = "$GITHUB_SHA"');
    expect(workflow).toContain('[[ "$RUNTIME_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]');
  });

  it('requires live PRO+ main stability and an empty merge reservation', () => {
    expect(workflow).toContain('repos/${GITHUB_REPOSITORY}/issues/640');
    expect(workflow).toContain("grep -Fxq 'MAIN_STABILITY=PASS'");
    expect(workflow).toContain('grep -Fxq "EVALUATED_MAIN_SHA=$GITHUB_SHA"');
    expect(workflow).toContain("grep -Fxq 'MERGE_RESERVATION=NONE'");
  });

  it('uses GCP control-plane reads only and cannot mutate runtime, database, scheduler or provider state', () => {
    expect(workflow).toContain('gcloud artifacts docker images describe');
    expect(workflow).toContain('gcloud run services describe "$DAEMON_SERVICE_NAME"');
    expect(workflow).toContain('gcloud run revisions describe "$DIRECT_REVISION"');

    for (const forbidden of [
      'gcloud run deploy ',
      'gcloud run jobs ',
      'gcloud run services update ',
      'gcloud run services update-traffic',
      'gcloud run services add-iam-policy-binding',
      'gcloud scheduler ',
      'gcloud sql ',
      'DATABASE_URL',
      'TOCA_SECRET_META_ACCESS_TOKEN',
      'META_ACCESS_TOKEN',
      'graph.facebook.com',
      'curl ',
    ]) {
      expect(workflow).not.toContain(forbidden);
    }
  });

  it('proves exactly the Direct LIMITED serving invariants', () => {
    expect(workflow).toContain("test \"$DIRECT_REVISION_COUNT\" = '1'");
    expect(workflow).toContain('.type == "Ready"');
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED');
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_WRITES_ENABLED');
    expect(workflow).toContain('INSTAGRAM_PUBLICATION_WRITES_ENABLED');
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_AUTO_REPLY_CHANNELS');
    expect(workflow).toContain('DIRECT_LIMITED_PRESTATE=PASS');
    expect(workflow).toContain('DIRECT_100_PERCENT_REVISION_COUNT=1');
    expect(workflow).toContain('DIRECT_REVISION_READY=true');
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED=true');
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=true');
    expect(workflow).toContain('INSTAGRAM_PUBLICATION_WRITES_ENABLED=false');
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_AUTO_REPLY_CHANNELS=DIRECT');
  });

  it('publishes only sanitized state and consumes authority without authorizing a real canary', () => {
    expect(workflow).toContain(
      'INSTAGRAM_ENGAGEMENT_DIRECT_LIMITED_PRESTATE_READONLY_STATUS=PASS',
    );
    expect(workflow).toContain('RUNTIME_IMAGE_DIGEST_MATCH=true');
    expect(workflow).toContain('PROVIDER_CALLS=false');
    expect(workflow).toContain('DATABASE_MUTATIONS=false');
    expect(workflow).toContain('SERVICE_MUTATIONS=false');
    expect(workflow).toContain('EXTERNAL_REPLY_WRITES=false');
    expect(workflow).toContain('DIRECT_STATE_MUTATION=false');
    expect(workflow).toContain('RAW_USER_DATA_LOGGED=false');
    expect(workflow).toContain('SECRETS_PRINTED=false');
    expect(workflow).toContain('AUTO_REAL_CANARY_AUTHORIZED=false');
    expect(workflow).toContain('PERSISTENT_COMMENT_PROMOTION_AUTHORIZED=false');
    expect(workflow).toContain('AUTHORIZATION_STATE=CONSUMED_AND_CLOSED');
    expect(workflow).not.toContain('AUTO_REAL_CANARY_AUTHORIZED=true');
    expect(workflow).not.toContain('PROVIDER_CALLS=true');
    expect(workflow).not.toContain('EXTERNAL_REPLY_WRITES=true');
  });
});
