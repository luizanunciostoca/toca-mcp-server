import type pg from 'pg';
import type { EngagementIntent } from '../policy/engagement-policy.js';
import {
  knowledgeSimilarity,
  normalizeKnowledgePrompt,
  type InstagramEngagementKnowledgeMatch,
  type InstagramEngagementKnowledgeSource,
} from './knowledge.js';

interface KnowledgeBaseCandidate {
  readonly chunk_id: string;
  readonly heading: string;
  readonly content: string;
  readonly search_text: string;
  readonly risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly autonomy: 'READ_ONLY' | 'SUGGEST_ONLY' | 'AUTO_REPLY_ALLOWED' | 'HUMAN_REVIEW_REQUIRED';
  readonly source_reference: string;
  readonly rank: number;
}

const HUMAN_OR_SENSITIVE_INTENTS = new Set<EngagementIntent>([
  'COMMERCIAL_LEAD',
  'COMPLAINT',
  'REFUND',
  'LEGAL',
  'SAFETY_INCIDENT',
  'PRESS',
  'PUBLIC_FIGURE',
  'HARASSMENT_OR_THREAT',
  'UNKNOWN',
]);

const FTS_QUESTION_NOISE = new Set([
  'a',
  'as',
  'o',
  'os',
  'um',
  'uma',
  'uns',
  'umas',
  'de',
  'da',
  'das',
  'do',
  'dos',
  'e',
  'em',
  'no',
  'na',
  'nos',
  'nas',
  'para',
  'por',
  'quanto',
  'quantos',
  'quanta',
  'quantas',
  'custa',
  'custam',
  'custo',
  'preco',
  'precos',
  'valor',
  'valores',
  'onde',
  'fica',
  'ficam',
  'qual',
  'quais',
  'que',
  'tem',
  'me',
  'diz',
  'saber',
]);

export interface PostgresInstagramEngagementKnowledgeBaseOptions {
  readonly minimumConfidence?: number;
  readonly limit?: number;
}

export class PostgresInstagramEngagementKnowledgeBaseSource implements InstagramEngagementKnowledgeSource {
  private readonly minimumConfidence: number;
  private readonly limit: number;

  constructor(
    private readonly pool: pg.Pool,
    options: PostgresInstagramEngagementKnowledgeBaseOptions = {},
  ) {
    this.minimumConfidence = options.minimumConfidence ?? 0.58;
    this.limit = options.limit ?? 12;
    if (
      !Number.isFinite(this.minimumConfidence) ||
      this.minimumConfidence < 0.3 ||
      this.minimumConfidence > 0.95
    ) {
      throw new Error('INSTAGRAM_ENGAGEMENT_KB_CONFIDENCE_INVALID');
    }
    if (!Number.isInteger(this.limit) || this.limit < 1 || this.limit > 50) {
      throw new Error('INSTAGRAM_ENGAGEMENT_KB_LIMIT_INVALID');
    }
  }

  async resolve(
    text: string,
    expectedIntent: EngagementIntent,
  ): Promise<InstagramEngagementKnowledgeMatch | null> {
    if (HUMAN_OR_SENSITIVE_INTENTS.has(expectedIntent)) return null;
    const query = normalizeKnowledgePrompt(text);
    if (!query) return null;
    const retrievalQuery = knowledgeRetrievalQuery(query);

    const result = await this.pool.query<KnowledgeBaseCandidate>(
      `select c.chunk_id, c.heading, c.content, c.search_text, c.risk, c.autonomy,
              c.source_reference,
              ts_rank_cd(c.search_vector, plainto_tsquery('simple', $1))::double precision as rank
         from instagram_engagement_knowledge_chunks c
         join instagram_engagement_knowledge_documents d on d.document_id = c.document_id
        where c.active = true
          and d.active = true
          and $2 = any(c.intent_hints)
          and c.autonomy in ('AUTO_REPLY_ALLOWED','SUGGEST_ONLY')
          and c.risk in ('LOW','MEDIUM')
          and c.search_vector @@ plainto_tsquery('simple', $1)
        order by rank desc, c.chunk_id asc
        limit $3`,
      [retrievalQuery, expectedIntent, this.limit],
    );

    let best: KnowledgeBaseCandidate | undefined;
    let bestConfidence = 0;
    for (const candidate of result.rows) {
      const lexical = Math.max(
        knowledgeSimilarity(text, candidate.heading),
        knowledgeSimilarity(text, candidate.search_text),
      );
      const ftsBoost = candidate.rank > 0 ? Math.min(0.18, 0.08 + candidate.rank) : 0;
      const confidence = Math.min(1, lexical + ftsBoost);
      if (confidence > bestConfidence) {
        best = candidate;
        bestConfidence = confidence;
      }
    }

    if (!best || bestConfidence < this.minimumConfidence) return null;
    const factsVerified = best.risk === 'LOW' && best.autonomy === 'AUTO_REPLY_ALLOWED';
    return {
      faqId: `KB:${best.chunk_id}`,
      intent: expectedIntent,
      answer: best.content,
      source: best.source_reference,
      confidence: bestConfidence,
      factsVerified,
      tier: 'KNOWLEDGE_BASE',
      chunkId: best.chunk_id,
    };
  }
}

function knowledgeRetrievalQuery(normalized: string): string {
  const significant = normalized
    .split(' ')
    .filter((token) => token.length > 1 && !FTS_QUESTION_NOISE.has(token));
  return significant.length > 0 ? significant.join(' ') : normalized;
}
