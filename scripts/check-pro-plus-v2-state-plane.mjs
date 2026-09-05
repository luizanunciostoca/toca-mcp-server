import { readFileSync } from 'node:fs';

const [lanePath, queuePath, evidencePath, backlogPath, evidenceCommentsPath] =
  process.argv.slice(2);
const expectedOwner = process.env.EXPECTED_OWNER?.trim();

if (!lanePath || !queuePath || !evidencePath || !backlogPath || !evidenceCommentsPath) {
  throw new Error('PRO_PLUS_V2_STATE_PLANE_INPUTS_REQUIRED');
}
if (!expectedOwner) throw new Error('PRO_PLUS_V2_EXPECTED_OWNER_REQUIRED');

const shaPattern = /^[0-9a-f]{40}$/;
const digestPattern = /^sha256:[0-9a-f]{64}$/;
const laneStatuses = new Set([
  'PLANNED',
  'READY_PARALLEL',
  'ACTIVE',
  'STACKED',
  'SERIAL_WAIT',
  'NEEDS_LOCK',
  'CI_RUNNING',
  'READY_FOR_INTEGRATION',
  'FROZEN',
  'MERGE_RESERVED',
  'MERGED',
  'POST_MERGE_ACCEPTANCE',
  'ACCEPTED',
  'BLOCKED_EXTERNAL',
  'SUPERSEDED',
  'CANCELED',
  'FAILED',
]);
const integrationStatuses = new Set([
  'READY_FOR_INTEGRATION',
  'FROZEN',
  'CI_RUNNING',
  'MERGE_RESERVED',
  'MERGED',
  'POST_MERGE_ACCEPTANCE',
  'ACCEPTED',
]);
const evidenceValidities = new Set([
  'VALID',
  'STALE',
  'SUPERSEDED',
  'AMBIGUOUS',
  'FAILED',
  'NOT_EXECUTED',
]);
const backlogClasses = new Set([
  'ACTIVE_IMPLEMENTATION',
  'READY_FOR_INTEGRATION',
  'STALE_NEEDS_SYNC',
  'SUPERSEDED_BY_MAIN',
  'SUPERSEDED_BY_PR',
  'EVIDENCE_ONLY',
  'DO_NOT_MERGE_DIAGNOSTIC',
  'BLOCKED_EXTERNAL',
  'DEPENDABOT_ROUTINE',
  'HISTORICAL',
]);

const fail = (message) => {
  throw new Error(`PRO_PLUS_V2_STATE_PLANE_INVALID: ${message}`);
};
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const marker = (body, key) => {
  const prefix = `${key}=`;
  const matches = body.split('\n').filter((line) => line.startsWith(prefix));
  if (matches.length !== 1) fail(`${key} must appear exactly once`);
  return matches[0].slice(prefix.length);
};
const stateBlock = (body) => {
  const matches = [...body.matchAll(/```json\s*([\s\S]*?)```/g)];
  if (matches.length !== 1) fail('state issue must contain exactly one JSON block');
  return JSON.parse(matches[0][1]);
};
const validateIssueEnvelope = (issue, expectedTitle, expectedRole) => {
  if (issue.state !== 'open') fail(`${expectedTitle} must remain open`);
  if (issue.user?.login !== expectedOwner) fail(`${expectedTitle} must be owner-authored`);
  if (issue.title !== expectedTitle) fail(`unexpected title for ${expectedRole}`);
  const body = issue.body ?? '';
  for (const expected of [
    ['PRO_PLUS_CONTROL_PLANE_SCHEMA_VERSION', '2'],
    ['CONTROL_PLANE_ROLE', expectedRole],
    ['STATE_PLANE_STORAGE', 'GITHUB_ISSUE'],
    ['MUTATION_CHANGES_MAIN_SHA', 'false'],
    ['EXTERNAL_SIDE_EFFECTS_AUTHORIZED', 'false'],
    ['PROVIDER_CALLS_AUTHORIZED', 'false'],
    ['DATABASE_MUTATIONS_AUTHORIZED', 'false'],
    ['SERVICE_MUTATIONS_AUTHORIZED', 'false'],
  ]) {
    if (marker(body, expected[0]) !== expected[1]) fail(`${expectedRole} marker ${expected[0]}`);
  }
  return { body, state: stateBlock(body) };
};

const laneIssue = readJson(lanePath);
const queueIssue = readJson(queuePath);
const evidenceIssue = readJson(evidencePath);
const backlogIssue = readJson(backlogPath);
const evidenceComments = readJson(evidenceCommentsPath);

const laneEnvelope = validateIssueEnvelope(
  laneIssue,
  'PRO+ v2 CONTROL PLANE — Lane Registry & Hotspot Locks',
  'LANE_REGISTRY_AND_HOTSPOT_LOCKS',
);
const queueEnvelope = validateIssueEnvelope(
  queueIssue,
  'PRO+ v2 CONTROL PLANE — Integration Queue & Main Stability',
  'INTEGRATION_QUEUE_AND_MAIN_STABILITY',
);
const evidenceEnvelope = validateIssueEnvelope(
  evidenceIssue,
  'PRO+ v2 CONTROL PLANE — Evidence Ledger',
  'EVIDENCE_LEDGER',
);
const backlogEnvelope = validateIssueEnvelope(
  backlogIssue,
  'PRO+ v2 CONTROL PLANE — Backlog Classification',
  'BACKLOG_CLASSIFICATION',
);

if (laneEnvelope.state.schemaVersion !== 2) fail('lane registry schema version');
const lanes = laneEnvelope.state.lanes ?? [];
const locks = laneEnvelope.state.locks ?? [];
if (!Array.isArray(lanes) || !Array.isArray(locks)) fail('lanes/locks must be arrays');
const laneIds = new Set();
const activeOwnedFiles = new Map();
const liveStatuses = new Set([
  'READY_PARALLEL',
  'ACTIVE',
  'STACKED',
  'SERIAL_WAIT',
  'NEEDS_LOCK',
  'CI_RUNNING',
  'READY_FOR_INTEGRATION',
  'FROZEN',
  'MERGE_RESERVED',
  'MERGED',
  'POST_MERGE_ACCEPTANCE',
]);
for (const lane of lanes) {
  if (!lane.lane_id || laneIds.has(lane.lane_id)) fail('duplicate or missing lane_id');
  laneIds.add(lane.lane_id);
  if (!laneStatuses.has(lane.status)) fail(`invalid lane status ${lane.lane_id}`);
  if (!shaPattern.test(lane.base_sha ?? '')) fail(`invalid lane base_sha ${lane.lane_id}`);
  if (lane.head_sha && !shaPattern.test(lane.head_sha))
    fail(`invalid lane head_sha ${lane.lane_id}`);
  if (!Array.isArray(lane.files_owned) || !Array.isArray(lane.hotspot_locks)) {
    fail(`invalid ownership arrays ${lane.lane_id}`);
  }
  if (liveStatuses.has(lane.status)) {
    for (const owned of lane.files_owned) {
      if (activeOwnedFiles.has(owned)) {
        fail(`active ownership overlap ${owned}: ${activeOwnedFiles.get(owned)} / ${lane.lane_id}`);
      }
      activeOwnedFiles.set(owned, lane.lane_id);
    }
  }
}
const lockIds = new Set();
const lockedResources = new Set();
for (const lock of locks) {
  if (!lock.lock_id || lockIds.has(lock.lock_id)) fail('duplicate or missing lock_id');
  lockIds.add(lock.lock_id);
  if (!lock.resource || lockedResources.has(lock.resource))
    fail('duplicate or missing lock resource');
  lockedResources.add(lock.resource);
  if (!laneIds.has(lock.owner_lane)) fail(`lock owner lane missing: ${lock.lock_id}`);
  if (!['HELD', 'RELEASED'].includes(lock.state)) fail(`invalid lock state: ${lock.lock_id}`);
}

if (queueEnvelope.state.schemaVersion !== 2) fail('integration queue schema version');
const queue = queueEnvelope.state.queue ?? [];
if (!Array.isArray(queue)) fail('integration queue must be an array');
const queuedLaneIds = new Set();
for (const entry of queue) {
  if (!entry.lane_id || queuedLaneIds.has(entry.lane_id)) fail('duplicate queue lane');
  queuedLaneIds.add(entry.lane_id);
  if (!laneIds.has(entry.lane_id)) fail(`queue references missing lane ${entry.lane_id}`);
  if (!integrationStatuses.has(entry.status)) fail(`invalid queue status ${entry.lane_id}`);
  if (!shaPattern.test(entry.head_sha ?? '') || !shaPattern.test(entry.base_sha ?? '')) {
    fail(`invalid queue SHA ${entry.lane_id}`);
  }
}
const stabilityMarker = marker(queueEnvelope.body, 'MAIN_STABILITY');
const evaluatedSha = marker(queueEnvelope.body, 'EVALUATED_MAIN_SHA');
const reservationMarker = marker(queueEnvelope.body, 'MERGE_RESERVATION');
if (!['PASS', 'BLOCKED'].includes(stabilityMarker)) fail('invalid MAIN_STABILITY marker');
if (!shaPattern.test(evaluatedSha)) fail('invalid EVALUATED_MAIN_SHA');
const stability = queueEnvelope.state.mainStability;
if (stability?.status !== stabilityMarker || stability?.evaluatedMainSha !== evaluatedSha) {
  fail('main stability marker/JSON mismatch');
}
const reservation = queueEnvelope.state.mergeReservation ?? null;
if (reservationMarker === 'NONE' && reservation !== null)
  fail('merge reservation marker/JSON mismatch');
if (reservation !== null) {
  if (reservationMarker === 'NONE') fail('missing merge reservation marker');
  if (!laneIds.has(reservation.lane_id)) fail('merge reservation references missing lane');
  if (!shaPattern.test(reservation.head_sha ?? '')) fail('invalid merge reservation head_sha');
}
if (stabilityMarker === 'PASS' && reservation !== null)
  fail('stable main cannot have merge reservation');

if (evidenceEnvelope.state.schemaVersion !== 2) fail('evidence ledger schema version');
const bodyRecords = evidenceEnvelope.state.records ?? [];
if (!Array.isArray(bodyRecords)) fail('evidence records must be an array');
for (const record of bodyRecords) {
  if (!record.evidence_id || !evidenceValidities.has(record.validity))
    fail('invalid evidence record');
  if (record.source_sha && !shaPattern.test(record.source_sha)) fail('invalid evidence source_sha');
  if (record.runtime_image_digest && !digestPattern.test(record.runtime_image_digest)) {
    fail('invalid evidence digest');
  }
}
if (!Array.isArray(evidenceComments)) fail('evidence comments payload must be an array');
for (const comment of evidenceComments) {
  const body = comment.body ?? '';
  if (!body.includes('EVIDENCE_ID=')) continue;
  const author = comment.user?.login;
  if (![expectedOwner, 'github-actions[bot]'].includes(author))
    fail('untrusted evidence comment author');
  const evidenceId = marker(body, 'EVIDENCE_ID');
  if (!evidenceId) fail('empty evidence comment id');
  const validity = marker(body, 'VALIDITY');
  if (!evidenceValidities.has(validity)) fail('invalid evidence comment validity');
  const sourceSha = marker(body, 'SOURCE_SHA');
  const treeSha = marker(body, 'TREE_SHA');
  const digest = marker(body, 'RUNTIME_IMAGE_DIGEST');
  if (!shaPattern.test(sourceSha) || !shaPattern.test(treeSha))
    fail('invalid evidence comment SHA');
  if (!digestPattern.test(digest)) fail('invalid evidence comment digest');
}

if (backlogEnvelope.state.schemaVersion !== 2) fail('backlog schema version');
const backlogRecords = backlogEnvelope.state.records ?? [];
if (!Array.isArray(backlogRecords)) fail('backlog records must be an array');
const backlogIds = new Set();
for (const record of backlogRecords) {
  const id = record.record_id ?? `${record.kind ?? 'UNKNOWN'}:${record.number ?? 'UNKNOWN'}`;
  if (backlogIds.has(id)) fail(`duplicate backlog record ${id}`);
  backlogIds.add(id);
  if (!backlogClasses.has(record.classification)) fail(`invalid backlog class ${id}`);
}

console.log(
  `PRO_PLUS_V2_STATE_PLANE=PASS lanes=${lanes.length} locks=${locks.length} queue=${queue.length} evidence_comments=${evidenceComments.filter((comment) => (comment.body ?? '').includes('EVIDENCE_ID=')).length} backlog=${backlogRecords.length}`,
);
