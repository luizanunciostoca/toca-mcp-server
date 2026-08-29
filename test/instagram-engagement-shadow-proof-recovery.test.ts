import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-shadow-proof-recovery.yml',
  'utf8',
);

describe('Instagram engagement shadow proof recovery', () => {
  it('preserves the authorized fail-closed recovery contract', () => {
    const required = [
      'name: Instagram Engagement Shadow Proof Recovery',
      'confirm_recovery:',
      'RECOVER_ENGAGEMENT_SHADOW_PROOF',
      'INSTAGRAM_ENGAGEMENT_SHADOW_PROOF_RECOVERY=AUTHORIZED',
      'AUTHORIZED_CANDIDATE_SHA=',
      'EXTERNAL_REPLY_WRITES_AUTHORIZED=false',
      'INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false',
      'RUNTIME_SOURCE_SHA: d23039fa360b1e1674964a59bd003ca76227e48f',
      'RUNTIME_IMAGE_DIGEST: sha256:4f7f9775fea909416341b18e0bc042fe0318037d6c1791fc7bcb4e121af24e30',
      '--default-url --no-invoker-iam-check',
      '--no-default-url --invoker-iam-check',
      'WEBHOOK_AUTOMATIC_ROLLBACK_MODE=DRS_CLOSED',
      'externalReplyWritesEnabled:false',
    ];

    for (const token of required) {
      expect(workflow).toContain(token);
    }

    expect(workflow).not.toContain('INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=true');
    expect(workflow).not.toContain('services add-iam-policy-binding');
  });

  it('verifies and pumps the existing authenticated scheduler for the proof', () => {
    const required = [
      'SCHEDULER_JOB_NAME: toca-managed-instagram-tick',
      'gcloud scheduler jobs describe "$SCHEDULER_JOB_NAME"',
      '--arg uri "${DAEMON_URL}/tick"',
      '.httpTarget.httpMethod == "POST"',
      '.httpTarget.oidcToken.serviceAccountEmail == $sa',
      '.httpTarget.oidcToken.audience == $audience',
      'tick_pump()',
      'gcloud scheduler jobs run "$SCHEDULER_JOB_NAME"',
      'tick_pump &',
      'instagram-engagement-shadow-e2e',
      '.channelsVerified | sort == ["COMMENT","DIRECT"]',
      '.externalReplyObserved == false',
      '.replyOutboxEvents == 0',
      'instagram-engagement-meta-subscriptions',
      '.appSubscriptionConfigured == true',
      '.pageSubscriptionConfigured == true',
      '.instagramSubscriptionConfigured == true',
      'if: failure()',
    ];

    for (const token of required) {
      expect(workflow).toContain(token);
    }
  });
});
