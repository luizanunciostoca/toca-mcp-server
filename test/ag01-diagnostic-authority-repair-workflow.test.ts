import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/ag01-diagnostic-authority-repair.yml', 'utf8');
const policy = JSON.parse(
  readFileSync('infra/control-plane/ag01-diagnostic-authority-repair-policy.json', 'utf8'),
) as Record<string, unknown>;

describe('AG-01 diagnostic authority repair', () => {
  it('requires exact-main single-use owner authorization', () => {
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain('github.event.issue.user.login');
    expect(workflow).toContain('github.repository_owner');
    expect(workflow).toContain('AUTHORIZED_CONTROLLER_SHA=$GITHUB_SHA');
    expect(workflow).toContain('AUTHORIZATION_STATE=ACTIVE');
    expect(workflow).toContain('AG01_DIAGNOSTIC_AUTHORITY_REPAIR=AUTHORIZED');
    expect(workflow).toContain('LIVE_ISSUE=');
    expect(workflow).toContain('.state == "open"');
    expect(workflow).toContain('AUTHORIZATION_STATE=CONSUMED');
    expect(workflow).toContain('REUSE_PROHIBITED=true');
  });

  it('allows only the read-only service account viewer grant', () => {
    expect(workflow).toContain('TARGET_ROLE: roles/iam.serviceAccountViewer');
    expect(workflow).toContain('test "$TARGET_ROLE"');
    expect(workflow).toContain("= 'roles/iam.serviceAccountViewer'");
    expect(workflow).toContain('gcloud projects add-iam-policy-binding "$PROJECT_ID"');
    expect(workflow.match(/gcloud projects add-iam-policy-binding/g)).toHaveLength(1);
    expect(workflow).toContain('--role="$TARGET_ROLE"');
    expect(workflow).toContain('--condition=None');
    expect(workflow).toContain('roles-expected-after.txt');
    expect(workflow).toContain('diff -u /tmp/roles-expected-after.txt /tmp/roles-after.txt');
    expect(workflow).toContain('SOURCE_SERVICE_ACCOUNT_POLICY_READ=$POLICY_READ');
  });

  it('forbids broader IAM and runtime mutation commands', () => {
    expect(workflow).not.toContain('--role=roles/iam.serviceAccountAdmin');
    expect(workflow).not.toContain('--role=roles/owner');
    expect(workflow).not.toContain('--role=roles/editor');
    expect(workflow).not.toContain('service-accounts add-iam-policy-binding');
    expect(workflow).not.toContain('service-accounts create');
    expect(workflow).not.toContain('service-accounts keys create');
    expect(workflow).not.toContain('gcloud run deploy');
    expect(workflow).not.toContain('gcloud run services update');
    expect(workflow).not.toContain('update-traffic');
    expect(workflow).not.toContain('gcloud scheduler');
    expect(workflow).not.toContain('gcloud sql');
    expect(workflow).not.toContain('gcloud secrets');
    expect(workflow).toContain('SERVICE_ACCOUNT_MUTATION_AUTHORIZED=false');
    expect(workflow).toContain('SERVICE_ACCOUNT_CREATE_AUTHORIZED=false');
    expect(workflow).toContain('SERVICE_ACCOUNT_KEYS_AUTHORIZED=false');
    expect(workflow).toContain('GENERAL_AUTONOMY_PROMOTION_AUTHORIZED=false');
  });

  it('orders prestate before mutation and permission proof', () => {
    const prestate = workflow.indexOf('- name: Capture project IAM prestate');
    const mutation = workflow.indexOf('- name: Grant only service-account policy read role');
    const verify = workflow.indexOf('- name: Verify exact IAM delta and permission proof');
    const proof = workflow.indexOf(
      'gcloud iam service-accounts get-iam-policy "$SOURCE_SERVICE_ACCOUNT"',
    );
    expect(prestate).toBeGreaterThan(-1);
    expect(mutation).toBeGreaterThan(prestate);
    expect(verify).toBeGreaterThan(mutation);
    expect(proof).toBeGreaterThan(verify);
    expect(workflow).toContain('RAW_IAM_POLICY_PUBLISHED=false');
  });

  it('pins the repair policy to the same narrow envelope', () => {
    expect(policy).toMatchObject({
      schemaVersion: 1,
      repairId: 'AG01_DIAGNOSTIC_AUTHORITY_REPAIR_20260917',
      projectId: 'toca-mcp-production',
      projectNumber: '990081828836',
      allowedProjectRole: 'roles/iam.serviceAccountViewer',
      requiredPermissionProof: 'iam.serviceAccounts.getIamPolicy',
      rawIamPolicyPublicationAllowed: false,
    });
  });
});
