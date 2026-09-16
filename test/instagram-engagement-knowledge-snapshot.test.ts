import { describe, expect, it } from 'vitest';
import {
  INSTAGRAM_ENGAGEMENT_CANONICAL_SPREADSHEET_ID,
  INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE,
} from '../src/instagram-engagement/knowledge-snapshot-current.js';
import { OFFICIAL_TICKET_INFORMATION_ANSWER } from '../src/instagram-engagement/ticket-information.js';

const ACTIVE_CANONICAL_SPREADSHEET_ID = '1M0HSs7QJpFCJvvnrZxJRaaXY8scv5R3okCG_OyFLiEU';

describe('Instagram engagement canonical knowledge snapshot', () => {
  it('stays bound to the active canonical FAQ spreadsheet', () => {
    expect(INSTAGRAM_ENGAGEMENT_CANONICAL_SPREADSHEET_ID).toBe(ACTIVE_CANONICAL_SPREADSHEET_ID);
  });

  it('contains the reconciled approved Toca FAQ set with unique identifiers', () => {
    expect(INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE).toHaveLength(36);
    expect(
      INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE.every(
        (row) =>
          row.status === 'APROVADO' &&
          row.operationalValidity === 'ATIVO_ATE_SUBSTITUICAO_CANONICA',
      ),
    ).toBe(true);
    expect(new Set(INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE.map((row) => row.faqId)).size).toBe(36);
  });

  it('keeps automatic replies limited to verified low-risk knowledge', () => {
    const automatic = INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE.filter(
      (row) => row.autonomy === 'AUTO_REPLY_ALLOWED',
    );
    const suggested = INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE.filter(
      (row) => row.autonomy === 'SUGGEST_ONLY',
    );

    expect(automatic).toHaveLength(24);
    expect(automatic.every((row) => row.risk === 'LOW')).toBe(true);
    expect(suggested).toHaveLength(12);
    expect(suggested.every((row) => row.risk === 'MEDIUM')).toBe(true);
  });

  it('covers the real party-day wording that exposed the production gap', () => {
    const partySchedule = INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE.find(
      (row) => row.faqId === 'FAQ-002',
    );
    expect(partySchedule?.autonomy).toBe('AUTO_REPLY_ALLOWED');
    expect(partySchedule?.variants).toContain('Que dia tem festa na Toca?');
    expect(partySchedule?.answer).toContain('sextas-feiras');
  });

  it('keeps ticket FAQs identical to the deterministic official CTA', () => {
    for (const id of ['FAQ-003', 'FAQ-004']) {
      const row = INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE.find((item) => item.faqId === id);
      expect(row?.intent).toBe('TICKET_INFO');
      expect(row?.answer).toBe(OFFICIAL_TICKET_INFORMATION_ANSWER);
    }
  });

  it('preserves source freshness instead of stamping old facts with the snapshot date', () => {
    expect(
      INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE.find((row) => row.faqId === 'FAQ-001')
        ?.sourceUpdatedOn,
    ).toBe('2026-08-28');
    expect(
      INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE.find((row) => row.faqId === 'FAQ-012')
        ?.sourceUpdatedOn,
    ).toBe('2026-08-08');
    expect(
      INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE.find((row) => row.faqId === 'FAQ-036')
        ?.sourceUpdatedOn,
    ).toBe('2026-09-16');
  });

  it('adds stable institutional and product knowledge without treating it as dynamic event data', () => {
    for (const id of ['FAQ-012', 'FAQ-013', 'FAQ-014', 'FAQ-016', 'FAQ-035', 'FAQ-036']) {
      const row = INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE.find((item) => item.faqId === id);
      expect(row).toBeDefined();
      expect(row?.risk).toBe('LOW');
      expect(row?.autonomy).toBe('AUTO_REPLY_ALLOWED');
    }
  });

  it('keeps unverified operational facts and commercial leads outside automatic replies', () => {
    for (const id of [
      'FAQ-010',
      'FAQ-021',
      'FAQ-022',
      'FAQ-026',
      'FAQ-027',
      'FAQ-028',
      'FAQ-029',
      'FAQ-030',
      'FAQ-031',
      'FAQ-032',
      'FAQ-033',
      'FAQ-034',
    ]) {
      const row = INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE.find((item) => item.faqId === id);
      expect(row).toBeDefined();
      expect(row?.autonomy).toBe('SUGGEST_ONLY');
    }

    const commercial = INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE.filter(
      (row) => row.intent === 'COMMERCIAL_LEAD',
    );
    expect(commercial.length).toBeGreaterThanOrEqual(2);
    expect(commercial.every((row) => row.risk === 'MEDIUM')).toBe(true);
    expect(commercial.every((row) => row.autonomy === 'SUGGEST_ONLY')).toBe(true);
  });
});
