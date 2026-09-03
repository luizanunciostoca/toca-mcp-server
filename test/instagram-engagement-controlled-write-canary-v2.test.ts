import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-controlled-write-canary-v2.yml',
  'utf8',
);
const probe = readFileSync('scripts/instagram-engagement-controlled-write-probe.mjs', 'utf8');
const runner = readFileSync('scripts/instagram-engagement-controlled-write-runner.mjs', 'utf8');
const dockerfile = readFileSync('Dockerfile', 'utf8');

describe('Instagram engagement controlled-write canary V2', () => {
  it('binds authorization to the completed shadow lineage and one DIRECT reply', () => {
    expect(workflow).toContain(
      'BASE_SHADOW_CONTROLLER_SHA: 7aec1d86113b1e015ad002dda37a0009ec0b6038',
    );
    expect(workflow).toContain(
      'BASE_SHADOW_RUNTIME_SOURCE_SHA: d166d2447b544cad81bc16b93e863e9c88c613a8',
    );
    expect(workflow).toContain("BASE_SHADOW_RUN_ID: '33709434008'");
    expect(workflow).toContain(
      'BASE_SHADOW_ARTIFACT_DIGEST: sha256:6ebbd3c2a2f1cd656ff6873fc7a50069d634d4fd63c1375caa6edaa105e81a7e',
    );
    expect(workflow).toContain('CANARY_CHANNEL=DIRECT');
    expect(workflow).toContain('CANARY_MAX_EXTERNAL_REPLIES=1');
    expect(workflow).toContain('TEMPORARY_JOB_ONLY=true');
    expect(workflow).toContain('PERSISTENT_WRITES_AUTHORIZED=false');
    expect(workflow).toContain('EXTERNAL_REPLY_WRITES_AUTHORIZED=true');
  });

  it('never promotes persistent engagement writes from the canary', () => {
    expect(workflow).not.toContain('PERSIST_LIMITED_WRITES_ONLY_AFTER_ACK=true');
    expect(workflow).not.toContain('LIMITED_WRITES_ENABLED=true');
    expect(workflow).not.toContain(
      '--update-env-vars "INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=true',
    );
    expect(workflow).toContain(
      '--update-env-vars "INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED=false,INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false"',
    );
    expect(workflow).toContain(
      '--update-env-vars "INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED=true,INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false"',
    );
    expect(workflow).toContain("'PERSISTENT_WRITES_ENABLED=false'");
    expect(workflow).toContain("'PERSISTENT_AUTONOMY_PROMOTED=false'");
    expect(workflow).not.toContain('gcloud scheduler jobs run');
  });

  it('uses the two-phase isolated ordering before the provider side effect', () => {
    const reserve = workflow.indexOf('Reserve one recent high-confidence verified DIRECT inbound');
    const phase1 = workflow.indexOf('Phase 1 — classify exactly one reserved inbound');
    const gate = workflow.indexOf('Verify policy/thread/fact gates and reserve exact reply');
    const phase2 = workflow.indexOf('Phase 2 — execute exactly one reserved provider reply');
    const post = workflow.indexOf('Verify provider ACK, receipt and exact one-reply budget');
    const cleanup = workflow.indexOf('Release pending canary reservations');
    const restore = workflow.indexOf('Restore persistent daemon to runtime-on and writes-off');
    expect(reserve).toBeGreaterThan(0);
    expect(phase1).toBeGreaterThan(reserve);
    expect(gate).toBeGreaterThan(phase1);
    expect(phase2).toBeGreaterThan(gate);
    expect(post).toBeGreaterThan(phase2);
    expect(cleanup).toBeGreaterThan(post);
    expect(restore).toBeGreaterThan(cleanup);
  });

  it('requires high-confidence low-risk fact-verified conversation state before reply reservation', () => {
    expect(probe).toContain("classification.confidence !== 'HIGH'");
    expect(probe).toContain("['P2', 'P3'].includes(classification.priority)");
    expect(probe).toContain('classification.containsPotentialSensitiveData');
    expect(probe).toContain("classification.commercialIntent !== 'NONE'");
    expect(probe).toContain('!match?.factsVerified');
    expect(probe).toContain("row.risk !== 'LOW'");
    expect(probe).toContain("row.autonomy !== 'AUTO_REPLY_ALLOWED'");
    expect(probe).toContain("row.action_status !== 'READY_TO_SEND'");
    expect(probe).toContain("row.thread_state !== 'RESPONDABLE'");
    expect(probe).toContain("row.group_status !== 'READY_TO_SEND'");
    expect(probe).toContain("replyRow.max_attempts !== 1");
  });

  it('reserves exact outbox phases without exposing raw event ids in evidence output', () => {
    expect(probe).toContain("available_at = '-infinity'::timestamptz");
    expect(probe).toContain('instagram:engagement:canary-session:');
    expect(probe).toContain('CANARY_TARGET_SHA256=');
    expect(probe).toContain('CANARY_REPLY_SHA256=');
    expect(probe).not.toContain('CANARY_TARGET_EVENT_ID=');
    expect(probe).not.toContain('CANARY_REPLY_EVENT_ID=');
  });

  it('runs only one engagement event per isolated batch and requires a provider receipt', () => {
    expect(runner).toContain("process.env.INSTAGRAM_ENGAGEMENT_BATCH_SIZE?.trim() !== '1'");
    expect(runner).toContain('result.claimed !== 1');
    expect(runner).toContain('result.succeeded !== 1');
    expect(runner).toContain('result.failed !== 0');
    expect(probe).toContain("row.action_status !== 'SENT'");
    expect(probe).toContain('!row.provider_reply_id');
    expect(probe).toContain("row.reply_status !== 'DELIVERED'");
    expect(probe).toContain('summary.sent_count !== 1');
    expect(probe).toContain('summary.ambiguous_count !== 0');
  });

  it('packages only the canary scripts needed by temporary jobs', () => {
    expect(dockerfile).toContain(
      'COPY --from=build /app/scripts/instagram-engagement-controlled-write-probe.mjs ./scripts/instagram-engagement-controlled-write-probe.mjs',
    );
    expect(dockerfile).toContain(
      'COPY --from=build /app/scripts/instagram-engagement-controlled-write-runner.mjs ./scripts/instagram-engagement-controlled-write-runner.mjs',
    );
  });
});
