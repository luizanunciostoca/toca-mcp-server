import { classifySocialEngagement } from '../crm/social-engagement-classifier.js';
import type { SocialEngagementClassification } from '../crm/social-engagement-contracts.js';
import type { EngagementIntent } from '../policy/engagement-policy.js';
import type {
  InstagramEngagementKnowledgeMatch,
  InstagramEngagementKnowledgeSource,
} from './knowledge.js';
import { TOCA_OFFICIAL_INFORMATION_URL } from './ticket-information.js';

const NON_AUTONOMOUS_INTENTS = new Set<EngagementIntent>([
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

const MAX_KNOWLEDGE_SEGMENTS = 8;
const MAX_SPLIT_RESULTS = MAX_KNOWLEDGE_SEGMENTS + 1;
const MAX_REPLY_MESSAGE_LENGTH = 2_000;

const UNRESOLVED_NOTICE =
  `Não encontrei informação canônica suficiente para confirmar todos os outros pontos agora. ` +
  `Para a informação oficial mais atualizada, acesse: ${TOCA_OFFICIAL_INFORMATION_URL}`;

export interface GroupedKnowledgeResolution {
  readonly classification: SocialEngagementClassification;
  readonly knowledge: InstagramEngagementKnowledgeMatch | null;
  readonly segmentCount: number;
  readonly resolvedSegmentCount: number;
  readonly autoReplySafe: boolean;
  readonly hasUnresolvedSafeSegment: boolean;
}

interface SegmentResolution {
  readonly text: string;
  readonly classification: SocialEngagementClassification;
  readonly knowledge: InstagramEngagementKnowledgeMatch | null;
  readonly unsafe: boolean;
}

export async function resolveGroupedKnowledge(input: {
  readonly groupedText: string;
  readonly messageCount: number;
  readonly knowledge: InstagramEngagementKnowledgeSource;
}): Promise<GroupedKnowledgeResolution> {
  const classification = classifySocialEngagement(input.groupedText);
  const segments = splitMessageSegments(input.groupedText, input.messageCount);
  if (segments.length === 0) {
    return {
      classification,
      knowledge: null,
      segmentCount: 0,
      resolvedSegmentCount: 0,
      autoReplySafe: false,
      hasUnresolvedSafeSegment: false,
    };
  }

  // Fail closed before any delegated knowledge lookup. This prevents a single
  // inbound message from multiplying into an unbounded number of serial DB or
  // Sheets reads and, critically, avoids silently dropping a later risky clause.
  if (segments.length > MAX_KNOWLEDGE_SEGMENTS) {
    return {
      classification,
      knowledge: null,
      segmentCount: segments.length,
      resolvedSegmentCount: 0,
      autoReplySafe: false,
      hasUnresolvedSafeSegment: true,
    };
  }

  const resolved: SegmentResolution[] = [];
  for (const text of segments) {
    const segmentClassification = classifySocialEngagement(text);
    const unsafe = isUnsafeForAutonomousReply(segmentClassification);
    const match = unsafe ? null : await input.knowledge.resolve(text, segmentClassification.intent);
    resolved.push({
      text,
      classification: segmentClassification,
      knowledge: match,
      unsafe,
    });
  }

  const hasUnsafe = resolved.some((item) => item.unsafe);
  const verified = resolved
    .map((item) => item.knowledge)
    .filter((match): match is InstagramEngagementKnowledgeMatch => match?.factsVerified === true);
  const unique = uniqueMatches(verified);
  const safeCount = resolved.filter((item) => !item.unsafe).length;
  const resolvedSegmentCount = resolved.filter(
    (item) => item.knowledge?.factsVerified === true,
  ).length;
  const hasUnresolvedSafeSegment = resolvedSegmentCount < safeCount;
  const knowledge = hasUnsafe
    ? null
    : composeKnowledge(unique, hasUnresolvedSafeSegment, classification.intent);

  return {
    classification,
    knowledge,
    segmentCount: segments.length,
    resolvedSegmentCount,
    autoReplySafe: knowledge !== null,
    hasUnresolvedSafeSegment,
  };
}

export function splitMessageSegments(groupedText: string, messageCount: number): readonly string[] {
  const normalized = groupedText.trim();
  if (!normalized) return [];

  const lines = normalized
    .split(/\r?\n+/g)
    .map((value) => value.trim())
    .filter(Boolean);
  const chunks = lines
    .flatMap((line) =>
      line
        .split(/(?<=\?)\s+/g)
        .flatMap((questionChunk) => splitConjunctionQuestions(questionChunk))
        .map((value) => value.trim())
        .filter(Boolean),
    )
    .slice(0, MAX_SPLIT_RESULTS);

  if (messageCount <= 1 && chunks.length <= 1) return [normalized];
  return chunks.length > 0 ? chunks : [normalized];
}

function splitConjunctionQuestions(value: string): readonly string[] {
  return value.split(
    /\s+e\s+(?=(?:qual|quais|quanto|quantos|quanta|quantas|como|onde|quando|que|o que|tem)\b)/giu,
  );
}

function isUnsafeForAutonomousReply(classification: SocialEngagementClassification): boolean {
  return (
    NON_AUTONOMOUS_INTENTS.has(classification.intent) ||
    classification.containsPotentialSensitiveData ||
    classification.urgency === 'CRITICAL' ||
    classification.urgency === 'HIGH'
  );
}

function uniqueMatches(
  matches: readonly InstagramEngagementKnowledgeMatch[],
): readonly InstagramEngagementKnowledgeMatch[] {
  const seen = new Set<string>();
  const unique: InstagramEngagementKnowledgeMatch[] = [];
  for (const match of matches) {
    const key = `${match.faqId}|${match.answer.trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(match);
  }
  return unique;
}

function composeKnowledge(
  matches: readonly InstagramEngagementKnowledgeMatch[],
  hasUnresolvedSafeSegment: boolean,
  fallbackIntent: EngagementIntent,
): InstagramEngagementKnowledgeMatch | null {
  if (matches.length === 0) return null;
  const answers = [...new Set(matches.map((match) => match.answer.trim()).filter(Boolean))];
  if (hasUnresolvedSafeSegment) answers.push(UNRESOLVED_NOTICE);
  const answer = answers.join('\n\n');
  if (answer.length > MAX_REPLY_MESSAGE_LENGTH) return null;

  const sources = [...new Set(matches.map((match) => match.source.trim()).filter(Boolean))];
  const ids = [...new Set(matches.map((match) => match.faqId.trim()).filter(Boolean))];

  return {
    faqId: ids.length === 1 ? ids[0]! : `MULTI:${ids.join('+').slice(0, 180)}`,
    intent: matches[0]?.intent ?? fallbackIntent,
    answer,
    source: sources.join(' | '),
    confidence: Math.min(...matches.map((match) => match.confidence)),
    factsVerified: true,
    tier: matches.every((match) => match.tier === 'FAQ') ? 'FAQ' : 'KNOWLEDGE_BASE',
  };
}
