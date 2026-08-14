import { existsSync, readFileSync } from 'node:fs';

const required = [
  '.github/workflows/infrastructure-control-plane.yml',
  '.github/workflows/deploy-toca-managed-instagram-daemon-gcp.yml',
  '.github/workflows/provision-instagram-publication-assets-gcs.yml',
  'infra/control-plane/policy.json',
  'infra/control-plane/storage-bucket-admin-role.yaml',
  'infra/control-plane/cloudsql-cost-optimizer-role.yaml',
  'docs/operations/infrastructure-control-plane.md',
];

for (const path of required) {
  if (!existsSync(path)) {
    console.error(`Infrastructure control-plane file is required: ${path}`);
    process.exit(1);
  }
}

const workflowPath = '.github/workflows/infrastructure-control-plane.yml';
const daemonWorkflowPath = '.github/workflows/deploy-toca-managed-instagram-daemon-gcp.yml';
const legacyProvisionPath = '.github/workflows/provision-instagram-publication-assets-gcs.yml';
const policyPath = 'infra/control-plane/policy.json';
const storageRolePath = 'infra/control-plane/storage-bucket-admin-role.yaml';
const cloudSqlRolePath = 'infra/control-plane/cloudsql-cost-optimizer-role.yaml';
const infraAdmin = 'toca-mcp-infra-admin@toca-mcp-production.iam.gserviceaccount.com';
const runtime = 'toca-mcp-runtime@toca-mcp-production.iam.gserviceaccount.com';

const workflow = readFileSync(workflowPath, 'utf8');
const daemonWorkflow = readFileSync(daemonWorkflowPath, 'utf8');
const legacyProvision = readFileSync(legacyProvisionPath, 'utf8');
const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
const storageRole = readFileSync(storageRolePath, 'utf8');
const cloudSqlRole = readFileSync(cloudSqlRolePath, 'utf8');

const workflowRequirements = [
  'workflow_dispatch:',
  'environment: infrastructure-admin',
  'id-token: write',
  'ref: main',
  'expected_policy_sha256',
  'sha256sum infra/control-plane/policy.json',
  infraAdmin,
  'reconcile-publication-assets-bucket',
  'optimize-cloud-sql-cost',
  '.publicRead == false',
  '.deliveryMode == "signed-url"',
  'roles/storage.objectCreator',
  'roles/storage.objectViewer',
  '--availability-type=zonal',
  '--edition=enterprise',
  '--tier=db-g1-small',
  '--retained-backups-count=7',
  '--retained-transaction-log-days=7',
  'CLOUD_SQL_COST_OPTIMIZATION=VERIFIED',
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
  'reconcile-toca-managed-instagram-heartbeat',
  'gcloud scheduler jobs',
  'gcloud run jobs deploy',
  'gcloud sql instances delete',
  'gcloud sql databases delete',
  'gcloud sql backups delete',
  'gcloud sql users',
  'gcloud sql ssl',
  'gcloud billing',
  'gcloud projects add-iam-policy-binding',
  'gcloud projects remove-iam-policy-binding',
];

for (const forbidden of forbiddenWorkflowMarkers) {
  if (workflow.includes(forbidden)) {
    console.error(`Infrastructure workflow contains forbidden/superseded capability: ${forbidden}`);
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

const publicationBucket = policy.allowedOperations?.['reconcile-publication-assets-bucket'];
const runtimeRoles = publicationBucket?.runtimeRoles;

if (
  publicationBucket?.resourceName !== 'toca-mcp-publication-assets' ||
  publicationBucket?.lifecycleDeleteAgeDays !== 7 ||
  !Array.isArray(runtimeRoles) ||
  runtimeRoles.length !== 2 ||
  !runtimeRoles.includes('roles/storage.objectCreator') ||
  !runtimeRoles.includes('roles/storage.objectViewer') ||
  publicationBucket?.publicRead !== false ||
  publicationBucket?.deliveryMode !== 'signed-url' ||
  publicationBucket?.uniformBucketLevelAccess !== true
) {
  console.error('Publication asset bucket is outside the approved envelope');
  process.exit(1);
}

const cloudSqlOptimization = policy.allowedOperations?.['optimize-cloud-sql-cost'];
if (
  cloudSqlOptimization?.resourceType !== 'cloud-sql-instance' ||
  cloudSqlOptimization?.resourceName !== 'toca-mcp-db' ||
  cloudSqlOptimization?.databaseVersion !== 'POSTGRES_18' ||
  cloudSqlOptimization?.requireRecentSuccessfulBackupHours !== 36 ||
  cloudSqlOptimization?.source?.edition !== 'ENTERPRISE_PLUS' ||
  cloudSqlOptimization?.source?.availabilityType !== 'REGIONAL' ||
  cloudSqlOptimization?.source?.tier !== 'db-perf-optimized-N-8' ||
  cloudSqlOptimization?.source?.dataDiskType !== 'PD_SSD' ||
  cloudSqlOptimization?.source?.dataDiskSizeGb !== 250 ||
  cloudSqlOptimization?.target?.edition !== 'ENTERPRISE' ||
  cloudSqlOptimization?.target?.availabilityType !== 'ZONAL' ||
  cloudSqlOptimization?.target?.tier !== 'db-g1-small' ||
  cloudSqlOptimization?.target?.retainedBackups !== 7 ||
  cloudSqlOptimization?.target?.transactionLogRetentionDays !== 7 ||
  cloudSqlOptimization?.preserve?.databaseVersion !== true ||
  cloudSqlOptimization?.preserve?.dataDiskType !== true ||
  cloudSqlOptimization?.preserve?.dataDiskSizeGb !== true ||
  cloudSqlOptimization?.preserve?.deletionProtection !== true ||
  cloudSqlOptimization?.preserve?.automatedBackups !== true ||
  cloudSqlOptimization?.preserve?.pointInTimeRecovery !== true ||
  cloudSqlOptimization?.forbid?.instanceDelete !== true ||
  cloudSqlOptimization?.forbid?.databaseDelete !== true ||
  cloudSqlOptimization?.forbid?.backupDelete !== true ||
  cloudSqlOptimization?.forbid?.userMutation !== true ||
  cloudSqlOptimization?.forbid?.sslMutation !== true ||
  cloudSqlOptimization?.forbid?.iamMutation !== true ||
  cloudSqlOptimization?.forbid?.billingMutation !== true ||
  cloudSqlOptimization?.forbid?.diskShrinkInPlace !== true
) {
  console.error('Cloud SQL cost optimization is outside the approved envelope');
  process.exit(1);
}

if (policy.allowedOperations?.['reconcile-toca-managed-instagram-heartbeat']) {
  console.error('Legacy heartbeat must not remain an active infrastructure operation');
  process.exit(1);
}

const daemon = policy.activeRuntime?.tocaManagedInstagramScheduler;
if (
  daemon?.resourceType !== 'cloud-run-service' ||
  daemon?.resourceName !== 'toca-managed-instagram-daemon' ||
  daemon?.runtimeServiceAccount !== runtime ||
  daemon?.private !== true ||
  daemon?.minInstances !== 1 ||
  daemon?.maxInstances !== 1 ||
  daemon?.concurrency !== 1 ||
  daemon?.pollIntervalMs !== 60000 ||
  daemon?.schedulerBackend !== 'postgresql' ||
  daemon?.scheduleTransport !== 'protected-mcp' ||
  daemon?.contentPayloadInInfrastructureTimer !== false ||
  daemon?.legacyHeartbeatSuperseded !== true
) {
  console.error('TOCA-managed Instagram daemon topology is outside the approved envelope');
  process.exit(1);
}

const daemonRequirements = [
  'SERVICE_NAME: toca-managed-instagram-daemon',
  '--min-instances 1',
  '--max-instances 1',
  '--concurrency 1',
  '--no-allow-unauthenticated',
  'TOCA_MANAGED_INSTAGRAM_DAEMON_POLL_INTERVAL_MS=60000',
  'TOCA_MANAGED_INSTAGRAM_SCHEDULER_ENABLED=true',
  'TOCA_MANAGED_INSTAGRAM_EXECUTOR_ENABLED=true',
];

for (const marker of daemonRequirements) {
  if (!daemonWorkflow.includes(marker)) {
    console.error(`Daemon deploy workflow missing active topology marker: ${marker}`);
    process.exit(1);
  }
}

const forbiddenPolicyFlags = [
  'projectOwner',
  'projectEditor',
  'serviceAccountKeys',
  'bucketDelete',
  'arbitraryGcloud',
  'runtimePrivilegeEscalation',
  'publicBucketIam',
  'perContentSchedulerJobs',
  'legacyHeartbeatRecreation',
  'deployAsSchedulingTransport',
];

for (const key of forbiddenPolicyFlags) {
  if (policy.forbidden?.[key] !== true) {
    console.error(`Infrastructure policy must explicitly forbid: ${key}`);
    process.exit(1);
  }
}

const requiredStoragePermissions = [
  'storage.buckets.create',
  'storage.buckets.get',
  'storage.buckets.getIamPolicy',
  'storage.buckets.setIamPolicy',
  'storage.buckets.update',
];

for (const permission of requiredStoragePermissions) {
  if (!storageRole.includes(`- ${permission}`)) {
    console.error(`Infrastructure storage role missing permission: ${permission}`);
    process.exit(1);
  }
}

const requiredCloudSqlPermissions = [
  'cloudsql.instances.get',
  'cloudsql.instances.list',
  'cloudsql.instances.update',
  'cloudsql.backupRuns.get',
  'cloudsql.backupRuns.list',
  'resourcemanager.projects.get',
  'serviceusage.services.get',
  'serviceusage.services.use',
];

for (const permission of requiredCloudSqlPermissions) {
  if (!cloudSqlRole.includes(`- ${permission}`)) {
    console.error(`Cloud SQL cost optimizer role missing permission: ${permission}`);
    process.exit(1);
  }
}

const forbiddenStoragePermissions = [
  'storage.buckets.delete',
  'iam.serviceAccounts.create',
  'iam.serviceAccountKeys.create',
  'resourcemanager.projects.setIamPolicy',
];

for (const permission of forbiddenStoragePermissions) {
  if (storageRole.includes(permission)) {
    console.error(`Infrastructure storage role contains forbidden permission: ${permission}`);
    process.exit(1);
  }
}

const forbiddenCloudSqlPermissions = [
  'cloudsql.instances.create',
  'cloudsql.instances.delete',
  'cloudsql.instances.clone',
  'cloudsql.instances.restoreBackup',
  'cloudsql.instances.import',
  'cloudsql.databases.delete',
  'cloudsql.backupRuns.delete',
  'cloudsql.users.create',
  'cloudsql.users.delete',
  'cloudsql.users.update',
  'cloudsql.sslCerts.create',
  'cloudsql.sslCerts.delete',
  'cloudsql.instances.setIamPolicy',
  'resourcemanager.projects.setIamPolicy',
  'billing.accounts.update',
];

for (const permission of forbiddenCloudSqlPermissions) {
  if (cloudSqlRole.includes(permission)) {
    console.error(`Cloud SQL cost optimizer role contains forbidden permission: ${permission}`);
    process.exit(1);
  }
}

console.log('Infrastructure control-plane check passed.');
