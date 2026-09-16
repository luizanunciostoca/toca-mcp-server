import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const statePath = 'src/ops/instagram-faq-expansion-knowledge-state.ts';
const workflowPath = '.github/workflows/instagram-engagement-faq-knowledge-recovery.yml';
const guardPath = 'scripts/instagram-faq-refresh-production-guard.sh';
const state = readFileSync(statePath, 'utf8');
const workflow = readFileSync(workflowPath, 'utf8');
const guard = readFileSync(guardPath, 'utf8');

describe('Instagram FAQ expansion knowledge recovery', () => {
  it('restores chunks without writing the generated search_vector column', () => {
    expect(state).toContain("['BACKUP', 'RESTORE', 'CLEANUP', 'INSPECT']");
    expect(state).toContain('insert into instagram_engagement_knowledge_chunks (');
    expect(state).toContain('chunk_id,');
    expect(state).toContain('search_text,');
    expect(state).toContain('from ${tables.chunks}');
    expect(state).not.toContain(
      'insert into instagram_engagement_knowledge_chunks select * from ${tables.chunks}',
    );
  });

  it('provides a read-only inspection mode before recovery mutation', () => {
    expect(state).toContain("if (action === 'INSPECT')");
    expect(state).toContain("operation: 'INSPECT'");
    expect(state).toContain('backupFaqCount: backup.faq');
    expect(state).toContain('activeFaqCount: active.faq');
    expect(state).toContain('providerWriteAttempted: false');
    expect(workflow).toContain('INSTAGRAM_FAQ_EXPANSION_STATE_ACTION=INSPECT');
    expect(workflow).toContain('.backupPresent == true');
    expect(workflow).toContain('.jsonPayload // ((.textPayload // "") | fromjson?)');
  });

  it('revalidates exact single-use recovery authorization through the shared guard', () => {
    expect(workflow).toContain('INSTAGRAM_FAQ_GUARD_PROFILE: FAQ_KNOWLEDGE_RECOVERY');
    expect(workflow).toContain('instagram-faq-refresh-production-guard.sh ACQUIRE');
    expect(workflow).toContain('instagram-faq-refresh-production-guard.sh ASSERT');
    expect(workflow).toContain('instagram-faq-refresh-production-guard.sh RELEASE');
    expect(guard).toContain("TITLE_PREFIX='PRODUCTION AUTHORIZATION — Instagram FAQ knowledge RECOVERY AUTO'");
    expect(guard).toContain('.state == "open"');
    expect(guard).toContain('.user.login == $owner');
    expect(guard).toContain('INSTAGRAM_FAQ_EXPANSION_KNOWLEDGE_RECOVERY=AUTHORIZED');
    expect(guard).toContain('AUTHORIZED_CONTROLLER_SHA=$GITHUB_SHA');
    expect(guard).toContain('RUNTIME_SOURCE_SHA=$GITHUB_SHA');
    expect(guard).toContain('DATABASE_MUTATIONS_AUTHORIZED=true');
    expect(guard).toContain('SERVICE_DEPLOY_AUTHORIZED=false');
    expect(guard).toContain('SCHEDULER_MUTATION_AUTHORIZED=false');
    expect(guard).toContain('PROVIDER_WRITES_AUTHORIZED=false');
    expect(guard).toContain('EXTERNAL_REPLY_WRITES_AUTHORIZED=false');
    expect(guard).toContain('GENERAL_AUTONOMY_PROMOTION_AUTHORIZED=false');
    expect(workflow).toContain('AUTHORIZATION_STATE=CONSUMED_AND_CLOSED');
  });

  it('serializes recovery against every shared engagement production mutation', () => {
    expect(guard).toContain('actions/runs?status=${status}&per_page=100');
    expect(guard).toContain('instagram-engagement-faq-expansion-limited-refresh.yml');
    expect(guard).toContain('instagram-engagement-faq-knowledge-recovery.yml');
    expect(guard).toContain('MERGE_RESERVATION=$ENGAGEMENT_RESERVATION');
    expect(guard).toContain('Competing engagement production mutation runs detected');
    expect(workflow).toContain('ENGAGEMENT_RESERVATION: FAQ_KNOWLEDGE_RECOVERY_');
  });

  it('preserves the active LIMITED runtime while recovering only database knowledge', () => {
    expect(guard).toContain('ENGAGEMENT_AUTONOMY_STAGE=LIMITED');
    expect(guard).toContain('ENGAGEMENT_AUTO_REPLY_CHANNELS=DIRECT,COMMENT');
    expect(guard).toContain('GENERAL_AUTONOMY=false');
    expect(workflow).toContain('EXPECTED_ACTIVE_REVISION');
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_BATCH_SIZE');
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_AUTO_REPLY_CHANNELS');
    expect(workflow).toContain('INSTAGRAM_PUBLICATION_WRITES_ENABLED');
    expect(workflow).not.toContain('gcloud run services update');
    expect(workflow).not.toContain('gcloud scheduler jobs update');
  });
});
