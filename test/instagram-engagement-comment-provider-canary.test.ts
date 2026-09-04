import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-comment-provider-canary.yml',
  'utf8',
);
const runner = readFileSync('scripts/instagram-engagement-comment-provider-canary.mjs', 'utf8');
const provider = readFileSync('src/providers/instagram/instagram-engagement-provider.ts', 'utf8');
const dockerfile = readFileSync('Dockerfile', 'utf8');

describe('Instagram real Comment provider canary', () => {
  it('requires a single-use Comment-only authorization without persistent promotion', () => {
    for (const marker of [
      'INSTAGRAM_ENGAGEMENT_REAL_COMMENT_CANARY=AUTHORIZED',
      'ELIGIBLE_TARGET_SHA256=',
      'CANARY_CHANNEL=COMMENT',
      'CANARY_MAX_EXTERNAL_REPLIES=1',
      'TEMPORARY_JOB_ONLY=true',
      'PERSISTENT_COMMENT_PROMOTION_AUTHORIZED=false',
      'EXTERNAL_COMMENT_REPLY_AUTHORIZED=true',
      'DIRECT_LIMITED_RUNTIME_MUST_REMAIN_ACTIVE=true',
      'AUTO_CANARY_AUTHORIZED=true',
    ]) {
      expect(workflow).toContain(marker);
    }
    expect(workflow).toContain("TARGET_COUNT=\"$(grep -c '^ELIGIBLE_TARGET_SHA256='");
    expect(workflow).toContain('test "$TARGET_COUNT" = \'1\'');
    expect(workflow).toContain('[[ "$ELIGIBLE_TARGET_SHA" =~ ^[0-9a-f]{64}$ ]]');
  });

  it('packages the canary runner into the production runtime image', () => {
    expect(dockerfile).toContain(
      'COPY --from=build /app/scripts/instagram-engagement-comment-provider-canary.mjs ./scripts/instagram-engagement-comment-provider-canary.mjs',
    );
  });

  it('never mutates the serving Direct runtime or Cloud Scheduler', () => {
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
    expect(workflow).toContain('DIRECT_LIMITED_PRESTATE=PASS');
    expect(workflow).toContain('DIRECT_LIMITED_POSTSTATE=PASS');
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_AUTO_REPLY_CHANNELS=COMMENT');
  });

  it('binds reservation and provider execution to the exact sanitized eligible target', () => {
    const propagation =
      'INSTAGRAM_ENGAGEMENT_COMMENT_CANARY_EXPECTED_TARGET_SHA256=$ELIGIBLE_TARGET_SHA';
    expect(workflow.match(new RegExp(propagation.replace('$', '\\$'), 'g'))).toHaveLength(2);
    expect(workflow).toContain('eligible_target_sha=$ELIGIBLE_TARGET_SHA');
    expect(workflow).toContain(
      'ELIGIBLE_TARGET_SHA: ${{ steps.auth.outputs.eligible_target_sha }}',
    );

    expect(runner).toContain('INSTAGRAM_ENGAGEMENT_COMMENT_CANARY_EXPECTED_TARGET_SHA256');
    expect(runner).toContain('COMMENT_CANARY_EXPECTED_TARGET_SHA256_INVALID');
    expect(runner).toContain('digest(row.engagement_event_id) !== expectedTargetSha256');
    expect(runner).toContain('COMMENT_CANARY_EXPECTED_TARGET_NOT_ELIGIBLE');
    expect(runner).toContain('digest(candidate.engagement_event_id) !== expectedTargetSha256');
    expect(runner).toContain('COMMENT_CANARY_RESERVED_TARGET_MISMATCH');

    const executeBinding = runner.indexOf('COMMENT_CANARY_RESERVED_TARGET_MISMATCH');
    const inFlight = runner.indexOf("status='SEND_AMBIGUOUS'");
    const providerCall = runner.indexOf('await provider.replyToComment({');
    expect(executeBinding).toBeGreaterThan(-1);
    expect(inFlight).toBeGreaterThan(executeBinding);
    expect(providerCall).toBeGreaterThan(inFlight);
  });

  it('selects only previously classified kill-switch Comments and revalidates safety', () => {
    for (const marker of [
      "action.status = 'SUGGESTED'",
      "action.risk = 'LOW'",
      "action.autonomy = 'SUGGEST_ONLY'",
      "action.policy_reason = 'engagement_writes_kill_switch'",
      "action.classification_confidence = 'HIGH'",
      "action.priority in ('P2','P3')",
      "thread.state = 'AWAITING_APPROVAL'",
      "group_row.status = 'SUGGESTED'",
      'group_row.message_count = 1',
      "classification.confidence !== 'HIGH'",
      "classification.commercialIntent !== 'NONE'",
      "classification.urgency !== 'LOW'",
      'classification.containsPotentialSensitiveData',
      'factsVerified: true',
      'writesEnabled: true',
      "policy.autonomy !== 'AUTO_REPLY_ALLOWED'",
    ]) {
      expect(runner).toContain(marker);
    }
  });

  it('fails closed as ambiguous before the one provider side effect', () => {
    const inFlight = runner.indexOf("status='SEND_AMBIGUOUS'");
    const providerCall = runner.indexOf('await provider.replyToComment({');
    expect(inFlight).toBeGreaterThan(-1);
    expect(providerCall).toBeGreaterThan(inFlight);
    expect(runner).toContain('COMMENT_CANARY_SEND_IN_FLIGHT');
    expect(runner).toContain('COMMENT_CANARY_PROVIDER_OUTCOME_UNKNOWN');
    expect(runner).toContain('COMMENT_CANARY_PROVIDER_OUTCOME_AMBIGUOUS');
    expect(runner).not.toContain('sendDirectReply');
  });

  it('requires provider ACK and canonical conversation receipt', () => {
    for (const marker of [
      "status: 'SENT'",
      'providerReplyId: reply.commentId',
      'recordConversationReply(pool',
      "row.action_status !== 'SENT'",
      "row.thread_state !== 'AWAITING_CUSTOMER'",
      "row.group_status !== 'RESPONDED'",
      'COMMENT_CANARY_PROVIDER_ACKNOWLEDGED=true',
      'COMMENT_CANARY_PERSISTENT_PROMOTION=false',
    ]) {
      expect(runner).toContain(marker);
    }
  });

  it('uses the canonical Instagram comment reply endpoint and requires an ACK id', () => {
    expect(provider).toContain('`${input.commentId}/replies`');
    expect(provider).toContain("return { commentId: requireString(response.id, 'id') }");
  });
});
