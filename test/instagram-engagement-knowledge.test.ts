import { describe, expect, it } from 'vitest';
import {
  GoogleSheetsInstagramEngagementKnowledgeSource,
  parseKnowledgeRows,
} from '../src/instagram-engagement/knowledge.js';

const header = [
  'faq_id',
  'categoria_id',
  'categoria',
  'subcategoria',
  'pergunta_canonica',
  'variantes_pergunta',
  'ocorrencias_2025',
  'percentual_perguntas_2025',
  'rank_categoria',
  'rank_pergunta_categoria',
  'intent',
  'risk_class',
  'autonomy_default',
  'resposta_oficial',
  'fonte_resposta_toca_os',
  'fatos_a_validar_antes_responder',
  'atualizado_em',
  'status',
  'notas',
];

describe('Instagram engagement knowledge', () => {
  it('only marks rows verified when status, autonomy, answer and source are explicit', () => {
    const rows = parseKnowledgeRows([
      header,
      [
        'FAQ-001',
        'CAT-001',
        'Horarios',
        '',
        'Que horas abre?',
        'Qual o horario?;Que horas voces abrem?',
        '',
        '',
        '',
        '',
        'LOCATION_HOURS',
        'LOW',
        'AUTO_REPLY_ALLOWED',
        'Resposta oficial',
        'TOCA_OS/05_MARKETING',
        '',
        '2026-08-28',
        'VALIDADO',
        '',
      ],
      [
        'FAQ-002',
        'CAT-001',
        'Horarios',
        '',
        'Horario de hoje?',
        '',
        '',
        '',
        '',
        '',
        'LOCATION_HOURS',
        'LOW',
        'AUTO_REPLY_ALLOWED',
        'Nao deve sair',
        '',
        '',
        '2026-08-28',
        'PENDENTE',
        '',
      ],
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.factsVerified).toBe(true);
    expect(rows[1]?.factsVerified).toBe(false);
  });

  it('returns only a high-confidence verified match for the expected intent', async () => {
    const client = {
      readRange() {
        return Promise.resolve([
          header,
          [
            'FAQ-001',
            'CAT-001',
            'Horarios',
            '',
            'Que horas abre?',
            'Qual o horario?;Que horas voces abrem?',
            '',
            '',
            '',
            '',
            'LOCATION_HOURS',
            'LOW',
            'AUTO_REPLY_ALLOWED',
            'Resposta oficial',
            'TOCA_OS/05_MARKETING',
            '',
            '2026-08-28',
            'VALIDADO',
            '',
          ],
        ]);
      },
    };
    const source = new GoogleSheetsInstagramEngagementKnowledgeSource({
      client,
      spreadsheetId: 'sheet-1',
      cacheMs: 0,
    });
    const match = await source.resolve('Qual o horario?', 'LOCATION_HOURS');
    expect(match?.faqId).toBe('FAQ-001');
    expect(match?.factsVerified).toBe(true);
    expect(await source.resolve('Qual o horario?', 'TICKET_INFO')).toBeNull();
  });

  it('never verifies a human-review intent even if the sheet is misconfigured', () => {
    const rows = parseKnowledgeRows([
      header,
      [
        'FAQ-HIGH',
        'CAT-009',
        'Refund',
        '',
        'Quero reembolso',
        '',
        '',
        '',
        '',
        '',
        'REFUND',
        'HIGH',
        'AUTO_REPLY_ALLOWED',
        'Resposta indevida',
        'fonte',
        '',
        '2026-08-28',
        'VALIDADO',
        '',
      ],
    ]);
    expect(rows[0]?.factsVerified).toBe(false);
  });
});
