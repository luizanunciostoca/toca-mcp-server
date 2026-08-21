import { existsSync, readFileSync } from 'node:fs';

const required = [
  '.github/workflows/infrastructure-control-plane.yml',
  '.github/workflows/deploy-toca-managed-instagram-daemon-gcp.yml',
  'src/toca-managed-instagram-daemon.ts',
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
const daemonSourcePath = 'src/toca-managed-instagram-daemon.ts';
const policyPath = 'infra/control-plane/policy.json';
const storageRolePath = 'infra/control-plane/storage-bucket-admin-role.yaml';
const cloudSqlRolePath = 'infra/control-plane/cloudsql-cost-optimizer-role.yaml';
const infraAdmin = 'toca-mcp-infra-admin@toca-mcp-production.iam.gserviceaccount.com';
const runtime = 'toca-mcp-runtime@toca-mcp-production.iam.gserviceaccount.com';

const workflow = readFileSync(workflowPath, 'utf8');
const daemonWorkflow = readFileSync(daemonWorkflowPath, 'utf8');
const daemonSource = readFileSync(daemonSourcePath, 'utf8');
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
  'gcloud components install beta --quiet',
  'CLOUD_SQL_RESUME_STATE=VERIFIED',
  'gcloud beta sql instances patch',
  '--storage-auto-increase-limit=206',
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
  'gcloud projects remove-iam-policy-binding',
  'perform-storage-shrink',
];

for (const forbidden of forbiddenWorkflowMarkers) {
  if (workflow.includes(forbidden)) {
    console.error(`Infrastructure workflow contains forbidden/superseded capability: ${forbidden}`);
    process.exit(1);
  }
}

const stagingReaderIamCommand =
  'gcloud projects add-iam-policy-binding "$STAGING_GCP_PROJECT_ID"';
const stagingReaderIamCommandCount = workflow.split(stagingReaderIamCommand).length - 1;
if (
  stagingReaderIamCommandCount !== 1 ||
  !workflow.includes('for role in roles/cloudsql.viewer roles/monitoring.viewer; do') ||
  !workflow.includes('MEMBER="serviceAccount:${STAGING_DEPLOYER_SERVICE_ACCOUNT}"') ||
  !workflow.includes('--member="$MEMBER"') ||
  !workflow.includes('--role="$role"') ||
  !workflow.includes('--condition=None')
) {
  console.error('Staging reader IAM mutation is outside the exact approved envelope');
  process.exit(1);
}

if (workflow.includes('push:') || workflow.includes('pull_request:')) {
  console.error('Infrastructure control plane cannot run automatically');
  process.exit(1);
}

if (
  policy.version !== 10 ||
  policy.projectId !== 'toca-mcp-production' ||
  policy.adminServiceAccount !== infraAdmin ||
  policy.runtimeServiceAccount !== runtime
) {
  console.error('Infrastructure identity/policy boundary changed unexpectedly');
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

const stagingReaders = policy.allowedOperations?.['grant-staging-verification-readers'];
const stagingReaderRoles = stagingReaders?.allowedRoles;
if (
  stagingReaders?.resourceType !== 'gcp-project-iam' ||
  stagingReaders?.projectId !== 'toca-mcp-next-staging' ||
  stagingReaders?.projectNumber !== '729069789107' ||
  stagingReaders?.principal !==
    'serviceAccount:toca-next-stg-deployer@toca-mcp-next-staging.iam.gserviceaccount.com' ||
  !Array.isArray(stagingReaderRoles) ||
  stagingReaderRoles.length !== 2 ||
  stagingReaderRoles[0] !== 'roles/cloudsql.viewer' ||
  stagingReaderRoles[1] !== 'roles/monitoring.viewer' ||
  stagingReaders?.verification?.cloudSqlBackupRead !== true ||
  stagingReaders?.verification?.monitoringConfigurationRead !== true ||
  stagingReaders?.forbid?.productionMutation !== true ||
  stagingReaders?.forbid?.providerMutation !== true ||
  stagingReaders?.forbid?.destructiveOperations !== true ||
  stagingReaders?.forbid?.projectOwner !== true ||
  stagingReaders?.forbid?.projectEditor !== true ||
  stagingReaders?.forbid?.serviceAccountKeys !== true
) {
  console.error('Staging verification readers are outside the approved envelope');
  process.exit(1);
}

const cloudSqlOptimization = policy.allowedOperations?.['optimize-cloud-sql-cost'];
const resumeStates = cloudSqlOptimization?.allowedResumeStates;
if (
  cloudSqlOptimization?.resourceType !== 'cloud-sql-instance' ||
  cloudSqlOptimization?.resourceName !== 'toca-mcp-db' ||
  cloudSqlOptimization?.databaseVersion !== 'POSTGRES_18' ||
  cloudSqlOptimization?.requireRecentSuccessfulBackupHours !== 36 ||
  cloudSqlOptimization?.originalSource?.edition !== 'ENTERPRISE_PLUS' ||
  cloudSqlOptimization?.originalSource?.availabilityType !== 'REGIONAL' ||
  cloudSqlOptimization?.originalSource?.tier !== 'db-perf-optimized-N-8' ||
  cloudSqlOptimization?.originalSource?.dataDiskType !== 'PD_SSD' ||
  cloudSqlOptimization?.originalSource?.dataDiskSizeGb !== 250 ||
  cloudSqlOptimization?.storageShrink?.enabled !== true ||
  cloudSqlOptimization?.storageShrink?.completed !== true ||
  cloudSqlOptimization?.storageShrink?.sourceSizeGb !== 250 ||
  cloudSqlOptimization?.storageShrink?.providerMinimalTargetSizeGb !== 56 ||
  cloudSqlOptimization?.storageShrink?.reserveBufferGb !== 100 ||
  cloudSqlOptimization?.storageShrink?.targetSizeGb !== 156 ||
  cloudSqlOptimization?.storageShrink?.autoIncreaseHeadroomGb !== 50 ||
  cloudSqlOptimization?.storageShrink?.autoIncreaseLimitGb !== 206 ||
  cloudSqlOptimization?.storageShrink?.completedProviderRunId !== 31844320778 ||
  cloudSqlOptimization?.storageShrink?.mustRunBeforeSharedCore !== true ||
  !Array.isArray(resumeStates) ||
  resumeStates.length !== 3 ||
  resumeStates[0]?.name !== 'STORAGE_SHRUNK' ||
  resumeStates[0]?.edition !== 'ENTERPRISE_PLUS' ||
  resumeStates[0]?.availabilityType !== 'REGIONAL' ||
  resumeStates[0]?.tier !== 'db-perf-optimized-N-8' ||
  resumeStates[0]?.dataDiskSizeGb !== 156 ||
  resumeStates[1]?.name !== 'HA_DISABLED' ||
  resumeStates[1]?.edition !== 'ENTERPRISE_PLUS' ||
  resumeStates[1]?.availabilityType !== 'ZONAL' ||
  resumeStates[1]?.tier !== 'db-perf-optimized-N-8' ||
  resumeStates[1]?.dataDiskSizeGb !== 156 ||
  resumeStates[2]?.name !== 'EDITION_TIER_DOWNGRADED' ||
  resumeStates[2]?.edition !== 'ENTERPRISE' ||
  resumeStates[2]?.availabilityType !== 'ZONAL' ||
  resumeStates[2]?.tier !== 'db-g1-small' ||
  resumeStates[2]?.dataDiskSizeGb !== 156 ||
  cloudSqlOptimization?.target?.edition !== 'ENTERPRISE' ||
  cloudSqlOptimization?.target?.availabilityType !== 'ZONAL' ||
  cloudSqlOptimization?.target?.tier !== 'db-g1-small' ||
  cloudSqlOptimization?.target?.dataDiskType !== 'PD_SSD' ||
  cloudSqlOptimization?.target?.dataDiskSizeGb !== 156 ||
  cloudSqlOptimization?.target?.storageAutoIncreaseLimitGb !== 206 ||
  cloudSqlOptimization?.target?.retainedBackups !== 7 ||
  cloudSqlOptimization?.target?.transactionLogRetentionDays !== 7 ||
  cloudSqlOptimization?.preserve?.databaseVersion !== true ||
  cloudSqlOptimization?.preserve?.dataDiskType !== true ||
  cloudSqlOptimization?.preserve?.deletionProtection !== true ||
  cloudSqlOptimization?.preserve?.automatedBackups !== true ||
  cloudSqlOptimization?.preserve?.pointInTimeRecovery !== true ||
  cloudSqlOptimization?.preserve?.storageAutoResize !== true ||
  cloudSqlOptimization?.forbid?.instanceDelete !== true ||
  cloudSqlOptimization?.forbid?.databaseDelete !== true ||
  cloudSqlOptimization?.forbid?.backupDelete !== true ||
  cloudSqlOptimization?.forbid?.userMutation !== true ||
  cloudSqlOptimization?.forbid?.sslMutation !== true ||
  cloudSqlOptimization?.forbid?.iamMutation !== true ||
  cloudSqlOptimization?.forbid?.billingMutation !== true ||
  cloudSqlOptimization?.forbid?.secondStorageShrink !== true ||
  cloudSqlOptimization?.forbid?.unguardedDiskShrink !== true
) {
  console.error('Cloud SQL cost optimization is outside the approved resumable envelope');
  process.exit(1);
}

if (policy.allowedOperations?.['reconcile-toca-managed-instagram-heartbeat']) {
  console.error('Legacy heartbeat must not remain an active infrastructure operation');
  process.exit(1);
}

const daemon = policy.activeRuntime?.tocaManagedInstagramScheduler;
const globalScheduler = daemon?.globalSchedulerJob;
if (
  daemon?.resourceType !== 'cloud-run-service' ||
  daemon?.resourceName !== 'toca-managed-instagram-daemon' ||
  daemon?.runtimeServiceAccount !== runtime ||
  daemon?.private !== true ||
  daemon?.minInstances !== 0 ||
  daemon?.maxInstances !== 1 ||
  daemon?.concurrency !== 1 ||
  daemon?.cpuThrottling !== true ||
  daemon?.requestBasedBilling !== true ||
  daemon?.triggerMode !== 'cloud-scheduler-http' ||
  globalScheduler?.name !== 'toca-managed-instagram-tick' ||
  globalScheduler?.schedule !== '* * * * *' ||
  globalScheduler?.timezone !== 'America/Bahia' ||
  globalScheduler?.endpoint !== '/tick' ||
  globalScheduler?.oidcServiceAccount !== runtime ||
  globalScheduler?.maxRetryAttempts !== 0 ||
  daemon?.schedulerBackend !== 'postgresql' ||
  daemon?.scheduleTransport !== 'protected-mcp' ||
  daemon?.contentPayloadInInfrastructureTimer !== false ||
  daemon?.legacyHeartbeatSuperseded !== true
) {
  console.error('TOCA-managed Instagram scheduler topology is outside the minimum-cost envelope');
  process.exit(1);
}

const mcpProduction = policy.activeRuntime?.mcpProduction;
if (
  mcpProduction?.resourceType !== 'cloud-run-service' ||
  mcpProduction?.resourceName !== 'toca-mcp-production' ||
  mcpProduction?.runtimeServiceAccount !== runtime ||
  mcpProduction?.private !== true ||
  mcpProduction?.minInstances !== 0 ||
  mcpProduction?.maxInstances !== 1 ||
  mcpProduction?.cpuThrottling !== true ||
  mcpProduction?.requestBasedBilling !== true
) {
  console.error('MCP production topology is outside the minimum-cost envelope');
  process.exit(1);
}

if (
  policy.costPrinciples?.preserveCorrectnessBeforeSavings !== true ||
  policy.costPrinciples?.scaleToZeroWhenNoBackgroundCpuIsRequired !== true ||
  policy.costPrinciples?.singleGlobalMinuteTriggerOnly !== true ||
  policy.costPrinciples?.cloudSqlSharedCoreFloor !== 'db-g1-small' ||
  policy.costPrinciples?.cloudSqlStorageSafetyBufferGb !== 100 ||
  policy.costPrinciples?.cloudSqlBackupRetentionDays !== 7 ||
  policy.costPrinciples?.cloudSqlTransactionLogRetentionDays !== 7
) {
  console.error('Minimum-cost principles changed outside the approved envelope');
  process.exit(1);
}

const daemonRequirements = [
  'SERVICE_NAME: toca-managed-instagram-daemon',
  'SCHEDULER_JOB_NAME: toca-managed-instagram-tick',
  '--min-instances 0',
  '--max-instances 1',
  '--concurrency 1',
  '--cpu-throttling',
  '--no-allow-unauthenticated',
  "--schedule='* * * * *'",
  "--time-zone='America/Bahia'",
  '--oidc-service-account-email="$GCP_RUNTIME_SERVICE_ACCOUNT"',
  'TOCA_MANAGED_INSTAGRAM_SCHEDULER_ENABLED=true',
  'TOCA_MANAGED_INSTAGRAM_EXECUTOR_ENABLED=true',
  'TOCA_MANAGED_INSTAGRAM_SCALE_TO_ZERO_READY=1',
];

for (const marker of daemonRequirements) {
  if (!daemonWorkflow.includes(marker)) {
    console.error(`Daemon deploy workflow missing minimum-cost topology marker: ${marker}`);
    process.exit(1);
  }
}

for (const forbidden of [
  '--min-instances 1',
  '--no-cpu-throttling',
  'TOCA_MANAGED_INSTAGRAM_DAEMON_POLL_INTERVAL_MS',
]) {
  if (daemonWorkflow.includes(forbidden)) {
    console.error(`Daemon deploy workflow retains always-on cost marker: ${forbidden}`);
    process.exit(1);
  }
}

for (const marker of [
  "request.url === '/tick'",
  "request.method !== 'POST'",
  "triggerMode: 'cloud-scheduler-http'",
]) {
  if (!daemonSource.includes(marker)) {
    console.error(`Daemon source missing request-driven marker: ${marker}`);
    process.exit(1);
  }
}

if (
  daemonSource.includes('setInterval(') ||
  daemonSource.includes('TOCA_MANAGED_INSTAGRAM_DAEMON_POLL_INTERVAL_MS')
) {
  console.error('Daemon source must not retain background polling when scale-to-zero is active');
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
  'perContentSchedulerJobs',
  'legacyHeartbeatRecreation',
  'alwaysOnSchedulerPolling',
  'unboundedCloudRunScaling',
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
  'cloudsql.instances.getDiskShrinkConfig',
  'cloudsql.instances.performDiskShrink',
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
