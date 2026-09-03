import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-shadow-production.yml',
  'utf8',
);

function section(start: string, end: string): string {
  const startIndex = workflow.indexOf(start);
  const endIndex = workflow.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return workflow.slice(startIndex, endIndex);
}

describe('Instagram production shadow step ordering', () => {
  it('keeps readiness independent from candidate routing and tick pumps', () => {
    const readiness = section(
      '- name: Run fail-closed readiness on PostgreSQL knowledge mirror',
      '- name: Deploy shadow runtime and expose webhook with DRS-safe invoker mode',
    );

    expect(readiness).toContain('instagram-engagement-readiness-preflight.js');
    expect(readiness).toContain('conversationOperationsVerified == true');
    expect(readiness).not.toContain('DAEMON_CANDIDATE_REVISION');
    expect(readiness).not.toContain('WEBHOOK_CANDIDATE_REVISION');
    expect(readiness).not.toContain('TICK_PID');
    expect(readiness).not.toContain('tick_pump');
  });

  it('creates and routes exact candidates only after readiness', () => {
    const deploy = section(
      '- name: Deploy shadow runtime and expose webhook with DRS-safe invoker mode',
      '- name: Verify DRS-safe public callback and fail-closed writes',
    );

    expect(deploy).toContain('EXPECTED_DAEMON_CANDIDATE_REVISION');
    expect(deploy).toContain('EXPECTED_WEBHOOK_CANDIDATE_REVISION');
    expect(deploy).toContain('--to-revisions="${EXPECTED_DAEMON_CANDIDATE_REVISION}=100"');
    expect(deploy).toContain('--to-revisions="${EXPECTED_WEBHOOK_CANDIDATE_REVISION}=100"');
    expect(deploy).toContain('INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false');
  });

  it('requires exact candidate traffic and authenticated tick pump in COMMENT/DIRECT proof', () => {
    const proof = section(
      '- name: Prove COMMENT and DIRECT end-to-end with synthetic signed webhooks',
      '- name: Prove conversation grouping, confidence and P0 escalation with writes disabled',
    );

    expect(proof).toContain('DAEMON_CANDIDATE_REVISION');
    expect(proof).toContain('WEBHOOK_CANDIDATE_REVISION');
    expect(proof).toContain('tick_pump()');
    expect(proof).toContain('gcloud scheduler jobs run "$SCHEDULER_JOB_NAME"');
    expect(proof).toContain('TICK_PID=');
    expect(proof).toContain('replyOutboxEvents == 0');
    expect(proof).toContain('externalReplyObserved == false');
  });

  it('requires exact candidate traffic and safe tick cleanup in Conversation Operations proof', () => {
    const proof = section(
      '- name: Prove conversation grouping, confidence and P0 escalation with writes disabled',
      '- name: Configure and read back Meta COMMENT and DIRECT subscriptions',
    );

    expect(proof).toContain('DAEMON_CANDIDATE_REVISION');
    expect(proof).toContain('WEBHOOK_CANDIDATE_REVISION');
    expect(proof).toContain('tick_pump()');
    expect(proof).toContain('if [[ -n "$TICK_PID" ]]');
    expect(proof).toContain('.lowConfidence.autoSendObserved == false');
    expect(proof).toContain('.p0.threadState == "ESCALATED"');
    expect(proof).toContain('.replyOutboxEvents == 0');
  });
});
