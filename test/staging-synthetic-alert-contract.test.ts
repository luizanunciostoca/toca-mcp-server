import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflowPath = '.github/workflows/staging-synthetic-alert.yml';

describe('staging synthetic alert workflow boundary', () => {
  it('uses only staging identity and never bootstraps IAM through production', () => {
    const workflow = readFileSync(workflowPath, 'utf8');
    expect(workflow).toContain(
      'projects/729069789107/locations/global/workloadIdentityPools/github-staging/providers/github-toca-mcp-staging',
    );
    expect(workflow).toContain(
      'toca-next-stg-deployer@toca-mcp-next-staging.iam.gserviceaccount.com',
    );
    expect(workflow).not.toContain(
      'projects/990081828836/locations/global/workloadIdentityPools/github/providers/github-toca-mcp',
    );
    expect(workflow).not.toContain(
      'toca-mcp-infra-admin@toca-mcp-production.iam.gserviceaccount.com',
    );
    expect(workflow).not.toContain('gcloud projects add-iam-policy-binding');
    expect(workflow).toContain('STAGING_SYNTHETIC_PREEXISTING_ROLES_AND_CHANNELS=PASS');
    expect(workflow).toContain('productionAccess:false');
    expect(workflow).toContain('iamMutation:false');
  });
});
