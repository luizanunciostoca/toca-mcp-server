import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-direct-canary-opportunity-watch.yml',
  'utf8',
);

describe('Instagram Direct canary opportunity watch', () => {
  it('is a bounded read-only watch with no reply authority', () => {
    expect(workflow).toContain("cron: '*/10 * * * *'");
    expect(workflow).toContain(
      'PRODUCTION AUTHORIZATION — Instagram DIRECT canary opportunity watch READONLY AUTO',
    );
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_DIRECT_CANARY_OPPORTUNITY_WATCH=AUTHORIZED');
    expect(workflow).toContain('WATCH_MODE=READ_ONLY');
    expect(workflow).toContain('WATCH_INTERVAL_MINUTES=10');
    expect(workflow).toContain('WATCH_MAX_LIFETIME_HOURS=12');
    expect(workflow).toContain('AUTO_REAL_CANARY_AUTHORIZED=false');
    expect(workflow).toContain('DATABASE_MUTATIONS_AUTHORIZED=false');
    expect(workflow).toContain('PROVIDER_CALLS_AUTHORIZED=false');
    expect(workflow).toContain('EXTERNAL_REPLY_WRITES_AUTHORIZED=false');
  });

  it('requires exactly one owner-authored current-main authorization and immutable image', () => {
    expect(workflow).toContain('test "$GITHUB_REF" = \'refs/heads/main\'');
    expect(workflow).toContain('select(.user.login == $owner)');
    expect(workflow).toContain('if [[ "$COUNT" != \'1\' ]]');
    expect(workflow).toContain('test "$CURRENT_MAIN_SHA" = "$GITHUB_SHA"');
    expect(workflow).toContain('if [[ "$RUNTIME_SHA" != "$GITHUB_SHA" ]]');
    expect(workflow).toContain('^sha256:[0-9a-f]{64}$');
    expect(workflow).toContain('gcloud artifacts docker images describe');
  });

  it('uses the existing Direct eligibility controller without provider credentials or writes', () => {
    expect(workflow).toContain(
      '--command node --args dist/src/ops/instagram-engagement-canary-eligibility-readonly.js',
    );
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_CANARY_MAX_AGE_MINUTES=30');
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_TRACE_MAX_AGE_MINUTES=120');
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false');
    expect(workflow).toContain('--max-retries 0');
    expect(workflow).toContain('for attempt in 1 2; do');
    expect(workflow).not.toContain('META_ACCESS_TOKEN');
    expect(workflow).not.toContain('INSTAGRAM_ACCESS_TOKEN');
  });

  it('polls sanitized evidence boundedly and fails closed on malformed or ambiguous state', () => {
    expect(workflow).toContain('for attempt in 1 2 3 4 5 6; do');
    expect(workflow).toContain('--order=desc');
    expect(workflow).toContain("LOGS='[]'");
    expect(workflow).toContain('read_single_marker() {');
    expect(workflow).toContain('test "$count" = \'1\'');
    expect(workflow).toContain('read_exact_marker READ_ONLY_ELIGIBILITY true');
    expect(workflow).toContain('read_exact_marker DATABASE_MUTATIONS false');
    expect(workflow).toContain('read_exact_marker PROVIDER_CALLS false');
    expect(workflow).toContain('read_exact_marker RAW_USER_DATA_LOGGED false');
    expect(workflow).toContain('MULTIPLE_ELIGIBLE_TARGETS');
  });

  it('keeps no-target watches active and only creates a sanitized opportunity for one target', () => {
    expect(workflow).toContain(
      'if [[ "$STATUS" = \'BLOCKED_LOG_PROPAGATION\' || "$STATUS" = \'NO_ELIGIBLE_TARGET\' ]]',
    );
    expect(workflow).toContain('WATCH_REMAINS_ACTIVE=true');
    expect(workflow).toContain('DIRECT_CANARY_OPPORTUNITY_STATUS=READY');
    expect(workflow).toContain('ELIGIBLE_TARGET_SHA256=$TARGET_SHA');
    expect(workflow).toContain('REAL_DIRECT_CANARY_AUTHORIZED=false');
    expect(workflow).toContain('PERSISTENT_DIRECT_PROMOTION_AUTHORIZED=false');
    expect(workflow).toContain('gh issue create');
    expect(workflow).not.toContain('EXTERNAL_DIRECT_REPLY_AUTHORIZED=true');
    expect(workflow).not.toContain('gcloud run services ');
    expect(workflow).not.toContain('gcloud scheduler ');
  });

  it('consumes stale, expired, ready, duplicate, or failed watches fail-closed', () => {
    expect(workflow).toContain("close_watch 'STALE_MAIN'");
    expect(workflow).toContain("close_watch 'EXPIRED'");
    expect(workflow).toContain("close_watch 'READY_FOUND'");
    expect(workflow).toContain("close_watch 'BLOCKED_DUPLICATE_OPPORTUNITY'");
    expect(workflow).toContain(
      'DIRECT_CANARY_OPPORTUNITY_WATCH_STATUS=PROBE_OR_CONTROLLER_FAILURE',
    );
    expect(workflow).toContain('AUTHORIZATION_STATE=CONSUMED_AND_CLOSED');
    expect(workflow).toContain('-f state=closed -f state_reason=completed');
  });
});
