import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const statePath = 'src/ops/instagram-faq-expansion-knowledge-state.ts';
const workflowPath = '.github/workflows/instagram-engagement-faq-knowledge-recovery.yml';
const guardPath = 'scripts/instagram-faq-refresh-production-guard.sh';
const conflictFilterPath = 'scripts/instagram-engagement-production-mutation-conflicts.jq';
const state = readFileSync(statePath, 'utf8');
const workflow = readFileSync(workflowPath, 'utf8');
const guard = readFileSync(guardPath, 'utf8');
const conflictFilter = readFileSync(conflictFilterPath, 'utf8');

const authorizedMutationMappings = [
  {
    path: '.github/workflows/instagram-engagement-limited-activation.yml',
    title: 'PRODUCTION AUTHORIZATION — Instagram engagement LIMITED activation AUTO',
  },
  {
    path: '.github/workflows/instagram-engagement-limited-runtime-refresh.yml',
    title: 'PRODUCTION AUTHORIZATION — Instagram engagement LIMITED runtime refresh AUTO',
  },
  {
    path: '.github/workflows/instagram-engagement-comment-limited-promotion.yml',
    title: 'PRODUCTION AUTHORIZATION — Instagram engagement COMMENT LIMITED promotion AUTO',
  },
  {
    path: '.github/workflows/instagram-engagement-tiered-knowledge-shadow.yml',
    title: 'PRODUCTION AUTHORIZATION — Instagram tiered knowledge shadow AUTO',
  },
  {
    path: '.github/workflows/instagram-engagement-faq-expansion-limited-refresh.yml',
    title: 'PRODUCTION AUTHORIZATION — Instagram FAQ expansion LIMITED refresh AUTO',
  },
  {
    path: '.github/workflows/instagram-engagement-faq-knowledge-recovery.yml',
    title: 'PRODUCTION AUTHORIZATION — Instagram FAQ knowledge RECOVERY AUTO',
  },
] as const;

function mutationRun(id: number, path: string, displayTitle: string, actor = 'luizanunciostoca') {
  return {
    id,
    path,
    display_title: displayTitle,
    event: 'issues',
    head_branch: 'main',
    actor: { login: actor },
  };
}

function countMutationConflicts(workflowRuns: unknown[], self = 999, owner = 'luizanunciostoca') {
  const args = [
    '--argjson',
    'self',
    String(self),
    '--arg',
    'owner',
    owner,
    '-f',
    conflictFilterPath,
  ];
  const output = execFileSync('jq', args, {
    input: JSON.stringify({ workflow_runs: workflowRuns }),
    encoding: 'utf8',
  });
  return Number(output.trim());
}

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
    expect(guard).toContain(
      "TITLE_PREFIX='PRODUCTION AUTHORIZATION — Instagram FAQ knowledge RECOVERY AUTO'",
    );
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
    expect(guard).toContain('-f "$CONFLICT_FILTER"');
    expect(conflictFilter).toContain('instagram-engagement-faq-expansion-limited-refresh.yml');
    expect(conflictFilter).toContain('instagram-engagement-faq-knowledge-recovery.yml');
    expect(conflictFilter).toContain('.actor.login == $owner');
    expect(guard).toContain('MERGE_RESERVATION=$ENGAGEMENT_RESERVATION');
    expect(guard).toContain('Competing engagement production mutation runs detected');
    expect(workflow).toContain('ENGAGEMENT_RESERVATION: FAQ_KNOWLEDGE_RECOVERY_');
  });

  it('filters issue fanout by owner eligibility and all six workflow title mappings', () => {
    authorizedMutationMappings.forEach((mapping, index) => {
      const id = index + 1;
      expect(countMutationConflicts([mutationRun(id, mapping.path, mapping.title)])).toBe(1);
      expect(
        countMutationConflicts([mutationRun(id, mapping.path, mapping.title, 'outsider')]),
      ).toBe(0);
    });

    const recoveryTitle = authorizedMutationMappings[5].title;
    const fanout = authorizedMutationMappings.map((mapping, index) =>
      mutationRun(index + 1, mapping.path, recoveryTitle),
    );
    expect(countMutationConflicts(fanout, 6)).toBe(0);

    const runtimeRefresh = authorizedMutationMappings[1];
    const realConcurrentRun = mutationRun(99, runtimeRefresh.path, runtimeRefresh.title);
    expect(countMutationConflicts([...fanout, realConcurrentRun], 6)).toBe(1);
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
