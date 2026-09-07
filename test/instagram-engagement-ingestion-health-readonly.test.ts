import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/ops/instagram-engagement-ingestion-health-readonly.ts', 'utf8');
const workflow = readFileSync(
  '.github/workflows/instagram-engagement-ingestion-health-readonly.yml',
  'utf8',
);

describe('Instagram engagement ingestion health read-only diagnostic', () => {
  it('keeps provider inspection GET-only and uses the canonical Facebook Login Page-bound model', () => {
    expect(source).toContain("fetch(url, { method: 'GET' })");
    expect(source).toContain("fetch(challengeUrl, { method: 'GET' })");
    expect(source).not.toContain("method: 'POST'");
    expect(source).not.toContain("method: 'PUT'");
    expect(source).not.toContain("method: 'PATCH'");
    expect(source).not.toContain("method: 'DELETE'");
    expect(source).toContain('${graphBaseUrl}/${apiVersion}/${appId}/subscriptions');
    expect(source).toContain('${graphBaseUrl}/${apiVersion}/${pageId}/subscribed_apps');
    expect(source).toContain("safeScalarString(entry.object) === 'instagram'");
    expect(source).toContain("appFields.has('comments')");
    expect(source).toContain("appFields.has('messages')");
    expect(source).toContain("pageFields.has('messages')");
    expect(source).toContain('SUBSCRIPTION_MODEL=FACEBOOK_LOGIN_PAGE_BOUND');
    expect(source).toContain('PROVIDER_METHODS=GET_ONLY');
    expect(source).toContain('PROVIDER_WRITES=false');
  });

  it('uses SELECT-only database health signals without exposing inbound payloads', () => {
    expect(source).toContain('from event_outbox inbound');
    expect(source).toContain('inbound.event_type = $1');
    expect(source).toContain("inbound.payload->>'channel' = 'COMMENT'");
    expect(source).toContain("inbound.payload->>'accountId' = $2");
    expect(source).toContain('RECENT_COMMENT_COUNT_30M=');
    expect(source).toContain('RECENT_COMMENT_COUNT_6H=');
    expect(source).toContain('RECENT_COMMENT_COUNT_24H=');
    expect(source).toContain('VALID_COMMENT_COUNT_24H=');
    expect(source).toContain('LATEST_COMMENT_AGE_MINUTES=');
    expect(source).not.toMatch(
      /\b(insert|update|delete|truncate)\s+(into\s+|from\s+)?event_outbox\b/i,
    );
    expect(source).not.toContain('console.log(payload');
    expect(source).not.toContain('console.log(inbound');
    expect(source).toContain('DATABASE_MUTATIONS=false');
    expect(source).toContain('RAW_USER_DATA_LOGGED=false');
    expect(source).toContain('SECRETS_PRINTED=false');
  });

  it('requires live single-use authorization, exact main/runtime provenance and PRO+ stability', () => {
    for (const marker of [
      'INSTAGRAM_ENGAGEMENT_INGESTION_HEALTH_READONLY=AUTHORIZED',
      'READ_ONLY_HEALTH=true',
      'TEMPORARY_DIAGNOSTIC_JOB_AUTHORIZED=true',
      'PROVIDER_READS_AUTHORIZED=true',
      'PROVIDER_WRITES_AUTHORIZED=false',
      'DATABASE_MUTATIONS_AUTHORIZED=false',
      'PERSISTENT_SERVICE_MUTATIONS_AUTHORIZED=false',
      'EXTERNAL_REPLY_WRITES_AUTHORIZED=false',
      'RAW_USER_DATA_LOGGED=false',
      'MAIN_STABILITY=PASS',
      'MERGE_RESERVATION=NONE',
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
    expect(workflow).toContain('^EVALUATED_MAIN_SHA=${GITHUB_SHA}$');
  });

  it('uses only a bounded temporary Cloud Run job and never mutates serving services or schedulers', () => {
    expect(workflow).toContain('gcloud run jobs deploy "$JOB"');
    expect(workflow).toContain('--tasks 1 --max-retries 0 --task-timeout 120s');
    expect(workflow).toContain('gcloud run jobs delete "$JOB"');
    expect(workflow).toContain('gcloud run services describe "$WEBHOOK_SERVICE_NAME"');
    for (const forbidden of [
      'gcloud run services update ',
      'gcloud run services update-traffic',
      'gcloud scheduler jobs pause',
      'gcloud scheduler jobs resume',
      'gcloud scheduler jobs update',
      'gcloud scheduler jobs run',
    ]) {
      expect(workflow).not.toContain(forbidden);
    }
  });

  it('publishes only an allowlisted sanitized result and consumes the authorization', () => {
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_INGESTION_HEALTH_READONLY_STATUS=PASS');
    expect(workflow).toContain('HEALTH=${STATUS}');
    expect(workflow).toContain('PROVIDER_METHODS=GET_ONLY');
    expect(workflow).toContain('RAW_USER_DATA_LOGGED=false');
    expect(workflow).toContain('SECRETS_PRINTED=false');
    expect(workflow).toContain('AUTHORIZATION_STATE=CONSUMED_AND_CLOSED');
    expect(workflow).not.toContain('ELIGIBLE_TARGET_SHA256=');
    expect(workflow).not.toContain('AUTO_REAL_CANARY_AUTHORIZED=true');
  });
});
