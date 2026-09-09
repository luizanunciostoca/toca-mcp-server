import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/instagram-engagement/conversation-operations.ts', 'utf8');

describe('Instagram conversation stale escalation automation block', () => {
  it('keeps approval-blocked threads fail-closed', () => {
    expect(source).toContain("existingState === 'AWAITING_APPROVAL'");
  });

  it('blocks ESCALATED threads only while a human queue item is active', () => {
    expect(source).toContain("existingState === 'ESCALATED'");
    expect(source).toContain("state in ('PENDING','ACKNOWLEDGED')");
    expect(source).toContain('(activeHumanQueue?.rowCount ?? 0) > 0');
  });

  it('does not treat a stale ESCALATED state by itself as an automation block', () => {
    expect(source).not.toContain(
      "automationBlocked: existingState === 'ESCALATED' || existingState === 'AWAITING_APPROVAL'",
    );
  });
});
