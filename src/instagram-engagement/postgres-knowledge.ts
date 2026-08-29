import type pg from 'pg';
import type { EngagementIntent } from '../policy/engagement-policy.js';
import {
  isVerifiedKnowledgeConfiguration,
  normalizeKnowledgePrompt,
  parseEngagementIntent,
  resolveKnowledgeRows,
  type InstagramEngagementKnowledgeMatch,
  type InstagramEngagementKnowledgeRow,
  type InstagramEngagementKnowledgeSource,
} from './knowledge.js';

interface KnowledgeDbRow {
  readonly faq_id: string;
  readonly canonical_question: string;
  readonly variants: readonly string[];
  readonly intent: string;
  readonly autonomy: string;
  readonly answer: string;
  readonly source: string;
  readonly status: string;
}

export class PostgresInstagramEngagementKnowledgeSource
  implements InstagramEngagementKnowledgeSource
{
  constructor(
    private readonly pool: pg.Pool,
    private readonly sourceSpreadsheetId?: string,
  ) {}

  async resolve(
    text: string,
    expectedIntent: EngagementIntent,
  ): Promise<InstagramEngagementKnowledgeMatch | null> {
    const params: unknown[] = [];
    let sourceFilter = '';
    if (this.sourceSpreadsheetId?.trim()) {
      params.push(this.sourceSpreadsheetId.trim());
      sourceFilter = ` and source_spreadsheet_id = $${params.length}`;
    }
    const result = await this.pool.query<KnowledgeDbRow>(
      `select faq_id, canonical_question, variants, intent, autonomy, answer, source, status
         from instagram_engagement_knowledge
        where active = true${sourceFilter}
        order by faq_id asc`,
      params,
    );
    const rows = result.rows.map(toKnowledgeRow).filter(isKnowledgeRow);
    return resolveKnowledgeRows(text, expectedIntent, rows);
  }
}

function toKnowledgeRow(row: KnowledgeDbRow): InstagramEngagementKnowledgeRow | undefined {
  const intent = parseEngagementIntent(row.intent);
  if (!intent) return undefined;
  const prompts = [row.canonical_question, ...(row.variants ?? [])]
    .map(normalizeKnowledgePrompt)
    .filter(Boolean);
  return {
    faqId: row.faq_id,
    intent,
    answer: row.answer,
    source: row.source,
    confidence: 0,
    factsVerified: isVerifiedKnowledgeConfiguration(
      row.status,
      row.autonomy,
      row.answer,
      row.source,
      intent,
    ),
    prompts: [...new Set(prompts)],
  };
}

function isKnowledgeRow(
  row: InstagramEngagementKnowledgeRow | undefined,
): row is InstagramEngagementKnowledgeRow {
  return row !== undefined;
}
