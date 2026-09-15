import { readFileSync } from 'node:fs';

const policy = JSON.parse(readFileSync('infra/control-plane/policy.json', 'utf8'));
const ag01 = policy.activeRuntime?.ag01Orchestrator;

const fail = (message) => {
  console.error(`AG-01 control-plane state invalid: ${message}`);
  process.exit(1);
};

if (!ag01) fail('runtime registration missing');
if (ag01.lifecycleStatus !== 'PRODUCTION_VERIFIED_DEGRADED') {
  fail('lifecycle must distinguish historical verification from current degradation');
}
if (ag01.historicalVerification?.status !== 'PRODUCTION_VERIFIED') {
  fail('historical production verification missing');
}
if (ag01.historicalVerification?.verifiedAt !== '2026-08-28') {
  fail('historical verification date drift');
}
if (
  ag01.historicalVerification?.canonicalProductionRevision !==
  'toca-ag01-orchestrator-vtx-d2c85284-2'
) {
  fail('historical production revision drift');
}
if (
  ag01.historicalVerification?.canonicalRuntimeSourceSha !==
  'd2c85284f3f67d017ee800e4c4b772f5418542d6'
) {
  fail('historical runtime source drift');
}

if (ag01.currentOperationalStatus !== 'DEGRADED') fail('current degraded status missing');
if (ag01.deploymentAuthorized !== false) fail('deployment must fail closed while degraded');
if (ag01.executionAuthorized !== false) fail('execution must fail closed while degraded');
if (ag01.executionAuthority !== 'CORE_POLICY_APPROVAL_ONLY') fail('execution authority widened');
if (ag01.directProviderWriteAuthorized !== false)
  fail('direct provider write must remain forbidden');
if (ag01.resourceType !== 'cloud-run-service') fail('unexpected resource type');
if (ag01.resourceName !== 'toca-ag01-orchestrator') fail('unexpected Cloud Run service');
if (ag01.runtimeServiceAccount !== 'toca-mcp-runtime@toca-mcp-production.iam.gserviceaccount.com') {
  fail('runtime identity drift');
}
if (ag01.private !== true) fail('runtime must remain private');
if (ag01.modelProvider !== 'google-vertex-ai' || ag01.model !== 'gemini-2.5-flash') {
  fail('model binding drift');
}
if (ag01.googleRegistryAuth !== 'GCP_RUNTIME_IDENTITY_SCOPED_TOKEN') {
  fail('Google registry auth boundary drift');
}
if (ag01.staticModelOrSheetsCredentialRequired !== false) {
  fail('long-lived model/Sheets credential requirement reintroduced');
}

const aliases = ag01.readinessAliases;
if (
  aliases?.externalHealth !== '/health' ||
  aliases?.externalReady !== '/ready' ||
  aliases?.cloudRunStartup !== '/readyz' ||
  aliases?.cloudRunLiveness !== '/healthz'
) {
  fail('readiness alias contract drift');
}

const requiredTables = ag01.persistenceRequired;
if (
  !Array.isArray(requiredTables) ||
  requiredTables.join(',') !== 'ag01_conversations,ag01_message_records,ag01_runtime_circuits'
) {
  fail('durable persistence contract drift');
}

if (
  ag01.sourceReconciliation?.status !== 'MERGED' ||
  ag01.sourceReconciliation?.pr !== '#815' ||
  ag01.sourceReconciliation?.mainSha !== '5d88effafb399099bbc3cef03b42bcb7a4ea6449'
) {
  fail('source reconciliation evidence drift');
}

const readback = ag01.cloudPlatformReadback;
if (readback?.projectBillingEnabled !== true || readback?.billingAccountLinked !== true) {
  fail('project billing attachment evidence missing');
}
if (readback?.artifactRegistryServiceEnabled !== false) {
  fail('Artifact Registry Service Usage observation drift');
}
if (readback?.artifactRegistryRepositoryReadback !== 'BILLING_DISABLED') {
  fail('Artifact Registry repository failure evidence drift');
}
if (
  readback?.baseHealthHttpStatus !== 500 ||
  readback?.baseReadyHttpStatus !== 503 ||
  readback?.taggedHealthHttpStatus !== 503 ||
  readback?.taggedReadyHttpStatus !== 503 ||
  readback?.failedRequestLatency !== '0s' ||
  readback?.containerSystemEventCount !== 0
) {
  fail('fresh Cloud Run degradation evidence drift');
}

const evidence = new Set(ag01.freshnessEvidence ?? []);
for (const marker of [
  'github-actions:35012288857:attempt-2',
  'github-actions:35015095866:attempt-1',
  'github-actions:35015308326:attempt-1',
]) {
  if (!evidence.has(marker)) fail(`missing freshness evidence ${marker}`);
}

const repair = new Set(ag01.repairRequirements ?? []);
for (const requirement of [
  'ARTIFACT_REGISTRY_SERVICE_ENABLED',
  'IMMUTABLE_IMAGE_READBACK_VERIFIED',
  'HEALTH_200',
  'READY_200',
  'EXACT_HEAD_DEPLOYMENT_CERTIFIED',
]) {
  if (!repair.has(requirement)) fail(`missing repair requirement ${requirement}`);
}

console.log('AG01_CONTROL_PLANE_STATE_CHECK_PASS=1');
