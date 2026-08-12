import { existsSync, readFileSync } from 'node:fs';

const required = [
  '.github/workflows/infrastructure-control-plane.yml',
  '.github/workflows/provision-instagram-publication-assets-gcs.yml',
  'infra/control-plane/policy.json',
  'infra/control-plane/storage-bucket-admin-role.yaml',
  'docs/operations/infrastructure-control-plane.md',
];

for (const path of required) {
  if (!existsSync(path)) {
    console.error(`Infrastructure control-plane file is required: ${path}`);
    process.exit(1);
  }
}

const workflowPath = '.github/workflows/infrastructure-control-plane.yml';
const legacyProvisionPath = '.github/workflows/provision-instagram-publication-assets-gcs.yml';
const policyPath = 'infra/control-plane/policy.json';
const rolePath = 'infra/control-plane/storage-bucket-admin-role.yaml';
const infraAdmin = 'toca-mcp-infra-admin@toca-mcp-production.iam.gserviceaccount.com';
const runtime = 'toca-mcp-runtime@toca-mcp-production.iam.gserviceaccount.com';

const workflow = readFileSync(workflowPath, 'utf8');
const legacyProvision = readFileSync(legacyProvisionPath, 'utf8');
const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
const role = readFileSync(rolePath, 'utf8');

const workflowRequirements = [
  'workflow_dispatch:',
  'environment: infrastructure-admin',
  'id-token: write',
  'ref: main',
  'expected_policy_sha256',
  'sha256sum infra/control-plane/policy.json',
  infraAdmin,
  'reconcile-publication-assets-bucket',
  '.publicRead == false',
  '.deliveryMode == "signed-url"',
  'allUsers',
  'allAuthenticatedUsers',
];

for (const marker of workflowRequirements) {
  if (!workflow.includes(marker)) {
    console.error(`Infrastructure workflow missing boundary marker: ${marker}`);
    process.exit(1);
  }
}

const forbiddenWorkflowMarkers = [
  'service_account_key',
  'credentials_json',
  'roles/owner',
  'roles/editor',
  'storage.buckets.delete',
  '--member="allUsers"',
  '--member="allAuthenticatedUsers"',
];

for (const forbidden of forbiddenWorkflowMarkers) {
  if (workflow.includes(forbidden)) {
    console.error(`Infrastructure workflow contains forbidden capability: ${forbidden}`);
    process.exit(1);
  }
}

for (const forbidden of ['--member="allUsers"', '--member="allAuthenticatedUsers"']) {
  if (legacyProvision.includes(forbidden)) {
    console.error(`Legacy publication provisioning contains forbidden public IAM: ${forbidden}`);
    process.exit(1);
  }
}

if (workflow.includes('push:') || workflow.includes('pull_request:')) {
  console.error('Infrastructure control plane cannot run automatically');
  process.exit(1);
}

if (
  policy.projectId !== 'toca-mcp-production' ||
  policy.adminServiceAccount !== infraAdmin ||
  policy.runtimeServiceAccount !== runtime
) {
  console.error('Infrastructure identity boundary changed unexpectedly');
  process.exit(1);
}

const operation = 'reconcile-publication-assets-bucket';
const publicationBucket = policy.allowedOperations?.[operation];

if (
  publicationBucket?.resourceName !== 'toca-mcp-publication-assets' ||
  publicationBucket?.lifecycleDeleteAgeDays !== 7 ||
  publicationBucket?.runtimeRole !== 'roles/storage.objectCreator' ||
  publicationBucket?.publicRead !== false ||
  publicationBucket?.deliveryMode !== 'signed-url' ||
  publicationBucket?.uniformBucketLevelAccess !== true
) {
  console.error('Publication asset bucket is outside the approved envelope');
  process.exit(1);
}

const forbiddenPolicyFlags = [
  'projectOwner',
  'projectEditor',
  'serviceAccountKeys',
  'bucketDelete',
  'arbitraryGcloud',
  'runtimePrivilegeEscalation',
  'publicBucketIam',
];

for (const key of forbiddenPolicyFlags) {
  if (policy.forbidden?.[key] !== true) {
    console.error(`Infrastructure policy must explicitly forbid: ${key}`);
    process.exit(1);
  }
}

const requiredPermissions = [
  'storage.buckets.create',
  'storage.buckets.get',
  'storage.buckets.getIamPolicy',
  'storage.buckets.setIamPolicy',
  'storage.buckets.update',
];

for (const permission of requiredPermissions) {
  if (!role.includes(`- ${permission}`)) {
    console.error(`Infrastructure role missing permission: ${permission}`);
    process.exit(1);
  }
}

const forbiddenPermissions = [
  'storage.buckets.delete',
  'iam.serviceAccounts.create',
  'iam.serviceAccountKeys.create',
  'resourcemanager.projects.setIamPolicy',
];

for (const permission of forbiddenPermissions) {
  if (role.includes(permission)) {
    console.error(`Infrastructure role contains forbidden permission: ${permission}`);
    process.exit(1);
  }
}

console.log('Infrastructure control-plane check passed.');
