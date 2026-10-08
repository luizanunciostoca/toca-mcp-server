import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-webhook-runtime-align.yml',
  'utf8',
);

describe('Instagram webhook runtime alignment', () => {
  it('is exact-head owner-authorized and serialized with callback writers', () => {
    for (const marker of [
      'Instagram Engagement Webhook Runtime Alignment',
      'INSTAGRAM_WEBHOOK_RUNTIME_ALIGNMENT=AUTHORIZED',
      'group: ${{ github.event.issue.user.login == github.repository_owner',
      "'instagram-engagement-webhook-callback-control'",
      'MAIN_STABILITY=PASS',
      'EVALUATED_MAIN_SHA=$GITHUB_SHA',
      'MERGE_RESERVATION=NONE',
      'AUTHORIZATION_STATE=CONSUMED_AND_CLOSED',
    ]) {
      expect(workflow).toContain(marker);
    }
  });

  it('aligns only the webhook to the current daemon immutable artifact', () => {
    for (const marker of [
      'EXPECTED_WEBHOOK_IMAGE_DIGEST',
      'EXPECTED_DAEMON_IMAGE_DIGEST',
      'SAME_IMMUTABLE_ARTIFACT_AS_DAEMON=true',
      'gcloud run deploy "$WEBHOOK_SERVICE_NAME"',
      '--no-traffic',
      'gcloud run services update-traffic "$WEBHOOK_SERVICE_NAME"',
      'bash scripts/verify-instagram-engagement-webhook-ingress.sh',
      'DAEMON_MUTATION=false',
      'DATABASE_MUTATIONS=false',
      'PROVIDER_METHODS=GET_ONLY',
      'PROVIDER_WRITES=false',
      'NEW_PAID_RESOURCES=false',
      'GENERAL_AUTONOMY=false',
    ]) {
      expect(workflow).toContain(marker);
    }

    expect(workflow).not.toContain('gcloud run deploy "$DAEMON_SERVICE_NAME"');
    expect(workflow).not.toContain(
      'gcloud run services update-traffic "$DAEMON_SERVICE_NAME"',
    );
    expect(workflow).not.toContain('gcloud run jobs deploy');
    expect(workflow).not.toContain('gcloud run jobs execute');
  });

  it('stages zero traffic before cutover and preserves daemon scheduler and IAM', () => {
    const markers = [
      '      - name: Capture exact daemon and webhook prestate',
      '      - name: Consume single-use authorization before mutation',
      '      - name: Stage webhook candidate on the daemon immutable artifact',
      '      - name: Cut over only webhook traffic',
      '      - name: Verify aligned webhook end to end without provider writes',
      '      - name: Publish successful alignment evidence',
    ];

    let previous = -1;
    for (const marker of markers) {
      const current = workflow.indexOf(marker);
      expect(current).toBeGreaterThan(previous);
      previous = current;
    }

    expect(workflow).toContain('ZERO_TRAFFIC_STAGE_REQUIRED=true');
    expect(workflow).toContain('([.status.traffic[]? | select(.revisionName==$candidate)');
    expect(workflow).toContain('PRE_DAEMON_TRAFFIC_SHA');
    expect(workflow).toContain('PRE_WEBHOOK_IAM_SHA');
    expect(workflow).toContain('PRE_SCHEDULER_SHA');
  });

  it('rolls webhook traffic back on failure or cancellation', () => {
    expect(workflow).toContain(
      "if: (failure() || cancelled()) && env.MUTATION_ATTEMPTED == 'true'",
    );
    expect(workflow).toContain('--to-revisions="$OLD_REVISION=100"');
    expect(workflow).toContain('INSTAGRAM_WEBHOOK_RUNTIME_ALIGNMENT_ROLLBACK=PASS');
    expect(workflow).toContain('ROLLBACK_REQUIRED=true');
  });
});
