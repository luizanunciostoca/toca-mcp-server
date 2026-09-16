import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-direct-canary-opportunity-watch-trigger.yml',
  'utf8',
);

describe('Instagram Direct canary opportunity watch trigger broker', () => {
  it('adds immediate owner-authorized kickoff plus a staggered redundant ten-minute trigger', () => {
    expect(workflow).toContain('issues:');
    expect(workflow).toContain('types: [opened]');
    expect(workflow).toContain("cron: '5,15,25,35,45,55 * * * *'");
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain("github.event_name != 'issues'");
    expect(workflow).toContain('github.event.issue.user.login == github.repository_owner');
    expect(workflow).toContain(
      "startsWith(github.event.issue.title, 'PRODUCTION AUTHORIZATION — Instagram DIRECT canary opportunity watch READONLY AUTO')",
    );
  });

  it('uses only the GitHub control plane and has no provider/database credentials', () => {
    for (const required of [
      'actions: write',
      'issues: read',
      'contents: read',
      'GH_TOKEN: ${{ github.token }}',
    ]) {
      expect(workflow).toContain(required);
    }
    for (const forbidden of [
      'id-token: write',
      'google-github-actions/auth',
      'google-github-actions/setup-gcloud',
      'gcloud ',
      'DATABASE_URL',
      'META_ACCESS_TOKEN',
      'INSTAGRAM_ACCESS_TOKEN',
      'graph.facebook.com',
      'TOCA_SECRET_META_ACCESS_TOKEN',
    ]) {
      expect(workflow).not.toContain(forbidden);
    }
  });

  it('fails closed unless exactly one owner-authored current-main read-only Direct watch exists', () => {
    expect(workflow).toContain('test "$CURRENT_MAIN_SHA" = "$GITHUB_SHA"');
    expect(workflow).toContain('select(.user.login == $owner)');
    expect(workflow).toContain('if [[ "$COUNT" != \'1\' ]]');
    expect(workflow).toContain('test "$EVENT_ISSUE_NUMBER" = "$ISSUE_NUMBER"');
    expect(workflow).toContain('test "$RUNTIME_SHA" = "$CURRENT_MAIN_SHA"');
    expect(workflow).toContain('[[ "$RUNTIME_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]');
    for (const marker of [
      'AUTHORIZATION_STATE=ACTIVE',
      'INSTAGRAM_ENGAGEMENT_DIRECT_CANARY_OPPORTUNITY_WATCH=AUTHORIZED',
      'WATCH_MODE=READ_ONLY',
      'WATCH_INTERVAL_MINUTES=10',
      'WATCH_MAX_LIFETIME_HOURS=12',
      'CANARY_CHANNEL=DIRECT',
      'MAX_AGE_MINUTES=30',
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
  });

  it('dispatches only the canonical read-only Direct watcher on main', () => {
    expect(workflow).toContain(
      'actions/workflows/instagram-engagement-direct-canary-opportunity-watch.yml/dispatches',
    );
    expect(workflow).toContain('-f ref=main');
    expect(workflow).toContain(
      'TARGET_WORKFLOW=instagram-engagement-direct-canary-opportunity-watch.yml',
    );
    expect(workflow).toContain('TARGET_REF=main');
    expect(workflow).not.toContain('provider-canary.yml/dispatches');
    expect(workflow).not.toContain('INSTAGRAM_ENGAGEMENT_REAL_DIRECT_CANARY=AUTHORIZED');
    expect(workflow).not.toContain('EXTERNAL_DIRECT_REPLY_AUTHORIZED=true');
  });

  it('does not mutate provider, database, service or watch state itself', () => {
    expect(workflow).toContain('PROVIDER_CALLS=false');
    expect(workflow).toContain('DATABASE_MUTATIONS=false');
    expect(workflow).toContain('SERVICE_MUTATIONS=false');
    expect(workflow).toContain('EXTERNAL_REPLY_WRITES=false');
    expect(workflow).not.toContain('gh issue create');
    expect(workflow).not.toContain('gh issue comment');
    expect(workflow).not.toContain('gcloud run jobs deploy');
    expect(workflow).not.toContain('gcloud run services');
  });
});
