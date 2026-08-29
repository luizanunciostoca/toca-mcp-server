import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-shadow-proof-recovery.yml',
  'utf8',
);

describe('Instagram engagement shadow proof recovery', () => {
  it('is manual, exact-head authorized and shadow-only', () => {
    expect(workflow).toContain('name: Instagram Engagement Shadow Proof Recovery');
    expect(workflow).toContain('confirm_recovery:');
    expect(workflow).toContain('RECOVER_ENGAGEMENT_SHADOW_PROOF');
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_SHADOW_PROOF_RECOVERY=AUTHORIZED');
    expect(workflow).toContain('AUTHORIZED_CANDIDATE_SHA=');
    expect(workflow).toContain('EXTERNAL_REPLY_WRITES_AUTHORIZED=false');
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false');
    expect(workflow).not.toContain('INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=true');
  });

  it('reuses the exact immutable runtime and DRS-safe callback', () => {
    expect(workflow).toContain(
      'RUNTIME_SOURCE_SHA: d23039fa360b1e1674964a59bd003ca76227e48f',
    );
    expect(workflow).toContain(
      'RUNTIME_IMAGE_DIGEST: sha256:4f7f9775fea909416341b18e0bc042fe0318037d6c1791fc7bcb4e121af24e30',
    );
    expect(workflow).toContain('--default-url --no-invoker-iam-check');
    expect(workflow).toContain('--no-default-url --invoker-iam-check');
    expect(workflow).not.toContain('services add-iam-policy-binding');
  });

  it('validates the existing private scheduler target before pumping ticks', () => {
    expect(workflow).toContain('SCHEDULER_JOB_NAME: toca-managed-instagram-tick');
    expect(workflow).toContain('gcloud scheduler jobs describe "$SCHEDULER_JOB_NAME"');
    expect(workflow).toContain('--arg uri "${DAEMON_URL}/tick"');
    expect(workflow).toContain('.httpTarget.httpMethod == "POST"');
    expect(workflow).toContain('.httpTarget.oidcToken.serviceAccountEmail == $sa');
    expect(workflow).toContain('.httpTarget.oidcToken.audience == $audience');
  });

  it('pumps the authenticated scheduler while the synthetic proof waits for COMMENT and DIRECT', () => {
    expect(workflow).toContain('tick_pump()');
    expect(workflow).toContain('gcloud scheduler jobs run "$SCHEDULER_JOB_NAME"');
    expect(workflow).toContain('tick_pump &');
    expect(workflow).toContain('instagram-engagement-shadow-e2e');
    expect(workflow).toContain('.channelsVerified | sort == ["COMMENT","DIRECT"]');
    expect(workflow).toContain('.externalReplyObserved == false');
    expect(workflow).toContain('.replyOutboxEvents == 0');
  });

  it('keeps Meta provider readback mandatory and rolls back closed on failure', () => {
    expect(workflow).toContain('instagram-engagement-meta-subscriptions');
    expect(workflow).toContain('.appSubscriptionConfigured == true');
    expect(workflow).toContain('.pageSubscriptionConfigured == true');
    expect(workflow).toContain('.instagramSubscriptionConfigured == true');
    expect(workflow).toContain('if: failure()');
    expect(workflow).toContain('WEBHOOK_AUTOMATIC_ROLLBACK_MODE=DRS_CLOSED');
    expect(workflow).toContain('externalReplyWritesEnabled:false');
  });
});
