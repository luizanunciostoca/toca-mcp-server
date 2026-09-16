import type {
  SocialConversationIntent,
  SocialEngagementClassification,
  SocialTopic,
} from './social-engagement-contracts.js';
import { classifySocialEngagement as classifyCoreSocialEngagement } from './social-engagement-classifier-core.js';

interface CanonicalRoute {
  readonly intent: SocialEngagementClassification['intent'];
  readonly topic?: SocialTopic;
  readonly addConversationIntents?: readonly SocialConversationIntent[];
}

const TICKET_INFO_PATTERNS = ['quanto pago para entrar'];

const LOCATION_HOURS_PATTERNS = [
  'onde e a toca',
  'a toca fica onde',
  'em que lugar fica a toca',
  'a toca fica em qual cidade',
  'a toca fica em morro',
  'todo dia tem sunset',
  'tem sunset todos os dias',
  'qual a programacao regular da toca',
];

const OFFICIAL_OPERATIONAL_PATTERNS = [
  'tem site',
  'qual o website da toca',
  'onde vejo informacoes oficiais',
  'qual o @ da toca',
  'qual o arroba da toca',
  'como falo com atendimento',
  'quero falar com a toca',
  'tem restaurante',
  'tem jantar',
  'tem bar',
  'onde vejo a programacao e informacoes oficiais',
  'onde vejo a agenda',
  'onde acompanho novidades',
  'onde vejo eventos da toca',
  'onde confirmo a programacao',
  'onde encontro informacoes atualizadas',
  'quero trabalhar com voces',
];

const GENERAL_SOCIAL_PATTERNS = [
  'que lugar e a toca',
  'como voce define a toca',
  'a toca e o que',
  'o que tem para fazer na toca',
  'o que tem na toca',
  'quais experiencias a toca tem',
  'quais produtos a toca oferece',
  'tem sunset e festa',
  'o que a toca oferece',
  'qual a ideia da toca',
  'qual a missao da experiencia toca',
  'por que a toca existe',
  'a toca e bar restaurante ou balada',
  'a toca e uma balada',
  'a toca e restaurante',
  'a toca e bar',
  'que tipo de lugar e a toca',
  'a toca e uma casa noturna',
];

const EVENT_INFO_PATTERNS = [
  'o que acontece no sunset',
  'como funciona o sunset',
  'o que tem no sunset',
  'vale a pena ir no sunset',
  'o que acontece na the party',
  'como funciona a festa da toca',
  'o que e a festa da toca',
  'como e a balada da toca',
  'a toca faz eventos especiais',
  'tem eventos especiais',
  'a toca faz eventos tematicos',
  'tem festas especiais alem da the party',
  'voces fazem eventos sazonais',
  'o que tem no sunset de sabado',
  'sabado tem o que na toca',
  'tem samba sabado',
  'tem pagode sabado',
  'o sunset de sabado tem samba',
  'o sunset de sabado tem pagode',
  'qual a programacao de sabado',
];

export function classifySocialEngagement(text: string): SocialEngagementClassification {
  const base = classifyCoreSocialEngagement(text);
  const route = canonicalRoute(normalizeCanonicalText(text));
  if (!route) return base;

  const conversationIntents = mergeConversationIntents(
    base.conversationIntents,
    route.addConversationIntents ?? ['INFORMATION'],
  );

  return {
    ...base,
    intent: route.intent,
    confidence: 'HIGH',
    ...(route.topic ? { topic: route.topic } : {}),
    conversationIntents,
  };
}

function canonicalRoute(normalized: string): CanonicalRoute | undefined {
  if (!normalized) return undefined;

  if (matchesAny(normalized, TICKET_INFO_PATTERNS)) {
    return {
      intent: 'TICKET_INFO',
      topic: 'TICKETS',
      addConversationIntents: ['INFORMATION'],
    };
  }

  // FAQ-036 and other explicit experience-description questions must remain
  // EVENT_INFO even when they contain temporal words such as "sábado".
  if (matchesAny(normalized, EVENT_INFO_PATTERNS)) {
    return {
      intent: 'EVENT_INFO',
      topic: 'EVENT_INFO',
      addConversationIntents: ['EVENT', 'INFORMATION'],
    };
  }

  if (matchesAny(normalized, LOCATION_HOURS_PATTERNS)) {
    return {
      intent: 'LOCATION_HOURS',
      topic: 'LOCATION_HOURS',
      addConversationIntents: ['INFORMATION'],
    };
  }

  if (matchesAny(normalized, OFFICIAL_OPERATIONAL_PATTERNS)) {
    return {
      intent: 'FAQ_OPERATIONAL',
      addConversationIntents: ['INFORMATION'],
    };
  }

  if (matchesAny(normalized, GENERAL_SOCIAL_PATTERNS)) {
    return {
      intent: 'GENERAL_SOCIAL',
      topic: 'GENERAL',
      addConversationIntents: ['INFORMATION'],
    };
  }

  return undefined;
}

function mergeConversationIntents(
  existing: readonly SocialConversationIntent[],
  additions: readonly SocialConversationIntent[],
): readonly SocialConversationIntent[] {
  const merged: SocialConversationIntent[] = existing.filter((intent) => intent !== 'OTHER');
  for (const intent of additions) {
    if (!merged.includes(intent)) merged.push(intent);
  }
  return merged.length > 0 ? merged : ['OTHER'];
}

function matchesAny(value: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => value === pattern || value.includes(pattern));
}

function normalizeCanonicalText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9@\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
