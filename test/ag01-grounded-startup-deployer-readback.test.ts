import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/ag01-grounded-startup-deployer-readback.yml',
  'utf8',
);
const policy = JSON.parse(
  readFileSync('infra/control-plane/ag01-deployer-readback-policy.json', 'utf8'),
) as Record<string, unknown>;

describe('AG-01 grounded startup deployer readback', () => {
  it('requires exact-main owner-issued single-use authorization', () => {
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain('github.event.issue.user.login');
    expect(workflow).toContain('github.repository_owner');
    expect(workflow).toContain('AUTHORIZED_CONTROLLER_SHA=$GITHUB_SHA');
    expect(workflow).toContain('AUTHORIZATION_STATE=ACTIVE');
    expect(workflow).toContain('AG01_STARTUP_DEPLOYER_READBACK=AUTHORIZED');
    expect(workflow).toContain('DEPLOYER_READ_ONLY_FALLBACK_ACKNOWLEDGED=true');
    expect(workflow).toContain(
      'DEDICATED_READER_UNAVAILABLE_REASON=PROJECT_IAM_BOOTSTRAP_AUTHORITY_UNAVAILABLE',
    );
    expect(workflow).toContain('AUTHORIZATION_STATE=CONSUMED');
    expect(workflow).toContain('REUSE_PROHIBITED=true');
  });

  it('uses the existing deployer identity without IAM bootstrap', () => {
    expect(workflow).toContain(
      'DEPLOYER_SERVICE_ACCOUNT: toca-mcp-deployer@toca-mcp-production.iam.gserviceaccount.com',
    );
    expect(workflow).toContain('service_account: ${{ env.DEPLOYER_SERVICE_ACCOUNT }}');
    expect(workflow).not.toContain('toca-ag01-diagnostic-reader@');
    expect(workflow).toContain('DIAGNOSTIC_IDENTITY=DEPLOYER_READ_ONLY_FALLBACK');
  });

  it('claims authorization before any Cloud Run or Logging read', () => {
    const claim = workflow.indexOf('- name: Claim single-use diagnostic authorization before read');
    const evidence = workflow.indexOf('- name: Read and sanitize AG-01 startup evidence');
    const revisionRead = workflow.indexOf('gcloud run revisions describe "$TARGET_REVISION"');
    const logRead = workflow.indexOf('gcloud logging read');
    expect(claim).toBeGreaterThan(-1);
    expect(evidence).toBeGreaterThan(claim);
    expect(revisionRead).toBeGreaterThan(evidence);
    expect(logRead).toBeGreaterThan(evidence);
    expect(workflow).toContain("if: steps.claim.outputs.claimed == 'true'");
    expect(workflow).toContain(
      "sed 's/^AUTHORIZATION_STATE=ACTIVE$/AUTHORIZATION_STATE=CONSUMED/'",
    );
    expect(workflow).toContain('-f body="$UPDATED" -f state=closed');
  });

  it('allows only revision/log reads and sanitized issue evidence', () => {
    expect(workflow.match(/gcloud run revisions describe/g)).toHaveLength(2);
    expect(workflow.match(/gcloud logging read/g)).toHaveLength(1);
    expect(workflow).toContain('RAW_LOG_PAYLOAD_PUBLISHED=false');
    expect(workflow).toContain('TRAFFIC_MUTATION=false');
    expect(workflow).toContain('SERVICE_MUTATION=false');
    expect(workflow).toContain('IAM_MUTATION=false');
    expect(workflow).toContain('DATABASE_MUTATION=false');
    expect(workflow).toContain('PROVIDER_CALLS=false');
    expect(workflow).not.toContain('gcloud projects add-iam-policy-binding');
    expect(workflow).not.toContain('gcloud projects set-iam-policy');
    expect(workflow).not.toContain('service-accounts create');
    expect(workflow).not.toContain('service-accounts add-iam-policy-binding');
    expect(workflow).not.toContain('service-accounts keys create');
    expect(workflow).not.toContain('gcloud run deploy');
    expect(workflow).not.toContain('gcloud run services update');
    expect(workflow).not.toContain('gcloud run services add-iam-policy-binding');
    expect(workflow).not.toContain('update-traffic');
    expect(workflow).not.toContain('gcloud sql');
    expect(workflow).not.toContain('gcloud scheduler');
    expect(workflow).not.toContain('curl');
  });

  it('retains the approved startup classifier and env-presence-only evidence', () => {
    for (const token of [
      'AG01_PERSISTENCE_NOT_READY',
      'AG01_PRODUCTION_MODEL_PROVIDER_REQUIRED',
      'AG01_PRODUCTION_VERTEX_PROVIDER_REQUIRED',
      'AG01_PRODUCTION_GOOGLE_AUTH_MODE_REQUIRED',
      'AG01_PRODUCTION_GCP_METADATA_REQUIRED',
      'AG01_VERTEX_PROJECT_ID_REQUIRED',
      'PERSISTENCE_SCHEMA_OR_MIGRATION_FAILURE',
      'STARTUP_DEPENDENCY_CONNECTIVITY_FAILURE',
      'STARTUP_PERMISSION_FAILURE',
      'STARTUP_MODULE_LOAD_FAILURE',
      'CLOUD_RUN_STARTUP_PROBE_FAILURE',
      'UNCLASSIFIED_STARTUP_FAILURE',
    ]) {
      expect(workflow).toContain(token);
    }
    for (const envName of [
      'DATABASE_URL',
      'AG01_MODEL_PROVIDER',
      'AG01_GOOGLE_AUTH_MODE',
      'AG01_VERTEX_PROJECT_ID',
      'AG01_VERTEX_MODEL',
      'GOOGLE_CLOUD_PROJECT',
    ]) {
      expect(workflow).toContain(envName);
    }
    expect(workflow).toContain('select(type == "string")');
  });

  it('pins the machine-readable policy to a read-only fallback envelope', () => {
    expect(policy).toMatchObject({
      schemaVersion: 1,
      diagnosticId: 'AG01_STARTUP_DEPLOYER_READBACK_20260917',
      projectId: 'toca-mcp-production',
      projectNumber: '990081828836',
      region: 'southamerica-east1',
      service: 'toca-ag01-orchestrator',
      diagnosticIdentity: 'toca-mcp-deployer@toca-mcp-production.iam.gserviceaccount.com',
      dedicatedReaderUnavailableReason: 'PROJECT_IAM_BOOTSTRAP_AUTHORITY_UNAVAILABLE',
      singleUseAuthorizationRequired: true,
      claimAuthorizationBeforeReadRequired: true,
      exactMainShaRequired: true,
      rawLogPayloadPublicationAllowed: false,
      allowedReads: ['run.revisions.describe', 'logging.entries.read'],
    });
  });
});
