import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-faq-expansion-limited-refresh.yml',
  'utf8',
);
const verifier = readFileSync(
  'src/ops/verify-instagram-faq-expansion-production.ts',
  'utf8',
);

describe('Instagram FAQ expansion LIMITED refresh', () => {
  it('keeps the production authorization narrow', () => {
    expect(workflow).toContain('INSTAGRAM_FAQ_EXPANSION_LIMITED_REFRESH=AUTHORIZED');
    expect(workflow).toContain('AUTO_REPLY_CHANNELS=DIRECT,COMMENT');
    expect(workflow).toContain('GENERAL_AUTONOMY_PROMOTION_AUTHORIZED=false');
    expect(workflow).toContain('SCHEDULER_MUTATION_AUTHORIZED=false');
    expect(workflow).toContain('ZERO_TRAFFIC_STAGE_REQUIRED=true');
    expect(workflow).toContain('BATCH_SIZE=1');
  });

  it('syncs the approved FAQ and knowledge sources', () => {
    expect(workflow).toContain('FAQ_EXPECTED_COUNT');
    expect(workflow).toContain('SRC-BRAND-001');
    expect(workflow).toContain('SRC-PROD-001');
    expect(workflow).toContain('sync-instagram-engagement-knowledge.js');
    expect(workflow).toContain('sync-instagram-engagement-knowledge-base.js');
    expect(verifier).toContain('EXPECTED_FAQ_COUNT = 36');
    expect(verifier).toContain('043_instagram_engagement_knowledge_source_kinds.sql');
  });

  it('stages, verifies and rolls back safely', () => {
    expect(workflow).toContain('--no-traffic --quiet');
    expect(workflow).toContain('POST_SCHEDULER_FINGERPRINT');
    expect(workflow).toContain('FAQ_EXPANSION_LIMITED_REFRESH_STATUS=PASS');
    expect(workflow).toContain('GENERAL_AUTONOMY_PROMOTED=false');
    expect(workflow).toContain('ROLLBACK_ATTEMPTED=true');
    expect(workflow).toContain('gh issue comment 641');
  });
});
