import { describe, expect, it } from 'vitest';
import { classifySocialEngagement } from '../src/crm/social-engagement-classifier.js';
import { evaluateEngagementPolicy } from '../src/policy/engagement-policy.js';

describe('Instagram conversation operations classification', () => {
  it('keeps multiple commercial event intentions instead of collapsing the conversation', () => {
    const result = classifySocialEngagement('Quanto custa o ingresso da The Party e onde compro?');
    expect(result.intent).toBe('COMMERCIAL_LEAD');
    expect(result.conversationIntents).toEqual(
      expect.arrayContaining(['COMMERCIAL', 'PURCHASE', 'EVENT', 'THE_PARTY', 'INFORMATION']),
    );
    expect(result.commercialIntent).toBe('HIGH');
    expect(result.priority).toBe('P1');
    expect(result.confidence).toBe('HIGH');
  });

  it('classifies safety/threat cases as P0 and abuse/support', () => {
    const result = classifySocialEngagement('Fui agredido e estou sendo ameaçado agora');
    expect(result.intent).toBe('HARASSMENT_OR_THREAT');
    expect(result.priority).toBe('P0');
    expect(result.conversationIntents).toEqual(expect.arrayContaining(['ABUSE', 'SUPPORT']));
    expect(result.confidence).toBe('HIGH');
  });

  it('identifies gastronomy as a separate conversation intent', () => {
    const result = classifySocialEngagement('Vocês têm cardápio de drinks?');
    expect(result.conversationIntents).toContain('GASTRONOMY');
    expect(result.confidence).toBe('HIGH');
  });

  it('never auto-replies with LOW classification confidence', () => {
    const decision = evaluateEngagementPolicy({
      channel: 'DIRECT',
      intent: 'FAQ_OPERATIONAL',
      factsVerified: true,
      writesEnabled: true,
      classificationConfidence: 'LOW',
    });
    expect(decision.autonomy).toBe('SUGGEST_ONLY');
    expect(decision.reason).toBe('classification_confidence_low');
  });

  it('blocks automation for a thread already requiring human handling', () => {
    const decision = evaluateEngagementPolicy({
      channel: 'DIRECT',
      intent: 'FAQ_OPERATIONAL',
      factsVerified: true,
      writesEnabled: true,
      classificationConfidence: 'HIGH',
      threadAutomationBlocked: true,
    });
    expect(decision.autonomy).toBe('HUMAN_REVIEW_REQUIRED');
    expect(decision.reason).toBe('thread_automation_blocked');
  });
});
