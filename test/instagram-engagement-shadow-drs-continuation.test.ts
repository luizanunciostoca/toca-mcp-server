import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-shadow-production.yml',
  'utf8',
);

describe('Instagram engagement production shadow DRS-safe primary workflow', () => {
  it('keeps the familiar production shadow dispatch surface', () => {
    expect(workflow).toContain('name: Instagram Engagement Production Shadow');
    expect(workflow).toContain('confirm_shadow:');
    expect(workflow).toContain('DEPLOY_ENGAGEMENT_SHADOW');
    expect(workflow).not.toContain('confirm_continuation:');
  });

  it('uses the exact previously validated immutable runtime image', () => {
    expect(workflow).toContain('RUNTIME_SOURCE_SHA: d23039fa360b1e1674964a59bd003ca76227e48f');
    expect(workflow).toContain(
      'RUNTIME_IMAGE_DIGEST: sha256:4f7f9775fea909416341b18e0bc042fe0318037d6c1791fc7bcb4e121af24e30',
    );
    expect(workflow).toContain(
      'server@sha256:4f7f9775fea909416341b18e0bc042fe0318037d6c1791fc7bcb4e121af24e30',
    );
  });

  it('requires an exact owner-authored authorization for the controller and runtime image', () => {
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_DRS_CONTINUATION=AUTHORIZED');
    expect(workflow).toContain('AUTHORIZED_CANDIDATE_SHA=');
    expect(workflow).toContain('RUNTIME_SOURCE_SHA=');
    expect(workflow).toContain('RUNTIME_IMAGE_DIGEST=');
    expect(workflow).toContain('EXTERNAL_REPLY_WRITES_AUTHORIZED=false');
  });

  it('uses the Cloud Run DRS-safe public access mode instead of adding allUsers', () => {
    expect(workflow).toContain('--default-url --no-invoker-iam-check');
    expect(workflow).toContain('run.googleapis.com/invoker-iam-disabled');
    expect(workflow).not.toContain('services add-iam-policy-binding');
  });

  it('restores the callback to a closed state on any failure', () => {
    expect(workflow).toContain('--no-default-url --invoker-iam-check');
    expect(workflow).toContain('WEBHOOK_AUTOMATIC_ROLLBACK_MODE=DRS_CLOSED');
    expect(workflow).toContain('if: failure()');
  });

  it('keeps all Instagram engagement external writes disabled', () => {
    expect(workflow).not.toContain('INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=true');
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false');
    expect(workflow).toContain('externalReplyWritesEnabled:false');
  });

  it('requires COMMENT and DIRECT synthetic proof and Meta provider readback', () => {
    expect(workflow).toContain('instagram-engagement-shadow-e2e');
    expect(workflow).toContain('.channelsVerified | sort == ["COMMENT","DIRECT"]');
    expect(workflow).toContain('.externalReplyObserved == false');
    expect(workflow).toContain('.replyOutboxEvents == 0');
    expect(workflow).toContain('instagram-engagement-meta-subscriptions');
    expect(workflow).toContain('.appSubscriptionConfigured == true');
    expect(workflow).toContain('.pageSubscriptionConfigured == true');
    expect(workflow).toContain('.instagramSubscriptionConfigured == true');
  });
});
