import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-canary-readiness-diagnostic.yml',
  'utf8',
);

describe('Instagram canary readiness retained-log diagnostic', () => {
  it('is owner-authorized, exact-main and read-only', () => {
    expect(workflow).toContain(
      'github.event.issue.user.login == github.repository_owner',
    );
    expect(workflow).toContain('AUTHORIZED_CANDIDATE_SHA=$GITHUB_SHA');
    expect(workflow).toContain('READ_ONLY_DIAGNOSTIC=true');
    expect(workflow).toContain('SERVICE_MUTATIONS_AUTHORIZED=false');
    expect(workflow).toContain('DATABASE_MUTATIONS_AUTHORIZED=false');
    expect(workflow).toContain('PROVIDER_WRITES_AUTHORIZED=false');
    expect(workflow).toContain('EXTERNAL_REPLY_WRITES_AUTHORIZED=false');
  });

  it('only accepts the readiness job lineage for the declared canary run', () => {
    expect(workflow).toContain('[[ "$SOURCE_RUN_ID" =~ ^[0-9]+$ ]]');
    expect(workflow).toContain('toca-ig-canary-ready-${SOURCE_RUN_ID}-');
    expect(workflow).toContain('[[ "$SOURCE_EXECUTION" == "${SOURCE_JOB}-"* ]]');
  });

  it('queries Cloud Logging without mutating Cloud Run or providers', () => {
    expect(workflow).toContain('gcloud logging read');
    expect(workflow).toContain('resource.labels.job_name');
    expect(workflow).not.toContain('gcloud run services update');
    expect(workflow).not.toContain('gcloud run jobs deploy');
    expect(workflow).not.toContain('graph.facebook.com');
  });

  it('publishes only sanitized evidence and consumes the one-shot authorization', () => {
    expect(workflow).toContain('RAW_PAYLOAD_PRINTED=false');
    expect(workflow).toContain(
      ".replace(/\\bEA[A-Za-z0-9_-]{20,}\\b/gu, '<META_TOKEN>')",
    );
    expect(workflow).toContain('AUTHORIZATION_STATE=CONSUMED_AND_CLOSED');
    expect(workflow).toContain('-f state=closed -f state_reason=completed');
  });
});
