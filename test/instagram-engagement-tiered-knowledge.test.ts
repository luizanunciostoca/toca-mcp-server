import { describe, expect, it, vi } from 'vitest';
import type { InstagramEngagementKnowledgeSource } from '../src/instagram-engagement/knowledge.js';
import { TieredInstagramEngagementKnowledgeSource } from '../src/instagram-engagement/tiered-knowledge.js';

describe('TieredInstagramEngagementKnowledgeSource', () => {
  it('uses a verified FAQ before querying the broader knowledge base', async () => {
    const faq: InstagramEngagementKnowledgeSource = {
      resolve: vi.fn().mockResolvedValue({
        faqId: 'FAQ-001',
        intent: 'LOCATION_HOURS',
        answer: 'O Sunset acontece todos os dias, a partir das 16:30.',
        source: 'TOCA OS operations',
        confidence: 1,
        factsVerified: true,
        tier: 'FAQ',
      }),
    };
    const knowledgeBaseResolve = vi.fn().mockResolvedValue(null);
    const knowledgeBase: InstagramEngagementKnowledgeSource = {
      resolve: knowledgeBaseResolve,
    };
    const source = new TieredInstagramEngagementKnowledgeSource({ faq, knowledgeBase });

    const match = await source.resolve('Que horas começa o Sunset?', 'LOCATION_HOURS');

    expect(match?.faqId).toBe('FAQ-001');
    expect(match?.tier).toBe('FAQ');
    expect(knowledgeBaseResolve).not.toHaveBeenCalled();
  });

  it('falls back to the knowledge base only when FAQ resolution has no match', async () => {
    const faq: InstagramEngagementKnowledgeSource = {
      resolve: vi.fn().mockResolvedValue(null),
    };
    const knowledgeBaseResolve = vi.fn().mockResolvedValue({
      faqId: 'KB:src-menu-002:pedra-do-morcego',
      intent: 'FAQ_OPERATIONAL',
      answer: 'Pedra do Morcego. Preço vigente exibido no cardápio: R$ 50.',
      source: 'CARDAPIO_CANONICO — Drive ID menu',
      confidence: 0.83,
      factsVerified: true,
      tier: 'KNOWLEDGE_BASE',
      chunkId: 'src-menu-002:pedra-do-morcego',
    });
    const knowledgeBase: InstagramEngagementKnowledgeSource = {
      resolve: knowledgeBaseResolve,
    };
    const source = new TieredInstagramEngagementKnowledgeSource({ faq, knowledgeBase });

    const match = await source.resolve('Quanto custa Pedra do Morcego?', 'FAQ_OPERATIONAL');

    expect(match?.tier).toBe('KNOWLEDGE_BASE');
    expect(match?.chunkId).toBe('src-menu-002:pedra-do-morcego');
    expect(knowledgeBaseResolve).toHaveBeenCalledOnce();
  });
});
