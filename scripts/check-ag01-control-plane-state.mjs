import { readFileSync } from 'node:fs';

const policy = JSON.parse(readFileSync('infra/control-plane/policy.json', 'utf8'));
const ag01 = policy.activeRuntime?.ag01Orchestrator;

const fail = (message) => {
  console.error(`AG-01 control-plane state invalid: ${message}`);
  process.exit(1);
};

if (!ag01) fail('runtime registration missing');
if (ag01.lifecycleStatus !== 'PRODUCTION_VERIFIED') {
  fail('lifecycle must reflect current production verification');
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
  fail('production revision drift');
}
if (
  ag01.historicalVerification?.canonicalRuntimeSourceSha !==
  'd2c85284f3f67d017ee800e4c4b772f5418542d6'
) {
  fail('runtime source drift');
}
if (
  ag01.historicalVerification?.canonicalImageDigest !==
  'sha256:491c0f4e05c8b02bd030080e9ab3d92fbc61a2252f2983fe582b619cbb222e96'
) {
  fail('canonical image digest drift');
}
if (ag01.historicalVerification?.productionClosureRun !== 33204846117) {
  fail('production closure evidence drift');
}

if (ag01.currentOperationalStatus !== 'HEALTHY') fail('current healthy status missing');
if (ag01.deploymentAuthorized !== false) {
  fail('deployment must remain separately exact-SHA authorized');
}
if (ag01.executionAuthorized !== true) fail('healthy AG-01 execution must be authorized');
if (ag01.executionAuthority !== 'CORE_POLICY_APPROVAL_ONLY') fail('execution authority widened');
if (ag01.directProviderWriteAuthorized !== false) {
  fail('direct provider write must remain forbidden');
}
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
if (
  readback?.artifactRegistryServiceEnabled !== true ||
  readback?.artifactRegistryServiceState !== 'ENABLED' ||
  readback?.artifactRegistryRepositoryReadback !== 'READABLE'
) {
  fail('Artifact Registry healthy readback missing');
}
if (
  readback?.baseHealthHttpStatus !== 200 ||
  readback?.baseReadyHttpStatus !== 200 ||
  readback?.taggedHealthHttpStatus !== 200 ||
  readback?.taggedReadyHttpStatus !== 200
) {
  fail('Cloud Run health/readiness evidence is not fully healthy');
}
if (readback?.runtimeCapabilityCount !== 42) fail('runtime capability count drift');
if (readback?.networkProbeResult !== 'APPLICATION_READY_BASE_AND_TAG') {
  fail('network readiness result drift');
}
if (readback?.productionRevision !== 'toca-ag01-orchestrator-vtx-d2c85284-2') {
  fail('serving revision readback drift');
}
if (readback?.runtimeSourceSha !== 'd2c85284f3f67d017ee800e4c4b772f5418542d6') {
  fail('serving runtime source readback drift');
}
if (
  readback?.imageDigest !==
  'sha256:491c0f4e05c8b02bd030080e9ab3d92fbc61a2252f2983fe582b619cbb222e96'
) {
  fail('serving image digest readback drift');
}
if (readback?.trafficPercent !== 100) fail('serving traffic must remain 100 percent');

const evidence = new Set(ag01.freshnessEvidence ?? []);
for (const marker of [
  'github-actions:33204846117:attempt-1',
  'github-actions:35141511500:attempt-1',
  'github-actions:35144684629:attempt-1',
]) {
  if (!evidence.has(marker)) fail(`missing freshness evidence ${marker}`);
}

if (!Array.isArray(ag01.repairRequirements) || ag01.repairRequirements.length !== 0) {
  fail('repair requirements must be empty after restoration');
}

const restoration = ag01.restorationEvidence;
if (
  restoration?.status !== 'PASS' ||
  restoration?.trackingIssue !== '#932' ||
  restoration?.artifactRegistryServiceEnabled !== true ||
  restoration?.immutableImageReadbackVerified !== true ||
  restoration?.health200 !== true ||
  restoration?.ready200 !== true ||
  restoration?.exactHeadDeploymentCertified !== true ||
  restoration?.providerWriteAuthorityWidened !== false
) {
  fail('restoration evidence incomplete');
}

console.log('AG01_CONTROL_PLANE_STATE_CHECK_PASS=1');
