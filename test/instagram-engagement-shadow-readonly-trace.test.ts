import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-shadow-readonly-trace.yml',
  'utf8',
);
const script = readFileSync(
  'scripts/diagnose-instagram-engagement-shadow-readonly.mjs',
  'utf8',
);

describe('Instagram engagement shadow read-only trace', () => {
  it(
    'requires exact owner authorization and keeps production fail-closed',
    () => {
      const required = [
        'PRODUCTION DIAGNOSTIC AUTHORIZATION — Instagram shadow readonly trace',
        'AUTHORIZED_DIAGNOSTIC_SHA=',
        'INSTAGRAM_ENGAGEMENT_SHADOW_READONLY_TRACE=AUTHORIZED',
        'DATABASE_MUTATIONS_AUTHORIZED=false',
        'EXTERNAL_REPLY_WRITES_AUTHORIZED=false',
        'Instagram Engagement Shadow Unique Candidate Recovery',
        'engagementWritesEnabled:false',
        'callbackClosed:true',
        'legacyAllUsersInvoker:false',
      ];
      for (const token of required) expect(workflow).toContain(token);
      expect(workflow).not.toContain(
        'INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=true',
      );
      expect(workflow).not.toContain('--no-invoker-iam-check');
      expect(workflow).not.toContain('update-traffic');
    },
  );

  it('uses a pinned Cloud SQL proxy and a read-only transaction', () => {
    expect(workflow).toContain("PROXY_VERSION='2.24.1'");
    expect(workflow).toContain(
      "PROXY_SHA256='fae2766aac9d614a2bdef2f2a7778f3d054f3acd5ff07a81a9e300bd471512eb'",
    );
    expect(workflow).toContain(
      'diagnose-instagram-engagement-shadow-readonly.mjs',
    );
    expect(script).toContain('begin transaction read only');
    expect(script).toContain("await client.query('rollback')");
    expect(script).not.toMatch(
      /\b(insert|update|delete|alter|drop|truncate)\s+(into|table|from|event_outbox|instagram_engagement_actions)/i,
    );
  });

  it(
    'traces webhook, inbound outbox, attempts and action without raw content',
    () => {
      const required = [
        'meta_webhook_events',
        "sender_scoped_id like 'shadow-proof-comment-sender-%'",
        "event_type = 'instagram.engagement.inbound.v1'",
        'event_outbox_delivery_attempts',
        'instagram_engagement_actions',
        'last_error_code',
        'currentDueInboundBacklog',
        'rawSenderPrinted: false',
        'rawMessagePrinted: false',
        'secretsPrinted: false',
        'databaseMutationPerformed: false',
      ];
      for (const token of required) expect(script).toContain(token);
    },
  );

  it('classifies the remaining failure modes precisely', () => {
    const diagnoses = [
      'META_SYNTHETIC_COMMENT_NOT_FOUND',
      'INBOUND_OUTBOX_NOT_ENQUEUED',
      'LATE_ACTION_OBSERVED_AFTER_PROOF_WINDOW',
      'INBOUND_PENDING_NOT_CLAIMED',
      'PROCESSOR_FAILED_RETRYABLE',
      'PROCESSOR_DEAD_LETTER',
      'INBOUND_CLAIM_STUCK',
      'ACTION_MISSING_AFTER_DELIVERY_INVARIANT_BREACH',
    ];
    for (const token of diagnoses) expect(script).toContain(token);
  });
});
