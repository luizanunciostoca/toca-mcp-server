import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-faq-expansion-limited-refresh.yml',
  'utf8',
);
const verifier = readFileSync('src/ops/verify-instagram-faq-expansion-production.ts', 'utf8');

describe('Instagram FAQ expansion LIMITED production refresh', () => {
  it('requires exact owner authorization and current protected main state', () => {
    expect(workflow).toContain('github.event.issue.user.login == github.repository_owner');
    expect(workflow).toContain(
      "startsWith(github.event.issue.title, 'PRODUCTION AUTHORIZATION — Instagram FAQ expansion LIMITED refresh AUTO')",
    );
    expect(workflow).toContain('AUTHORIZED_CONTROLLER_SHA=$GITHUB_SHA');
    expect(workflow).toContain('INSTAGRAM_FAQ_EXPANSION_LIMITED_REFRESH=AUTHORIZED');
    expect(workflow).toContain('RUNTIME_SOURCE_SHA=$GITHUB_SHA');
    expect(workflow).toContain('EVALUATED_MAIN_SHA=$GITHUB_SHA');
    expect(workflow).toContain('MERGE_RESERVATION=NONE');
  });

  it('preserves the existing Direct and Comment LIMITED envelope', () => {
    for (const marker of [
      'AUTONOMY_STAGE=LIMITED',
      'AUTO_REPLY_CHANNELS=DIRECT,COMMENT',
      'DIRECT_LIMITED_RUNTIME_ACTIVE=true',
      'COMMENT_LIMITED_RUNTIME_ACTIVE=true',
      'GENERAL_AUTONOMY=false',
      'GENERAL_AUTONOMY_PROMOTION_AUTHORIZED=false',
      'GENERAL_AUTONOMY_PROMOTED=false',
      'INSTAGRAM_ENGAGEMENT_AUTO_REPLY_CHANNELS=DIRECT,COMMENT',
      'INSTAGRAM_ENGAGEMENT_BATCH_SIZE=1',
      'INSTAGRAM_PUBLICATION_WRITES_ENABLED=false',
    ]) {
      expect(workflow).toContain(marker);
    }
  });

  it(
    'applies migrations and synchronizes the 36-FAQ snapshot plus all five canonical sources',
    () => {
      expect(workflow).toContain("FAQ_EXPECTED_COUNT: '36'");
      expect(workflow).toContain(
        'KB_SOURCE_IDS: SRC-OPS-001,SRC-MENU-002,SRC-LOC-001,SRC-BRAND-001,SRC-PROD-001',
      );
      expect(workflow).toContain('dist/scripts/migrate-and-verify.js');
      expect(workflow).toContain('dist/src/ops/sync-instagram-engagement-knowledge.js');
      expect(workflow).toContain('dist/src/ops/sync-instagram-engagement-knowledge-base.js');
      expect(workflow).toContain('dist/src/ops/verify-instagram-faq-expansion-production.js');
      expect(verifier).toContain("const EXPECTED_FAQ_COUNT = 36;");
      expect(verifier).toContain("'043_instagram_engagement_knowledge_source_kinds.sql'");
      expect(verifier).toContain("'SRC-BRAND-001'");
      expect(verifier).toContain("'SRC-PROD-001'");
      expect(verifier).toContain('providerWriteAttempted: false');
    },
  );

  it(
    'uses zero-traffic staging, immutable digest readback, unchanged scheduler and rollback',
    () => {
      expect(workflow).toContain('--no-traffic --quiet');
      expect(workflow).toContain('--to-revisions="${CANDIDATE_REVISION}=100"');
      expect(workflow).toContain('SCHEDULER_FINGERPRINT');
      expect(workflow).toContain('POST_SCHEDULER_FINGERPRINT');
      expect(workflow).toContain(
        'test "$POST_SCHEDULER_FINGERPRINT" = "$PRE_SCHEDULER_FINGERPRINT"',
      );
      expect(workflow).toContain('--to-revisions="${PRE_REVISION}=100"');
      expect(workflow).toContain('ROLLBACK_ATTEMPTED=true');
    },
  );

  it('records sanitized production evidence in the authorization issue and Evidence Ledger', () => {
    for (const marker of [
      'FAQ_EXPANSION_LIMITED_REFRESH_STATUS=PASS',
      'MIGRATION_043_APPLIED=true',
      'FAQ_COUNT=${{ steps.knowledge.outputs.faq_count }}',
      'FAQ_SNAPSHOT_SHA256=${{ steps.knowledge.outputs.faq_hash }}',
      'KB_SOURCE_COUNT=${{ steps.knowledge.outputs.kb_source_count }}',
      'SCHEDULER_MUTATION=false',
      'ROLLBACK_REQUIRED=false',
      'gh issue comment 641',
    ]) {
      expect(workflow).toContain(marker);
    }
  });
});
