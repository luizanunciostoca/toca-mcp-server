import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflowPath = '.github/workflows/instagram-engagement-faq-expansion-limited-refresh.yml';
const guardPath = 'scripts/instagram-faq-refresh-production-guard.sh';
const conflictFilterPath = 'scripts/instagram-engagement-production-mutation-conflicts.jq';
const statePath = 'src/ops/instagram-faq-expansion-knowledge-state.ts';
const verifierPath = 'src/ops/verify-instagram-faq-expansion-production.ts';
const workflow = readFileSync(workflowPath, 'utf8');
const guard = readFileSync(guardPath, 'utf8');
const conflictFilter = readFileSync(conflictFilterPath, 'utf8');
const state = readFileSync(statePath, 'utf8');
const verifier = readFileSync(verifierPath, 'utf8');

describe('Instagram FAQ expansion LIMITED refresh', () => {
  it('keeps the production authorization narrow and live', () => {
    expect(workflow).toContain('actions: read');
    expect(workflow).toContain('AUTHORIZATION_ISSUE: ${{ github.event.issue.number }}');
    expect(workflow).toContain('instagram-faq-refresh-production-guard.sh ACQUIRE');
    expect(workflow).toContain('instagram-faq-refresh-production-guard.sh ASSERT');
    expect(workflow).toContain('instagram-faq-refresh-production-guard.sh RELEASE');
    expect(guard).toContain('INSTAGRAM_FAQ_EXPANSION_LIMITED_REFRESH=AUTHORIZED');
    expect(guard).toContain('AUTO_REPLY_CHANNELS=DIRECT,COMMENT');
    expect(guard).toContain('GENERAL_AUTONOMY_PROMOTION_AUTHORIZED=false');
    expect(guard).toContain('SCHEDULER_MUTATION_AUTHORIZED=false');
    expect(guard).toContain('ZERO_TRAFFIC_STAGE_REQUIRED=true');
    expect(guard).toContain('BATCH_SIZE=1');
    expect(guard).toContain('gh api "repos/${GITHUB_REPOSITORY}/issues/${AUTHORIZATION_ISSUE}"');
    expect(guard).toContain('.state == "open"');
    expect(guard).toContain('AUTHORIZATION_STATE=ACTIVE');
  });

  it('serializes engagement mutations through the control-plane reservation', () => {
    expect(workflow).toContain('ENGAGEMENT_RESERVATION: FAQ_EXPANSION_${{ github.run_id }}');
    expect(guard).toContain('MERGE_RESERVATION=$ENGAGEMENT_RESERVATION');
    expect(guard).toContain('MERGE_RESERVATION=NONE');
    expect(guard).toContain('actions/runs?status=${status}&per_page=100');
    expect(guard).toContain('-f "$CONFLICT_FILTER"');
    expect(conflictFilter).toContain('instagram-engagement-limited-runtime-refresh.yml');
    expect(conflictFilter).toContain('instagram-engagement-comment-limited-promotion.yml');
    expect(conflictFilter).toContain('.actor.login == $owner');
    expect(workflow).toContain('test "$CURRENT_REVISION" = "$PRE_REVISION"');
    expect(workflow).toContain(
      'test "$CURRENT_SCHEDULER_FINGERPRINT" = "$PRE_SCHEDULER_FINGERPRINT"',
    );
  });

  it('syncs and verifies the exact approved FAQ and five knowledge sources', () => {
    expect(workflow).toContain("FAQ_EXPECTED_COUNT: '36'");
    expect(workflow).toContain(
      'KB_SOURCE_IDS: SRC-OPS-001,SRC-MENU-002,SRC-LOC-001,SRC-BRAND-001,SRC-PROD-001',
    );
    expect(workflow).toContain('sync-instagram-engagement-knowledge.js');
    expect(workflow).toContain('sync-instagram-engagement-knowledge-base.js');
    expect(verifier).toContain('EXPECTED_FAQ_COUNT = 36');
    expect(verifier).toContain('043_instagram_engagement_knowledge_source_kinds.sql');
    expect(verifier).toContain('EXPECTED_FAQ_SNAPSHOT_SHA256');
    expect(verifier).toContain('INSTAGRAM_FAQ_EXPANSION_CANONICAL_SNAPSHOT_HASH_MISMATCH');
    expect(verifier).toContain('canonicalSnapshotHashMatched: true');
  });

  it('backs up and restores shared knowledge as part of rollback', () => {
    expect(workflow).toContain('INSTAGRAM_FAQ_EXPANSION_STATE_ACTION=BACKUP');
    expect(workflow).toContain('INSTAGRAM_FAQ_EXPANSION_STATE_ACTION=RESTORE');
    expect(workflow).toContain('INSTAGRAM_FAQ_EXPANSION_STATE_ACTION=CLEANUP');
    expect(workflow).toContain('KNOWLEDGE_ROLLBACK_BOUNDARY=BACKUP_RESTORE');
    expect(state).toContain("if (action === 'BACKUP')");
    expect(state).toContain("action === 'RESTORE'");
    expect(state).toContain('INSTAGRAM_FAQ_EXPANSION_RESTORE_COUNT_MISMATCH');
    expect(state).toContain('providerWriteAttempted: false');
  });

  it('stages at zero traffic, preserves scheduler and records sanitized evidence', () => {
    expect(workflow).toContain('--no-traffic --quiet');
    expect(workflow).toContain('POST_SCHEDULER_FINGERPRINT');
    expect(workflow).toContain('FAQ_EXPANSION_LIMITED_REFRESH_STATUS=PASS');
    expect(workflow).toContain('FAQ_CANONICAL_SNAPSHOT_HASH_MATCHED=true');
    expect(workflow).toContain('GENERAL_AUTONOMY_PROMOTED=false');
    expect(workflow).toContain('ROLLBACK_ATTEMPTED=true');
    expect(workflow).toContain('gh issue comment 641');
  });

  it('keeps the production guard shell syntactically valid', () => {
    expect(() => execFileSync('bash', ['-n', guardPath], { stdio: 'pipe' })).not.toThrow();
  });
});
