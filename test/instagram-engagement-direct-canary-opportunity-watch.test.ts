import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-direct-canary-opportunity-watch.yml',
  'utf8',
);
const eligibilityProbe = readFileSync(
  'src/ops/instagram-engagement-canary-eligibility-readonly.ts',
  'utf8',
);

describe('Instagram Direct canary opportunity watch', () => {
  it('is bounded and read-only', () => {
    expect(workflow).toContain("cron: '*/10 * * * *'");
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain(
      'PRODUCTION AUTHORIZATION — Instagram DIRECT canary opportunity watch READONLY AUTO',
    );
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_DIRECT_CANARY_OPPORTUNITY_WATCH=AUTHORIZED');
    expect(workflow).toContain('WATCH_MODE=READ_ONLY');
    expect(workflow).toContain('WATCH_INTERVAL_MINUTES=10');
    expect(workflow).toContain('WATCH_MAX_LIFETIME_HOURS=12');
    expect(workflow).toContain('CANARY_CHANNEL=DIRECT');
    expect(workflow).toContain('AUTO_REAL_CANARY_AUTHORIZED=false');
    expect(workflow).toContain('DATABASE_MUTATIONS_AUTHORIZED=false');
    expect(workflow).toContain('PROVIDER_CALLS_AUTHORIZED=false');
    expect(workflow).toContain('EXTERNAL_REPLY_WRITES_AUTHORIZED=false');
  });

  it('requires stable current main and exact immutable runtime', () => {
    expect(workflow).toContain('git rev-parse HEAD');
    expect(workflow).toContain('select(.user.login == $owner)');
    expect(workflow).toContain('CURRENT_MAIN_SHA=');
    expect(workflow).toContain('MAIN_STABILITY=PASS');
    expect(workflow).toContain('EVALUATED_MAIN_SHA=$GITHUB_SHA');
    expect(workflow).toContain('MERGE_RESERVATION=NONE');
    expect(workflow).toContain('STALE_MAIN');
    expect(workflow).toContain('^sha256:[0-9a-f]{64}$');
    expect(workflow).toContain('gcloud artifacts docker images describe');
  });

  it('fails closed when bounded expiry metadata is malformed', () => {
    expect(workflow).toContain('CREATED_EPOCH=');
    expect(workflow).toContain('EXPIRES_EPOCH=');
    expect(workflow).toContain('INVALID_EXPIRY');
    expect(workflow).toContain('INVALID_EXPIRY_WINDOW');
  });

  it('revalidates governance immediately before the diagnostic probe', () => {
    expect(workflow).toContain('Run bounded read-only Direct opportunity probe');
    expect(workflow).toContain('issues/640');
    expect(workflow).toContain('branches/main');
  });

  it('makes a capped Direct eligibility scan explicit and fail closed on truncation', () => {
    expect(eligibilityProbe).toContain('const CANDIDATE_SCAN_LIMIT = 100;');
    expect(eligibilityProbe).toContain('CANDIDATE_SCAN_LIMIT + 1');
    expect(eligibilityProbe).toContain('candidateScanComplete');
    expect(eligibilityProbe).toContain('SCAN_TRUNCATED');
    expect(eligibilityProbe).toContain('CANDIDATE_SCAN_COMPLETE=');
    expect(workflow).toContain('CANDIDATE_SCAN_COMPLETE');
    expect(workflow).toContain('SCAN_TRUNCATED');
  });

  it('reuses the Direct eligibility probe with writes disabled', () => {
    expect(workflow).toContain('instagram-engagement-canary-eligibility-readonly.js');
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false');
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_CANARY_MAX_AGE_MINUTES=30');
    expect(workflow).toContain('--max-retries 0');
    expect(workflow).toContain('READ_ONLY_ELIGIBILITY true');
    expect(workflow).toContain('DATABASE_MUTATIONS false');
    expect(workflow).toContain('PROVIDER_CALLS false');
    expect(workflow).toContain('RAW_USER_DATA_LOGGED false');
  });

  it('confirms temporary diagnostic job deletion', () => {
    expect(workflow).toContain('for attempt in 1 2 3; do');
    expect(workflow).toContain('gcloud run jobs list');
    expect(workflow).toContain('deleted=true');
  });

  it('revalidates authorization before creating an opportunity', () => {
    expect(workflow).toContain('WATCH_JSON=');
    expect(workflow).toContain('CURRENT_TITLE=');
    expect(workflow).toContain('current_required=(');
    expect(workflow).toContain('WATCH_EXPIRES_AT=$WATCH_EXPIRES_AT');
    expect(workflow).toContain('NOW_EPOCH < EXPIRES_EPOCH');
  });

  it('creates only sanitized governance and never a real canary', () => {
    expect(workflow).toContain('DIRECT_CANARY_OPPORTUNITY_STATUS=READY');
    expect(workflow).toContain('ELIGIBLE_TARGET_SHA256=$TARGET_SHA');
    expect(workflow).toContain('REAL_DIRECT_CANARY_AUTHORIZED=false');
    expect(workflow).toContain('PERSISTENT_DIRECT_PROMOTION_AUTHORIZED=false');
    expect(workflow).toContain('gh issue create');
    expect(workflow).not.toContain('EXTERNAL_DIRECT_REPLY_AUTHORIZED=true');
    expect(workflow).not.toContain('META_ACCESS_TOKEN');
    expect(workflow).not.toContain('INSTAGRAM_ACCESS_TOKEN');
    expect(workflow).not.toContain('gcloud run services ');
    expect(workflow).not.toContain('gcloud scheduler ');
  });

  it('keeps no-target watches active but consumes terminal states', () => {
    expect(workflow).toContain('NO_ELIGIBLE_TARGET');
    expect(workflow).toContain('WATCH_REMAINS_ACTIVE=true');
    expect(workflow).toContain('EXPIRED');
    expect(workflow).toContain('READY_FOUND');
    expect(workflow).toContain('AUTHORIZATION_STATE=CONSUMED_AND_CLOSED');
  });

  it('consumes an active watch after probe or controller failure', () => {
    expect(workflow).toContain('Consume active Direct watch on controller failure');
    expect(workflow).toContain('PROBE_OR_CONTROLLER_FAILURE');
    expect(workflow).toContain('state_reason=completed');
  });

  it('polls only sanitized markers', () => {
    expect(workflow).toContain('for attempt in 1 2 3 4 5 6; do');
    expect(workflow).toContain('--order=desc');
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_CANARY_ELIGIBILITY');
    expect(workflow).toContain('EXTERNAL_REPLY_WRITES=false');
  });
});
