import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const processor = readFileSync('src/instagram-engagement/processor.ts', 'utf8');
const runtime = readFileSync('src/instagram-engagement/runtime.ts', 'utf8');
const leadEngine = readFileSync('src/crm/social-engagement-lead-engine.ts', 'utf8');
const preflight = readFileSync(
  'src/ops/instagram-engagement-limited-activation-preflight.ts',
  'utf8',
);
const workflow = readFileSync(
  '.github/workflows/instagram-engagement-limited-activation.yml',
  'utf8',
);

describe('Instagram engagement LIMITED persistent activation', () => {
  it('uses the same narrow autonomy envelope as the controlled Direct canary', () => {
    for (const marker of [
      "classification.confidence === 'HIGH'",
      "['P2', 'P3'].includes(classification.priority)",
      '!classification.containsPotentialSensitiveData',
      "classification.commercialIntent === 'NONE'",
      "classification.urgency === 'LOW'",
      '!context.automationBlocked',
      'autoReplyChannels.has(payload.channel)',
      'isWithinAutoReplyWindow(payload.occurredAt ?? now, now, autoReplyMaxAgeMs)',
    ]) {
      expect(processor).toContain(marker);
    }
  });

  it('keeps persistent auto-replies Direct-only until a separate Comment proof', () => {
    expect(runtime).toContain("autoReplyChannels: ['DIRECT']");
    expect(runtime).toContain('autoReplyMaxAgeMs: 30 * 60 * 1000');
    expect(runtime).toContain('separate real COMMENT provider-acknowledgement gate');
    expect(workflow).toContain('AUTO_REPLY_CHANNELS=DIRECT');
    expect(workflow).toContain('COMMENT_AUTO_REPLY_AUTHORIZED=false');
    expect(workflow).toContain('COMMENT_AUTO_REPLY_ENABLED=false');
  });

  it('passes confidence and conversation blocking context into the policy engine', () => {
    expect(leadEngine).toContain('classificationConfidence:');
    expect(leadEngine).toContain('input.authorization.classificationConfidence');
    expect(leadEngine).toContain('contextConflict: input.authorization.contextConflict');
    expect(leadEngine).toContain(
      'threadAutomationBlocked: input.authorization.threadAutomationBlocked',
    );
  });

  it('requires a clean reply boundary before persistent writes are enabled', () => {
    expect(preflight).toContain("event_type = 'instagram.engagement.reply.v1'");
    expect(preflight).toContain("status in ('PENDING', 'CLAIMED', 'FAILED_RETRYABLE')");
    expect(preflight).toContain("status = 'DEAD_LETTER'");
    expect(preflight).toContain("status = 'SEND_AMBIGUOUS'");
    expect(preflight).toContain('DATABASE_MUTATIONS=false');
    expect(preflight).toContain('PROVIDER_CALLS=false');
  });

  it('binds activation to exact main, immutable image, zero-traffic stage and rollback', () => {
    for (const marker of [
      'test "$CURRENT_MAIN_SHA" = "$GITHUB_SHA"',
      'AUTHORIZED_CONTROLLER_SHA=$GITHUB_SHA',
      'RUNTIME_SOURCE_SHA=$GITHUB_SHA',
      'AUTONOMY_STAGE=LIMITED',
      'PERSISTENT_WRITES_AUTHORIZED=true',
      'DATABASE_MIGRATIONS_AUTHORIZED=true',
      'SERVICE_MUTATION_AUTHORIZED=true',
      'SCHEDULER_MUTATION_AUTHORIZED=false',
      'ZERO_TRAFFIC_STAGE_REQUIRED=true',
      'BATCH_SIZE=1',
      'ROLLBACK_ON_FAILURE=true',
      'INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=true',
      'INSTAGRAM_ENGAGEMENT_BATCH_SIZE=1',
      'INSTAGRAM_PUBLICATION_WRITES_ENABLED=false',
      '--no-traffic --quiet',
      '--revision-suffix "$REVISION_SUFFIX"',
      'gcloud run services update-traffic "$DAEMON_SERVICE_NAME"',
      '--to-revisions="${CANDIDATE_REVISION}=100" --quiet',
      'ZERO_TRAFFIC_STAGE_VERIFIED=true',
      'SCHEDULER_MUTATION=false',
      'Roll back traffic to fail-closed revision on failure',
    ]) {
      expect(workflow).toContain(marker);
    }
  });

  it('derives fail-closed prestate from the routed revision instead of the service template', () => {
    expect(workflow).toContain(
      'PRE_REVISION_JSON="$(gcloud run revisions describe "$PRE_REVISION"',
    );
    expect(workflow).toContain('printf \'%s\' "$PRE_REVISION_JSON" | jq -e');
    expect(workflow).toContain('(.spec.serviceAccountName == $sa)');
    expect(workflow).not.toContain(
      'PRE_IMAGE="$(printf \'%s\' "$SERVICE_JSON" | jq -r \'.spec.template.spec.containers[0].image\')"',
    );
    expect(workflow).not.toContain('.spec.template.spec.containers[0] as $c |');
  });

  it('keeps the serving fail-closed revision until the named candidate is verified', () => {
    expect(workflow).toContain('Stage write-enabled candidate revision at zero traffic');
    expect(workflow).toContain('Verify zero-traffic candidate before cutover');
    expect(workflow).toContain('--arg previous "$PRE_REVISION"');
    expect(workflow).toContain('== 0 and');
    expect(workflow).toContain('== 100');
    expect(workflow).not.toContain('.status.latestReadyRevisionName == $candidate');
    expect(workflow).not.toContain('--to-latest --quiet');
    expect(workflow).toContain('Activate LIMITED runtime by explicit traffic cutover');
    expect(workflow).toContain('--to-revisions="${PRE_REVISION}=100"');
    expect(workflow).toContain('DAEMON_ENV="^@^');
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_KB_SOURCE_IDS=$KB_SOURCE_IDS');
  });

  it('does not mutate the Scheduler or perform a synthetic provider send during activation', () => {
    expect(workflow).not.toContain('gcloud scheduler jobs pause');
    expect(workflow).not.toContain('gcloud scheduler jobs resume');
    expect(workflow).not.toContain('gcloud scheduler jobs update');
    expect(workflow).not.toContain('gcloud scheduler jobs run');
    expect(workflow).not.toContain('sendDirectReply');
    expect(workflow).not.toContain('replyToComment');
    expect(workflow).not.toContain('CANARY_MAX_EXTERNAL_REPLIES');
  });
});
