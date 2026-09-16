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

const NON_AUTONOMOUS_CORE_INTENTS = new Set<SocialEngagementClassification['intent']>([
  'COMMERCIAL_LEAD',
  'COMPLAINT',
  'REFUND',
  'LEGAL',
  'SAFETY_INCIDENT',
  'PRESS',
  'PUBLIC_FIGURE',
  'HARASSMENT_OR_THREAT',
]);

const REFUND_FAIL_CLOSED_PATTERNS = ['dinheiro de volta', 'devolver meu dinheiro'];

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

const GASTRONOMY_OPERATIONAL_PATTERNS = [
  'o que tem para comer',
  'o que tem para beber',
  'o que tem hoje para comer',
  'o que tem hoje para beber',
  'hoje tem o que para comer',
  'hoje tem o que para beber',
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
  'qual a programacao de hoje',
  'qual e a programacao de hoje',
  'programacao de hoje',
  'programacao hoje',
  'o que tem hoje na toca',
  'hoje tem o que na toca',
  'o que acontece hoje na toca',
  'tem evento hoje',
];

const EXACT_TODAY_EVENT_INFO_PATTERNS = [
  'o que tem hoje',
  'hoje tem o que',
  'o que acontece hoje',
  'tem algo hoje',
  'agenda de hoje',
  'agenda hoje',
];

export function classifySocialEngagement(text: string): SocialEngagementClassification {
  const base = classifyCoreSocialEngagement(text);
  const normalized = normalizeCanonicalText(text);

  if (matchesAny(normalized, REFUND_FAIL_CLOSED_PATTERNS)) {
    return {
      ...base,
      intent: 'REFUND',
      topic: 'REFUND',
      priority: 'P1',
      confidence: 'HIGH',
      urgency: 'MEDIUM',
      conversationIntents: mergeConversationIntents(base.conversationIntents, ['SUPPORT']),
    };
  }

  // Never let a low-risk canonical FAQ/event pattern downgrade a core route that
  // policy intentionally keeps out of autonomous reply. UNKNOWN remains eligible
  // for exact canonical rescue patterns below; all other non-autonomous intents
  // retain the core classifier's stricter route.
  if (NON_AUTONOMOUS_CORE_INTENTS.has(base.intent)) return base;

  const route = canonicalRoute(normalized);
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

  if (isTodayOperatingHoursQuestion(normalized)) {
    return {
      intent: 'LOCATION_HOURS',
      topic: 'LOCATION_HOURS',
      addConversationIntents: ['INFORMATION'],
    };
  }

  // Keep ambiguous generic "today" aliases exact so a phrase such as
  // "o que tem hoje para comer?" cannot be widened into EVENT_INFO.
  if (
    matchesAny(normalized, EVENT_INFO_PATTERNS) ||
    matchesExactAny(normalized, EXACT_TODAY_EVENT_INFO_PATTERNS)
  ) {
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

  if (matchesAny(normalized, GASTRONOMY_OPERATIONAL_PATTERNS)) {
    return {
      intent: 'FAQ_OPERATIONAL',
      topic: 'GASTRONOMY',
      addConversationIntents: ['GASTRONOMY', 'INFORMATION'],
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

function isTodayOperatingHoursQuestion(value: string): boolean {
  if (!value.includes('hoje')) return false;
  return /\b(?:abre|abrem|abrir|aberto|aberta|abertos|abertas|funciona|funcionam|funcionar|funcionando)\b/.test(
    value,
  );
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

function matchesExactAny(value: string, patterns: readonly string[]): boolean {
  return patterns.includes(value);
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
