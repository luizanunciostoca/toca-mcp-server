import { describe, expect, it } from 'vitest';
import { classifySocialEngagement } from '../src/crm/social-engagement-classifier.js';
import { evaluateEngagementPolicy } from '../src/policy/engagement-policy.js';

describe('Instagram conversation operations classification', () => {
  it('keeps explicit ticket purchase as a commercial lead signal while routing the response through TICKET_INFO', () => {
    const result = classifySocialEngagement(
      'Quero comprar ingresso da The Party e saber se tem disponibilidade',
    );
    expect(result.intent).toBe('TICKET_INFO');
    expect(result.conversationIntents).toEqual(
      expect.arrayContaining(['COMMERCIAL', 'PURCHASE', 'EVENT', 'THE_PARTY', 'INFORMATION']),
    );
    expect(result.commercialIntent).toBe('HIGH');
    expect(result.topic).toBe('TICKETS');
    expect(result.priority).toBe('P1');
    expect(result.confidence).toBe('HIGH');
  });

  it('keeps factual ticket information outside commercial handoff', () => {
    const result = classifySocialEngagement('Quanto custa o ingresso da The Party e onde compro?');
    expect(result.intent).toBe('TICKET_INFO');
    expect(result.commercialIntent).toBe('NONE');
    expect(result.conversationIntents).toEqual(
      expect.arrayContaining(['EVENT', 'THE_PARTY', 'INFORMATION']),
    );
    expect(result.conversationIntents).not.toContain('COMMERCIAL');
    expect(result.conversationIntents).not.toContain('PURCHASE');
    expect(result.priority).toBe('P3');
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
