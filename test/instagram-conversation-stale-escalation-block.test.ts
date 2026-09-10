import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/instagram-engagement/conversation-operations.ts', 'utf8');

describe('Instagram conversation stale escalation automation block', () => {
  it('does not let a prior SUGGESTED/AWAITING_APPROVAL state permanently block a new inbound', () => {
    expect(source).not.toContain("existingState === 'AWAITING_APPROVAL' ||");
    expect(source).toContain("status === 'SUGGESTED') return 'AWAITING_APPROVAL'");
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

  it('keeps genuine human escalation fail-closed while the queue remains active', () => {
    expect(source).toContain('const hasActiveHumanEscalation =');
    expect(source).toContain(
      "automationBlocked: existingState === 'ESCALATED' && hasActiveHumanEscalation",
    );
  });
});
