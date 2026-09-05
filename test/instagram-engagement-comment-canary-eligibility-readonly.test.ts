import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  'src/ops/instagram-engagement-comment-canary-eligibility-readonly.ts',
  'utf8',
);
const workflow = readFileSync(
  '.github/workflows/instagram-engagement-comment-canary-eligibility-readonly.yml',
  'utf8',
);

// Keep this read-only gate aligned with the real Comment canary PREPARE contract.
describe('Instagram Comment canary read-only eligibility gate', () => {
  it('mirrors the real Comment canary state-selection contract', () => {
    for (const marker of [
      "inbound.status = 'DELIVERED'",
      "inbound.payload->>'channel' = 'COMMENT'",
      "inbound.payload->>'accountId' = $3",
      "action.status = 'SUGGESTED'",
      "action.risk = 'LOW'",
      "action.autonomy = 'SUGGEST_ONLY'",
      "action.policy_reason = 'engagement_writes_kill_switch'",
      "action.classification_confidence = 'HIGH'",
      "action.priority in ('P2','P3')",
      "thread.state = 'AWAITING_APPROVAL'",
      "thread.classification_confidence = 'HIGH'",
      "thread.priority in ('P2','P3')",
      "group_row.status = 'SUGGESTED'",
      'group_row.message_count = 1',
      "reply.event_id = 'instagram-engagement-reply:' || action.event_id",
      'instagram:engagement:comment-canary-session:',
    ]) {
      expect(source).toContain(marker);
    }
    expect(source).not.toContain("candidate.payload->>'channel' = 'DIRECT'");
    expect(source).not.toContain('for update');
    expect(source).not.toContain('skip locked');
  });

  it('revalidates Comment safety before READY', () => {
    for (const marker of [
      "classification.confidence !== 'HIGH'",
      "['P2', 'P3'].includes(classification.priority)",
      'classification.containsPotentialSensitiveData',
      "classification.commercialIntent !== 'NONE'",
      "classification.urgency !== 'LOW'",
      'match?.factsVerified',
      'match.faqId?.trim()',
      'match.answer?.trim()',
      'match.answer.length > 2_000',
      "channel: 'COMMENT'",
      'factsVerified: true',
      'writesEnabled: true',
      "policy.risk !== 'LOW'",
      "policy.autonomy !== 'AUTO_REPLY_ALLOWED'",
    ]) {
      expect(source).toContain(marker);
    }
  });

  it('is strictly database-read-only and provider-free', () => {
    expect(source).toContain('DATABASE_MUTATIONS=false');
    expect(source).toContain('PROVIDER_CALLS=false');
    expect(source).toContain('EXTERNAL_REPLY_WRITES=false');
    expect(source).toContain('RAW_USER_DATA_LOGGED=false');
    expect(source).not.toMatch(
      /\b(update|insert into|delete from)\s+(event_outbox|instagram_engagement_actions)\b/iu,
    );
    expect(source).not.toContain('InstagramGraphEngagementProvider');
    expect(source).not.toContain('MetaApiClient');
    expect(source).not.toContain('replyToComment');
  });

  it('reports bounded rejection and blocking causes', () => {
    for (const marker of [
      'RECENT_COMMENT_COUNT=',
      'STATE_CANDIDATE_COUNT=',
      'ELIGIBLE_COUNT=',
      'ELIGIBLE_TARGET_SHA256=',
      'UNRESOLVED_AMBIGUITY_COUNT=',
      'ACTIVE_RESERVATION_COUNT=',
      'REJECTED_SCOPE=',
      'REJECTED_AGE=',
      'REJECTED_CONFIDENCE=',
      'REJECTED_PRIORITY=',
      'REJECTED_SENSITIVE=',
      'REJECTED_COMMERCIAL=',
      'REJECTED_URGENCY=',
      'REJECTED_KNOWLEDGE=',
      'REJECTED_POLICY=',
      "'BLOCKED_UNRESOLVED_AMBIGUITY'",
      "'BLOCKED_ACTIVE_RESERVATION'",
      "'NO_ELIGIBLE_TARGET'",
      "'READY'",
      "'MULTIPLE_ELIGIBLE_TARGETS'",
    ]) {
      expect(source).toContain(marker);
    }
    expect(source).toContain("eligible.length === 1 ? eligible[0] : 'NONE'");
  });

  it('gives Cloud Logging a bounded flush window before the ephemeral job exits', () => {
    expect(source).toContain('const LOG_FLUSH_GRACE_MS = 10_000;');
    expect(source).toContain('setTimeout(resolve, LOG_FLUSH_GRACE_MS)');
  });

  it('requires exact-main Comment-only immutable-image authorization', () => {
    for (const marker of [
      'AUTHORIZED_CANDIDATE_SHA=$GITHUB_SHA',
      'RUNTIME_SOURCE_SHA=$GITHUB_SHA',
      'INSTAGRAM_ENGAGEMENT_COMMENT_CANARY_ELIGIBILITY_READONLY=AUTHORIZED',
      'CANARY_CHANNEL=COMMENT',
      'MAX_AGE_MINUTES=30',
      'READ_ONLY_ELIGIBILITY=true',
      'DATABASE_MUTATIONS_AUTHORIZED=false',
      'PROVIDER_CALLS_AUTHORIZED=false',
      'EXTERNAL_REPLY_WRITES_AUTHORIZED=false',
    ]) {
      expect(workflow).toContain(marker);
    }
    expect(workflow).not.toContain('TOCA_SECRET_META_ACCESS_TOKEN');
    expect(workflow).not.toContain('gcloud run services update');
  });

  it('runs the Comment probe once and cleans up', () => {
    expect(workflow).toContain(
      'dist/src/ops/instagram-engagement-comment-canary-eligibility-readonly.js',
    );
    expect(workflow).toContain('--max-retries 0');
    expect(workflow).toContain('--task-timeout 120s');
    expect(workflow).toContain('gcloud run jobs delete');
    expect(workflow).not.toContain('scripts/instagram-engagement-comment-provider-canary.mjs');
  });

  it('publishes only bounded counts, status and a hashed target', () => {
    for (const marker of [
      'COMMENT_CANARY_ELIGIBILITY_READONLY_STATUS=PASS',
      'ELIGIBILITY=${STATUS}',
      'ELIGIBLE_TARGET_SHA256=${TARGET_SHA:-NONE}',
      'RAW_USER_DATA_LOGGED=false',
      'DATABASE_MUTATIONS=false',
      'PROVIDER_CALLS=false',
      'EXTERNAL_REPLY_WRITES=false',
    ]) {
      expect(workflow).toContain(marker);
    }
    expect(workflow).toContain('if [[ "$TARGET_SHA" != \'NONE\' ]]');
    expect(workflow).not.toContain('PAYLOAD_SUMMARIES=');
    expect(workflow).not.toContain('RAW_TEXT=');
  });
});
