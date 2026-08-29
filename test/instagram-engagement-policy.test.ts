import { describe, expect, it } from 'vitest';
import { classifySocialEngagement } from '../src/crm/social-engagement-classifier.js';
import { evaluateEngagementPolicy } from '../src/policy/engagement-policy.js';

describe('Instagram engagement risk policy', () => {
  it('requires human review for harassment or threats', () => {
    const classification = classifySocialEngagement('Estou recebendo ameaça e assédio agora');
    expect(classification.intent).toBe('HARASSMENT_OR_THREAT');
    expect(classification.urgency).toBe('CRITICAL');
    const decision = evaluateEngagementPolicy({
      channel: 'DIRECT',
      intent: classification.intent,
      factsVerified: true,
      writesEnabled: true,
    });
    expect(decision.autonomy).toBe('HUMAN_REVIEW_REQUIRED');
    expect(decision.risk).toBe('HIGH');
  });

  it('requires human review for an unknown material question', () => {
    const classification = classifySocialEngagement('Vocês conseguem resolver isso para mim?');
    expect(classification.intent).toBe('UNKNOWN');
    const decision = evaluateEngagementPolicy({
      channel: 'DIRECT',
      intent: classification.intent,
      factsVerified: false,
      writesEnabled: true,
    });
    expect(decision.autonomy).toBe('HUMAN_REVIEW_REQUIRED');
  });

  it('allows verified low-risk facts only when the write switch is enabled', () => {
    const classification = classifySocialEngagement('Qual o horário?');
    expect(classification.intent).toBe('LOCATION_HOURS');
    expect(
      evaluateEngagementPolicy({
        channel: 'COMMENT',
        intent: classification.intent,
        factsVerified: true,
        writesEnabled: false,
      }).autonomy,
    ).toBe('SUGGEST_ONLY');
    expect(
      evaluateEngagementPolicy({
        channel: 'COMMENT',
        intent: classification.intent,
        factsVerified: true,
        writesEnabled: true,
      }).autonomy,
    ).toBe('AUTO_REPLY_ALLOWED');
  });

  it('keeps commercial pricing intent in suggest-only handoff', () => {
    const classification = classifySocialEngagement(
      'Quanto custa e como faço para comprar ingresso?',
    );
    expect(classification.intent).toBe('COMMERCIAL_LEAD');
    const decision = evaluateEngagementPolicy({
      channel: 'DIRECT',
      intent: classification.intent,
      factsVerified: true,
      writesEnabled: true,
    });
    expect(decision.autonomy).toBe('SUGGEST_ONLY');
    expect(decision.risk).toBe('MEDIUM');
  });

  it('forces human review when sensitive personal data is detected', () => {
    const classification = classifySocialEngagement('Meu CPF é 123.456.789-00, pode verificar?');
    expect(classification.containsPotentialSensitiveData).toBe(true);
    const decision = evaluateEngagementPolicy({
      channel: 'DIRECT',
      intent: classification.intent,
      factsVerified: true,
      containsSensitivePersonalData: true,
      writesEnabled: true,
    });
    expect(decision.autonomy).toBe('HUMAN_REVIEW_REQUIRED');
  });
});
