import { describe, expect, it } from 'vitest';
import { classifySocialEngagement } from '../src/crm/social-engagement-classifier.js';
import { resolveKnowledgeRows } from '../src/instagram-engagement/knowledge.js';

const FAQ_001 = {
  faqId: 'FAQ-001',
  intent: 'LOCATION_HOURS' as const,
  answer: 'O Sunset acontece todos os dias, a partir das 16:30.',
  source: 'canonical-test-source',
  confidence: 0,
  factsVerified: true,
  prompts: [
    'que horas começa o sunset',
    'qual o horario do sunset',
    'sunset começa quando',
    'o sunset funciona todos os dias',
  ],
};

describe('social engagement event schedule classification', () => {
  it('prioritizes schedule semantics over generic event interest for the canonical Sunset FAQ', () => {
    const classification = classifySocialEngagement('Que horas começa o Sunset?');

    expect(classification).toMatchObject({
      intent: 'LOCATION_HOURS',
      topic: 'LOCATION_HOURS',
      eventInterest: 'SUNSET',
      productEvent: 'SUNSET',
    });
    expect(
      resolveKnowledgeRows('Que horas começa o Sunset?', classification.intent, [FAQ_001]),
    ).toMatchObject({
      faqId: 'FAQ-001',
      intent: 'LOCATION_HOURS',
      factsVerified: true,
    });
  });

  it.each([
    'Qual o horário do Sunset?',
    'Sunset começa quando?',
    'O Sunset funciona todos os dias?',
    'Que dia e que horas acontece a The Party?',
    'What time does The Party start?',
  ])('classifies event schedule question as LOCATION_HOURS: %s', (text) => {
    expect(classifySocialEngagement(text).intent).toBe('LOCATION_HOURS');
  });

  it('preserves EVENT_INFO for event interest without schedule or location semantics', () => {
    expect(classifySocialEngagement('Quero saber mais sobre o Sunset')).toMatchObject({
      intent: 'EVENT_INFO',
      eventInterest: 'SUNSET',
    });
  });

  it('preserves commercial precedence over schedule/event signals', () => {
    expect(
      classifySocialEngagement('Quanto custa o ingresso da The Party e que horas começa?'),
    ).toMatchObject({
      intent: 'COMMERCIAL_LEAD',
      eventInterest: 'THE_PARTY',
      commercialIntent: 'HIGH',
    });
  });
});
