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

  it('binds activation to exact main, immutable image, batch one and rollback', () => {
    for (const marker of [
      'test "$CURRENT_MAIN_SHA" = "$GITHUB_SHA"',
      'AUTHORIZED_CONTROLLER_SHA=$GITHUB_SHA',
      'RUNTIME_SOURCE_SHA=$GITHUB_SHA',
      'AUTONOMY_STAGE=LIMITED',
      'PERSISTENT_WRITES_AUTHORIZED=true',
      'DATABASE_MIGRATIONS_AUTHORIZED=true',
      'SERVICE_MUTATION_AUTHORIZED=true',
      'BATCH_SIZE=1',
      'ROLLBACK_ON_FAILURE=true',
      'INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=true',
      'INSTAGRAM_ENGAGEMENT_BATCH_SIZE=1',
      'INSTAGRAM_PUBLICATION_WRITES_ENABLED=false',
      'Roll back persistent writes on failure',
    ]) {
      expect(workflow).toContain(marker);
    }
  });

  it('does not perform a synthetic or blind provider send during activation', () => {
    expect(workflow).not.toContain('sendDirectReply');
    expect(workflow).not.toContain('replyToComment');
    expect(workflow).not.toContain('CANARY_MAX_EXTERNAL_REPLIES');
    expect(workflow).not.toContain('gcloud scheduler jobs run');
  });
});
