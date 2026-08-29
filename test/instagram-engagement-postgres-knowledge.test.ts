import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { PostgresInstagramEngagementKnowledgeSource } from '../src/instagram-engagement/postgres-knowledge.js';

function createPool(rows: readonly Record<string, unknown>[]): {
  readonly pool: pg.Pool;
  readonly query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn().mockResolvedValue({ rows });
  return {
    pool: { query } as unknown as pg.Pool,
    query,
  };
}

describe('PostgresInstagramEngagementKnowledgeSource', () => {
  it('resolves an approved low-risk auto-reply row', async () => {
    const { pool, query } = createPool([
      {
        faq_id: 'FAQ-001',
        canonical_question: 'Que horas começa o Sunset?',
        variants: ['Qual o horário do Sunset?'],
        intent: 'LOCATION_HOURS',
        autonomy: 'AUTO_REPLY_ALLOWED',
        answer: 'O Sunset acontece todos os dias, a partir das 16:30.',
        source: 'TOCA_OS canonical operations',
        status: 'APROVADO',
      },
    ]);
    const source = new PostgresInstagramEngagementKnowledgeSource(pool, 'sheet-1');

    const match = await source.resolve('Qual o horário do Sunset?', 'LOCATION_HOURS');

    expect(match?.faqId).toBe('FAQ-001');
    expect(match?.factsVerified).toBe(true);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('source_spreadsheet_id = $1'), [
      'sheet-1',
    ]);
  });

  it('never returns a commercial SUGGEST_ONLY row as verified knowledge', async () => {
    const { pool } = createPool([
      {
        faq_id: 'FAQ-010',
        canonical_question: 'Quero fazer uma reserva ou evento privado, como faço?',
        variants: ['Quero reservar mesa'],
        intent: 'COMMERCIAL_LEAD',
        autonomy: 'SUGGEST_ONLY',
        answer: 'Encaminhar para atendimento humano/CRM.',
        source: 'TOCA OS engagement policy',
        status: 'APROVADO',
      },
    ]);
    const source = new PostgresInstagramEngagementKnowledgeSource(pool, 'sheet-1');

    expect(await source.resolve('Quero reservar mesa', 'COMMERCIAL_LEAD')).toBeNull();
  });

  it('fails closed for human-review intents even if a row is misconfigured as auto reply', async () => {
    const { pool } = createPool([
      {
        faq_id: 'FAQ-HIGH',
        canonical_question: 'Quero reembolso',
        variants: [],
        intent: 'REFUND',
        autonomy: 'AUTO_REPLY_ALLOWED',
        answer: 'Resposta que não pode sair automaticamente.',
        source: 'fonte',
        status: 'APROVADO',
      },
    ]);
    const source = new PostgresInstagramEngagementKnowledgeSource(pool, 'sheet-1');

    expect(await source.resolve('Quero reembolso', 'REFUND')).toBeNull();
  });
});
