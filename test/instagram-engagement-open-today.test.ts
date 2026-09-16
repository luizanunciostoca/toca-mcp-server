import { describe, expect, it } from 'vitest';
import { classifySocialEngagement } from '../src/crm/social-engagement-classifier.js';
import {
  normalizeKnowledgePrompt,
  resolveKnowledgeRows,
  type InstagramEngagementKnowledgeRow,
  type InstagramEngagementKnowledgeSource,
} from '../src/instagram-engagement/knowledge.js';
import { resolveGroupedKnowledge } from '../src/instagram-engagement/grouped-knowledge.js';

const FAQ_001: InstagramEngagementKnowledgeRow = {
  faqId: 'FAQ-001',
  intent: 'LOCATION_HOURS',
  answer: 'O Sunset acontece todos os dias, a partir das 16:30, no horário da Bahia.',
  source: 'canonical-operations-source',
  confidence: 0,
  factsVerified: true,
  prompts: [
    'Que horas começa o Sunset?',
    'Qual o horário do Sunset?',
    'O Sunset funciona todos os dias?',
  ].map(normalizeKnowledgePrompt),
};

const FAQ_011: InstagramEngagementKnowledgeRow = {
  faqId: 'FAQ-011',
  intent: 'LOCATION_HOURS',
  answer:
    'Na operação regular, o Sunset acontece todos os dias a partir das 16:30. A The Party acontece às sextas-feiras, das 23:59 às 06:00.',
  source: 'canonical-operations-source',
  confidence: 0,
  factsVerified: true,
  prompts: [
    'Quais dias e horários a Toca funciona?',
    'Que dias a Toca abre?',
    'Qual o horário de funcionamento?',
    'A Toca abre todo dia?',
    'Quando a Toca abre?',
  ].map(normalizeKnowledgePrompt),
};

const ROWS = [FAQ_001, FAQ_011] as const;

const knowledge: InstagramEngagementKnowledgeSource = {
  resolve(text, expectedIntent) {
    return Promise.resolve(resolveKnowledgeRows(text, expectedIntent, ROWS));
  },
};

describe('Instagram engagement open-today routing', () => {
  it.each([
    'Olá, vocês funcionam hoje?',
    'Olá, vocês abrem hoje?',
    'A Toca está aberta hoje?',
    'Vocês estão funcionando hoje?',
    'Vai abrir hoje?',
  ])('routes a natural open-today question to verified LOCATION_HOURS: %s', (text) => {
    const classification = classifySocialEngagement(text);

    expect(classification).toMatchObject({
      intent: 'LOCATION_HOURS',
      topic: 'LOCATION_HOURS',
      confidence: 'HIGH',
    });
    expect(resolveKnowledgeRows(text, classification.intent, ROWS)).toMatchObject({
      faqId: 'FAQ-011',
      intent: 'LOCATION_HOURS',
      factsVerified: true,
      confidence: 0.95,
    });
  });

  it('answers the two real messages safely when they are grouped into one batch', async () => {
    const result = await resolveGroupedKnowledge({
      groupedText: 'Olá, vocês funcionam hoje?\nOlá, vocês abrem hoje?',
      messageCount: 2,
      knowledge,
    });

    expect(result).toMatchObject({
      segmentCount: 2,
      resolvedSegmentCount: 2,
      autoReplySafe: true,
      hasUnresolvedSafeSegment: false,
    });
    expect(result.knowledge).toMatchObject({
      faqId: 'FAQ-011',
      factsVerified: true,
    });
    expect(result.knowledge?.answer).toContain('Sunset acontece todos os dias a partir das 16:30');
  });

  it('does not bind a Party-specific today question to generic Toca opening hours', () => {
    const classification = classifySocialEngagement('A The Party funciona hoje?');

    expect(classification.intent).toBe('LOCATION_HOURS');
    expect(resolveKnowledgeRows('A The Party funciona hoje?', classification.intent, ROWS)).toBeNull();
  });

  it('preserves gastronomy routing for today wording', () => {
    expect(classifySocialEngagement('O que tem hoje para comer?')).toMatchObject({
      intent: 'FAQ_OPERATIONAL',
      topic: 'GASTRONOMY',
    });
  });
});
