import { describe, expect, it } from 'vitest';
import {
  INSTAGRAM_ENGAGEMENT_CANONICAL_SPREADSHEET_ID,
  INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE,
} from '../src/instagram-engagement/knowledge-snapshot-current.js';

describe('Instagram engagement canonical knowledge snapshot', () => {
  it('is bound to the approved canonical FAQ spreadsheet', () => {
    expect(INSTAGRAM_ENGAGEMENT_CANONICAL_SPREADSHEET_ID).toBe(
      '1529TovmZFt1oBkCQ_K7kjRdjGuRidkfgPEJuzY4YvuA',
    );
    expect(INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE).toHaveLength(10);
  });

  it('keeps commercial leads outside automatic reply autonomy', () => {
    const commercial = INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE.find(
      (row) => row.intent === 'COMMERCIAL_LEAD',
    );
    expect(commercial?.autonomy).toBe('SUGGEST_ONLY');
  });
});
