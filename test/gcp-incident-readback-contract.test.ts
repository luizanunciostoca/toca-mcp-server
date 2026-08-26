import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/gcp-incident-readback.yml', 'utf8');

describe('GCP incident historical readback contract', () => {
  it('is bounded to the exact failed production deploy window', () => {
    expect(workflow).toContain("INCIDENT_DEPLOY_RUN_ID: '32921717336'");
    expect(workflow).toContain("INCIDENT_WINDOW_START: '2026-08-26T02:16:30Z'");
    expect(workflow).toContain("INCIDENT_WINDOW_END: '2026-08-26T02:18:30Z'");
    expect(workflow).toContain('INCIDENT_CANDIDATE_SHA');
    expect(workflow).toContain('AUTHORIZED_PROBE_CANDIDATE_SHA=');
    expect(workflow).toContain('NO_TRAFFIC_MUTATION=true');
    expect(workflow).toContain('NO_PROVIDER_CALLS=true');
    expect(workflow).toContain('NO_DATABASE_MUTATION=true');
  });

  it('uses only read operations against GCP production', () => {
    expect(workflow).toContain('gcloud run services describe');
    expect(workflow).toContain('gcloud run revisions list');
    expect(workflow).toContain('gcloud run revisions describe');
    expect(workflow).toContain('gcloud logging read');

    expect(workflow).not.toContain('gcloud run deploy');
    expect(workflow).not.toContain('gcloud run services update');
    expect(workflow).not.toContain('gcloud run services update-traffic');
    expect(workflow).not.toContain('gcloud run services add-iam-policy-binding');
    expect(workflow).not.toContain('gcloud run services remove-iam-policy-binding');
    expect(workflow).not.toContain('gcloud scheduler jobs create');
    expect(workflow).not.toContain('gcloud scheduler jobs update');
    expect(workflow).not.toContain('gcloud scheduler jobs delete');
    expect(workflow).not.toContain('gcloud scheduler jobs run');
    expect(workflow).not.toContain('gcloud sql');
    expect(workflow).not.toContain('docker build');
    expect(workflow).not.toContain('docker push');
    expect(workflow).not.toContain('--allow-unauthenticated');
    expect(workflow).not.toContain('--ingress all');
  });

  it('finds the historical revision by immutable release SHA rather than requiring its tag', () => {
    expect(workflow).toContain('TOCA_RELEASE_SHA');
    expect(workflow).toContain('release_sha');
    expect(workflow).toContain('if [[ "$release_sha" == "$INCIDENT_CANDIDATE_SHA" ]]');
    expect(workflow).toContain('CURRENT_TAG_PRESENT');
    expect(workflow).not.toContain('Exact candidate tagged URL not found');
  });

  it('correlates original Scheduler results with candidate and service request logs', () => {
    expect(workflow).toContain('toca-mcp-health-${INCIDENT_DEPLOY_RUN_ID}-${INCIDENT_RUN_ATTEMPT}');
    expect(workflow).toContain('toca-mcp-ready-${INCIDENT_DEPLOY_RUN_ID}-${INCIDENT_RUN_ATTEMPT}');
    expect(workflow).toContain('resource.type=\\"cloud_scheduler_job\\"');
    expect(workflow).toContain('resource.labels.revision_name=\\"${CANDIDATE_REVISION}\\"');
    expect(workflow).toContain('httpRequest.status=404');
    expect(workflow).toContain('ORIGINAL_404_REJECTED_BEFORE_CLOUD_RUN_REVISION');
    expect(workflow).toContain('ORIGINAL_404_REACHED_CANDIDATE_REVISION');
    expect(workflow).toContain('ORIGINAL_404_NOT_OBSERVED_AT_CANDIDATE_REVISION');
  });

  it('records an explicit non-mutation evidence contract', () => {
    expect(workflow).toContain('readOnly:true');
    expect(workflow).toContain('deployExecuted:false');
    expect(workflow).toContain('trafficMutationExecuted:false');
    expect(workflow).toContain('iamMutationExecuted:false');
    expect(workflow).toContain('schedulerMutationExecuted:false');
    expect(workflow).toContain('providerCallExecuted:false');
  });
});
