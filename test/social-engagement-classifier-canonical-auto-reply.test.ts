import { describe, expect, it } from 'vitest';
import { classifySocialEngagement } from '../src/crm/social-engagement-classifier.js';
import { INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE } from '../src/instagram-engagement/knowledge-snapshot-current.js';

const autoReplyCases = INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE.filter(
  (row) => row.autonomy === 'AUTO_REPLY_ALLOWED',
).flatMap((row) =>
  [row.canonicalQuestion, ...row.variants].map((text) => ({
    faqId: row.faqId,
    text,
    expectedIntent: row.intent,
  })),
);

describe('canonical Instagram auto-reply classifier coverage', () => {
  it.each(autoReplyCases)(
    '$faqId classifies "$text" as $expectedIntent with high confidence',
    ({ text, expectedIntent }) => {
      const classification = classifySocialEngagement(text);
      expect(classification.intent).toBe(expectedIntent);
      expect(classification.confidence).toBe('HIGH');
    },
  );

  it('keeps the career canonical variant suggest-only reachable instead of unknown', () => {
    expect(classifySocialEngagement('Quero trabalhar com vocês')).toMatchObject({
      intent: 'FAQ_OPERATIONAL',
      confidence: 'HIGH',
    });
  });

  it.each([
    ['Fui agredido na Toca', 'SAFETY_INCIDENT'],
    ['Quero meu dinheiro de volta', 'REFUND'],
    ['Quero reservar um camarote', 'COMMERCIAL_LEAD'],
  ])('does not weaken fail-closed routing for "%s"', (text, expectedIntent) => {
    expect(classifySocialEngagement(text).intent).toBe(expectedIntent);
  });
});
