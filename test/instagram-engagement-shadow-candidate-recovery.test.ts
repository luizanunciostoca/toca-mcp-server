import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-shadow-candidate-recovery.yml',
  'utf8',
);

describe('Instagram engagement exact candidate shadow recovery', () => {
  it('keeps the recovery exact-head, shadow-only and fail-closed', () => {
    const required = [
      'name: Instagram Engagement Shadow Candidate Recovery',
      'RECOVER_ENGAGEMENT_SHADOW_CANDIDATE',
      'INSTAGRAM_ENGAGEMENT_SHADOW_CANDIDATE_RECOVERY=AUTHORIZED',
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

  it('enables webhook inbound outbox composition without enabling external writes', () => {
    const required = [
      '@INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED=true',
      '@INSTAGRAM_ENGAGEMENT_TENANT_ID=$TOCA_TENANT_ID',
      '@INSTAGRAM_ENGAGEMENT_WORKSPACE_ID=$TOCA_WORKSPACE_ID',
      '@INSTAGRAM_ENGAGEMENT_ORGANIZATION_ID=$TOCA_ORGANIZATION_ID',
      'select(.name == "INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED") | .value',
      'select(.name == "INSTAGRAM_ENGAGEMENT_TENANT_ID") | .value',
      'select(.name == "INSTAGRAM_ENGAGEMENT_WORKSPACE_ID") | .value',
      'select(.name == "INSTAGRAM_ENGAGEMENT_ORGANIZATION_ID") | .value',
      'webhookInboundOutboxEnabled:true',
    ];

    for (const token of required) {
      expect(workflow).toContain(token);
    }

    expect(workflow).toContain('@INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false');
    expect(workflow).not.toContain('@INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=true');
  });

  it('routes and verifies exactly one webhook candidate before exposure', () => {
    const required = [
      'WEBHOOK_CANDIDATE_REVISION=',
      'gcloud run revisions describe "$WEBHOOK_CANDIDATE_REVISION"',
      '.spec.containers[0].image | contains($digest)',
      '.spec.containers[0].command == ["node"]',
      '.spec.containers[0].args == ["dist/src/http-instagram-engagement.js"]',
      '--to-revisions="${WEBHOOK_CANDIDATE_REVISION}=100"',
      'candidateTrafficPercent:100',
      'callbackClosedDuringRouting:true',
      'Expose DRS-safe callback only after candidate owns 100 percent traffic',
      '([.status.traffic[]? | select((.percent // 0) == 100) | .revisionName] | first == $revision)',
    ];

    for (const token of required) {
      expect(workflow).toContain(token);
    }
  });

  it('still proves both channels through authenticated ticks and strict Meta readback', () => {
    const required = [
      'SCHEDULER_JOB_NAME: toca-managed-instagram-tick',
      '.httpTarget.httpMethod == "POST"',
      '.httpTarget.oidcToken.serviceAccountEmail == $sa',
      '.httpTarget.oidcToken.audience == $audience',
      'tick_pump()',
      'gcloud scheduler jobs run "$SCHEDULER_JOB_NAME"',
      'instagram-engagement-shadow-e2e',
      '.channelsVerified | sort == ["COMMENT","DIRECT"]',
      '.externalReplyObserved == false',
      '.replyOutboxEvents == 0',
      'instagram-engagement-meta-subscriptions',
      '.appSubscriptionConfigured == true',
      '.pageSubscriptionConfigured == true',
      '.instagramSubscriptionConfigured == true',
      'proof-job-sanitized-logs.json',
      'if: failure()',
    ];

    for (const token of required) {
      expect(workflow).toContain(token);
    }
  });
});
