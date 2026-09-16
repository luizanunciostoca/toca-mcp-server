import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type RecoveryPolicy = {
  status: string;
  authorization: {
    mode: string;
    phrase: string;
  };
  requiredApis: string[];
  runtimeSecrets: string[];
  bindings: {
    runtimeSecretRole: string;
    deployerRuntimeRole: string;
    deployerProjectRoles: string[];
    deployerArtifactRepositoryRole: string;
    runtimeProjectRoles: string[];
    runtimeBucketRoles: string[];
  };
  forbidden: {
    projectOwner: boolean;
    projectEditor: boolean;
    projectSecretAccessor: boolean;
    serviceAccountKeys: boolean;
    billingMutation: boolean;
    providerWriteDuringRecovery: boolean;
  };
  preflight: {
    providerReadOnly: boolean;
    metaGraphApiVersion: string;
    requiredMetaScopes: string[];
    instagramAccountId: string;
    pageId: string;
    username: string;
    driveFileId: string;
    expectedAssetSha256: string;
  };
};

const workflow = readFileSync(
  '.github/workflows/instagram-gcp-publication-recovery-preflight.yml',
  'utf8',
);
const policy = JSON.parse(
  readFileSync('infra/control-plane/instagram-gcp-publication-recovery-policy.json', 'utf8'),
) as RecoveryPolicy;

const requiredApis = [
  'artifactregistry.googleapis.com',
  'run.googleapis.com',
  'secretmanager.googleapis.com',
  'iamcredentials.googleapis.com',
  'sqladmin.googleapis.com',
  'logging.googleapis.com',
];

const requiredMetaScopes = [
  'instagram_basic',
  'instagram_content_publish',
  'pages_show_list',
  'pages_read_engagement',
];

describe('Instagram GCP publication recovery preflight', () => {
  it('requires explicit workflow dispatch authorization bound to exact main SHA', () => {
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('authorization:');
    expect(workflow).toContain('expected_source_sha:');
    expect(workflow).toContain('test "$GITHUB_EVENT_NAME" = \'workflow_dispatch\'');
    expect(workflow).toContain('test "$EXPECTED_SOURCE_SHA" = "$GITHUB_SHA"');
    expect(workflow).toContain(
      'test "$RECOVERY_AUTHORIZATION" = \'AUTHORIZE_GCP_INSTAGRAM_RECOVERY_PREFLIGHT\'',
    );
    expect(workflow).not.toMatch(/on:\s*\n\s*push:/);
    expect(policy.authorization).toEqual({
      mode: 'WORKFLOW_DISPATCH_EXACT_SHA',
      phrase: 'AUTHORIZE_GCP_INSTAGRAM_RECOVERY_PREFLIGHT',
    });
  });

  it('locks recovery APIs and IAM to the approved least-authority contract', () => {
    expect(policy.status).toBe('AUTHORIZED_RECOVERY');
    expect(policy.requiredApis).toEqual(requiredApis);
    expect(policy.runtimeSecrets).toEqual([
      'toca-meta-oauth-token',
      'toca-meta-app-secret',
      'toca-database-url',
    ]);
    expect(policy.bindings.runtimeSecretRole).toBe('roles/secretmanager.secretAccessor');
    expect(policy.bindings.deployerRuntimeRole).toBe('roles/iam.serviceAccountUser');
    expect(policy.bindings.deployerProjectRoles).toEqual([
      'roles/run.developer',
      'roles/logging.viewer',
    ]);
    expect(policy.bindings.deployerArtifactRepositoryRole).toBe('roles/artifactregistry.writer');
    expect(policy.bindings.runtimeProjectRoles).toEqual(['roles/cloudsql.client']);
    expect(policy.bindings.runtimeBucketRoles).toEqual([
      'roles/storage.objectCreator',
      'roles/storage.objectViewer',
    ]);
    expect(policy.forbidden.projectOwner).toBe(true);
    expect(policy.forbidden.projectEditor).toBe(true);
    expect(policy.forbidden.projectSecretAccessor).toBe(true);
    expect(policy.forbidden.serviceAccountKeys).toBe(true);
    expect(policy.forbidden.billingMutation).toBe(true);
    expect(workflow).not.toContain('gcloud services enable');
    expect(workflow).not.toContain('gcloud services list --enabled');
    expect(workflow).not.toContain('add-iam-policy-binding');
    expect(workflow).not.toContain('get-iam-policy');
    expect(workflow).toContain('requiredApisExternalBootstrap:true');
    expect(workflow).toContain('iamBindingsExternalBootstrap:true');
    expect(workflow).toContain('iamMutationAttempted:false');
    expect(workflow).toContain('iamPolicyInspectionAttempted:false');
    expect(workflow).toContain('GCP_PUBLICATION_EXTERNAL_BOOTSTRAP_BOUNDARY=VERIFIED');
    expect(workflow).toContain('bootstrap-contract:');
    expect(workflow).toContain('needs: bootstrap-contract');
  });

  it('binds provider reads to one exact Meta target and scope set', () => {
    expect(policy.preflight.metaGraphApiVersion).toBe('v24.0');
    expect(policy.preflight.pageId).toBe('306103746115875');
    expect(policy.preflight.instagramAccountId).toBe('17841402033495654');
    expect(policy.preflight.username).toBe('tocadomorcego');
    expect(policy.preflight.requiredMetaScopes).toEqual(requiredMetaScopes);
    expect(workflow).toContain('META_USERNAME: tocadomorcego');
    expect(workflow).toContain('.preflight.metaGraphApiVersion == $apiVersion');
    expect(workflow).toContain('.preflight.pageId == $page');
    expect(workflow).toContain('.preflight.instagramAccountId == $ig');
    expect(workflow).toContain('.preflight.username == $username');
  });

  it('mounts Meta credentials only inside the Cloud Run runtime', () => {
    expect(workflow).toContain('META_ACCESS_TOKEN=$TOKEN_SECRET_ID:latest');
    expect(workflow).toContain('META_APP_SECRET=$APP_SECRET_ID:1');
    expect(workflow).toContain('metaRuntimeSecretsPresent: true');
    expect(workflow).not.toContain('const databaseUrl = process.env.DATABASE_URL');
    expect(workflow).not.toContain('DATABASE_URL=$DATABASE_SECRET_ID:latest');
    expect(workflow).toContain('--service-account "$GCP_RUNTIME_SERVICE_ACCOUNT"');
    expect(workflow).not.toContain('${{ secrets.META_ACCESS_TOKEN }}');
  });

  it('keeps provider verification GET-only and fail-closed on recent media', () => {
    expect(policy.preflight.providerReadOnly).toBe(true);
    expect(policy.forbidden.providerWriteDuringRecovery).toBe(true);
    expect(workflow).toContain("method: 'GET'");
    expect(workflow).not.toContain("method: 'POST'");
    expect(workflow).not.toContain('/media_publish');
    expect(workflow).toContain('GCP_PUBLICATION_PREFLIGHT_MEDIA_EMPTY_OR_INVALID');
    expect(workflow).toContain('GCP_PUBLICATION_PREFLIGHT_MEDIA_ID_INVALID');
    expect(workflow).toContain('GCP_PUBLICATION_PREFLIGHT_MEDIA_TIMESTAMP_INVALID');
  });

  it('deploys the preflight image by immutable digest and records it as evidence', () => {
    expect(workflow).toContain('IMAGE_DIGEST=');
    expect(workflow).toContain('IMMUTABLE_IMAGE=');
    expect(workflow).toContain('--image "$IMMUTABLE_IMAGE"');
    expect(workflow).toContain('. + {imageDigest:$imageDigest}');
    expect(workflow).toContain('startswith("sha256:")');
  });

  it('binds the same approved Drive JPEG by exact SHA', () => {
    expect(policy.preflight.driveFileId).toBe('1uFK4y1fqUHi-m4qn6m-TB-ehBC0Y7JOK');
    expect(policy.preflight.expectedAssetSha256).toBe(
      'a495fa29db54dc2af24700b0556e8a6d1fb01472c333067c91ee6d613525e4e6',
    );
    expect(workflow).toContain('test "$actual" = "$EXPECTED_ASSET_SHA256"');
  });
});
