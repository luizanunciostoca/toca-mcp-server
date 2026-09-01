import type { EngagementIntent } from '../policy/engagement-policy.js';

export interface SpreadsheetValuesReader {
  readRange(spreadsheetId: string, range: string): Promise<readonly (readonly unknown[])[]>;
}

export interface InstagramEngagementKnowledgeMatch {
  readonly faqId: string;
  readonly intent: EngagementIntent;
  readonly answer: string;
  readonly source: string;
  readonly confidence: number;
  readonly factsVerified: boolean;
  readonly tier?: 'FAQ' | 'KNOWLEDGE_BASE';
  readonly chunkId?: string;
}

export interface InstagramEngagementKnowledgeSource {
  resolve(
    text: string,
    expectedIntent: EngagementIntent,
  ): Promise<InstagramEngagementKnowledgeMatch | null>;
}

export interface GoogleSheetsInstagramEngagementKnowledgeOptions {
  readonly client: SpreadsheetValuesReader;
  readonly spreadsheetId: string;
  readonly range?: string;
  readonly cacheMs?: number;
  readonly now?: () => number;
}

export interface InstagramEngagementKnowledgeRow extends InstagramEngagementKnowledgeMatch {
  readonly prompts: readonly string[];
}

const DEFAULT_RANGE = 'FAQ_IA!A:T';
const VERIFIED_STATUSES = new Set([
  'ACTIVE',
  'ATIVO',
  'VERIFIED',
  'VALIDADO',
  'APPROVED',
  'APROVADO',
]);
const HUMAN_INTENTS = new Set<EngagementIntent>([
  'COMPLAINT',
  'REFUND',
  'LEGAL',
  'SAFETY_INCIDENT',
  'PRESS',
  'PUBLIC_FIGURE',
  'HARASSMENT_OR_THREAT',
  'UNKNOWN',
]);

export class GoogleSheetsInstagramEngagementKnowledgeSource implements InstagramEngagementKnowledgeSource {
  private readonly range: string;
  private readonly cacheMs: number;
  private readonly now: () => number;
  private cache:
    | { readonly expiresAt: number; readonly rows: readonly InstagramEngagementKnowledgeRow[] }
    | undefined;

  constructor(private readonly options: GoogleSheetsInstagramEngagementKnowledgeOptions) {
    if (!options.spreadsheetId.trim())
      throw new Error('INSTAGRAM_ENGAGEMENT_KNOWLEDGE_SPREADSHEET_ID_REQUIRED');
    this.range = options.range?.trim() || DEFAULT_RANGE;
    this.cacheMs = options.cacheMs ?? 60_000;
    if (!Number.isInteger(this.cacheMs) || this.cacheMs < 0 || this.cacheMs > 3_600_000) {
      throw new Error('INSTAGRAM_ENGAGEMENT_KNOWLEDGE_CACHE_MS_INVALID');
    }
    this.now = options.now ?? Date.now;
  }

  async resolve(
    text: string,
    expectedIntent: EngagementIntent,
  ): Promise<InstagramEngagementKnowledgeMatch | null> {
    return resolveKnowledgeRows(text, expectedIntent, await this.rows());
  }

  private async rows(): Promise<readonly InstagramEngagementKnowledgeRow[]> {
    const now = this.now();
    if (this.cache && this.cache.expiresAt > now) return this.cache.rows;
    const values = await this.options.client.readRange(this.options.spreadsheetId, this.range);
    const parsed = parseKnowledgeRows(values);
    this.cache = { expiresAt: now + this.cacheMs, rows: parsed };
    return parsed;
  }
}

export function resolveKnowledgeRows(
  text: string,
  expectedIntent: EngagementIntent,
  rows: readonly InstagramEngagementKnowledgeRow[],
): InstagramEngagementKnowledgeMatch | null {
  const normalized = normalizeText(text);
  if (!normalized) return null;
  let best: InstagramEngagementKnowledgeRow | undefined;
  let bestScore = 0;

  for (const row of rows) {
    if (!row.factsVerified || row.intent !== expectedIntent || HUMAN_INTENTS.has(row.intent))
      continue;
    const score = Math.max(...row.prompts.map((prompt) => similarity(normalized, prompt)), 0);
    if (score > bestScore) {
      best = row;
      bestScore = score;
    }
  }

  if (!best || bestScore < 0.78) return null;
  return {
    faqId: best.faqId,
    intent: best.intent,
    answer: best.answer,
    source: best.source,
    confidence: bestScore,
    factsVerified: true,
    tier: best.tier ?? 'FAQ',
    ...(best.chunkId ? { chunkId: best.chunkId } : {}),
  };
}

export function parseKnowledgeRows(
  values: readonly (readonly unknown[])[],
): readonly InstagramEngagementKnowledgeRow[] {
  const [headerRaw, ...body] = values;
  if (!headerRaw) return [];
  const headers = headerRaw.map((value) => scalarText(value).toLowerCase());
  const index = new Map(headers.map((header, position) => [header, position] as const));
  const rows: InstagramEngagementKnowledgeRow[] = [];

  for (const raw of body) {
    const faqId = cell(raw, index, 'faq_id');
    const canonical = cell(raw, index, 'pergunta_canonica');
    const variants = cell(raw, index, 'variantes_pergunta');
    const answer = cell(raw, index, 'resposta_oficial');
    const source = cell(raw, index, 'fonte_resposta_toca_os');
    const status = cell(raw, index, 'status').toUpperCase();
    const autonomy = cell(raw, index, 'autonomy_default').toUpperCase();
    const intent = parseEngagementIntent(cell(raw, index, 'intent'));
    if (!faqId || !canonical || !intent) continue;

    const prompts = [canonical, ...splitVariants(variants)].map(normalizeText).filter(Boolean);
    const factsVerified = isVerifiedKnowledgeConfiguration(
      status,
      autonomy,
      answer,
      source,
      intent,
    );
    rows.push({
      faqId,
      intent,
      answer,
      source,
      confidence: 0,
      factsVerified,
      prompts: [...new Set(prompts)],
      tier: 'FAQ',
    });
  }
  return rows;
}

export function parseEngagementIntent(value: string): EngagementIntent | undefined {
  const candidate = value.trim().toUpperCase();
  const allowed: readonly EngagementIntent[] = [
    'FAQ_OPERATIONAL',
    'EVENT_INFO',
    'TICKET_INFO',
    'LOCATION_HOURS',
    'GENERAL_SOCIAL',
    'COMMERCIAL_LEAD',
    'COMPLAINT',
    'REFUND',
    'LEGAL',
    'SAFETY_INCIDENT',
    'PRESS',
    'PUBLIC_FIGURE',
    'HARASSMENT_OR_THREAT',
    'UNKNOWN',
  ];
  return allowed.includes(candidate as EngagementIntent)
    ? (candidate as EngagementIntent)
    : undefined;
}

export function isVerifiedKnowledgeConfiguration(
  status: string,
  autonomy: string,
  answer: string,
  source: string,
  intent: EngagementIntent,
): boolean {
  return (
    VERIFIED_STATUSES.has(status.trim().toUpperCase()) &&
    autonomy.trim().toUpperCase() === 'AUTO_REPLY_ALLOWED' &&
    answer.trim().length > 0 &&
    source.trim().length > 0 &&
    !HUMAN_INTENTS.has(intent)
  );
}

export function normalizeKnowledgePrompt(value: string): string {
  return normalizeText(value);
}

export function knowledgeSimilarity(left: string, right: string): number {
  return similarity(normalizeText(left), normalizeText(right));
}

function cell(row: readonly unknown[], index: ReadonlyMap<string, number>, key: string): string {
  const position = index.get(key);
  if (position === undefined) return '';
  return scalarText(row[position]);
}

function scalarText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value).trim();
  }
  return '';
}

function splitVariants(value: string): readonly string[] {
  return value
    .split(/[\n|;]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.length >= 12 && right.length >= 12 && (left.includes(right) || right.includes(left)))
    return 0.92;
  const leftTokens = new Set(left.split(' ').filter((token) => token.length > 1));
  const rightTokens = new Set(right.split(' ').filter((token) => token.length > 1));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 0 : intersection / union;
}
