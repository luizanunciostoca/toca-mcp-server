import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-shadow-readonly-trace.yml',
  'utf8',
);
const script = readFileSync('scripts/diagnose-instagram-engagement-shadow-readonly.mjs', 'utf8');

const workflowGuards = [
  'PRODUCTION DIAGNOSTIC AUTHORIZATION',
  'AUTHORIZED_DIAGNOSTIC_SHA=',
  'INSTAGRAM_ENGAGEMENT_SHADOW_READONLY_TRACE=AUTHORIZED',
  'DATABASE_MUTATIONS_AUTHORIZED=false',
  'EXTERNAL_REPLY_WRITES_AUTHORIZED=false',
  'engagementWritesEnabled:false',
  'callbackClosed:true',
  'legacyAllUsersInvoker:false',
];

const traceSignals = [
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

describe('Instagram engagement shadow read-only trace', () => {
  it('keeps the diagnostic fail-closed', () => {
    for (const token of workflowGuards) {
      expect(workflow).toContain(token);
    }
    expect(workflow).not.toContain('INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=true');
    expect(workflow).not.toContain('--no-invoker-iam-check');
    expect(workflow).not.toContain('update-traffic');
  });

  it('uses only a read-only database transaction', () => {
    expect(workflow).toContain("PROXY_VERSION='2.24.1'");
    expect(script).toContain('begin transaction read only');
    expect(script).toContain("await client.query('rollback')");
    for (const phrase of [
      'insert into event_outbox',
      'update event_outbox',
      'delete from event_outbox',
      'update instagram_engagement_actions',
      'delete from instagram_engagement_actions',
    ]) {
      expect(script.toLowerCase()).not.toContain(phrase);
    }
  });

  it('traces the synthetic comment without raw content', () => {
    for (const token of traceSignals) {
      expect(script).toContain(token);
    }
  });

  it('classifies the remaining failure modes', () => {
    for (const diagnosis of diagnoses) {
      expect(script).toContain(diagnosis);
    }
  });
});
