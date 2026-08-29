import { describe, expect, it } from 'vitest';
import {
  INSTAGRAM_ENGAGEMENT_CANONICAL_SPREADSHEET_ID,
  INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE,
} from '../src/instagram-engagement/knowledge-snapshot-current.js';

const ACTIVE_CANONICAL_SPREADSHEET_ID = '1M0HSs7QJpFCJvvnrZxJRaaXY8scv5R3okCG_OyFLiEU';

describe('Instagram engagement canonical knowledge snapshot', () => {
  it('stays bound to the active canonical FAQ spreadsheet', () => {
    expect(INSTAGRAM_ENGAGEMENT_CANONICAL_SPREADSHEET_ID).toBe(ACTIVE_CANONICAL_SPREADSHEET_ID);
  });

  it('contains exactly the ten approved operational FAQs', () => {
    expect(INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE).toHaveLength(10);

    expect(
      INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE.every(
        (row) =>
          row.status === 'APROVADO' &&
          row.operationalValidity === 'ATIVO_ATE_SUBSTITUICAO_CANONICA',
      ),
    ).toBe(true);

    expect(new Set(INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE.map((row) => row.faqId)).size).toBe(10);
  });

  it('allows automatic replies only for the nine low-risk operational FAQs', () => {
    const automatic = INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE.filter(
      (row) => row.autonomy === 'AUTO_REPLY_ALLOWED',
    );

    expect(automatic).toHaveLength(9);
    expect(automatic.every((row) => row.risk === 'LOW')).toBe(true);
  });

  it('keeps commercial leads outside automatic reply autonomy', () => {
    const commercial = INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE.find(
      (row) => row.intent === 'COMMERCIAL_LEAD',
    );

    expect(commercial).toBeDefined();
    expect(commercial?.risk).toBe('MEDIUM');
    expect(commercial?.autonomy).toBe('SUGGEST_ONLY');
  });
});
