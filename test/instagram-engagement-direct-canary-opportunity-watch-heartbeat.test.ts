import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-direct-canary-opportunity-watch-heartbeat.yml',
  'utf8',
);

describe('Instagram Direct canary opportunity watch heartbeat', () => {
  it('starts only from a governed Direct watch issue or explicit workflow dispatch', () => {
    expect(workflow).toContain('issues:');
    expect(workflow).toContain('types: [opened]');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain('github.event.issue.user.login == github.repository_owner');
    expect(workflow).toContain(
      "startsWith(github.event.issue.title, 'PRODUCTION AUTHORIZATION — Instagram DIRECT canary opportunity watch READONLY AUTO')",
    );
  });

  it('has GitHub-only least authority and no production/provider credentials', () => {
    expect(workflow).toContain('contents: read');
    expect(workflow).toContain('issues: read');
    expect(workflow).toContain('actions: write');
    for (const forbidden of [
      'id-token: write',
      'google-github-actions/auth',
      'google-github-actions/setup-gcloud',
      'DATABASE_URL',
      'META_ACCESS_TOKEN',
      'INSTAGRAM_ACCESS_TOKEN',
      'gcloud ',
    ]) {
      expect(workflow).not.toContain(forbidden);
    }
  });

  it('requires one owner-authored current-main watch with exact read-only safety markers', () => {
    expect(workflow).toContain('test "$CURRENT_MAIN_SHA" = "$GITHUB_SHA"');
    expect(workflow).toContain('select(.user.login == $owner)');
    expect(workflow).toContain('if [[ "$COUNT" != \'1\' ]]');
    for (const marker of [
      'AUTHORIZATION_STATE=ACTIVE',
      'INSTAGRAM_ENGAGEMENT_DIRECT_CANARY_OPPORTUNITY_WATCH=AUTHORIZED',
      'WATCH_MODE=READ_ONLY',
      'WATCH_INTERVAL_MINUTES=10',
      'WATCH_MAX_LIFETIME_HOURS=12',
      'CANARY_CHANNEL=DIRECT',
      'PERSISTENT_SERVICE_MUTATIONS_AUTHORIZED=false',
      'DATABASE_MUTATIONS_AUTHORIZED=false',
      'PROVIDER_CALLS_AUTHORIZED=false',
      'EXTERNAL_REPLY_WRITES_AUTHORIZED=false',
      'AUTO_REAL_CANARY_AUTHORIZED=false',
      'COMMENT_LIMITED_MUST_REMAIN_UNCHANGED=true',
      'GENERAL_AUTONOMY_MUST_REMAIN_DISABLED=true',
      'PERSISTENT_DIRECT_PROMOTION_AUTHORIZED=false',
    ]) {
      expect(workflow).toContain(marker);
    }
    expect(workflow).toContain('^sha256:[0-9a-f]{64}$');
  });

  it('uses a bounded delay and revalidates before each probe dispatch', () => {
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
      'DIRECT_CANARY_WATCH_HEARTBEAT_DECISION=SKIP_EXISTING_ACTIVE_PROBE',
    );
  });

  it('dispatches only the canonical read-only Direct watcher and never a provider canary', () => {
    expect(workflow).toContain(
      'WATCH_WORKFLOW: instagram-engagement-direct-canary-opportunity-watch.yml',
    );
    expect(workflow).toContain(
      '"repos/${GITHUB_REPOSITORY}/actions/workflows/${WATCH_WORKFLOW}/dispatches"',
    );
    expect(workflow).toContain(
      'TARGET_WORKFLOW=instagram-engagement-direct-canary-opportunity-watch.yml',
    );
    expect(workflow).not.toContain('provider-canary.yml');
    expect(workflow).not.toContain('INSTAGRAM_ENGAGEMENT_REAL_DIRECT_CANARY=AUTHORIZED');
    expect(workflow).not.toContain('EXTERNAL_DIRECT_REPLY_AUTHORIZED=true');
  });

  it('self-rearms only while the same watch remains open, current and unexpired', () => {
    expect(workflow).toContain(
      'HEARTBEAT_WORKFLOW: instagram-engagement-direct-canary-opportunity-watch-heartbeat.yml',
    );
    expect(workflow).toContain('Rearm heartbeat only while same watch remains current and active');
    expect(workflow).toContain('DIRECT_CANARY_WATCH_HEARTBEAT_REARM=SKIPPED_CLOSED');
    expect(workflow).toContain('DIRECT_CANARY_WATCH_HEARTBEAT_REARM=SKIPPED_STALE');
    expect(workflow).toContain('DIRECT_CANARY_WATCH_HEARTBEAT_REARM=SKIPPED_EXPIRED');
    expect(workflow).toContain('select(.id != $current)');
    expect(workflow).toContain(
      'DIRECT_CANARY_WATCH_HEARTBEAT_REARM=SKIPPED_EXISTING_ACTIVE_HEARTBEAT',
    );
    expect(workflow).toContain(
      '"repos/${GITHUB_REPOSITORY}/actions/workflows/${HEARTBEAT_WORKFLOW}/dispatches"',
    );
    expect(workflow).toContain('DIRECT_CANARY_WATCH_HEARTBEAT_REARM=DISPATCHED');
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
