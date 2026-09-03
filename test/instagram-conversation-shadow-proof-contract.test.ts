import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Instagram conversation shadow proof contract', () => {
  it('proves grouping, low-confidence fail-closed and P0 escalation with writes disabled', async () => {
    const proof = await readFile(
      'src/ops/instagram-conversation-shadow-proof.ts',
      'utf8',
    );

    expect(proof).toContain('CONVERSATION_SHADOW_PROOF_REQUIRES_WRITES_DISABLED');
    expect(proof).toContain('message_count !== 2');
    expect(proof).toContain('CONVERSATION_SHADOW_GROUP_DECISION_COUNT_INVALID');
    expect(proof).toContain("classification_confidence !== 'LOW'");
    expect(proof).toContain("lowAction.status === 'READY_TO_SEND'");
    expect(proof).toContain("p0Action.priority !== 'P0'");
    expect(proof).toContain("p0Action.status !== 'HUMAN_REVIEW'");
    expect(proof).toContain("p0Thread.state !== 'ESCALATED'");
    expect(proof).toContain('replyOutboxEvents !== 0');
    expect(proof).toContain("validation: 'instagram-conversation-shadow-e2e'");
    expect(proof).toContain('externalReplyObserved: false');
    expect(proof).toContain('writesEnabled: false');
  });
});
