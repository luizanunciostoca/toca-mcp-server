import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-shadow-production.yml',
  'utf8',
);

describe('Instagram engagement production shadow first-webhook contract', () => {
  it('accepts an absent webhook prestate without weakening daemon rollback', () => {
    expect(workflow).toContain('WEBHOOK_SERVICE_EXISTED=false');
    expect(workflow).toContain(
      'PREVIOUS_WEBHOOK_SERVICE_EXISTED=$WEBHOOK_SERVICE_EXISTED',
    );
    expect(workflow).toContain(
      'webhookRevision:(if ($webhook|length)>0 then $webhook else "ABSENT" end)',
    );
    expect(workflow).toContain("test -n \"$PREVIOUS_DAEMON_REVISION\"");
    expect(workflow).not.toContain(
      "test -n \"$PREVIOUS_WEBHOOK_REVISION\" || { echo 'Webhook rollback revision missing'",
    );
  });

  it('bootstraps a first webhook privately before enabling the Meta callback surface', () => {
    expect(workflow).toContain('gcloud run deploy "$WEBHOOK_SERVICE_NAME"');
    expect(workflow).toContain('--no-allow-unauthenticated');
    expect(workflow).toContain('--default-url --quiet');
    expect(workflow).toContain('--member=allUsers --role=roles/run.invoker');
  });

  it('restores an absent first-webhook state as closed external exposure', () => {
    expect(workflow).toContain(
      'WEBHOOK_AUTOMATIC_ROLLBACK_MODE=ABSENT_CLOSED',
    );
    expect(workflow).toContain('--no-default-url --quiet');
    expect(workflow).toContain(
      'gcloud run services remove-iam-policy-binding "$WEBHOOK_SERVICE_NAME"',
    );
    expect(workflow).not.toContain(
      'gcloud run services delete "$WEBHOOK_SERVICE_NAME"',
    );
  });

  it('keeps engagement reply writes disabled throughout shadow bootstrap', () => {
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false');
    expect(workflow).not.toContain('INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=true');
  });
});
