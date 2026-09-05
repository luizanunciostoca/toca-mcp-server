import { existsSync, readFileSync } from 'node:fs';

const protocolId = '17DLQXnLkhVRfN2ina4WDcE-fjQL6AHqH2x6UzhXZxUw';
const requiredFiles = [
  'control/pro-plus/README.md',
  'control/pro-plus/control-plane.schema.json',
  'control/pro-plus/hotspot-policy.json',
  'control/pro-plus/build-broker-policy.json',
  'control/pro-plus/promotion-materialization-policy.json',
  'control/pro-plus/metrics-policy.json',
  'control/pro-plus/state-plane.json',
  '.github/agents/toca-build-broker-controller.agent.md',
  '.github/agents/toca-backlog-reconciler.agent.md',
  '.github/agents/toca-merge-queue-controller.agent.md',
  '.github/instructions/pro-plus-control-plane.instructions.md',
  '.github/prompts/main-stability-gate.prompt.md',
  '.github/prompts/merge-reservation.prompt.md',
  '.github/prompts/backlog-reconcile.prompt.md',
  '.github/prompts/promotion-materialize.prompt.md',
  '.github/workflows/pro-plus-v2-state-plane-validation.yml',
  'scripts/check-pro-plus-v2-state-plane.mjs',
];

const fail = (message) => {
  console.error(`PRO_PLUS_V2_CONTROL_PLANE_INVALID: ${message}`);
  process.exit(1);
};

for (const path of requiredFiles) {
  if (!existsSync(path)) fail(`missing ${path}`);
}

const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const schema = json('control/pro-plus/control-plane.schema.json');
const hotspots = json('control/pro-plus/hotspot-policy.json');
const buildBroker = json('control/pro-plus/build-broker-policy.json');
const promotion = json('control/pro-plus/promotion-materialization-policy.json');
const metrics = json('control/pro-plus/metrics-policy.json');
const statePlane = json('control/pro-plus/state-plane.json');

if (schema.schemaVersion !== 2 || schema.driveProtocolId !== protocolId)
  fail('schema/protocol mismatch');
if (schema.$defs?.gitSha?.pattern !== '^[0-9a-f]{40}$') fail('git SHA contract missing');
if (schema.$defs?.imageDigest?.pattern !== '^sha256:[0-9a-f]{64}$') fail('digest contract missing');

const requireEnum = (name, required) => {
  const values = schema.$defs?.[name]?.enum ?? [];
  for (const value of required) if (!values.includes(value)) fail(`${name} missing ${value}`);
};
requireEnum('laneStatus', [
  'READY_PARALLEL',
  'NEEDS_LOCK',
  'MERGE_RESERVED',
  'POST_MERGE_ACCEPTANCE',
  'ACCEPTED',
]);
requireEnum('integrationStatus', [
  'FROZEN',
  'CI_RUNNING',
  'MERGE_RESERVED',
  'POST_MERGE_ACCEPTANCE',
]);
requireEnum('evidenceValidity', ['VALID', 'STALE', 'AMBIGUOUS', 'FAILED', 'NOT_EXECUTED']);
requireEnum('backlogClass', [
  'SUPERSEDED_BY_MAIN',
  'SUPERSEDED_BY_PR',
  'DO_NOT_MERGE_DIAGNOSTIC',
  'DEPENDABOT_ROUTINE',
]);

if (
  hotspots.migrationSerialization !== 'GLOBAL_SERIAL' ||
  hotspots.migrationSlotRequiredBeforeEdit !== true
)
  fail('migration serialization weakened');
if (hotspots.allowOverlappingActiveOwnershipWithoutLock !== false)
  fail('overlapping ownership must fail closed');
const uniqueResources = new Set(hotspots.resources ?? []);
if (uniqueResources.size !== (hotspots.resources ?? []).length) fail('duplicate hotspot resource');
for (const resource of [
  'migrations/**',
  'package.json',
  'pnpm-lock.yaml',
  '.github/workflows/**',
]) {
  if (!uniqueResources.has(resource)) fail(`missing hotspot ${resource}`);
}

if (buildBroker.mainStabilityRequired !== true || buildBroker.stateIssue !== 640)
  fail('main stability state binding invalid');
if (buildBroker.artifactReusePolicy !== 'EXACT_TREE_AND_RUNTIME_CONTRACT_ONLY')
  fail('artifact reuse is too weak');
if (buildBroker.subjectiveEquivalenceAllowed !== false)
  fail('subjective artifact equivalence forbidden');

if (
  promotion.defaultStrategy !== 'MATERIALIZE_ON_DEMAND' ||
  promotion.longLivedDraftDefault !== false
)
  fail('promotion must default to on-demand materialization');
if (
  promotion.separatePromotionAuthorizationRequired !== true ||
  promotion.implicitPromotionForbidden !== true
)
  fail('promotion authorization boundary weakened');

const requiredMetrics = [
  'useful_parallel_throughput',
  'invalidated_work_ratio',
  'stale_build_ratio',
  'rebuild_avoided_count',
  'evidence_stale_count',
  'provider_ambiguity_count',
];
for (const metric of requiredMetrics)
  if (!(metrics.metrics ?? []).includes(metric)) fail(`missing metric ${metric}`);

if (statePlane.storage !== 'GITHUB_ISSUES' || statePlane.mutationsChangeMainSha !== false)
  fail('mutable state must not churn main');
const issueEntries = Object.values(statePlane.issues ?? {});
const issueNumbers = issueEntries.map((entry) => entry.number);
if (issueNumbers.length !== 4 || new Set(issueNumbers).size !== issueNumbers.length)
  fail('state issues must be four distinct bindings');
for (const number of [639, 640, 641, 642])
  if (!issueNumbers.includes(number)) fail(`missing state issue #${number}`);
for (const entry of issueEntries)
  if (entry.externalSideEffectsAuthorized !== false)
    fail('state issue cannot grant external side effects');

for (const path of [
  'AGENTS.md',
  '.github/copilot-instructions.md',
  '.github/agents/toca-control-tower.agent.md',
]) {
  const text = readFileSync(path, 'utf8');
  if (!text.includes(protocolId) && path !== '.github/agents/toca-control-tower.agent.md')
    fail(`${path} missing v2 protocol binding`);
  if (!text.includes('control/pro-plus')) fail(`${path} missing control-plane binding`);
}

for (const path of [
  '.github/agents/toca-build-broker-controller.agent.md',
  '.github/agents/toca-backlog-reconciler.agent.md',
  '.github/agents/toca-merge-queue-controller.agent.md',
]) {
  const text = readFileSync(path, 'utf8');
  if (!text.startsWith('---\nname:') || !text.includes('\ndescription:'))
    fail(`${path} invalid custom-agent frontmatter`);
}

const stateWorkflow = readFileSync('.github/workflows/pro-plus-v2-state-plane-validation.yml', 'utf8');
if (!stateWorkflow.includes('issues: read') || stateWorkflow.includes('issues: write')) {
  fail('state-plane validator must remain read-only');
}
for (const marker of ['639', '640', '641', '642', 'check-pro-plus-v2-state-plane.mjs']) {
  if (!stateWorkflow.includes(marker)) fail(`state-plane validator missing ${marker}`);
}

const buildWorkflow = readFileSync(
  '.github/workflows/instagram-engagement-shadow-runtime-build.yml',
  'utf8',
);
for (const marker of [
  'PRO_PLUS_CONTROL_PLANE_SCHEMA_VERSION=2',
  'MAIN_STABILITY=PASS',
  'EVALUATED_MAIN_SHA=$GITHUB_SHA',
  'MERGE_RESERVATION=NONE',
  'issues/640',
  'issues/641/comments',
  'EVIDENCE_TYPE=IMMUTABLE_RUNTIME_BUILD',
  'RUNTIME_CONTRACT=SERVER_IMAGE_V1',
  'BUILD_REUSED=',
]) {
  if (!buildWorkflow.includes(marker))
    fail(`shadow runtime build missing Build Broker marker: ${marker}`);
}

console.log('PRO_PLUS_V2_CONTROL_PLANE=PASS');
