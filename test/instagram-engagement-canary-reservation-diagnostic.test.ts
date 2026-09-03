import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-canary-reservation-diagnostic.yml',
  'utf8',
);

describe('Instagram canary reservation retained-log diagnostic', () => {
  it('is owner-authorized, exact-main and read-only', () => {
    expect(workflow).toContain('github.event.issue.user.login == github.repository_owner');
    expect(workflow).toContain('AUTHORIZED_CANDIDATE_SHA=$GITHUB_SHA');
    expect(workflow).toContain('READ_ONLY_DIAGNOSTIC=true');
    expect(workflow).toContain('SERVICE_MUTATIONS_AUTHORIZED=false');
    expect(workflow).toContain('DATABASE_MUTATIONS_AUTHORIZED=false');
    expect(workflow).toContain('PROVIDER_WRITES_AUTHORIZED=false');
    expect(workflow).toContain('EXTERNAL_REPLY_WRITES_AUTHORIZED=false');
  });

  it('only accepts the PREPARE job lineage for the declared canary run', () => {
    expect(workflow).toContain('[[ "$SOURCE_RUN_ID" =~ ^[0-9]+$ ]]');
    expect(workflow).toContain('toca-ig-canary-pre-${SOURCE_RUN_ID}-');
    expect(workflow).not.toContain('SOURCE_EXECUTION');
  });

  it('queries retained Cloud Logging without mutating runtime, database or provider', () => {
    expect(workflow).toContain('gcloud logging read');
    expect(workflow).toContain('resource.labels.job_name');
    expect(workflow).not.toContain('gcloud run services update');
    expect(workflow).not.toContain('gcloud run jobs deploy');
    expect(workflow).not.toContain('graph.facebook.com');
  });

  it('emits only a bounded cause enum and no raw user payload', () => {
    for (const cause of [
      'NO_SAFE_RECENT_CANDIDATE',
      'ACTIVE_RESERVATION_EXISTS',
      'RESERVED_PRIORITY_CONFLICT',
      'RESERVATION_CONFLICT',
      'INFRASTRUCTURE_OR_PERMISSION_ERROR',
      'UNKNOWN',
    ]) {
      expect(workflow).toContain(cause);
    }
    expect(workflow).toContain('RAW_PAYLOAD_PRINTED=false');
    expect(workflow).toContain('RAW_USER_DATA_PRINTED=false');
    expect(workflow).not.toContain('SAFE_MARKERS=');
    expect(workflow).not.toContain('PAYLOAD_SUMMARIES=');
  });

  it('consumes the one-shot diagnostic authorization', () => {
    expect(workflow).toContain('AUTHORIZATION_STATE=CONSUMED_AND_CLOSED');
    expect(workflow).toContain('-f state=closed -f state_reason=completed');
  });
});
