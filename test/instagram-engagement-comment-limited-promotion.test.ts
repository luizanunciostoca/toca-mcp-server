import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-comment-limited-promotion.yml',
  'utf8',
);

describe('Instagram Comment LIMITED promotion controller', () => {
  it('is owner-only, exact-controller and separately authorized', () => {
    for (const marker of [
      "github.ref == 'refs/heads/main'",
      'github.event.issue.user.login == github.repository_owner',
      'AUTHORIZED_CONTROLLER_SHA=$GITHUB_SHA',
      'INSTAGRAM_ENGAGEMENT_COMMENT_LIMITED_PROMOTION=AUTHORIZED',
      'PERSISTENT_COMMENT_PROMOTION_AUTHORIZED=true',
      'AUTO_REPLY_CHANNELS=DIRECT,COMMENT',
      'AUTONOMY_STAGE=LIMITED',
      'GENERAL_AUTONOMY_PROMOTION_AUTHORIZED=false',
      'BATCH_SIZE=1',
    ]) {
      expect(workflow).toContain(marker);
    }
  });

  it('requires immutable evidence from a successful real Comment canary', () => {
    for (const marker of [
      'CANARY_AUTHORIZATION_ISSUE=',
      'CANARY_RUN_ID=',
      'AUTHORIZATION_STATE=CONSUMED_AND_CLOSED',
      'INSTAGRAM_ENGAGEMENT_REAL_COMMENT_CANARY=AUTHORIZED',
      'CANARY_MAX_EXTERNAL_REPLIES=1',
      'PERSISTENT_COMMENT_PROMOTION_AUTHORIZED=false',
      '.github/workflows/instagram-engagement-comment-provider-canary.yml',
      '.conclusion == "success"',
      'COMMENT_CANARY_STATUS=PASS',
      'CANARY_SENT_COUNT=1',
      'PROVIDER_ACKNOWLEDGED=true',
      'CONVERSATION_RECEIPT=PASS',
      'DIRECT_LIMITED_RUNTIME_ACTIVE=true',
      'GENERAL_AUTONOMY_PROMOTED=false',
    ]) {
      expect(workflow).toContain(marker);
    }
  });

  it('fails closed on any post-canary runtime drift', () => {
    for (const marker of [
      'compare/${RUNTIME_SHA}...${GITHUB_SHA}',
      '.status == "ahead"',
      '.base_commit.sha == $runtime',
      '.merge_base_commit.sha == $runtime',
      '(.ahead_by >= 1)',
      '.github/workflows/instagram-engagement-comment-limited-promotion.yml',
      'test/instagram-engagement-comment-limited-promotion.test.ts',
      'COMMENT_PROMOTION_RUNTIME_DRIFT_GATE=PASS',
    ]) {
      expect(workflow).toContain(marker);
    }
  });

  it('requires a healthy Direct-only LIMITED prestate', () => {
    for (const marker of [
      'DIRECT_LIMITED_PROMOTION_PRESTATE=PASS',
      'INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED',
      'INSTAGRAM_ENGAGEMENT_WRITES_ENABLED',
      'INSTAGRAM_ENGAGEMENT_BATCH_SIZE',
      'INSTAGRAM_ENGAGEMENT_AUTO_REPLY_CHANNELS',
      '== "DIRECT"',
      'INSTAGRAM_PUBLICATION_WRITES_ENABLED',
    ]) {
      expect(workflow).toContain(marker);
    }
  });

  it('proves dual-channel readiness without executing a provider reply', () => {
    expect(workflow).toContain('Prove dual-channel readiness without sending');
    expect(workflow).toContain('dist/src/instagram-engagement-readiness-preflight.js');
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_AUTO_REPLY_CHANNELS=DIRECT,COMMENT');
    expect(workflow).not.toContain('scripts/instagram-engagement-comment-provider-canary.mjs');
    expect(workflow).not.toContain('replyToComment');
    expect(workflow).not.toContain('/replies');
  });

  it('stages zero traffic before explicit cutover and verifies exact channel scope', () => {
    const stage = workflow.indexOf('--no-traffic --quiet');
    const zeroTraffic = workflow.indexOf('COMMENT_LIMITED_ZERO_TRAFFIC_STAGE=PASS');
    const cutover = workflow.indexOf('gcloud run services update-traffic');
    expect(stage).toBeGreaterThan(-1);
    expect(zeroTraffic).toBeGreaterThan(stage);
    expect(cutover).toBeGreaterThan(zeroTraffic);
    expect(workflow).toContain('== "DIRECT,COMMENT"');
    expect(workflow).toContain('COMMENT_LIMITED_RUNTIME_READBACK=PASS');
  });

  it('never mutates the scheduler or runs database migrations', () => {
    expect(workflow).toContain('SCHEDULER_MUTATION_AUTHORIZED=false');
    expect(workflow).toContain('DATABASE_MIGRATIONS_AUTHORIZED=false');
    expect(workflow).toContain('gcloud scheduler jobs describe');
    for (const forbidden of [
      'gcloud scheduler jobs pause',
      'gcloud scheduler jobs resume',
      'gcloud scheduler jobs update',
      'gcloud scheduler jobs delete',
      'gcloud scheduler jobs create',
      'dist/scripts/migrate-and-verify.js',
    ]) {
      expect(workflow).not.toContain(forbidden);
    }
  });

  it('rolls traffic back fail-closed and consumes one-shot authorization', () => {
    expect(workflow).toContain('Roll back traffic to previous Direct LIMITED revision on failure');
    expect(workflow).toContain('--to-revisions="${PRE_REVISION}=100"');
    expect(workflow).toContain('ROLLBACK_ON_FAILURE=true');
    expect(workflow).toContain('AUTHORIZATION_STATE=CONSUMED_AND_CLOSED');
    expect(workflow).toContain('-f state=closed -f state_reason=completed');
  });

  it('publishes a bounded LIMITED promotion receipt and keeps GENERAL disabled', () => {
    for (const marker of [
      'COMMENT_LIMITED_PROMOTION_STATUS=PASS',
      'AUTO_REPLY_CHANNELS=DIRECT,COMMENT',
      'PERSISTENT_WRITES_ENABLED=true',
      'COMMENT_AUTO_REPLY_ENABLED=true',
      'BATCH_SIZE=1',
      'TRAFFIC_PERCENT=100',
      'ZERO_TRAFFIC_STAGE_VERIFIED=true',
      'SCHEDULER_MUTATION=false',
      'DATABASE_MIGRATIONS=false',
      'GENERAL_AUTONOMY_PROMOTED=false',
    ]) {
      expect(workflow).toContain(marker);
    }
  });
});
