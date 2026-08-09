import { describe, expect, it } from 'vitest';
import { evaluateEngagementPolicy } from '../src/policy/engagement-policy.js';
import { discoverInstagramCapabilities } from '../src/providers/instagram/instagram-capabilities.js';

describe('Instagram engagement policy', () => {
  it('allows verified low-risk FAQ replies', () => {
    expect(
      evaluateEngagementPolicy({
        channel: 'DIRECT',
        intent: 'FAQ_OPERATIONAL',
        factsVerified: true,
      }),
    ).toMatchObject({
      risk: 'LOW',
      autonomy: 'AUTO_REPLY_ALLOWED',
      requiresHumanReview: false,
    });
  });

  it('requires human review for complaints and sensitive data', () => {
    expect(
      evaluateEngagementPolicy({
        channel: 'COMMENT',
        intent: 'COMPLAINT',
        factsVerified: true,
      }).autonomy,
    ).toBe('HUMAN_REVIEW_REQUIRED');

    expect(
      evaluateEngagementPolicy({
        channel: 'DIRECT',
        intent: 'FAQ_OPERATIONAL',
        factsVerified: true,
        containsSensitivePersonalData: true,
      }).autonomy,
    ).toBe('HUMAN_REVIEW_REQUIRED');
  });

  it('never auto-replies when facts are unverified', () => {
    expect(
      evaluateEngagementPolicy({
        channel: 'DIRECT',
        intent: 'EVENT_INFO',
        factsVerified: false,
      }).autonomy,
    ).toBe('SUGGEST_ONLY');
  });
});

describe('Instagram engagement capability discovery', () => {
  it('requires scope and positive provider evidence for reply capabilities', () => {
    const capabilities = discoverInstagramCapabilities({
      accountEligible: true,
      scopes: ['instagram_business_basic', 'instagram_business_manage_messages'],
      providerEvidence: [
        'instagram.messaging.reply',
        'instagram.comments.reply',
        'instagram.engagement.webhook.receive',
      ],
    });

    expect(capabilities).toContain('instagram.messaging.reply');
    expect(capabilities).toContain('instagram.engagement.webhook.receive');
    expect(capabilities).not.toContain('instagram.comments.reply');
  });
});
