import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-gcp-publication-recovery-preflight.yml',
  'utf8',
);
const policy = JSON.parse(
  readFileSync('infra/control-plane/instagram-gcp-publication-recovery-policy.json', 'utf8'),
) as Record<string, any>;

describe('Instagram GCP publication recovery preflight', () => {
  it('runs only from protected main changes to the recovery contract', () => {
    expect(workflow).toContain('branches:\n      - main');
    expect(workflow).toContain('test "$GITHUB_REF" = \'refs/heads/main\'');
    expect(workflow).toContain('environment: infrastructure-admin');
    expect(workflow).toContain('environment: production');
  });

  it('repairs only scoped IAM required by the existing GCP executor', () => {
    expect(policy.status).toBe('AUTHORIZED_RECOVERY');
    expect(policy.bindings.runtimeSecretRole).toBe('roles/secretmanager.secretAccessor');
    expect(policy.bindings.deployerRuntimeRole).toBe('roles/iam.serviceAccountUser');
    expect(policy.bindings.deployerArtifactRepositoryRole).toBe('roles/artifactregistry.writer');
    expect(policy.forbidden.projectOwner).toBe(true);
    expect(policy.forbidden.projectEditor).toBe(true);
    expect(policy.forbidden.serviceAccountKeys).toBe(true);
    expect(policy.forbidden.billingMutation).toBe(true);
    expect(workflow).not.toContain('roles/owner');
    expect(workflow).not.toContain('roles/editor');
  });

  it('mounts the existing Meta token only inside the Cloud Run runtime', () => {
    expect(workflow).toContain('META_ACCESS_TOKEN=$TOKEN_SECRET_ID:latest');
    expect(workflow).toContain('META_APP_SECRET=$APP_SECRET_ID:1');
    expect(workflow).toContain('DATABASE_URL=$DATABASE_SECRET_ID:latest');
    expect(workflow).toContain('--service-account "$GCP_RUNTIME_SERVICE_ACCOUNT"');
    expect(workflow).not.toContain('${{ secrets.META_ACCESS_TOKEN }}');
  });

  it('proves provider access with GET-only code and cannot publish media', () => {
    expect(policy.preflight.providerReadOnly).toBe(true);
    expect(policy.forbidden.providerWriteDuringRecovery).toBe(true);
    expect(workflow).toContain("method: 'GET'");
    expect(workflow).not.toContain("method: 'POST'");
    expect(workflow).not.toContain('/media_publish');
  });

  it('binds the same approved Drive JPEG by exact SHA', () => {
    expect(policy.preflight.driveFileId).toBe('1uFK4y1fqUHi-m4qn6m-TB-ehBC0Y7JOK');
    expect(policy.preflight.expectedAssetSha256).toBe(
      'a495fa29db54dc2af24700b0556e8a6d1fb01472c333067c91ee6d613525e4e6',
    );
    expect(workflow).toContain('test "$actual" = "$EXPECTED_ASSET_SHA256"');
  });
});
