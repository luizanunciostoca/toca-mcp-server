import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-comment-canary-opportunity-watch-heartbeat.yml',
  'utf8',
);

describe('Instagram Comment canary opportunity watch heartbeat', () => {
  it('starts only from a governed watch issue or explicit workflow dispatch', () => {
    expect(workflow).toContain('issues:');
    expect(workflow).toContain('types: [opened]');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain('github.event.issue.user.login == github.repository_owner');
    expect(workflow).toContain(
      "startsWith(github.event.issue.title, 'PRODUCTION AUTHORIZATION — Instagram COMMENT canary opportunity watch READONLY AUTO')",
    );
  });

  it('has GitHub-only least authority and no production/provider credentials', () => {
    expect(workflow).toContain('contents: read');
    expect(workflow).toContain('issues: read');
    expect(workflow).toContain('actions: write');
    expect(workflow).not.toContain('id-token: write');
    expect(workflow).not.toContain('google-github-actions/auth');
    expect(workflow).not.toContain('google-github-actions/setup-gcloud');
    expect(workflow).not.toContain('DATABASE_URL');
    expect(workflow).not.toContain('META_ACCESS_TOKEN');
    expect(workflow).not.toContain('INSTAGRAM_ACCESS_TOKEN');
    expect(workflow).not.toContain('gcloud ');
  });

  it('requires one owner-authored current-main watch with exact read-only safety markers', () => {
    expect(workflow).toContain('test "$CURRENT_MAIN_SHA" = "$GITHUB_SHA"');
    expect(workflow).toContain('select(.user.login == $owner)');
    expect(workflow).toContain('if [[ "$COUNT" != \'1\' ]]');
    expect(workflow).toContain('AUTHORIZATION_STATE=ACTIVE');
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_COMMENT_CANARY_OPPORTUNITY_WATCH=AUTHORIZED');
    expect(workflow).toContain('WATCH_MODE=READ_ONLY');
    expect(workflow).toContain('WATCH_INTERVAL_MINUTES=10');
    expect(workflow).toContain('WATCH_MAX_LIFETIME_HOURS=12');
    expect(workflow).toContain('CANARY_CHANNEL=COMMENT');
    expect(workflow).toContain('PERSISTENT_SERVICE_MUTATIONS_AUTHORIZED=false');
    expect(workflow).toContain('DATABASE_MUTATIONS_AUTHORIZED=false');
    expect(workflow).toContain('PROVIDER_CALLS_AUTHORIZED=false');
    expect(workflow).toContain('EXTERNAL_REPLY_WRITES_AUTHORIZED=false');
    expect(workflow).toContain('AUTO_REAL_CANARY_AUTHORIZED=false');
    expect(workflow).toContain('DIRECT_LIMITED_MUST_REMAIN_UNCHANGED=true');
    expect(workflow).toContain('GENERAL_AUTONOMY_MUST_REMAIN_DISABLED=true');
    expect(workflow).toContain('PERSISTENT_COMMENT_PROMOTION_AUTHORIZED=false');
    expect(workflow).toContain('^sha256:[0-9a-f]{64}$');
  });

  it('uses a bounded delay and revalidates before every probe dispatch', () => {
    expect(workflow).toContain("HEARTBEAT_DELAY_SECONDS: '540'");
    expect(workflow).toContain('sleep "$HEARTBEAT_DELAY_SECONDS"');
    expect(workflow).toContain('Revalidate watch and determine probe dispatch');
    expect(workflow).toContain("jq -r '.state'");
    expect(workflow).toContain("!= 'open'");
    expect(workflow).toContain(
      'if [[ "$RUNTIME_SHA" != "$CURRENT_MAIN_SHA" || "$NOW_EPOCH" -ge "$EXPIRES_EPOCH" ]]',
    );
    expect(workflow).toContain('select(.status != "completed")');
    expect(workflow).toContain(
      'COMMENT_CANARY_WATCH_HEARTBEAT_DECISION=SKIP_EXISTING_ACTIVE_PROBE',
    );
  });

  it('dispatches only the canonical read-only watch and never the provider canary', () => {
    expect(workflow).toContain(
      'WATCH_WORKFLOW: instagram-engagement-comment-canary-opportunity-watch.yml',
    );
    expect(workflow).toContain(
      '"repos/${GITHUB_REPOSITORY}/actions/workflows/${WATCH_WORKFLOW}/dispatches"',
    );
    expect(workflow).toContain(
      'TARGET_WORKFLOW=instagram-engagement-comment-canary-opportunity-watch.yml',
    );
    expect(workflow).not.toContain('instagram-engagement-comment-provider-canary.yml');
    expect(workflow).not.toContain('INSTAGRAM_ENGAGEMENT_REAL_COMMENT_CANARY=AUTHORIZED');
    expect(workflow).not.toContain('EXTERNAL_COMMENT_REPLY_AUTHORIZED=true');
  });

  it('self-rearms only while the same watch remains open, current and unexpired', () => {
    expect(workflow).toContain(
      'HEARTBEAT_WORKFLOW: instagram-engagement-comment-canary-opportunity-watch-heartbeat.yml',
    );
    expect(workflow).toContain('Rearm heartbeat only while same watch remains current and active');
    expect(workflow).toContain('COMMENT_CANARY_WATCH_HEARTBEAT_REARM=SKIPPED_CLOSED');
    expect(workflow).toContain('COMMENT_CANARY_WATCH_HEARTBEAT_REARM=SKIPPED_STALE');
    expect(workflow).toContain('COMMENT_CANARY_WATCH_HEARTBEAT_REARM=SKIPPED_EXPIRED');
    expect(workflow).toContain('select(.id != $current)');
    expect(workflow).toContain(
      'COMMENT_CANARY_WATCH_HEARTBEAT_REARM=SKIPPED_EXISTING_ACTIVE_HEARTBEAT',
    );
    expect(workflow).toContain(
      '"repos/${GITHUB_REPOSITORY}/actions/workflows/${HEARTBEAT_WORKFLOW}/dispatches"',
    );
    expect(workflow).toContain('COMMENT_CANARY_WATCH_HEARTBEAT_REARM=DISPATCHED');
  });

  it('keeps every declared side-effect attestation fail-closed', () => {
    expect(workflow).toContain('PROVIDER_CALLS=false');
    expect(workflow).toContain('DATABASE_MUTATIONS=false');
    expect(workflow).toContain('SERVICE_MUTATIONS=false');
    expect(workflow).toContain('EXTERNAL_REPLY_WRITES=false');
    expect(workflow).not.toContain('gh issue create');
    expect(workflow).not.toContain('gh issue comment');
    expect(workflow).not.toContain('gcloud run services');
    expect(workflow).not.toContain('gcloud scheduler');
  });
});
