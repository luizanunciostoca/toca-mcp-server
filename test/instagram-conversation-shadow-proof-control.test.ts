import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Instagram conversation shadow proof control', () => {
  it('keeps the proof fail-closed and external writes disabled', async () => {
    const raw = await readFile('control/instagram-conversation-shadow-proof.v1.json', 'utf8');
    const control = JSON.parse(raw) as {
      writesEnabledRequired: boolean;
      requiredAssertions: string[];
      evidenceValidation: string;
    };

    expect(control.writesEnabledRequired).toBe(false);
    expect(control.requiredAssertions).toEqual(
      expect.arrayContaining([
        'TWO_NEARBY_MESSAGES_ONE_GROUP',
        'ONE_GROUP_ONE_DECISION',
        'LOW_CONFIDENCE_ZERO_AUTOSEND',
        'P0_HUMAN_REVIEW_ESCALATED',
        'ZERO_REPLY_OUTBOX_EVENTS',
        'ZERO_PROVIDER_REPLY_IDS',
      ]),
    );
    expect(control.evidenceValidation).toBe('instagram-conversation-shadow-e2e');
  });
});
