import type {
  SocialClassificationConfidence,
  SocialCommercialIntent,
  SocialConversationIntent,
  SocialEngagementClassification,
  SocialLanguage,
  SocialPriority,
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
    'agredido',
    'agredida',
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
  const partnership = hasAny(normalized, [
    'parceria',
    'collab',
    'colaboracao',
    'patrocinio',
    'fornecedor',
    'agencia',
    'influencer',
    'criador de conteudo',
    'artista',
    'partnership',
    'collaboration',
    'sponsorship',
  ]);
  const publicFigure = hasAny(normalized, [
    'vip',
    'celebridade',
    'famoso',
    'famosa',
    'artista conhecido',
    'public figure',
    'celebrity',
  ]);
  const careers = hasAny(normalized, [
    'trabalhe conosco',
    'vaga',
    'curriculo',
    'emprego',
    'contratando',
    'job opening',
    'resume',
    'work with you',
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
  const support =
    complaint ||
    refund ||
    hasAny(normalized, [
      'preciso de ajuda',
      'nao funcionou',
      'deu erro',
      'problema com',
      'suporte',
      'help me',
      'not working',
      'support',
    ]);
  const ticket = hasAny(normalized, ['ingresso', 'ticket', 'entrada', 'bilhete']);
  const reservation = hasAny(normalized, ['reserva', 'reservar', 'booking', 'book a table']);
  const price = hasAny(normalized, ['preco', 'valor', 'quanto custa', 'price', 'how much']);
  const gastronomy = hasAny(normalized, [
    'cardapio',
    'menu',
    'comida',
    'prato',
    'petisco',
    'gastronomia',
    'drink',
    'bebida',
    'cerveja',
    'cocktail',
    'food',
  ]);
  const praise = hasAny(normalized, [
    'amei',
    'adorei',
    'maravilhoso',
    'incrivel',
    'parabens',
    'melhor experiencia',
    'love it',
    'amazing',
    'congratulations',
  ]);
  const ugc = hasAny(normalized, [
    '@tocadomorcego',
    'marquei voces',
    'marquei vcs',
    'repost',
    'repostar',
    'marcacao',
    'tagged you',
    'mentioned you',
  ]);
  const spam = hasAny(normalized, [
    'ganhe seguidores',
    'compre seguidores',
    'divulgue seu perfil',
    'bitcoin investment',
    'crypto investment',
    'seo service',
    'social media growth service',
  ]);
  const abusiveLanguage = hasAny(normalized, [
    'vou acabar com voces',
    'vou pegar voces',
    'matar voces',
    'idiotas',
    'desgracados',
  ]);
  const locationHours = hasAny(normalized, [
    'horario',
    'que horas',
    'onde fica',
    'localizacao',
    'como chegar',
    'quando',
    'abre',
    'fecha',
    'comeca',
    'termina',
    'funciona todos os dias',
    'hours',
    'what time',
    'where is',
    'how to get',
    'when',
    'opens',
    'closes',
    'starts',
    'ends',
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
    'compro',
    'onde compro',
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
    ticket ||
    reservation ||
    price ||
    locationHours ||
    operationalFaq ||
    eventInterest !== 'NONE' ||
    gastronomy ||
    praise ||
    ugc ||
    partnership ||
    careers ||
    support ||
    spam;
  const materialUnknown = !knownLowOrCommercial && isMaterialQuestion(normalized);

  const intent =
    harassmentOrThreat || abusiveLanguage
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
                : complaint || support
                  ? 'COMPLAINT'
                  : commercialIntent === 'HIGH' || reservation || price
                    ? 'COMMERCIAL_LEAD'
                    : ticket
                      ? 'TICKET_INFO'
                      : locationHours
                        ? 'LOCATION_HOURS'
                        : eventInterest !== 'NONE'
                          ? 'EVENT_INFO'
                          : operationalFaq || gastronomy
                            ? 'FAQ_OPERATIONAL'
                            : partnership
                              ? 'COMMERCIAL_LEAD'
                              : materialUnknown || careers || spam
                                ? 'UNKNOWN'
                                : 'GENERAL_SOCIAL';

  const topic: SocialTopic = refund
    ? 'REFUND'
    : legal || harassmentOrThreat || abusiveLanguage
      ? 'LEGAL'
      : safety
        ? 'SAFETY'
        : press
          ? 'PRESS'
          : complaint || support
            ? 'COMPLAINT'
            : partnership
              ? 'PARTNERSHIP'
              : careers
                ? 'CAREERS'
                : reservation
                  ? 'RESERVATION'
                  : price
                    ? 'PRICE'
                    : ticket
                      ? 'TICKETS'
                      : gastronomy
                        ? 'GASTRONOMY'
                        : locationHours
                          ? 'LOCATION_HOURS'
                          : eventInterest !== 'NONE'
                            ? 'EVENT_INFO'
                            : operationalFaq
                              ? 'LOCATION_HOURS'
                              : 'GENERAL';

  const sentiment = classifySentiment(normalized);
  const urgency = classifyUrgency(
    normalized,
    safety || harassmentOrThreat || abusiveLanguage,
    refund,
  );
  const conversationIntents = classifyConversationIntents({
    spam,
    harassmentOrThreat: harassmentOrThreat || abusiveLanguage,
    safety,
    legal,
    support,
    complaint,
    commercialIntent,
    buyingSignal,
    eventInterest,
    gastronomy,
    praise,
    ugc,
    partnership,
    careers,
    information: ticket || reservation || price || locationHours || operationalFaq || materialUnknown,
  });
  const priority = classifyPriority({
    harassmentOrThreat: harassmentOrThreat || abusiveLanguage,
    safety,
    legal,
    containsPotentialSensitiveData,
    complaint,
    refund,
    support,
    commercialIntent,
    urgency,
  });
  const confidence = classifyConfidence({
    normalized,
    materialUnknown,
    spam,
    highSpecificity:
      harassmentOrThreat ||
      abusiveLanguage ||
      legal ||
      safety ||
      refund ||
      complaint ||
      support ||
      ticket ||
      reservation ||
      price ||
      locationHours ||
      operationalFaq ||
      gastronomy ||
      partnership ||
      careers ||
      praise ||
      ugc,
    eventInterest,
  });

  return {
    intent,
    conversationIntents,
    commercialIntent,
    eventInterest,
    sentiment,
    urgency,
    priority,
    confidence,
    topic,
    language: classifyLanguage(normalized),
    productEvent,
    containsPotentialSensitiveData,
  };
}

function classifyConversationIntents(input: {
  readonly spam: boolean;
  readonly harassmentOrThreat: boolean;
  readonly safety: boolean;
  readonly legal: boolean;
  readonly support: boolean;
  readonly complaint: boolean;
  readonly commercialIntent: SocialCommercialIntent;
  readonly buyingSignal: boolean;
  readonly eventInterest: 'NONE' | 'SUNSET' | 'THE_PARTY' | 'BOTH';
  readonly gastronomy: boolean;
  readonly praise: boolean;
  readonly ugc: boolean;
  readonly partnership: boolean;
  readonly careers: boolean;
  readonly information: boolean;
}): readonly SocialConversationIntent[] {
  const intents: SocialConversationIntent[] = [];
  const add = (value: SocialConversationIntent) => {
    if (!intents.includes(value)) intents.push(value);
  };
  if (input.spam) add('SPAM');
  if (input.harassmentOrThreat) add('ABUSE');
  if (input.harassmentOrThreat || input.safety || input.legal || input.support) add('SUPPORT');
  if (input.complaint) add('COMPLAINT');
  if (input.commercialIntent !== 'NONE') add('COMMERCIAL');
  if (input.buyingSignal) add('PURCHASE');
  if (input.eventInterest !== 'NONE') add('EVENT');
  if (input.eventInterest === 'SUNSET' || input.eventInterest === 'BOTH') add('SUNSET');
  if (input.eventInterest === 'THE_PARTY' || input.eventInterest === 'BOTH') add('THE_PARTY');
  if (input.gastronomy) add('GASTRONOMY');
  if (input.partnership) add('PARTNERSHIP');
  if (input.careers) add('CAREERS');
  if (input.praise) add('PRAISE');
  if (input.ugc) add('UGC_BRAND_MENTION');
  if (input.information) add('INFORMATION');
  if (intents.length === 0) add('OTHER');
  return intents;
}

function classifyPriority(input: {
  readonly harassmentOrThreat: boolean;
  readonly safety: boolean;
  readonly legal: boolean;
  readonly containsPotentialSensitiveData: boolean;
  readonly complaint: boolean;
  readonly refund: boolean;
  readonly support: boolean;
  readonly commercialIntent: SocialCommercialIntent;
  readonly urgency: SocialUrgency;
}): SocialPriority {
  if (input.harassmentOrThreat || input.safety || input.legal || input.urgency === 'CRITICAL') {
    return 'P0';
  }
  if (
    input.containsPotentialSensitiveData ||
    input.complaint ||
    input.refund ||
    input.support ||
    input.commercialIntent === 'HIGH' ||
    input.urgency === 'HIGH'
  ) {
    return 'P1';
  }
  if (input.commercialIntent === 'MEDIUM' || input.urgency === 'MEDIUM') return 'P2';
  return 'P3';
}

function classifyConfidence(input: {
  readonly normalized: string;
  readonly materialUnknown: boolean;
  readonly spam: boolean;
  readonly highSpecificity: boolean;
  readonly eventInterest: 'NONE' | 'SUNSET' | 'THE_PARTY' | 'BOTH';
}): SocialClassificationConfidence {
  if (!input.normalized.trim() || input.materialUnknown) return 'LOW';
  if (input.spam || input.highSpecificity) return 'HIGH';
  if (input.eventInterest !== 'NONE') return 'MEDIUM';
  return 'MEDIUM';
}

function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
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
  return (
    email.test(value) || phone.test(value) || paymentCardLike.test(value) || cpfLike.test(value)
  );
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
