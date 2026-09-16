import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const statePath = 'src/ops/instagram-faq-expansion-knowledge-state.ts';
const workflowPath = '.github/workflows/instagram-engagement-faq-knowledge-recovery.yml';
const state = readFileSync(statePath, 'utf8');
const workflow = readFileSync(workflowPath, 'utf8');

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
  });

  it('requires exact single-use recovery authorization', () => {
    expect(workflow).toContain('INSTAGRAM_FAQ_EXPANSION_KNOWLEDGE_RECOVERY=AUTHORIZED');
    expect(workflow).toContain('AUTHORIZED_CONTROLLER_SHA=$GITHUB_SHA');
    expect(workflow).toContain('RUNTIME_SOURCE_SHA=$GITHUB_SHA');
    expect(workflow).toContain('DATABASE_MUTATIONS_AUTHORIZED=true');
    expect(workflow).toContain('SERVICE_DEPLOY_AUTHORIZED=false');
    expect(workflow).toContain('SCHEDULER_MUTATION_AUTHORIZED=false');
    expect(workflow).toContain('PROVIDER_WRITES_AUTHORIZED=false');
    expect(workflow).toContain('EXTERNAL_REPLY_WRITES_AUTHORIZED=false');
    expect(workflow).toContain('GENERAL_AUTONOMY_PROMOTION_AUTHORIZED=false');
    expect(workflow).toContain('AUTHORIZATION_STATE=CONSUMED_AND_CLOSED');
  });

  it('preserves the active LIMITED runtime while recovering only database knowledge', () => {
    expect(workflow).toContain('ENGAGEMENT_AUTONOMY_STAGE=LIMITED');
    expect(workflow).toContain('ENGAGEMENT_AUTO_REPLY_CHANNELS=DIRECT,COMMENT');
    expect(workflow).toContain('GENERAL_AUTONOMY=false');
    expect(workflow).toContain('EXPECTED_ACTIVE_REVISION');
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_BATCH_SIZE');
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_AUTO_REPLY_CHANNELS');
    expect(workflow).toContain('INSTAGRAM_PUBLICATION_WRITES_ENABLED');
    expect(workflow).not.toContain('gcloud run services update');
    expect(workflow).not.toContain('gcloud scheduler jobs update');
  });
});
