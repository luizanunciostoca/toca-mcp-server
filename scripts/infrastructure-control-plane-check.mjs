import { existsSync, readFileSync } from 'node:fs';

const required = [
  '.github/workflows/infrastructure-control-plane.yml',
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

const workflow = readFileSync('.github/workflows/infrastructure-control-plane.yml', 'utf8');
const policy = JSON.parse(readFileSync('infra/control-plane/policy.json', 'utf8'));
const role = readFileSync('infra/control-plane/storage-bucket-admin-role.yaml', 'utf8');

const workflowRequirements = [
  'workflow_dispatch:',
  'environment: infrastructure-admin',
  'id-token: write',
  'ref: main',
  'expected_policy_sha256',
  'sha256sum infra/control-plane/policy.json',
  'toca-mcp-infra-admin@toca-mcp-production.iam.gserviceaccount.com',
  'reconcile-publication-assets-bucket',
];

for (const marker of workflowRequirements) {
  if (!workflow.includes(marker)) {
    console.error(`Infrastructure control-plane workflow missing boundary marker: ${marker}`);
    process.exit(1);
  }
}

for (const forbidden of [
  'service_account_key',
  'credentials_json',
  'roles/owner',
  'roles/editor',
  'storage.buckets.delete',
]) {
  if (workflow.includes(forbidden)) {
    console.error(`Infrastructure control-plane workflow contains forbidden capability: ${forbidden}`);
    process.exit(1);
  }
}

if (workflow.includes('push:') || workflow.includes('pull_request:')) {
  console.error('Infrastructure control plane must never execute automatically from push or pull_request');
  process.exit(1);
}

if (
  policy.projectId !== 'toca-mcp-production' ||
  policy.adminServiceAccount !==
    'toca-mcp-infra-admin@toca-mcp-production.iam.gserviceaccount.com' ||
  policy.runtimeServiceAccount !== 'toca-mcp-runtime@toca-mcp-production.iam.gserviceaccount.com'
) {
  console.error('Infrastructure control-plane identity boundary changed unexpectedly');
  process.exit(1);
}

const publicationBucket = policy.allowedOperations?.['reconcile-publication-assets-bucket'];
if (
  publicationBucket?.resourceName !== 'toca-mcp-publication-assets' ||
  publicationBucket?.lifecycleDeleteAgeDays !== 7 ||
  publicationBucket?.runtimeRole !== 'roles/storage.objectCreator' ||
  publicationBucket?.publicRead !== true ||
  publicationBucket?.uniformBucketLevelAccess !== true
) {
  console.error('Publication asset bucket policy is outside the approved envelope');
  process.exit(1);
}

for (const key of [
  'projectOwner',
  'projectEditor',
  'serviceAccountKeys',
  'bucketDelete',
  'arbitraryGcloud',
  'runtimePrivilegeEscalation',
]) {
  if (policy.forbidden?.[key] !== true) {
    console.error(`Infrastructure policy must explicitly forbid: ${key}`);
    process.exit(1);
  }
}

for (const permission of [
  'storage.buckets.create',
  'storage.buckets.get',
  'storage.buckets.getIamPolicy',
  'storage.buckets.setIamPolicy',
  'storage.buckets.update',
]) {
  if (!role.includes(`- ${permission}`)) {
    console.error(`Infrastructure custom role missing approved permission: ${permission}`);
    process.exit(1);
  }
}

for (const forbiddenPermission of [
  'storage.buckets.delete',
  'iam.serviceAccounts.create',
  'iam.serviceAccountKeys.create',
  'resourcemanager.projects.setIamPolicy',
]) {
  if (role.includes(forbiddenPermission)) {
    console.error(`Infrastructure custom role contains forbidden permission: ${forbiddenPermission}`);
    process.exit(1);
  }
}

console.log('Infrastructure control-plane check passed.');
