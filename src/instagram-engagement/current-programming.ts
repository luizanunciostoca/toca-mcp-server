import type { EngagementIntent } from '../policy/engagement-policy.js';
import type { InstagramEngagementKnowledgeMatch } from './knowledge.js';
import { TOCA_OFFICIAL_INFORMATION_URL } from './ticket-information.js';

const OPERATIONS_SOURCE =
  'TOCA_OS — 08_OPERACOES — HOMOLOGACAO_E_PARAMETROS_OPERACIONAIS_v1.1 — DEC-02';
const SATURDAY_SOURCE = 'TOCA_OS — BASE_CANONICA_ATENDIMENTO_INSTAGRAM_IA_v1.0 — FAQ-036';

const TODAY_PROGRAMMING_PATTERNS = [
  'programacao de hoje',
  'programacao hoje',
  'qual a programacao de hoje',
  'qual e a programacao de hoje',
  'o que tem hoje',
  'hoje tem o que',
  'o que acontece hoje',
  'tem algo hoje',
  'tem evento hoje',
  'agenda de hoje',
  'agenda hoje',
] as const;

export interface CurrentProgrammingResolverOptions {
  readonly now?: Date;
  readonly timeZone?: string;
}

export function resolveCurrentProgrammingKnowledge(
  text: string,
  expectedIntent: EngagementIntent,
  options: CurrentProgrammingResolverOptions = {},
): InstagramEngagementKnowledgeMatch | null {
  if (expectedIntent !== 'EVENT_INFO') return null;
  const normalized = normalize(text);
  if (!TODAY_PROGRAMMING_PATTERNS.some((pattern) => normalized.includes(pattern))) return null;

  const now = options.now ?? new Date();
  const timeZone = options.timeZone ?? 'America/Bahia';
  const localClock = localClockInTimeZone(now, timeZone);
  const fridayPartyCarryover = localClock.weekday === 'sat' && localClock.hour < 6;
  const answer = programmingAnswer(localClock.weekday, fridayPartyCarryover);
  const sources =
    localClock.weekday === 'sat'
      ? `${OPERATIONS_SOURCE}; ${SATURDAY_SOURCE}`
      : OPERATIONS_SOURCE;

  return {
    faqId: `DYNAMIC:PROGRAMMING_TODAY:${localClock.weekday.toUpperCase()}${fridayPartyCarryover ? ':FRIDAY_CARRYOVER' : ''}`,
    intent: 'EVENT_INFO',
    answer,
    source: sources,
    confidence: 1,
    factsVerified: true,
    tier: 'KNOWLEDGE_BASE',
  };
}

function programmingAnswer(weekday: Weekday, fridayPartyCarryover: boolean): string {
  const parts = [
    'Pela programação regular canônica, hoje tem Sunset na Toca do Morcego a partir das 16:30, no horário da Bahia.',
  ];
  if (weekday === 'fri') {
    parts.push('Às sextas-feiras, a The Party acontece das 23:59 às 06:00.');
  }
  if (fridayPartyCarryover) {
    parts.push(
      'Se você está falando de agora, a The Party de sexta-feira ainda está dentro da janela regular canônica, que segue até 06:00 de sábado.',
    );
  }
  if (weekday === 'sat') {
    parts.push('Aos sábados, o Sunset tem samba e pagode.');
  }
  parts.push(
    `Atrações, edições especiais e valores podem variar. Para conferir a programação vigente e ingressos, acesse: ${TOCA_OFFICIAL_INFORMATION_URL}`,
  );
  return parts.join(' ');
}

type Weekday = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';

interface LocalClock {
  readonly weekday: Weekday;
  readonly hour: number;
}

function localClockInTimeZone(now: Date, timeZone: string): LocalClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    hour: '2-digit',
    hour12: false,
    hourCycle: 'h23',
    timeZone,
  }).formatToParts(now);
  const weekdayValue = parts.find((part) => part.type === 'weekday')?.value.toLowerCase().slice(0, 3);
  const hourValue = Number(parts.find((part) => part.type === 'hour')?.value);

  if (!weekdayValue || !['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].includes(weekdayValue)) {
    throw new Error('INSTAGRAM_ENGAGEMENT_PROGRAMMING_WEEKDAY_INVALID');
  }
  if (!Number.isInteger(hourValue) || hourValue < 0 || hourValue > 23) {
    throw new Error('INSTAGRAM_ENGAGEMENT_PROGRAMMING_HOUR_INVALID');
  }

  return { weekday: weekdayValue as Weekday, hour: hourValue };
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
