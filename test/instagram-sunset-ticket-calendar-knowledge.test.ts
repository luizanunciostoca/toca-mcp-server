import { describe, expect, it } from 'vitest';
import { classifySocialEngagement } from '../src/crm/social-engagement-classifier.js';
import { GoogleSheetsInstagramEngagementKnowledgeSource } from '../src/instagram-engagement/knowledge.js';
import {
  INSTAGRAM_ENGAGEMENT_CANONICAL_SPREADSHEET_ID,
  INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE,
} from '../src/instagram-engagement/knowledge-snapshot-current.js';
import { INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE as EXPANDED_CORE_KNOWLEDGE } from '../src/instagram-engagement/knowledge-snapshot-expanded-core.js';
import { MultiIntentInstagramEngagementKnowledgeSource } from '../src/instagram-engagement/multi-intent-knowledge.js';
import { TOCA_TICKET_INFORMATION_REPLY } from '../src/instagram-engagement/ticket-information.js';

const CALENDAR_URL = 'https://tocadomorcego.com.br/produtos/experiencia-por-do-sol-3822.html';
const UPDATED_FAQS = ['FAQ-001', 'FAQ-011', 'FAQ-019'];
const HEADER = [
  'faq_id',
  'pergunta_canonica',
  'variantes_pergunta',
  'intent',
  'risk_class',
  'autonomy_default',
  'resposta_oficial',
  'fonte_resposta_toca_os',
  'fatos_a_validar_antes_responder',
  'atualizado_em',
  'status',
];

// Only the spreadsheet transport is local: use the actual current snapshot,
// production row parser and matcher, including their hours/today fallbacks.
const source = new GoogleSheetsInstagramEngagementKnowledgeSource({
  spreadsheetId: INSTAGRAM_ENGAGEMENT_CANONICAL_SPREADSHEET_ID,
  cacheMs: 0,
  client: {
    readRange: () =>
      Promise.resolve([
        HEADER,
        ...INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE.map((row) => [
          row.faqId,
          row.canonicalQuestion,
          row.variants.join(';'),
          row.intent,
          row.risk,
          row.autonomy,
          row.answer,
          row.source,
          row.factsToValidate,
          row.sourceUpdatedOn,
          row.status,
        ]),
      ]),
  },
});
const composedSource = new MultiIntentInstagramEngagementKnowledgeSource(source, {
  now: () => new Date('2026-10-19T00:24:00Z'), // 2026-10-18 21:24, America/Bahia.
});

describe('Sunset operating days from the official ticket calendar', () => {
  it.each([
    ['Que horas começa o Sunset?', 'FAQ-001'],
    ['O Sunset funciona todos os dias?', 'FAQ-001'],
    ['Quais dias tem Sunset?', 'FAQ-001'],
    ['Em quais dias acontece o Sunset?', 'FAQ-001'],
    ['Que dias tem pôr do sol na Toca?', 'FAQ-001'],
    ['Quais dias e horários a Toca funciona?', 'FAQ-011'],
    ['Que dias a Toca abre?', 'FAQ-011'],
    ['Quais dias a Toca abre?', 'FAQ-011'],
    ['Quais os dias de funcionamento?', 'FAQ-011'],
    ['Quais dias vocês funcionam?', 'FAQ-011'],
    ['Vocês abrem quais dias?', 'FAQ-011'],
    ['Qual o horário de funcionamento?', 'FAQ-011'],
    ['A Toca abre todo dia?', 'FAQ-011'],
    ['Hoje tem Sunset?', 'FAQ-019'],
    ['Tem Sunset hoje?', 'FAQ-019'],
    ['Hoje tem pôr do sol na Toca?', 'FAQ-019'],
    ['Todo dia tem Sunset?', 'FAQ-019'],
    ['Tem Sunset todos os dias?', 'FAQ-019'],
    ['A Toca abre hoje para o Sunset?', 'FAQ-019'],
  ])('resolves "%s" to calendar guidance through the real matcher', async (question, faqId) => {
    const match = await source.resolve(question, 'LOCATION_HOURS');

    expect(match?.faqId).toBe(faqId);
    expect(match?.factsVerified).toBe(true);
    expect(match?.answer).toContain(CALENDAR_URL);
    expect(match?.answer).toContain('as datas e os horários disponíveis do Pôr do Sol');
    expect(match?.answer).not.toContain('16:30');
    expect(match?.answer).not.toMatch(/todos os dias|todo dia|diariamente|hoje tem Sunset/i);
    expect(match?.answer).toContain(
      'Se a data desejada não aparecer ou estiver sem ingressos, confirme a operação nos canais oficiais.',
    );
  });

  it.each(['Vocês abrem hoje?', 'A Toca tá aberta hoje?', 'Tá aberto hoje?'])(
    'keeps the real today classification and hours fallback safe for "%s"',
    async (question) => {
      const classification = classifySocialEngagement(question);
      expect(classification.intent).toBe('LOCATION_HOURS');

      const match = await source.resolve(question, classification.intent);
      expect(match?.faqId).toBe('FAQ-011');
      expect(match?.factsVerified).toBe(true);
      expect(match?.answer).toContain(CALENDAR_URL);
      expect(match?.answer).not.toMatch(/todos os dias|hoje tem Sunset|est[aá] fechad[oa]/i);
    },
  );

  it.each([
    ['Hoje tem Sunset?', 'FAQ-019'],
    ['O Sunset funciona hoje?', 'FAQ-001'],
    ['O Sunset funciona todos os dias?', 'FAQ-001'],
    ['Qual o horário de funcionamento?', 'FAQ-011'],
    ['Quais os dias de funcionamento?', 'FAQ-011'],
    ['Quais os dias de funcionamento da Toca?', 'FAQ-011'],
    ['Tem Sunset segunda?', 'FAQ-001'],
    ['Tem Sunset na segunda-feira?', 'FAQ-001'],
    ['A Toca abre segunda?', 'FAQ-011'],
    ['A Toca abre na segunda-feira?', 'FAQ-011'],
    ['Vocês abrem segunda-feira?', 'FAQ-011'],
    ['Abrem amanhã?', 'FAQ-011'],
    ['Tem Sunset amanhã?', 'FAQ-019'],
  ])(
    'preserves calendar guidance in the classified final reply for "%s"',
    async (question, faqId) => {
      const classification = classifySocialEngagement(question);
      expect(classification.intent).toBe('LOCATION_HOURS');
      const reply = await composedSource.resolve(question, classification.intent);

      expect(reply?.faqId).toBe(faqId);
      expect(reply?.factsVerified).toBe(true);
      expect(reply?.answer).toContain(CALENDAR_URL);
      expect(reply?.answer).not.toContain('16:30');
      expect(reply?.answer).not.toMatch(
        /todos os dias|todo dia|diariamente|hoje tem|tem, sim|est[aá] fechad[oa]/i,
      );
    },
  );

  it.each([
    'Olá, vocês funcionam hoje?\nOlá, vocês abrem hoje?',
    'Vocês abrem hoje? E quanto custa o ingresso?',
    'Tem Sunset segunda? Que dia e que horas acontece a The Party?',
    'Vocês abrem hoje? Qual a programação de hoje?',
    'Tem Sunset segunda? Qual a programação de hoje?',
    'O Sunset funciona todos os dias? Qual a programação de hoje?',
  ])('keeps the calendar in the composed customer answer to "%s"', async (question) => {
    const classification = classifySocialEngagement(question);
    const reply = await composedSource.resolve(question, classification.intent);

    expect(reply?.factsVerified).toBe(true);
    expect(reply?.answer).toContain(CALENDAR_URL);
    expect(reply?.answer).not.toContain('16:30');
    expect(reply?.answer).not.toMatch(
      /todos os dias|todo dia|diariamente|hoje tem|tem, sim|est[aá] fechad[oa]/i,
    );
  });

  it.each([
    '2026-10-18T15:00:00Z',
    '2026-10-19T15:00:00Z',
    '2026-10-20T15:00:00Z',
    '2026-10-21T15:00:00Z',
    '2026-10-22T15:00:00Z',
    '2026-10-23T15:00:00Z',
    '2026-10-24T15:00:00Z',
  ])('does not confirm Sunset opening from the weekday alone at %s', async (now) => {
    const programmingSource = new MultiIntentInstagramEngagementKnowledgeSource(source, {
      now: () => new Date(now),
    });
    for (const question of [
      'Qual a programação de hoje?',
      'Agenda hoje?',
      'O que tem hoje na Toca?',
    ]) {
      const classification = classifySocialEngagement(question);
      expect(classification.intent).toBe('EVENT_INFO');
      const reply = await programmingSource.resolve(question, classification.intent);

      expect(reply?.factsVerified).toBe(true);
      expect(reply?.answer).toContain(CALENDAR_URL);
      expect(reply?.answer).not.toContain('16:30');
      expect(reply?.source).toContain(CALENDAR_URL);
      expect(reply?.source).toContain('2026-10-18 (America/Bahia)');
      expect(reply?.answer).not.toMatch(
        /hoje tem Sunset|hoje tem, sim|todos os dias|diariamente|est[aá] fechad[oa]/i,
      );
    }
  });

  it.each([
    ['Sou jornalista, quais os dias de funcionamento?', 'PRESS'],
    ['Quero reembolso. Qual a programação de hoje?', 'REFUND'],
    ['Quero reservar um camarote? Vocês abrem hoje?', 'COMMERCIAL_LEAD'],
  ])('preserves the human-required route for "%s"', async (question, expectedIntent) => {
    const classification = classifySocialEngagement(question);
    expect(classification.intent).toBe(expectedIntent);
    expect(await composedSource.resolve(question, classification.intent)).toBeNull();
  });

  it('does not turn unrelated or gastronomy questions into venue operating days', () => {
    expect(classifySocialEngagement('Quais os dias de funcionamento da farmácia?').intent).toBe(
      'UNKNOWN',
    );
    expect(classifySocialEngagement('O que tem hoje para comer?')).toMatchObject({
      intent: 'FAQ_OPERATIONAL',
      topic: 'GASTRONOMY',
    });
  });

  it('retains the directive date in both snapshots without refreshing unrelated facts', () => {
    for (const snapshot of [EXPANDED_CORE_KNOWLEDGE, INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE]) {
      expect(
        snapshot.filter((row) => row.sourceUpdatedOn === '2026-10-18').map((row) => row.faqId),
      ).toEqual(UPDATED_FAQS);
      expect(
        snapshot.filter((row) => row.source.includes(CALENDAR_URL)).map((row) => row.faqId),
      ).toEqual(UPDATED_FAQS);
      for (const faqId of UPDATED_FAQS) {
        const row = snapshot.find((item) => item.faqId === faqId);
        expect(row?.source).toContain('2026-10-18 (America/Bahia)');
        expect(row?.source).toContain('1Sr4jKNvWZQSlAr3g7klkw_Eou3yLESrcOv2Ednjk7g4');
        expect(row?.factsToValidate).toContain('inferir fechamento');
        expect(row?.factsToValidate).toContain('ingressos esgotados ou falha de leitura');
      }
    }
  });

  it.each([
    ['Que dia tem festa na Toca?', 'FAQ-002'],
    ['Tem The Party sábado?', 'FAQ-020'],
  ])('preserves the separate The Party schedule for "%s"', async (question, faqId) => {
    const match = await source.resolve(question, 'LOCATION_HOURS');

    expect(match?.faqId).toBe(faqId);
    expect(match?.answer).toContain('The Party');
    expect(match?.answer).toContain('23:59');
    expect(match?.answer).toContain('06:00');
    expect(match?.answer).not.toContain(CALENDAR_URL);
    expect(
      INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE.find((row) => row.faqId === faqId)?.sourceUpdatedOn,
    ).toBe('2026-08-28');
  });

  it('preserves the combined regular schedule and the unconfirmed Sunset closing time', async () => {
    const regularHours = await source.resolve(
      'Quais dias e horários a Toca funciona?',
      'LOCATION_HOURS',
    );
    expect(regularHours?.answer).toContain(
      'A The Party acontece às sextas-feiras, das 23:59 às 06:00.',
    );

    const closing = await source.resolve('Que horas o Sunset termina?', 'LOCATION_HOURS');
    expect(closing?.faqId).toBe('FAQ-023');
    expect(closing?.answer).toBe(
      'O início regular do Sunset é às 16:30. O horário de encerramento pode variar conforme a operação do dia e não deve ser presumido sem regra ou evento específico vigente.',
    );
  });

  it('preserves ticket guidance and the separately approved Saturday programming', async () => {
    for (const question of ['Quanto custa o ingresso?', 'Onde compro ingressos?']) {
      expect((await source.resolve(question, 'TICKET_INFO'))?.answer).toBe(
        TOCA_TICKET_INFORMATION_REPLY,
      );
    }

    const saturday = await source.resolve('O que tem no Sunset de sábado?', 'EVENT_INFO');
    expect(saturday?.faqId).toBe('FAQ-036');
    expect(saturday?.answer).toContain('samba e pagode');
    expect(saturday?.answer).not.toContain(CALENDAR_URL);
  });
});
