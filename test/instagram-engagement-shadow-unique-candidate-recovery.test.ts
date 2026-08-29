import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-shadow-unique-candidate-recovery.yml',
  'utf8',
);

describe('Instagram engagement unique candidate shadow recovery', () => {
  it('keeps the controller exact-head, shadow-only and fail-closed', () => {
    const required = [
      'name: Instagram Engagement Shadow Unique Candidate Recovery',
      'RECOVER_ENGAGEMENT_SHADOW_UNIQUE_CANDIDATE',
      'INSTAGRAM_ENGAGEMENT_SHADOW_UNIQUE_CANDIDATE_RECOVERY=AUTHORIZED',
      'DAEMON_CANDIDATE_TRAFFIC_ROUTING_AUTHORIZED=true',
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

    for (const token of required) expect(workflow).toContain(token);
    expect(workflow).not.toContain('INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=true');
    expect(workflow).not.toContain('services add-iam-policy-binding');
  });

  it('creates and addresses a deterministic unique Cloud Run revision directly', () => {
    const required = [
      'BEFORE_LATEST_READY=',
      'REVISION_SUFFIX="u${RUN_TAIL}a${GITHUB_RUN_ATTEMPT}"',
      'EXPECTED_WEBHOOK_CANDIDATE_REVISION="${WEBHOOK_SERVICE_NAME}-${REVISION_SUFFIX}"',
      '--revision-suffix="$REVISION_SUFFIX"',
      '@INSTAGRAM_ENGAGEMENT_SHADOW_RUN_ID=$GITHUB_RUN_ID',
      'gcloud run revisions describe "$EXPECTED_WEBHOOK_CANDIDATE_REVISION"',
      'Do not trust latestReadyRevisionName to identify the candidate',
      'candidateRevisionUnique:true',
    ];

    for (const token of required) expect(workflow).toContain(token);
  });

  it('creates, validates and routes an exact daemon candidate before proof', () => {
    const required = [
      'BEFORE_DAEMON_LATEST_READY=',
      'DAEMON_REVISION_SUFFIX="d${RUN_TAIL}a${GITHUB_RUN_ATTEMPT}"',
      'EXPECTED_DAEMON_CANDIDATE_REVISION="${DAEMON_SERVICE_NAME}-${DAEMON_REVISION_SUFFIX}"',
      '--revision-suffix="$DAEMON_REVISION_SUFFIX"',
      'gcloud run revisions describe "$EXPECTED_DAEMON_CANDIDATE_REVISION"',
      'daemon-candidate-contract.json',
      'databaseSecretBound',
      'cloudSqlBound',
      '--to-revisions="${EXPECTED_DAEMON_CANDIDATE_REVISION}=100"',
      'daemon-candidate-routing.json',
      'DAEMON_CANDIDATE_REVISION=$EXPECTED_DAEMON_CANDIDATE_REVISION',
      'Exact daemon candidate must still own 100% traffic immediately before proof',
      'daemonCandidateTrafficPercent:100',
    ];

    for (const token of required) expect(workflow).toContain(token);
  });

  it('emits sanitized field-level diagnostics before candidate exposure', () => {
    const required = [
      'candidate-contract.json',
      'serviceAccountMatches',
      'imageDigestMatches',
      'commandMatches',
      'argsMatches',
      'runtimeEnabled',
      'tenantMatches',
      'workspaceMatches',
      'organizationMatches',
      'shadowRunMatches',
      'persistenceEnabled',
      'Callback must remain closed while validating unique candidate',
    ];

    for (const token of required) expect(workflow).toContain(token);
  });

  it('retains exact traffic, scheduler proof, Meta readback and rollback gates', () => {
    const required = [
      '--to-revisions="${EXPECTED_WEBHOOK_CANDIDATE_REVISION}=100"',
      'callbackClosedDuringRouting:true',
      'tick_pump()',
      'gcloud scheduler jobs run "$SCHEDULER_JOB_NAME"',
      '.channelsVerified | sort == ["COMMENT","DIRECT"]',
      '.webhookAccepted == true',
      '.inboundDelivered == true',
      '.faqResolved == true',
      '.externalReplyObserved == false',
      '.replyOutboxEvents == 0',
      '.appSubscriptionConfigured == true',
      '.pageSubscriptionConfigured == true',
      '.instagramSubscriptionConfigured == true',
      '.pageAccessTokenResolved == true',
      'if: failure()',
      '--to-revisions="${PREVIOUS_DAEMON_REVISION}=100"',
    ];

    for (const token of required) expect(workflow).toContain(token);
  });
});
