import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  PostgresInstagramEngagementKnowledgeBaseSource,
} from '../src/instagram-engagement/postgres-knowledge-base.js';

function candidate(heading: string, searchText: string) {
  return {
    chunk_id: `chunk:${heading.toLowerCase().replace(/\s+/g, '-')}`,
    heading,
    content: `Resposta canônica para ${heading}.`,
    search_text: searchText,
    risk: 'LOW' as const,
    autonomy: 'AUTO_REPLY_ALLOWED' as const,
    source_reference: 'fonte-canônica',
    rank: 0.2,
  };
}

describe('PostgresInstagramEngagementKnowledgeBaseSource', () => {
  it('removes conversational price noise before PostgreSQL full-text filtering', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        candidate(
          'Pedra do Morcego',
          'pedra do morcego bar autoral cachaça coco mix citrico preco valor cardapio r 50',
        ),
      ],
    });
    const source = new PostgresInstagramEngagementKnowledgeBaseSource(
      { query } as unknown as pg.Pool,
      { minimumConfidence: 0.5 },
    );

    const result = await source.resolve('Quanto custa Pedra do Morcego?', 'FAQ_OPERATIONAL');

    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[1]).toEqual(['pedra morcego', 'FAQ_OPERATIONAL', 12]);
    expect(result?.tier).toBe('KNOWLEDGE_BASE');
    expect(result?.factsVerified).toBe(true);
  });

  it('removes conversational location noise while retaining entity terms', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        candidate(
          'Localização geral da Toca do Morcego',
          'onde fica localizacao endereco toca do morcego morro de sao paulo ilha tinhare bahia brasil',
        ),
      ],
    });
    const source = new PostgresInstagramEngagementKnowledgeBaseSource(
      { query } as unknown as pg.Pool,
      { minimumConfidence: 0.5 },
    );

    const result = await source.resolve('Onde fica a Toca do Morcego?', 'LOCATION_HOURS');

    expect(query.mock.calls[0]?.[1]).toEqual(['toca morcego', 'LOCATION_HOURS', 12]);
    expect(result?.tier).toBe('KNOWLEDGE_BASE');
  });

  it('does not query broad knowledge for sensitive intents', async () => {
    const query = vi.fn();
    const source = new PostgresInstagramEngagementKnowledgeBaseSource(
      { query } as unknown as pg.Pool,
    );

    await expect(source.resolve('Quero reembolso', 'REFUND')).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});
