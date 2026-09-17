import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/ag01-diagnostic-reader-bootstrap.yml', 'utf8');

describe('AG-01 diagnostic reader bootstrap controller', () => {
  it('requires live exact-main single-use owner authorization', () => {
    expect(workflow).toContain('github.event.issue.user.login');
    expect(workflow).toContain('github.repository_owner');
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain('AUTHORIZED_CONTROLLER_SHA=$GITHUB_SHA');
    expect(workflow).toContain('AUTHORIZATION_STATE=ACTIVE');
    expect(workflow).toContain('AG01_DIAGNOSTIC_READER_BOOTSTRAP=AUTHORIZED');
    expect(workflow).toContain('LIVE_ISSUE=');
    expect(workflow).toContain('.state == "open"');
    expect(workflow).toContain('AUTHORIZATION_STATE=CONSUMED');
    expect(workflow).toContain('REUSE_PROHIBITED=true');
  });

  it('uses infrastructure admin only to provision a dedicated diagnostic identity', () => {
    expect(workflow).toContain('toca-mcp-infra-admin@');
    expect(workflow).toContain('toca-ag01-diagnostic-reader@');
    expect(workflow).toContain('environment: infrastructure-admin');
    expect(workflow).toContain('service-accounts create toca-ag01-diagnostic-reader');
    expect(workflow).toContain('roles/run.viewer');
    expect(workflow).toContain('roles/logging.viewer');
    expect(workflow).toContain('roles/iam.workloadIdentityUser');
    expect(workflow).toContain('EXPECTED_WIF_POOL_PREFIX: principalSet://iam.googleapis.com/');
    expect(workflow).toContain('workloadIdentityPools/github/');
    expect(workflow).toContain('SOURCE_SERVICE_ACCOUNT: toca-mcp-deployer@');
    expect(workflow).toContain('source-wif-sorted.txt');
    expect(workflow).toContain('target-wif-after.txt');
    expect(workflow).toContain('--managed-by=user');
  });

  it('never grants mutation roles or service/provider/database capabilities', () => {
    expect(workflow).not.toContain('roles/run.developer');
    expect(workflow).not.toContain('roles/run.admin');
    expect(workflow).not.toContain('roles/editor');
    expect(workflow).not.toContain('roles/owner');
    expect(workflow).not.toContain('roles/logging.admin');
    expect(workflow).not.toContain('roles/iam.serviceAccountAdmin');
    expect(workflow).not.toContain('gcloud run deploy');
    expect(workflow).not.toContain('gcloud run services update');
    expect(workflow).not.toContain('update-traffic');
    expect(workflow).not.toContain('gcloud scheduler');
    expect(workflow).not.toContain('gcloud sql');
    expect(workflow).not.toContain('gcloud secrets');
    expect(workflow).not.toContain('service-accounts keys create');
    expect(workflow).toContain('USER_MANAGED_KEYS_AUTHORIZED=false');
    expect(workflow).toContain('SERVICE_MUTATION_AUTHORIZED=false');
    expect(workflow).toContain('TRAFFIC_MUTATION_AUTHORIZED=false');
    expect(workflow).toContain('DATABASE_MUTATION_AUTHORIZED=false');
    expect(workflow).toContain('PROVIDER_CALLS_AUTHORIZED=false');
    expect(workflow).toContain('GENERAL_AUTONOMY_PROMOTION_AUTHORIZED=false');
  });

  it('fails closed on privilege drift and verifies the exact final envelope', () => {
    expect(workflow).toContain('target-project-roles-before.txt');
    expect(workflow).toContain("'roles/run.viewer'");
    expect(workflow).toContain("'roles/logging.viewer'");
    expect(workflow).toContain('select(.role != "roles/iam.workloadIdentityUser")');
    expect(workflow).toContain("printf '%s\\n' roles/logging.viewer roles/run.viewer");
    expect(workflow).toContain('expected-project-roles.txt');
    expect(workflow).toContain('target-project-roles-after.txt');
    expect(workflow).toContain('USER_MANAGED_KEYS=');
    expect(workflow).toContain('LEAST_PRIVILEGE=');
  });
});
