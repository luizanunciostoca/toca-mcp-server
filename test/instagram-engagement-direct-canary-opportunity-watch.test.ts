import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-direct-canary-opportunity-watch.yml',
  'utf8',
);
const controller = readFileSync(
  'src/ops/instagram-engagement-canary-eligibility-readonly.ts',
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

  it('enforces unique single-use authorization markers and dynamic fields', () => {
    expect(workflow).toContain('require_unique_exact() {');
    expect(workflow).toContain('count="$(grep -Fxc "$expected" <<< "$BODY" || true)"');
    expect(workflow).toContain('read_unique_field() {');
    expect(workflow).toContain('Expected exactly one authorization field');
    expect(workflow).toContain('AUTHORIZATION_STATE=CONSUMED_AND_CLOSED');
    expect(workflow).toContain('Consumed authorization state cannot coexist with ACTIVE');
    expect(workflow).toContain('RUNTIME_SHA="$(read_unique_field RUNTIME_SOURCE_SHA)"');
    expect(workflow).toContain('RUNTIME_DIGEST="$(read_unique_field RUNTIME_IMAGE_DIGEST)"');
    expect(workflow).toContain('WATCH_EXPIRES_AT="$(read_unique_field WATCH_EXPIRES_AT)"');
  });

  it('fails closed on malformed expiry and requires the live control-plane gate', () => {
    expect(workflow).toContain('if ! CREATED_EPOCH="$(date -u -d "$CREATED_AT" +%s 2>/dev/null)"');
    expect(workflow).toContain(
      'if ! EXPIRES_EPOCH="$(date -u -d "$WATCH_EXPIRES_AT" +%s 2>/dev/null)"',
    );
    expect(workflow).toContain("close_watch 'INVALID_EXPIRY'");
    expect(workflow).toContain('repos/${GITHUB_REPOSITORY}/issues/640');
    expect(workflow).toContain("grep -Fxc 'MAIN_STABILITY=PASS'");
    expect(workflow).toContain('EVALUATED_MAIN_SHA=$GITHUB_SHA');
    expect(workflow).toContain("grep -Fxc 'MERGE_RESERVATION=NONE'");
    expect(workflow).toContain('DIRECT_CANARY_OPPORTUNITY_WATCH=BLOCKED_CONTROL_PLANE');
  });

  it('uses the existing Direct controller without provider credentials or writes', () => {
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

  it('records temporary job names before deploy so cleanup covers partial deploys', () => {
    const pushIndex = workflow.indexOf('DEPLOYED_JOBS+=("$JOB")');
    const deployIndex = workflow.indexOf('if ! gcloud run jobs deploy "$JOB"');
    expect(pushIndex).toBeGreaterThan(-1);
    expect(deployIndex).toBeGreaterThan(pushIndex);
    expect(workflow).toContain('gcloud run jobs delete "$job"');
  });

  it('treats malformed or duplicate log evidence as terminal ambiguity', () => {
    expect(workflow).toContain('BLOCKED_MALFORMED_LOG_EVIDENCE');
    expect(workflow).toContain("jq -e 'type == \"array\"'");
    expect(workflow).toContain('if (( count > 1 )); then');
    expect(workflow).toContain('status=BLOCKED_AMBIGUOUS_EVIDENCE');
    expect(workflow).toContain("target_count=\"$(grep -c '^ELIGIBLE_TARGET_SHA256='");
    expect(workflow).toContain('AMBIGUOUS_MARKER=ELIGIBLE_TARGET_SHA256');
    expect(workflow).toContain('read_single_marker() {');
  });

  it('makes the bounded candidate query explicit and blocks saturated READY evidence', () => {
    expect(controller).toContain('const CANDIDATE_QUERY_LIMIT = 100;');
    expect(controller).toContain('limit $6`');
    expect(controller).toContain('CANDIDATE_QUERY_LIMIT=${CANDIDATE_QUERY_LIMIT}');
    expect(controller).toContain('CANDIDATE_QUERY_SATURATED=${candidateQuerySaturated}');
    expect(workflow).toContain('CANDIDATE_QUERY_LIMIT CANDIDATE_QUERY_SATURATED');
    expect(workflow).toContain('BLOCKED_CANDIDATE_QUERY_SATURATED');
    expect(workflow).toContain("[[ \"$QUERY_SATURATED\" =~ ^(true|false)$ ]]");
  });

  it('revalidates authorization, expiry, main and control plane before READY creation', () => {
    expect(workflow).toContain('revalidate_watch() {');
    expect(workflow.match(/if ! revalidate_watch; then/g)?.length).toBe(2);
    expect(workflow).toContain('BLOCKED_REVALIDATION');
    expect(workflow).toContain('runtime_digest="$(grep \'^RUNTIME_IMAGE_DIGEST=\'');
    expect(workflow).toContain('(( now_epoch < expires_epoch ))');
    expect(workflow).toContain('[[ "$current_main" = "$GITHUB_SHA" ]]');
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

  it('consumes stale, expired, ambiguous, saturated, duplicate, or failed watches', () => {
    expect(workflow).toContain("close_watch 'STALE_MAIN'");
    expect(workflow).toContain("close_watch 'EXPIRED'");
    expect(workflow).toContain("close_watch 'READY_FOUND'");
    expect(workflow).toContain("close_watch 'BLOCKED_DUPLICATE_OPPORTUNITY'");
    expect(workflow).toContain('close_watch "BLOCKED_${STATUS}"');
    expect(workflow).toContain(
      'DIRECT_CANARY_OPPORTUNITY_WATCH_STATUS=PROBE_OR_CONTROLLER_FAILURE',
    );
    expect(workflow).toContain('-f state=closed -f state_reason=completed');
  });
});
