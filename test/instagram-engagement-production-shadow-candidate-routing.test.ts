import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-shadow-production.yml',
  'utf8',
);

describe('Instagram production shadow exact candidate routing', () => {
  it('creates deterministic daemon and webhook candidates and routes each to 100 percent', () => {
    expect(workflow).toContain('DAEMON_REVISION_SUFFIX=');
    expect(workflow).toContain('WEBHOOK_REVISION_SUFFIX=');
    expect(workflow).toContain('--revision-suffix="$DAEMON_REVISION_SUFFIX"');
    expect(workflow).toContain('--revision-suffix="$WEBHOOK_REVISION_SUFFIX"');
    expect(workflow).toContain('--to-revisions="${EXPECTED_DAEMON_CANDIDATE_REVISION}=100"');
    expect(workflow).toContain('--to-revisions="${EXPECTED_WEBHOOK_CANDIDATE_REVISION}=100"');
    expect(workflow).toContain('Daemon candidate must own exactly 100% traffic before proof');
    expect(workflow).toContain(
      'Webhook candidate must own exactly 100% traffic while callback remains closed',
    );
  });

  it('keeps the callback closed until the exact webhook candidate owns traffic', () => {
    expect(workflow).toContain('--no-default-url --invoker-iam-check');
    expect(workflow).toContain(
      'callback stays closed until the exact verified candidate owns all traffic',
    );
    expect(workflow).toContain('--default-url --no-invoker-iam-check');
  });

  it('proves both shadow stages with authenticated scheduler ticks', () => {
    expect(workflow).toContain('SCHEDULER_JOB_NAME: toca-managed-instagram-tick');
    expect(workflow).toContain('tick_pump()');
    expect(workflow).toContain('gcloud scheduler jobs run "$SCHEDULER_JOB_NAME"');
    expect(workflow).toContain('Scheduler target/OIDC boundary mismatch');
    expect(workflow).toContain('tickPumpUsed:true');
  });

  it('remains fail closed for external replies while routing candidates', () => {
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false');
    expect(workflow).not.toContain('INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=true');
    expect(workflow).toContain('.replyOutboxEvents == 0');
    expect(workflow).toContain('.externalReplyObserved == false');
  });
});
