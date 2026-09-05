import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-comment-canary-opportunity-watch.yml',
  'utf8',
);

describe('Instagram Comment canary opportunity watch', () => {
  it('is a bounded read-only condition watch instead of reply authority', () => {
    expect(workflow).toContain("cron: '*/10 * * * *'");
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain(
      'PRODUCTION AUTHORIZATION — Instagram COMMENT canary opportunity watch READONLY AUTO',
    );
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_COMMENT_CANARY_OPPORTUNITY_WATCH=AUTHORIZED');
    expect(workflow).toContain('WATCH_MODE=READ_ONLY');
    expect(workflow).toContain('WATCH_INTERVAL_MINUTES=10');
    expect(workflow).toContain('WATCH_MAX_LIFETIME_HOURS=12');
    expect(workflow).toContain('WATCH_EXPIRES_AT=');
    expect(workflow).toContain('AUTO_REAL_CANARY_AUTHORIZED=false');
    expect(workflow).toContain('PERSISTENT_SERVICE_MUTATIONS_AUTHORIZED=false');
    expect(workflow).toContain('DATABASE_MUTATIONS_AUTHORIZED=false');
    expect(workflow).toContain('PROVIDER_CALLS_AUTHORIZED=false');
    expect(workflow).toContain('EXTERNAL_REPLY_WRITES_AUTHORIZED=false');
  });

  it('requires exactly one owner-authored current-main authorization and exact immutable image', () => {
    expect(workflow).toContain('test "$GITHUB_REF" = \'refs/heads/main\'');
    expect(workflow).toContain('select(.user.login == $owner)');
    expect(workflow).toContain('if [[ "$COUNT" != \'1\' ]]');
    expect(workflow).toContain('test "$CURRENT_MAIN_SHA" = "$GITHUB_SHA"');
    expect(workflow).toContain('if [[ "$RUNTIME_SHA" != "$GITHUB_SHA" ]]');
    expect(workflow).toContain('^sha256:[0-9a-f]{64}$');
    expect(workflow).toContain('gcloud artifacts docker images describe');
    expect(workflow).toContain(
      'RUNTIME_DIGEST: ${{ needs.authorization-preflight.outputs.runtime_digest }}',
    );
    expect(workflow).toContain('GH_TOKEN: ${{ github.token }}');
  });

  it('reuses the Comment-specific read-only probe with no blind retries', () => {
    expect(workflow).toContain(
      '--command node --args dist/src/ops/instagram-engagement-comment-canary-eligibility-readonly.js',
    );
    expect(workflow).toContain('--max-retries 0');
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_COMMENT_CANARY_MAX_AGE_MINUTES=30');
    expect(workflow).toContain("grep -E '^(INSTAGRAM_ENGAGEMENT_COMMENT_CANARY_ELIGIBILITY");
    expect(workflow).toContain('RAW_USER_DATA_LOGGED');
    expect(workflow).toContain('if [[ "$STATUS" = \'READY\' ]]');
    expect(workflow).toContain('test "$ELIGIBLE_COUNT" = \'1\'');
    expect(workflow).toContain('test "$AMBIGUITY_COUNT" = \'0\'');
    expect(workflow).toContain('test "$RESERVATION_COUNT" = \'0\'');
  });

  it('fails closed unless probe safety attestations are unique and exact', () => {
    expect(workflow).toContain('read_single_marker() {');
    expect(workflow).toContain('test "$count" = \'1\'');
    expect(workflow).toContain('read_exact_marker CANARY_CHANNEL COMMENT');
    expect(workflow).toContain('read_exact_marker READ_ONLY_ELIGIBILITY true');
    expect(workflow).toContain('read_exact_marker DATABASE_MUTATIONS false');
    expect(workflow).toContain('read_exact_marker PROVIDER_CALLS false');
    expect(workflow).toContain('read_exact_marker EXTERNAL_REPLY_WRITES false');
    expect(workflow).toContain('read_exact_marker RAW_USER_DATA_LOGGED false');
    expect(workflow).toContain(
      'STATUS="$(read_single_marker INSTAGRAM_ENGAGEMENT_COMMENT_CANARY_ELIGIBILITY)"',
    );
    expect(workflow).toContain('TARGET_SHA="$(read_single_marker ELIGIBLE_TARGET_SHA256)"');
  });

  it('polls Cloud Logging boundedly and treats transient reads as retryable evidence gaps', () => {
    expect(workflow).toContain('for attempt in 1 2 3 4 5 6; do');
    expect(workflow).toContain('sleep 10');
    expect(workflow).toContain('--order=desc');
    expect(workflow).not.toContain('--order=asc');
    expect(workflow).toContain('if ! LOGS="$(gcloud logging read');
    expect(workflow).toContain("LOGS='[]'");
    expect(workflow).toContain('MARKERS_COMPLETE=false');
    expect(workflow).toContain('if [[ "$count" != \'1\' ]]');
    expect(workflow).toContain('COMMENT_CANARY_OPPORTUNITY_WATCH=BLOCKED_LOG_PROPAGATION');
    expect(workflow).toContain('echo \'status=BLOCKED_LOG_PROPAGATION\' >> "$GITHUB_OUTPUT"');
    expect(workflow).toContain('COMMENT_CANARY_OPPORTUNITY_WATCH_RESULT=BLOCKED_LOG_PROPAGATION');
    expect(workflow).toContain('WATCH_REMAINS_ACTIVE=true');
    expect(workflow).toContain('test "$TARGET_SHA" = \'NONE\'');
  });

  it('creates only a sanitized opportunity and never dispatches or performs a real canary', () => {
    expect(workflow).toContain('COMMENT_CANARY_OPPORTUNITY_STATUS=READY');
    expect(workflow).toContain('ELIGIBLE_TARGET_SHA256=$TARGET_SHA');
    expect(workflow).toContain('REAL_COMMENT_CANARY_AUTHORIZED=false');
    expect(workflow).toContain('PERSISTENT_COMMENT_PROMOTION_AUTHORIZED=false');
    expect(workflow).toContain('RAW_USER_DATA_LOGGED=false');
    expect(workflow).toContain('gh issue create');
    expect(workflow).not.toContain('INSTAGRAM_ENGAGEMENT_REAL_COMMENT_CANARY=AUTHORIZED');
    expect(workflow).not.toContain('EXTERNAL_COMMENT_REPLY_AUTHORIZED=true');
    expect(workflow).not.toContain(
      'actions/workflows/instagram-engagement-comment-provider-canary.yml/dispatches',
    );
    expect(workflow).not.toContain('gcloud run services ');
    expect(workflow).not.toContain('gcloud scheduler ');
  });

  it('keeps no-target watches active but consumes terminal, stale, expired, or failed watches', () => {
    expect(workflow).toContain('if [[ "$STATUS" = \'NO_ELIGIBLE_TARGET\' ]]');
    expect(workflow).toContain('WATCH_REMAINS_ACTIVE=true');
    expect(workflow).toContain("close_watch 'STALE_MAIN'");
    expect(workflow).toContain("close_watch 'EXPIRED'");
    expect(workflow).toContain("close_watch 'READY_FOUND'");
    expect(workflow).toContain('close_watch "BLOCKED_${STATUS}"');
    expect(workflow).toContain(
      'COMMENT_CANARY_OPPORTUNITY_WATCH_STATUS=PROBE_OR_CONTROLLER_FAILURE',
    );
    expect(workflow).toContain('AUTHORIZATION_STATE=CONSUMED_AND_CLOSED');
    expect(workflow).toContain('-f state=closed -f state_reason=completed');
  });

  it('limits side effects to temporary diagnostic jobs and sanitized GitHub governance', () => {
    expect(workflow).toContain('gcloud run jobs deploy "$JOB"');
    expect(workflow).toContain('gcloud run jobs delete "$JOB"');
    expect(workflow).toContain('PROVIDER_CALLS=false');
    expect(workflow).toContain('EXTERNAL_REPLY_WRITES=false');
    expect(workflow).toContain('AUTO_REAL_CANARY_AUTHORIZED=false');
    expect(workflow).not.toContain('META_ACCESS_TOKEN');
    expect(workflow).not.toContain('INSTAGRAM_ACCESS_TOKEN');
  });
});
