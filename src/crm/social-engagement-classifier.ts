import type {
  SocialCommercialIntent,
  SocialEngagementClassification,
  SocialLanguage,
  SocialSentiment,
  SocialTopic,
  SocialUrgency,
} from './social-engagement-contracts.js';

export function classifySocialEngagement(text: string): SocialEngagementClassification {
  const normalized = normalizeText(text);
  const containsPotentialSensitiveData = containsSensitiveData(text);
  const sunset = hasAny(normalized, ['sunset', 'por do sol', 'fim de tarde']);
  const theParty = hasAny(normalized, ['the party', 'balada', 'festa', 'party']);
  const eventInterest =
    sunset && theParty ? 'BOTH' : sunset ? 'SUNSET' : theParty ? 'THE_PARTY' : 'NONE';
  const productEvent = eventInterest === 'NONE' ? 'UNSPECIFIED' : eventInterest;

  const refund = hasAny(normalized, [
    'reembolso',
    'estorno',
    'refund',
    'devolucao',
    'cobranca',
    'cobrado duas vezes',
    'cobranca duplicada',
    'chargeback',
  ]);
  const harassmentOrThreat = hasAny(normalized, [
    'ameaca',
    'ameacando',
    'assedio',
    'assediado',
    'assediada',
    'harassment',
    'threat',
    'threatening',
  ]);
  const legal = hasAny(normalized, [
    'advogado',
    'processo',
    'justica',
    'boletim de ocorrencia',
    'legal action',
    'lawsuit',
  ]);
  const safety = hasAny(normalized, [
    'acidente',
    'agressao',
    'seguranca',
    'machucado',
    'machucada',
    'emergencia',
    'emergency',
    'assault',
  ]);
  const press = hasAny(normalized, [
    'imprensa',
    'jornalista',
    'reportagem',
    'press inquiry',
    'media request',
  ]);
  const publicFigure = hasAny(normalized, [
    'vip',
    'influencer',
    'celebridade',
    'famoso',
    'famosa',
    'artista conhecido',
    'public figure',
    'celebrity',
  ]);
  const complaint = hasAny(normalized, [
    'reclamacao',
    'reclamar',
    'pessimo',
    'horrivel',
    'problema serio',
    'complaint',
    'terrible',
  ]);
  const ticket = hasAny(normalized, ['ingresso', 'ticket', 'entrada', 'bilhete']);
  const reservation = hasAny(normalized, ['reserva', 'reservar', 'booking', 'book a table']);
  const price = hasAny(normalized, ['preco', 'valor', 'quanto custa', 'price', 'how much']);
  const locationHours = hasAny(normalized, [
    'horario',
    'que horas',
    'onde fica',
    'localizacao',
    'como chegar',
    'hours',
    'what time',
    'where is',
    'how to get',
  ]);
  const operationalFaq = hasAny(normalized, [
    'idade minima',
    'menor de idade',
    'dress code',
    'traje',
    'acessibilidade',
    'cadeirante',
    'estacionamento',
    'forma de pagamento',
    'aceita cartao',
    'pode entrar com',
    'documento para entrar',
  ]);

  const commercialSignals = [ticket, reservation, price].filter(Boolean).length;
  const buyingSignal = hasAny(normalized, [
    'comprar',
    'quero ir',
    'quero ingresso',
    'garantir',
    'disponibilidade',
    'buy',
    'purchase',
    'i want to go',
    'available',
  ]);
  const commercialIntent: SocialCommercialIntent =
    buyingSignal && (commercialSignals > 0 || eventInterest !== 'NONE')
      ? 'HIGH'
      : commercialSignals >= 2
        ? 'HIGH'
        : commercialSignals === 1
          ? 'MEDIUM'
          : eventInterest !== 'NONE'
            ? 'LOW'
            : 'NONE';

  const knownLowOrCommercial =
    ticket || reservation || price || locationHours || operationalFaq || eventInterest !== 'NONE';
  const materialUnknown = !knownLowOrCommercial && isMaterialQuestion(normalized);

  const intent = harassmentOrThreat
    ? 'HARASSMENT_OR_THREAT'
    : refund
      ? 'REFUND'
      : legal
        ? 'LEGAL'
        : safety
          ? 'SAFETY_INCIDENT'
          : press
            ? 'PRESS'
            : publicFigure
              ? 'PUBLIC_FIGURE'
              : complaint
                ? 'COMPLAINT'
                : commercialIntent === 'HIGH' || reservation || price
                  ? 'COMMERCIAL_LEAD'
                  : ticket
                    ? 'TICKET_INFO'
                    : eventInterest !== 'NONE'
                      ? 'EVENT_INFO'
                      : locationHours
                        ? 'LOCATION_HOURS'
                        : operationalFaq
                          ? 'FAQ_OPERATIONAL'
                          : materialUnknown
                            ? 'UNKNOWN'
                            : 'GENERAL_SOCIAL';

  const topic: SocialTopic = refund
    ? 'REFUND'
    : legal || harassmentOrThreat
      ? 'LEGAL'
      : safety
        ? 'SAFETY'
        : press
          ? 'PRESS'
          : complaint
            ? 'COMPLAINT'
            : reservation
              ? 'RESERVATION'
              : price
                ? 'PRICE'
                : ticket
                  ? 'TICKETS'
                  : eventInterest !== 'NONE'
                    ? 'EVENT_INFO'
                    : locationHours || operationalFaq
                      ? 'LOCATION_HOURS'
                      : 'GENERAL';

  return {
    intent,
    commercialIntent,
    eventInterest,
    sentiment: classifySentiment(normalized),
    urgency: classifyUrgency(normalized, safety || harassmentOrThreat, refund),
    topic,
    language: classifyLanguage(normalized),
    productEvent,
    containsPotentialSensitiveData,
  };
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function hasAny(value: string, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => value.includes(candidate));
}

function isMaterialQuestion(value: string): boolean {
  if (!value.trim()) return true;
  return (
    value.includes('?') ||
    hasAny(` ${value} `, [
      ' como ',
      ' quando ',
      ' onde ',
      ' qual ',
      ' quais ',
      ' quanto ',
      ' quem ',
      ' posso ',
      ' pode ',
      ' tem ',
      ' existe ',
      ' how ',
      ' when ',
      ' where ',
      ' what ',
      ' who ',
      ' can ',
      ' do you ',
      ' hay ',
      ' donde ',
      ' cuando ',
      ' cuanto ',
    ])
  );
}

function containsSensitiveData(value: string): boolean {
  const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
  const phone = /(?:\+?\d[\s().-]*){10,15}/;
  const paymentCardLike = /\b(?:\d[ -]*?){13,19}\b/;
  const cpfLike = /\b\d{3}[.-]?\d{3}[.-]?\d{3}-?\d{2}\b/;
  return email.test(value) || phone.test(value) || paymentCardLike.test(value) || cpfLike.test(value);
}

function classifySentiment(value: string): SocialSentiment {
  if (hasAny(value, ['amei', 'incrivel', 'maravilhoso', 'top', 'love', 'amazing', 'great'])) {
    return 'POSITIVE';
  }
  if (hasAny(value, ['pessimo', 'horrivel', 'raiva', 'odio', 'terrible', 'awful', 'angry'])) {
    return 'NEGATIVE';
  }
  return 'NEUTRAL';
}

function classifyUrgency(value: string, safety: boolean, refund: boolean): SocialUrgency {
  if (safety && hasAny(value, ['agora', 'urgente', 'emergency', 'now'])) return 'CRITICAL';
  if (safety || hasAny(value, ['urgente', 'imediato', 'asap', 'urgent'])) return 'HIGH';
  if (refund || hasAny(value, ['hoje', 'today', 'esta noite', 'tonight'])) return 'MEDIUM';
  return 'LOW';
}

function classifyLanguage(value: string): SocialLanguage {
  const portuguese = hasAny(value, [
    ' quero ',
    ' preco',
    ' ingresso',
    ' hoje',
    ' onde ',
    'horario',
  ]);
  const spanish = hasAny(value, ['quiero', 'precio', 'entrada', ' donde ', 'horario']);
  const english = hasAny(value, [
    ' the ',
    ' want ',
    ' price',
    ' ticket',
    ' today',
    ' where ',
    ' how ',
  ]);
  if (portuguese && !spanish) return 'PT';
  if (spanish && !portuguese) return 'ES';
  if (english) return 'EN';
  return 'UNKNOWN';
}
