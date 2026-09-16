import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const queuePath =
  process.env.SCHEDULED_PUBLICATION_QUEUE_PATH ?? 'control/gcp-instagram-publication-queue.json';
const commandPath =
  process.env.SCHEDULED_PUBLICATION_COMMAND_PATH ??
  '/tmp/marketing-scheduled-publication-command.json';
const summaryPath =
  process.env.SCHEDULED_PUBLICATION_SUMMARY_PATH ??
  '/tmp/marketing-scheduled-publication-summary.json';
const creativeStandardsDirectory =
  process.env.CREATIVE_STANDARDS_DIRECTORY ?? 'control/creative-standards';
const nowIso = process.env.SCHEDULED_PUBLICATION_NOW ?? new Date().toISOString();
const nowMs = Date.parse(nowIso);

fail(Number.isFinite(nowMs), 'SCHEDULED_PUBLICATION_NOW_INVALID');

const queue = JSON.parse(readFileSync(queuePath, 'utf8'));
validateQueue(queue);

if (!queue.enabled) {
  writeSummary({ due: false, reason: 'QUEUE_DISABLED', mode: queue.mode, now: nowIso });
  console.log('GCP_SCHEDULED_PUBLICATION=DISABLED');
  process.exit(0);
}

validateUniqueIdentities(queue.items);

const maxDelayMs = queue.maxDelayMinutes * 60_000;
const due = [];
const expired = [];

for (const item of queue.items) {
  validateItem(item, queue.mode, nowMs);
  const dueMs = Date.parse(item.scheduledAt);
  const deltaMs = nowMs - dueMs;
  if (deltaMs >= 0 && deltaMs <= maxDelayMs) due.push(item);
  if (deltaMs > maxDelayMs) expired.push(item.contentItemId);
}

if (expired.length > 0) {
  fail(false, `SCHEDULED_PUBLICATION_WINDOW_EXPIRED:${expired.join(',')}`);
}
if (due.length > 1) {
  fail(false, `SCHEDULED_PUBLICATION_AMBIGUOUS:${due.map((item) => item.contentItemId).join(',')}`);
}
if (due.length === 0) {
  writeSummary({ due: false, reason: 'NO_ITEM_DUE', mode: queue.mode, now: nowIso });
  console.log('GCP_SCHEDULED_PUBLICATION=NO_ITEM_DUE');
  process.exit(0);
}

const item = due[0];
const command = {
  schemaVersion: 1,
  commandId: item.commandId,
  action: 'PUBLISH_NOW',
  issuedAt: toBahiaOffset(nowMs),
  timezone: 'America/Bahia',
  schedulingPolicy: 'SCHEDULED_GCP',
  scheduledAt: item.scheduledAt,
  operation: item.operation,
  channel: 'INSTAGRAM',
  format: item.format,
  contentType: 'image/jpeg',
  instagramAccountId: item.instagramAccountId,
  approvalMode: 'EXPLICIT_APPROVAL',
  approvalStatus: 'APPROVED',
  publicationIntent: 'SHARE_NOW',
  contentItemId: item.contentItemId,
  assetId: item.assetId,
  driveFileId: item.driveFileId,
  expectedAssetSha256: item.expectedAssetSha256,
  caption: item.caption,
  correlationId: item.correlationId,
  idempotencyKey: item.idempotencyKey,
  targetCodeSha: item.targetCodeSha,
  creativeTruthBinding: item.creativeTruthBinding,
  rightsClearance: item.rightsClearance,
  registrySnapshot: item.registrySnapshot,
};

writeJson(commandPath, command);
writeSummary({
  due: true,
  reason: 'ITEM_DUE',
  mode: queue.mode,
  now: nowIso,
  contentItemId: item.contentItemId,
  scheduledAt: item.scheduledAt,
  targetCodeSha: item.targetCodeSha,
  commandPath,
});

console.log(`GCP_SCHEDULED_PUBLICATION=DUE:${item.contentItemId}`);

function validateQueue(value) {
  fail(
    value && typeof value === 'object' && !Array.isArray(value),
    'SCHEDULED_PUBLICATION_QUEUE_INVALID',
  );
  fail(value.schemaVersion === 1, 'SCHEDULED_PUBLICATION_QUEUE_SCHEMA_INVALID');
  fail(value.mode === 'CANARY' || value.mode === 'LIMITED', 'SCHEDULED_PUBLICATION_MODE_INVALID');
  fail(typeof value.enabled === 'boolean', 'SCHEDULED_PUBLICATION_ENABLED_INVALID');
  fail(value.timezone === 'America/Bahia', 'SCHEDULED_PUBLICATION_TIMEZONE_INVALID');
  fail(Number.isInteger(value.maxDelayMinutes), 'SCHEDULED_PUBLICATION_MAX_DELAY_INVALID');
  fail(
    value.maxDelayMinutes >= 5 && value.maxDelayMinutes <= 30,
    'SCHEDULED_PUBLICATION_MAX_DELAY_INVALID',
  );
  fail(Array.isArray(value.items), 'SCHEDULED_PUBLICATION_ITEMS_INVALID');
  if (value.mode === 'CANARY') {
    fail(value.items.length <= 1, 'SCHEDULED_PUBLICATION_CANARY_ITEM_LIMIT');
  }
}

function validateUniqueIdentities(items) {
  for (const field of ['contentItemId', 'commandId', 'correlationId', 'idempotencyKey']) {
    const seen = new Set();
    for (const item of items) {
      const value = item?.[field];
      fail(
        typeof value === 'string' && value.length > 0,
        `SCHEDULED_PUBLICATION_${field.toUpperCase()}_REQUIRED`,
      );
      fail(!seen.has(value), `SCHEDULED_PUBLICATION_DUPLICATE_${field.toUpperCase()}:${value}`);
      seen.add(value);
    }
  }
}

function validateItem(item, mode, currentMs) {
  fail(
    item && typeof item === 'object' && !Array.isArray(item),
    'SCHEDULED_PUBLICATION_ITEM_INVALID',
  );

  const writerIdentityPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
  for (const field of [
    'commandId',
    'contentItemId',
    'assetId',
    'caption',
    'correlationId',
    'idempotencyKey',
    'targetCodeSha',
  ]) {
    fail(
      typeof item[field] === 'string' && item[field].trim().length > 0,
      `SCHEDULED_PUBLICATION_${field.toUpperCase()}_REQUIRED`,
    );
  }
  for (const field of [
    'commandId',
    'contentItemId',
    'assetId',
    'correlationId',
    'idempotencyKey',
  ]) {
    fail(
      writerIdentityPattern.test(item[field]),
      `SCHEDULED_PUBLICATION_${field.toUpperCase()}_INVALID`,
    );
  }
  fail(
    /^[A-Za-z0-9_-]{10,128}$/.test(item.driveFileId),
    'SCHEDULED_PUBLICATION_DRIVE_FILE_ID_INVALID',
  );
  fail(
    /^[a-f0-9]{64}$/.test(item.expectedAssetSha256 ?? ''),
    'SCHEDULED_PUBLICATION_ASSET_SHA_INVALID',
  );
  fail(
    /^[a-f0-9]{40}$/.test(item.targetCodeSha) && !/^0{40}$/.test(item.targetCodeSha),
    'SCHEDULED_PUBLICATION_TARGET_CODE_SHA_INVALID',
  );
  fail(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00$/.test(item.scheduledAt ?? ''),
    'SCHEDULED_PUBLICATION_SCHEDULE_INVALID',
  );
  fail(Number.isFinite(Date.parse(item.scheduledAt)), 'SCHEDULED_PUBLICATION_SCHEDULE_INVALID');
  fail(
    item.operation === 'SUNSET' || item.operation === 'THE_PARTY',
    'SCHEDULED_PUBLICATION_OPERATION_INVALID',
  );
  fail(item.channel === 'INSTAGRAM', 'SCHEDULED_PUBLICATION_CHANNEL_INVALID');
  fail(
    item.format === 'FEED_IMAGE' || item.format === 'STORY_IMAGE',
    'SCHEDULED_PUBLICATION_FORMAT_INVALID',
  );
  fail(item.contentType === 'image/jpeg', 'SCHEDULED_PUBLICATION_CONTENT_TYPE_INVALID');
  fail(item.instagramAccountId === '17841402033495654', 'SCHEDULED_PUBLICATION_ACCOUNT_INVALID');
  fail(item.status === 'SCHEDULED', 'SCHEDULED_PUBLICATION_STATUS_INVALID');
  fail(item.scheduledState === 'SCHEDULED', 'SCHEDULED_PUBLICATION_SCHEDULED_STATE_INVALID');
  fail(item.approvalMode === 'EXPLICIT_APPROVAL', 'SCHEDULED_PUBLICATION_APPROVAL_MODE_INVALID');
  fail(item.approvalStatus === 'APPROVED', 'SCHEDULED_PUBLICATION_NOT_APPROVED');
  fail(
    item.publicationStatus === 'NOT_PUBLISHED',
    'SCHEDULED_PUBLICATION_ALREADY_MARKED_PUBLISHED',
  );
  if (mode === 'CANARY') {
    fail(item.canary === true, 'SCHEDULED_PUBLICATION_CANARY_FLAG_REQUIRED');
  }

  const truth = item.creativeTruthBinding;
  fail(truth && typeof truth === 'object', 'SCHEDULED_PUBLICATION_CREATIVE_TRUTH_REQUIRED');
  fail(
    truth.policyId === 'TOCA_CREATIVE_TRUTH_POLICY_V1',
    'SCHEDULED_PUBLICATION_CREATIVE_POLICY_INVALID',
  );
  fail(nonempty(truth.standardId), 'SCHEDULED_PUBLICATION_CREATIVE_STANDARD_REQUIRED');
  fail(nonempty(truth.creativeId), 'SCHEDULED_PUBLICATION_CREATIVE_ID_REQUIRED');
  fail(
    truth.outputSha256 === item.expectedAssetSha256,
    'SCHEDULED_PUBLICATION_CREATIVE_ASSET_MISMATCH',
  );
  fail(truth.brandIntegrityStatus === 'PASSED', 'SCHEDULED_PUBLICATION_BRAND_GATE_FAILED');
  fail(truth.venueFidelityStatus === 'PASSED', 'SCHEDULED_PUBLICATION_VENUE_GATE_FAILED');
  fail(truth.qualityGateStatus === 'PASSED', 'SCHEDULED_PUBLICATION_QUALITY_GATE_FAILED');
  fail(truth.exactAssetBinding === true, 'SCHEDULED_PUBLICATION_EXACT_ASSET_BINDING_REQUIRED');
  validateCreativeStandardScope(item, truth);

  const rights = item.rightsClearance;
  fail(rights && typeof rights === 'object', 'SCHEDULED_PUBLICATION_RIGHTS_REQUIRED');
  fail(rights.status === 'CLEARED', 'SCHEDULED_PUBLICATION_RIGHTS_NOT_CLEARED');
  fail(
    rights.scope === 'INSTAGRAM_ORGANIC_PUBLICATION',
    'SCHEDULED_PUBLICATION_RIGHTS_SCOPE_INVALID',
  );
  fail(nonempty(rights.evidenceRef), 'SCHEDULED_PUBLICATION_RIGHTS_EVIDENCE_REQUIRED');
  fail(nonempty(rights.authority), 'SCHEDULED_PUBLICATION_RIGHTS_AUTHORITY_REQUIRED');
  fail(
    rights.assetSha256 === item.expectedAssetSha256,
    'SCHEDULED_PUBLICATION_RIGHTS_ASSET_MISMATCH',
  );
  const clearedMs = Date.parse(rights.clearedAt ?? '');
  fail(
    Number.isFinite(clearedMs) && clearedMs <= currentMs,
    'SCHEDULED_PUBLICATION_RIGHTS_TIMESTAMP_INVALID',
  );
  if (rights.expiresAt !== undefined) {
    const expiresMs = Date.parse(rights.expiresAt);
    fail(
      Number.isFinite(expiresMs) && expiresMs > currentMs,
      'SCHEDULED_PUBLICATION_RIGHTS_EXPIRED',
    );
  }

  const snapshot = item.registrySnapshot;
  fail(
    snapshot && typeof snapshot === 'object',
    'SCHEDULED_PUBLICATION_REGISTRY_SNAPSHOT_REQUIRED',
  );
  fail(
    snapshot.sourceTitle === 'TOCA_OS — MARKETING_AUTOPILOT_CONTENT_REGISTRY_v1.0',
    'SCHEDULED_PUBLICATION_REGISTRY_SOURCE_INVALID',
  );
  fail(
    snapshot.spreadsheetId === '1r02HLhmnTijFNkmZv4o1yeZPxCEUMXZC_QreDFB6yTw',
    'SCHEDULED_PUBLICATION_REGISTRY_ID_INVALID',
  );
  fail(snapshot.sheetName === 'CONTENT_ITEMS', 'SCHEDULED_PUBLICATION_REGISTRY_SHEET_INVALID');
  fail(
    Number.isInteger(snapshot.row) && snapshot.row >= 2,
    'SCHEDULED_PUBLICATION_REGISTRY_ROW_INVALID',
  );
  fail(
    snapshot.contentItemId === item.contentItemId,
    'SCHEDULED_PUBLICATION_REGISTRY_ITEM_MISMATCH',
  );
  fail(snapshot.approvalStatus === 'APPROVED', 'SCHEDULED_PUBLICATION_REGISTRY_APPROVAL_INVALID');
  fail(snapshot.scheduledState === 'SCHEDULED', 'SCHEDULED_PUBLICATION_REGISTRY_SCHEDULE_INVALID');
  fail(
    snapshot.publicationStatus === 'NOT_PUBLISHED',
    'SCHEDULED_PUBLICATION_REGISTRY_PUBLICATION_INVALID',
  );
  fail(
    snapshot.scheduledAt === item.scheduledAt,
    'SCHEDULED_PUBLICATION_REGISTRY_SCHEDULE_TIME_MISMATCH',
  );
  fail(
    snapshot.assetSha256 === item.expectedAssetSha256,
    'SCHEDULED_PUBLICATION_REGISTRY_ASSET_MISMATCH',
  );
  fail(
    snapshot.captionSha256 === item.captionSha256,
    'SCHEDULED_PUBLICATION_REGISTRY_CAPTION_MISMATCH',
  );
  fail(
    /^[a-f0-9]{64}$/.test(item.captionSha256 ?? ''),
    'SCHEDULED_PUBLICATION_CAPTION_SHA_INVALID',
  );
  const actualCaptionSha256 = createHash('sha256').update(item.caption).digest('hex');
  fail(actualCaptionSha256 === item.captionSha256, 'SCHEDULED_PUBLICATION_CAPTION_HASH_MISMATCH');
}

function validateCreativeStandardScope(item, truth) {
  const matching = [];
  for (const file of readdirSync(creativeStandardsDirectory)) {
    if (!file.endsWith('.json')) continue;
    let candidate;
    try {
      candidate = JSON.parse(readFileSync(join(creativeStandardsDirectory, file), 'utf8'));
    } catch {
      fail(false, `SCHEDULED_PUBLICATION_CREATIVE_STANDARD_PARSE_FAILED:${file}`);
    }
    if (candidate?.standardId === truth.standardId) matching.push(candidate);
  }
  fail(matching.length === 1, 'SCHEDULED_PUBLICATION_CREATIVE_STANDARD_NOT_CANONICAL');
  const standard = matching[0];
  fail(standard.status === 'ACTIVE_CANONICAL', 'SCHEDULED_PUBLICATION_CREATIVE_STANDARD_INACTIVE');
  fail(
    standard.parentPolicyId === truth.policyId,
    'SCHEDULED_PUBLICATION_CREATIVE_STANDARD_POLICY_MISMATCH',
  );
  fail(
    standard.scope?.operation === item.operation,
    'SCHEDULED_PUBLICATION_CREATIVE_STANDARD_OPERATION_MISMATCH',
  );
  fail(
    standard.scope?.channel === item.channel || standard.scope?.channel === 'ALL',
    'SCHEDULED_PUBLICATION_CREATIVE_STANDARD_CHANNEL_MISMATCH',
  );
  const allowedFormats =
    item.format === 'FEED_IMAGE' ? ['SINGLE_IMAGE', 'ALL'] : ['STORIES', 'ALL'];
  fail(
    allowedFormats.includes(standard.scope?.format),
    'SCHEDULED_PUBLICATION_CREATIVE_STANDARD_FORMAT_MISMATCH',
  );
}

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function toBahiaOffset(epochMs) {
  const shifted = new Date(epochMs - 3 * 60 * 60 * 1000);
  const pad = (value) => String(value).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}-03:00`;
}

function writeSummary(value) {
  writeJson(summaryPath, value);
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function fail(ok, code) {
  if (ok) return;
  console.error(code);
  process.exit(1);
}
