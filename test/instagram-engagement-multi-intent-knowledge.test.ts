import { describe, expect, it, vi } from 'vitest';
import { classifySocialEngagement } from '../src/crm/social-engagement-classifier.js';
import type { EngagementIntent } from '../src/policy/engagement-policy.js';
import { resolveCurrentProgrammingKnowledge } from '../src/instagram-engagement/current-programming.js';
import type {
  InstagramEngagementKnowledgeMatch,
  InstagramEngagementKnowledgeSource,
} from '../src/instagram-engagement/knowledge.js';
import { MultiIntentInstagramEngagementKnowledgeSource } from '../src/instagram-engagement/multi-intent-knowledge.js';
import {
  TOCA_OFFICIAL_INFORMATION_URL,
  TOCA_TICKET_INFORMATION_REPLY,
} from '../src/instagram-engagement/ticket-information.js';

function ticketKnowledgeMatch(
  answer = TOCA_TICKET_INFORMATION_REPLY,
  faqId = 'FAQ-003',
  source = 'TOCA_OS — FAQ-003',
): InstagramEngagementKnowledgeMatch {
  return {
    faqId,
    intent: 'TICKET_INFO',
    answer,
    source,
    confidence: 1,
    factsVerified: true,
    tier: 'FAQ',
  };
}

describe('Instagram grounded multi-intent knowledge', () => {
  it('classifies a current-programming question as EVENT_INFO', () => {
    const classification = classifySocialEngagement('Qual a programação de hoje?');

    expect(classification.intent).toBe('EVENT_INFO');
    expect(classification.topic).toBe('EVENT_INFO');
    expect(classification.confidence).toBe('HIGH');
  });

  it.each(['O que tem hoje?', 'O que acontece hoje?', 'Tem algo hoje?', 'Agenda hoje?'])(
    'routes the grounded today alias "%s" to EVENT_INFO',
    (text) => {
      expect(classifySocialEngagement(text).intent).toBe('EVENT_INFO');
    },
  );

  it('resolves a generic today alias through the grounded programming source', async () => {
    const delegateResolve = vi.fn().mockResolvedValue(null);
    const source = new MultiIntentInstagramEngagementKnowledgeSource(
      { resolve: delegateResolve },
      { now: () => new Date('2026-09-16T14:30:00Z') },
    );
    const classification = classifySocialEngagement('Agenda hoje?');

    const match = await source.resolve('Agenda hoje?', classification.intent);

    expect(match?.factsVerified).toBe(true);
    expect(match?.answer).toContain('Sunset na Toca do Morcego a partir das 16:30');
  });

  it('preserves a human-required press route when programming is mixed into the same message', async () => {
    const classification = classifySocialEngagement('Sou jornalista, qual a programação de hoje?');
    expect(classification.intent).toBe('PRESS');

    const delegateResolve = vi.fn().mockResolvedValue(null);
    const source = new MultiIntentInstagramEngagementKnowledgeSource(
      { resolve: delegateResolve },
      {
        now: () => new Date('2026-09-16T14:30:00Z'),
      },
    );

    const match = await source.resolve(
      'Sou jornalista, qual a programação de hoje?',
      classification.intent,
    );

    expect(match).toBeNull();
    expect(delegateResolve).toHaveBeenCalledWith(
      'Sou jornalista, qual a programação de hoje?',
      'PRESS',
    );
  });

  it('answers current Wednesday programming from canonical regular operations', () => {
    const match = resolveCurrentProgrammingKnowledge('Qual a programação de hoje?', 'EVENT_INFO', {
      now: new Date('2026-09-16T14:30:00Z'),
    });

    expect(match?.factsVerified).toBe(true);
    expect(match?.answer).toContain('Sunset na Toca do Morcego a partir das 16:30');
    expect(match?.answer).not.toContain('The Party acontece');
    expect(match?.answer).not.toContain('samba e pagode');
    expect(match?.answer).toContain(TOCA_OFFICIAL_INFORMATION_URL);
    expect(match?.answer).toContain('Atrações, edições especiais e valores podem variar');
  });

  it('adds the regular Friday The Party window without inventing attractions or prices', () => {
    const match = resolveCurrentProgrammingKnowledge('O que tem hoje na Toca?', 'EVENT_INFO', {
      now: new Date('2026-09-18T14:30:00Z'),
    });

    expect(match?.answer).toContain('Sunset na Toca do Morcego a partir das 16:30');
    expect(match?.answer).toContain('The Party acontece das 23:59 às 06:00');
    expect(match?.answer).not.toMatch(/R\$\s*\d/);
    expect(match?.answer).not.toMatch(/DJ\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+/);
  });

  it('includes the Friday party carryover on early Saturday in Bahia', () => {
    const match = resolveCurrentProgrammingKnowledge('Qual a programação de hoje?', 'EVENT_INFO', {
      now: new Date('2026-09-19T05:30:00Z'),
    });

    expect(match?.factsVerified).toBe(true);
    expect(match?.faqId).toContain('FRIDAY_CARRYOVER');
    expect(match?.answer).toContain('The Party de sexta-feira');
    expect(match?.answer).toContain('segue até 06:00 de sábado');
    expect(match?.answer).toContain('Aos sábados, o Sunset tem samba e pagode');
  });

  it('does not include the Friday carryover after the canonical Saturday cutoff', () => {
    const match = resolveCurrentProgrammingKnowledge('Qual a programação de hoje?', 'EVENT_INFO', {
      now: new Date('2026-09-19T09:00:00Z'),
    });

    expect(match?.faqId).not.toContain('FRIDAY_CARRYOVER');
    expect(match?.answer).not.toContain('The Party de sexta-feira');
    expect(match?.answer).toContain('Aos sábados, o Sunset tem samba e pagode');
  });

  it('adds the approved Saturday samba/pagode fact', () => {
    const match = resolveCurrentProgrammingKnowledge('Programação de hoje?', 'EVENT_INFO', {
      now: new Date('2026-09-19T14:30:00Z'),
    });

    expect(match?.answer).toContain('Aos sábados, o Sunset tem samba e pagode');
    expect(match?.source).toContain('FAQ-036');
  });

  it('reproduces the screenshot scenario and answers both questions in one grounded reply', async () => {
    const delegateResolve = vi.fn((text: string, intent: EngagementIntent) =>
      Promise.resolve(
        intent === 'TICKET_INFO' && text.toLowerCase().includes('ingresso')
          ? ticketKnowledgeMatch()
          : null,
      ),
    );
    const delegate: InstagramEngagementKnowledgeSource = { resolve: delegateResolve };
    const source = new MultiIntentInstagramEngagementKnowledgeSource(delegate, {
      now: () => new Date('2026-09-16T14:30:00Z'),
    });

    const match = await source.resolve(
      'Qual o valor do ingresso?\nQual a programação de hoje?',
      'EVENT_INFO',
    );

    expect(match?.factsVerified).toBe(true);
    expect(match?.answer).toContain('Os valores dos ingressos variam de acordo com a data');
    expect(match?.answer).toContain('Sunset na Toca do Morcego a partir das 16:30');
    expect(match?.answer).toContain(TOCA_OFFICIAL_INFORMATION_URL);
    expect(match?.answer).not.toContain('utm_');
    expect(match?.answer).not.toContain('fbclid');
    expect(delegateResolve).toHaveBeenCalledWith('Qual o valor do ingresso?', 'TICKET_INFO');
    expect(delegateResolve).toHaveBeenCalledWith('Qual a programação de hoje?', 'EVENT_INFO');
  });

  it('splits two questions written in one Direct message and resolves both intents', async () => {
    const delegateResolve = vi.fn((_text: string, intent: EngagementIntent) =>
      Promise.resolve(intent === 'TICKET_INFO' ? ticketKnowledgeMatch() : null),
    );
    const delegate: InstagramEngagementKnowledgeSource = { resolve: delegateResolve };
    const source = new MultiIntentInstagramEngagementKnowledgeSource(delegate, {
      now: () => new Date('2026-09-16T14:30:00Z'),
    });

    const match = await source.resolve(
      'Qual o valor do ingresso? Qual a programação de hoje?',
      'EVENT_INFO',
    );

    expect(match?.answer).toContain('Os valores dos ingressos variam');
    expect(match?.answer).toContain('Sunset na Toca do Morcego a partir das 16:30');
  });

  it('splits conjunction-based questions and resolves ticket plus programming independently', async () => {
    const delegateResolve = vi.fn((_text: string, intent: EngagementIntent) =>
      Promise.resolve(intent === 'TICKET_INFO' ? ticketKnowledgeMatch() : null),
    );
    const source = new MultiIntentInstagramEngagementKnowledgeSource(
      { resolve: delegateResolve },
      { now: () => new Date('2026-09-16T14:30:00Z') },
    );

    const match = await source.resolve(
      'Qual o valor do ingresso e qual a programação de hoje?',
      'EVENT_INFO',
    );

    expect(match?.answer).toContain('Os valores dos ingressos variam');
    expect(match?.answer).toContain('Sunset na Toca do Morcego a partir das 16:30');
    expect(delegateResolve).toHaveBeenCalledWith('Qual o valor do ingresso', 'TICKET_INFO');
    expect(delegateResolve).toHaveBeenCalledWith('qual a programação de hoje?', 'EVENT_INFO');
  });

  it('fails closed when a grouped message contains a human-required intent', async () => {
    const delegate: InstagramEngagementKnowledgeSource = {
      resolve: vi.fn().mockResolvedValue(ticketKnowledgeMatch()),
    };
    const source = new MultiIntentInstagramEngagementKnowledgeSource(delegate, {
      now: () => new Date('2026-09-16T14:30:00Z'),
    });

    const match = await source.resolve(
      'Qual o valor do ingresso?\nQuero reembolso do meu ingresso.',
      'TICKET_INFO',
    );

    expect(match).toBeNull();
  });

  it('fails closed when a grouped message contains a commercial lead', async () => {
    const delegateResolve = vi.fn((_text: string, intent: EngagementIntent) =>
      Promise.resolve(intent === 'TICKET_INFO' ? ticketKnowledgeMatch() : null),
    );
    const source = new MultiIntentInstagramEngagementKnowledgeSource({ resolve: delegateResolve });

    const match = await source.resolve(
      'Quero reservar um camarote?\nQual o valor do ingresso?',
      'TICKET_INFO',
    );

    expect(match).toBeNull();
    expect(delegateResolve).not.toHaveBeenCalledWith(
      'Quero reservar um camarote?',
      'COMMERCIAL_LEAD',
    );
    expect(delegateResolve).toHaveBeenCalledWith('Qual o valor do ingresso?', 'TICKET_INFO');
  });

  it('fails closed before delegated lookups when segment count exceeds the bound', async () => {
    const delegateResolve = vi.fn().mockResolvedValue(ticketKnowledgeMatch());
    const source = new MultiIntentInstagramEngagementKnowledgeSource({ resolve: delegateResolve });
    const abusiveGroupedInput = Array.from({ length: 9 }, () => 'Qual o valor do ingresso?').join(
      '\n',
    );

    const match = await source.resolve(abusiveGroupedInput, 'TICKET_INFO');

    expect(match).toBeNull();
    expect(delegateResolve).not.toHaveBeenCalled();
  });

  it('fails closed when a composed verified reply would exceed the provider envelope', async () => {
    const delegateResolve = vi.fn((text: string, _intent: EngagementIntent) =>
      Promise.resolve(
        ticketKnowledgeMatch(
          `${text} ${'A'.repeat(300)}`,
          `FAQ-${text}`,
          `TOCA_OS — ${text}`,
        ),
      ),
    );
    const source = new MultiIntentInstagramEngagementKnowledgeSource({ resolve: delegateResolve });
    const groupedInput = Array.from(
      { length: 8 },
      (_, index) => `Qual o valor do ingresso ${index + 1}?`,
    ).join('\n');

    const match = await source.resolve(groupedInput, 'TICKET_INFO');

    expect(match).toBeNull();
    expect(delegateResolve).toHaveBeenCalledTimes(8);
  });
});
