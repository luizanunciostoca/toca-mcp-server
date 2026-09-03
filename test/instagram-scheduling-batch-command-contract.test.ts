import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/instagram-scheduling-batch-command.yml', 'utf8');

describe('Instagram scheduling batch command contract', () => {
  it('accepts only the owner command on authorization issue 523', () => {
    expect(workflow).toContain('issue_comment:');
    expect(workflow).toContain("AUTHORIZATION_ISSUE: '523'");
    expect(workflow).toContain("ALLOWED_ACTOR: 'luizanunciostoca'");
    expect(workflow).toContain("COMMAND_PREFIX: '/toca-schedule-authorized-48 '");
    expect(workflow).toContain("github.event.issue.number == 523");
    expect(workflow).toContain("github.actor == 'luizanunciostoca'");
  });

  it('requires exact current main and the immutable authorized bundle', () => {
    expect(workflow).toContain('test "$CANDIDATE_SHA" = "$MAIN_SHA"');
    expect(workflow).toContain(
      'BUNDLE_SHA256: 9fb7c7cd85fd9ec431316e4cf4c81b31f8b01a5da3117a76deeda74797ec3476',
    );
    expect(workflow).toContain("grep -Fqx 'BUNDLE_ITEM_COUNT=48'");
    expect(workflow).toContain("grep -Fqx 'APPROVE_SELECTED_ITEMS=ALL_48'");
  });

  it('dispatches only the canonical one-shot workflow and never publishes directly', () => {
    expect(workflow).toContain("TARGET_WORKFLOW: 'instagram-scheduling-batch-one-shot.yml'");
    expect(workflow).toContain('actions/workflows/${TARGET_WORKFLOW}/dispatches');
    expect(workflow).toContain('confirm_schedule:"SCHEDULE_AUTHORIZED_48"');
    expect(workflow).not.toContain('gcloud ');
    expect(workflow).not.toContain('media_publish');
    expect(workflow).not.toContain('scheduled_jobs');
    expect(workflow).not.toContain('cron:');
  });
});
