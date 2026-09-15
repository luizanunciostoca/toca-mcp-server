import { readFileSync } from 'node:fs';

const workflowPath = '.github/workflows/ag01-artifact-registry-repair.yml';
const repairPolicyPath = 'infra/control-plane/ag01-artifact-registry-repair-policy.json';
const parentPolicyPath = 'infra/control-plane/policy.json';

const workflow = readFileSync(workflowPath, 'utf8');
const repair = JSON.parse(readFileSync(repairPolicyPath, 'utf8'));
const parent = JSON.parse(readFileSync(parentPolicyPath, 'utf8'));

const fail = (message) => {
  console.error(`AG-01 Artifact Registry repair contract invalid: ${message}`);
  process.exit(1);
};

if (repair.schemaVersion !== 'toca.ag01.artifact-registry-repair-policy.v1') {
  fail('unexpected repair policy schema');
}
if (repair.operationId !== 'restore-ag01-artifact-registry-service') fail('operation id drift');
if (
  repair.parentControlPlane?.path !== parentPolicyPath ||
  repair.parentControlPlane?.version !== 10 ||
  repair.parentControlPlane?.projectId !== 'toca-mcp-production'
) {
  fail('parent control-plane binding drift');
}
if (
  repair.target?.projectId !== 'toca-mcp-production' ||
  repair.target?.region !== 'southamerica-east1' ||
  repair.target?.serviceName !== 'artifactregistry.googleapis.com' ||
  repair.target?.artifactRepository !== 'toca-mcp' ||
  repair.target?.immutableImageDigest !==
    'southamerica-east1-docker.pkg.dev/toca-mcp-production/toca-mcp/ag01@sha256:491c0f4e05c8b02bd030080e9ab3d92fbc61a2252f2983fe582b619cbb222e96'
) {
  fail('repair target drift');
}
if (
  repair.execution?.mode !== 'MANUAL_EXPLICIT_CONFIRMATION_ONLY' ||
  repair.execution?.environment !== 'infrastructure-admin' ||
  repair.execution?.confirmation !== 'RESTORE_ARTIFACT_REGISTRY_ONLY' ||
  repair.execution?.allowedMutation !== 'ENABLE_EXACT_SERVICE_ONLY' ||
  repair.execution?.stopAfter !== 'IMMUTABLE_IMAGE_READBACK' ||
  repair.execution?.requiredPermission !== 'serviceusage.services.enable' ||
  repair.execution?.permissionObservedAtPreparation !== false ||
  repair.execution?.permissionEvidence !== 'github-actions:35016168143:attempt-1'
) {
  fail('execution boundary drift');
}
if (
  repair.preconditions?.projectBillingEnabled !== true ||
  repair.preconditions?.ag01OperationalStatus !== 'DEGRADED' ||
  repair.preconditions?.ag01ExecutionAuthorized !== false ||
  repair.preconditions?.ag01DeploymentAuthorized !== false ||
  repair.preconditions?.artifactRegistryServiceEnabled !== false
) {
  fail('repair precondition drift');
}
if (
  repair.postconditions?.artifactRegistryServiceEnabled !== true ||
  repair.postconditions?.immutableImageDigestReadable !== true ||
  repair.postconditions?.cloudRunDeploymentExecuted !== false ||
  repair.postconditions?.cloudRunTrafficMutationExecuted !== false ||
  repair.postconditions?.businessCapabilityExecuted !== false
) {
  fail('repair postcondition drift');
}
for (const key of [
  'billingMutation',
  'iamMutation',
  'privilegeEscalation',
  'arbitraryServiceEnable',
  'cloudRunDeploy',
  'cloudRunTrafficMutation',
  'databaseMutation',
  'providerMutation',
  'businessCapabilityExecution',
  'serviceAccountKeyCreation',
]) {
  if (repair.forbid?.[key] !== true) fail(`missing forbidden mutation ${key}`);
}

if (
  parent.projectId !== 'toca-mcp-production' ||
  parent.adminServiceAccount !== 'toca-mcp-infra-admin@toca-mcp-production.iam.gserviceaccount.com' ||
  parent.activeRuntime?.ag01Orchestrator?.currentOperationalStatus !== 'DEGRADED' ||
  parent.activeRuntime?.ag01Orchestrator?.executionAuthorized !== false ||
  parent.activeRuntime?.ag01Orchestrator?.deploymentAuthorized !== false ||
  parent.forbidden?.runtimePrivilegeEscalation !== true ||
  parent.forbidden?.arbitraryGcloud !== true ||
  parent.forbidden?.serviceAccountKeys !== true
) {
  fail('parent fail-closed boundary drift');
}

for (const marker of [
  'workflow_dispatch:',
  'environment: infrastructure-admin',
  'expected_main_sha',
  'expected_parent_policy_sha256',
  'expected_repair_policy_sha256',
  'RESTORE_ARTIFACT_REGISTRY_ONLY',
  'ref: main',
  'sha256sum "$PARENT_POLICY"',
  'sha256sum "$REPAIR_POLICY"',
  'serviceusage.services.enable',
  'testIamPermissions',
  'MISSING_SERVICEUSAGE_SERVICES_ENABLE',
  'gcloud services enable "$SERVICE_NAME"',
  'gcloud artifacts docker images describe "$IMMUTABLE_IMAGE_DIGEST"',
  'serviceUsageMutationExecuted:true',
  'cloudRunDeploymentExecuted:false',
  'cloudRunTrafficMutationExecuted:false',
  'databaseMutationExecuted:false',
  'providerMutationExecuted:false',
  'businessCapabilityExecuted:false',
  'billingMutationExecuted:false',
  'iamMutationExecuted:false',
]) {
  if (!workflow.includes(marker)) fail(`workflow marker missing: ${marker}`);
}

if (workflow.includes('push:') || workflow.includes('pull_request:')) {
  fail('repair workflow must never run automatically');
}

const exactEnable = 'gcloud services enable "$SERVICE_NAME"';
if (workflow.split(exactEnable).length - 1 !== 1) {
  fail('exact service enable must occur exactly once');
}

for (const forbidden of [
  'gcloud projects add-iam-policy-binding',
  'gcloud projects remove-iam-policy-binding',
  'gcloud iam service-accounts keys',
  'gcloud billing projects link',
  'gcloud run deploy',
  'gcloud run services update',
  'gcloud run services update-traffic',
  'gcloud sql',
  'meta_ads.',
  'instagram.publish',
  'whatsapp.',
  'email.',
]) {
  if (workflow.includes(forbidden)) fail(`forbidden workflow capability: ${forbidden}`);
}

console.log('AG01_ARTIFACT_REGISTRY_REPAIR_CONTRACT_CHECK_PASS=1');
