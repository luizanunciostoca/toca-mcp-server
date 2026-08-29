import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-shadow-pipeline-diagnostics.yml',
  'utf8',
);

describe('Instagram engagement shadow pipeline diagnostics', () => {
  it('is read-only and never enables external writes', () => {
    const required = [
      'name: Instagram Engagement Shadow Pipeline Diagnostics',
      'workflow_run:',
      "workflows: ['Instagram Engagement Shadow Unique Candidate Recovery']",
      'readOnly:true',
      'externalReplyWritesAuthorized:false',
      'secretsPrinted: false',
      'messageTextPrinted: false',
      'gcloud logging read',
    ];

    for (const token of required) expect(workflow).toContain(token);
    expect(workflow).not.toContain('INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=true');
    expect(workflow).not.toContain('gcloud run services update ');
    expect(workflow).not.toContain('gcloud run services update-traffic');
    expect(workflow).not.toContain('gcloud scheduler jobs run');
    expect(workflow).not.toContain('add-iam-policy-binding');
    expect(workflow).not.toContain('secrets versions access');
  });

  it('binds diagnostics to the exact unique-candidate run and revision', () => {
    const required = [
      'BOOTSTRAP_TARGET_RUN_ID:',
      '.name == "Instagram Engagement Shadow Unique Candidate Recovery"',
      '.event == "workflow_dispatch"',
      '.head_branch == "main"',
      'RUN_TAIL="${TARGET_RUN_ID: -7}"',
      'EXPECTED_CANDIDATE_REVISION="${WEBHOOK_SERVICE_NAME}-u${RUN_TAIL}a${TARGET_RUN_ATTEMPT}"',
      'resource.labels.revision_name=\\"${EXPECTED_CANDIDATE_REVISION}\\"',
      'WINDOW_START=',
      'WINDOW_END=',
    ];

    for (const token of required) expect(workflow).toContain(token);
  });

  it('captures only aggregate webhook, daemon and scheduler signals', () => {
    const required = [
      'webhookRequest2xxCount',
      'webhookAcceptedEventCount',
      'webhookDuplicateEventCount',
      'daemonTickHttp2xxCount',
      'daemonTickCompletedCount',
      'engagementClaimedTotal',
      'engagementSucceededTotal',
      'engagementFailedTotal',
      'processingErrorCodes',
      'schedulerHttpSuccessCount',
      'INBOUND_NOT_CLAIMED_BY_DAEMON',
      'ENGAGEMENT_PROCESSOR_FAILED',
      'ENGAGEMENT_PROCESSOR_SUCCEEDED_ACTION_MISSING_OR_PROOF_MISMATCH',
    ];

    for (const token of required) expect(workflow).toContain(token);
  });
});
