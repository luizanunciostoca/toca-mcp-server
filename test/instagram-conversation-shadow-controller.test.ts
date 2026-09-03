import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-shadow-production.yml',
  'utf8',
);

describe('Instagram conversation proof production-shadow controller', () => {
  it('requires the persistent conversation schema in readiness', () => {
    expect(workflow).toContain('.conversationOperationsVerified == true');
    expect(workflow).toContain('conversationOperationsVerified');
  });

  it('executes the conversation grouping, LOW-confidence and P0 proof', () => {
    expect(workflow).toContain('dist/src/ops/instagram-conversation-shadow-proof.js');
    expect(workflow).toContain('instagram-conversation-shadow-e2e');
    expect(workflow).toContain('.grouping.inboundEvents == 2');
    expect(workflow).toContain('.grouping.persistedGroups == 1');
    expect(workflow).toContain('.grouping.decisions == 1');
    expect(workflow).toContain('.grouping.messageCount == 2');
    expect(workflow).toContain('.lowConfidence.confidence == "LOW"');
    expect(workflow).toContain('.lowConfidence.autoSendObserved == false');
    expect(workflow).toContain('.p0.priority == "P0"');
    expect(workflow).toContain('.p0.actionStatus == "HUMAN_REVIEW"');
    expect(workflow).toContain('.p0.threadState == "ESCALATED"');
  });

  it('keeps the conversation proof and final closeout fail-closed on external replies', () => {
    expect(workflow).toContain('.replyOutboxEvents == 0');
    expect(workflow).toContain('.externalReplyObserved == false');
    expect(workflow).toContain('.writesEnabled == false');
    expect(workflow).toContain('conversationShadowProof:"PASS"');
    expect(workflow).not.toContain('INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=true');
  });
});
