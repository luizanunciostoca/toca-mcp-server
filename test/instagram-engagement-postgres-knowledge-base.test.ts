import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { PostgresInstagramEngagementKnowledgeBaseSource } from '../src/instagram-engagement/postgres-knowledge-base.js';

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

describe('PostgresInstagramEngagementKnowledgeBaseSource', () => {
  it('retrieves a menu chunk from a natural-language price question', async () => {
    const { pool, query } = createPool([
      {
        chunk_id: 'src-menu-002:pedra-do-morcego',
        heading: 'Pedra do Morcego',
        content: 'Pedra do Morcego. Preço vigente exibido no cardápio: R$ 50.',
        search_text: 'pedra do morcego autoral preco valor cardapio menu r 50',
        risk: 'LOW',
        autonomy: 'AUTO_REPLY_ALLOWED',
        source_reference: 'TOCA OS menu canônico',
        rank: 0.2,
      },
    ]);
    const source = new PostgresInstagramEngagementKnowledgeBaseSource(pool, {
      minimumConfidence: 0.5,
    });

    const match = await source.resolve('Quanto custa Pedra do Morcego?', 'FAQ_OPERATIONAL');

    expect(match?.tier).toBe('KNOWLEDGE_BASE');
    expect(match?.factsVerified).toBe(true);
    expect(match?.chunkId).toBe('src-menu-002:pedra-do-morcego');
    expect(query).toHaveBeenCalledWith(expect.stringContaining("to_tsquery('simple', $1)"), [
      'quanto | custa | pedra | do | morcego',
      'FAQ_OPERATIONAL',
      12,
    ]);
  });

  it('still fails closed for sensitive intents before querying PostgreSQL', async () => {
    const { pool, query } = createPool([]);
    const source = new PostgresInstagramEngagementKnowledgeBaseSource(pool);

    expect(await source.resolve('Quero reembolso', 'REFUND')).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});
