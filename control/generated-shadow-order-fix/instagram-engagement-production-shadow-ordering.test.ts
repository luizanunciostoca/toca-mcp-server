import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-shadow-production.yml',
  'utf8',
);

const readinessStart = workflow.indexOf(
  '      - name: Run fail-closed readiness on PostgreSQL knowledge mirror',
);
const deployStart = workflow.indexOf(
  '      - name: Deploy shadow runtime and expose webhook with DRS-safe invoker mode',
);
const commentStart = workflow.indexOf(
  '      - name: Prove COMMENT and DIRECT end-to-end with synthetic signed webhooks',
);
const conversationStart = workflow.indexOf(
  '      - name: Prove conversation grouping, confidence and P0 escalation with writes disabled',
);
const subscriptionsStart = workflow.indexOf(
  '      - name: Configure and read back Meta COMMENT and DIRECT subscriptions',
);

const readiness = workflow.slice(readinessStart, deployStart);
const commentProof = workflow.slice(commentStart, conversationStart);
const conversationProof = workflow.slice(conversationStart, subscriptionsStart);

describe('Instagram production shadow ordering regression', () => {
  it('keeps readiness independent from not-yet-created candidate revisions', () => {
    expect(readiness).not.toContain('DAEMON_CANDIDATE_REVISION');
    expect(readiness).not.toContain('WEBHOOK_CANDIDATE_REVISION');
    expect(readiness).not.toContain('tick_pump()');
    expect(readiness).not.toContain("TICK_PID=''");
    expect(readiness).toContain('instagram-engagement-readiness-preflight.js');
    expect(readiness).toContain('conversationOperationsVerified == true');
  });

  it('runs COMMENT/DIRECT proof only after exact candidate routing exists', () => {
    expect(commentStart).toBeGreaterThan(deployStart);
    expect(commentProof).toContain('DAEMON_CANDIDATE_REVISION');
    expect(commentProof).toContain('WEBHOOK_CANDIDATE_REVISION');
    expect(commentProof).toContain('tick_pump()');
    expect(commentProof).toContain('gcloud scheduler jobs run "$SCHEDULER_JOB_NAME"');
    expect(commentProof).toContain('oidcToken.serviceAccountEmail');
  });

  it('cleans up scheduler pumps in both shadow proof stages', () => {
    expect(commentProof).toContain('if [[ -n "$TICK_PID" ]]');
    expect(conversationProof).toContain('if [[ -n "$TICK_PID" ]]');
    expect(conversationProof).toContain('tick_pump()');
  });
});
