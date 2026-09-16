import { describe, expect, it, vi } from 'vitest';
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

function ticketKnowledgeMatch(): InstagramEngagementKnowledgeMatch {
  return {
    faqId: 'FAQ-003',
    intent: 'TICKET_INFO',
    answer: TOCA_TICKET_INFORMATION_REPLY,
    source: 'TOCA_OS — FAQ-003',
    confidence: 1,
    factsVerified: true,
    tier: 'FAQ',
  };
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

describe('Instagram customer-facing reply UX', () => {
  it('uses natural customer language for today programming', () => {
    const match = resolveCurrentProgrammingKnowledge('Qual a programação de hoje?', 'EVENT_INFO', {
      now: new Date('2026-09-16T14:30:00Z'),
    });

    expect(match?.answer).toContain(
      'Hoje tem Sunset na Toca do Morcego a partir das 16:30, no horário da Bahia.',
    );
    expect(match?.answer.toLowerCase()).not.toContain('canônica');
    expect(match?.answer.toLowerCase()).not.toContain('canonica');
  });

  it('uses natural language for the Friday party carryover', () => {
    const match = resolveCurrentProgrammingKnowledge('Qual a programação de hoje?', 'EVENT_INFO', {
      now: new Date('2026-09-19T05:30:00Z'),
    });

    expect(match?.answer).toContain(
      'Se você está falando de agora, a The Party de sexta-feira segue até 06:00 de sábado.',
    );
    expect(match?.answer.toLowerCase()).not.toContain('janela regular canônica');
  });

  it('emits the official Linktree only once in a ticket plus programming reply', async () => {
    const delegateResolve = vi.fn((_text: string, intent: EngagementIntent) =>
      Promise.resolve(intent === 'TICKET_INFO' ? ticketKnowledgeMatch() : null),
    );
    const delegate: InstagramEngagementKnowledgeSource = { resolve: delegateResolve };
    const source = new MultiIntentInstagramEngagementKnowledgeSource(delegate, {
      now: () => new Date('2026-09-16T14:30:00Z'),
    });

    const match = await source.resolve(
      'Qual o valor do ingresso? E qual a programação de hoje?',
      'EVENT_INFO',
    );

    expect(match?.factsVerified).toBe(true);
    expect(match?.answer).toContain('Os valores dos ingressos variam de acordo com a data.');
    expect(match?.answer).toContain('Hoje tem Sunset na Toca do Morcego a partir das 16:30');
    expect(match?.answer).toContain(
      `Para conferir a programação atualizada, valores e ingressos, acesse: ${TOCA_OFFICIAL_INFORMATION_URL}`,
    );
    expect(countOccurrences(match?.answer ?? '', TOCA_OFFICIAL_INFORMATION_URL)).toBe(1);
  });

  it('keeps one official Linktree when another safe grouped point is unresolved', async () => {
    const delegateResolve = vi.fn((_text: string, intent: EngagementIntent) =>
      Promise.resolve(intent === 'TICKET_INFO' ? ticketKnowledgeMatch() : null),
    );
    const source = new MultiIntentInstagramEngagementKnowledgeSource(
      { resolve: delegateResolve },
      { now: () => new Date('2026-09-16T14:30:00Z') },
    );

    const match = await source.resolve(
      'Qual o valor do ingresso? Qual a programação de hoje? Qual o horário de funcionamento?',
      'EVENT_INFO',
    );

    expect(match?.factsVerified).toBe(true);
    expect(match?.answer).toContain(
      'Não encontrei informação suficiente para confirmar todos os outros pontos agora.',
    );
    expect(match?.answer.toLowerCase()).not.toContain('informação canônica');
    expect(countOccurrences(match?.answer ?? '', TOCA_OFFICIAL_INFORMATION_URL)).toBe(1);
  });
});
