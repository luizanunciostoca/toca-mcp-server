export interface SunsetStoryProductionContext {
  readonly contentItemId: string;
  readonly sourceTaskId?: string;
  readonly currentMessage: string;
  readonly sameDayMessages?: readonly string[];
}

const SAME_DAY_SEMANTIC_DUPLICATION_THRESHOLD = 0.62;
const STOPWORDS = new Set([
  'a',
  'o',
  'as',
  'os',
  'e',
  'de',
  'da',
  'do',
  'das',
  'dos',
  'em',
  'na',
  'no',
  'nas',
  'nos',
  'um',
  'uma',
  'para',
  'por',
  'com',
  'que',
  'seu',
  'sua',
  'esse',
  'essa',
  'este',
  'esta',
  'nao',
]);

function normalizeToken(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokens(value: string): ReadonlySet<string> {
  const normalized = normalizeToken(value);
  if (normalized.length === 0) return new Set();
  return new Set(
    normalized
      .split(/\s+/)
      .filter((token) => token.length >= 3 && !STOPWORDS.has(token)),
  );
}

function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function sameDaySemanticSimilarity(left: string, right: string): number {
  return jaccard(tokens(left), tokens(right));
}

export function validateSunsetStoryProductionContext(
  context: SunsetStoryProductionContext,
): void {
  if (!context.contentItemId.startsWith('MKT-')) {
    throw new Error('SUNSET_CONTENT_ID_DRIFT');
  }
  if (context.sourceTaskId !== undefined && !context.sourceTaskId.startsWith('CONT-')) {
    throw new Error('SUNSET_SOURCE_TASK_ID_DRIFT');
  }
  if (context.sourceTaskId === context.contentItemId) {
    throw new Error('SUNSET_CONTENT_TASK_ID_COLLISION');
  }
  if (context.currentMessage.trim().length === 0) {
    throw new Error('SUNSET_CURRENT_MESSAGE_MISSING');
  }

  for (const prior of context.sameDayMessages ?? []) {
    if (
      sameDaySemanticSimilarity(context.currentMessage, prior) >=
      SAME_DAY_SEMANTIC_DUPLICATION_THRESHOLD
    ) {
      throw new Error('SUNSET_SAME_DAY_SEMANTIC_DUPLICATION');
    }
  }
}
