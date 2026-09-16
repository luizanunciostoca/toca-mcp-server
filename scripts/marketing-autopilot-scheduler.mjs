#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const MODE = process.argv[2] ?? 'scan';
const POLICY_PATH =
  process.env.MARKETING_AUTOPILOT_POLICY_PATH ??
  'control/marketing-autopilot-scheduler-policy.json';
const policy = JSON.parse(readFileSync(POLICY_PATH, 'utf8'));
const now = parseNow(process.env.MARKETING_AUTOPILOT_NOW);

assert(policy.schemaVersion === 1, 'AUTOPILOT_POLICY_SCHEMA_INVALID');
assert(policy.lifecycleStatus === 'CANARY', 'AUTOPILOT_POLICY_NOT_CANARY');
assert(policy.generalAutonomy === false, 'AUTOPILOT_GENERAL_AUTONOMY_MUST_BE_FALSE');
assert(policy.timezone === 'America/Bahia', 'AUTOPILOT_TIMEZONE_INVALID');
assert(
  policy.canonicalWriter?.transport === 'gcp-instagram-publish-now',
  'AUTOPILOT_CANONICAL_WRITER_INVALID',
);
assert(
  policy.canonicalWriter?.providerPublicationWriteAuthorized === false,
  'AUTOPILOT_SCHEDULER_PROVIDER_WRITE_MUST_BE_FALSE',
);
assert(policy.rollout?.phase === 'CANARY', 'AUTOPILOT_ROLLOUT_PHASE_INVALID');
assert(policy.rollout?.generalAutonomy !== true, 'AUTOPILOT_ROLLOUT_GENERAL_AUTONOMY_FORBIDDEN');
assert(policy.rollout?.blindRetryAuthorized === false, 'AUTOPILOT_BLIND_RETRY_FORBIDDEN');
assert(policy.rollout?.automaticFallbackAuthorized === false, 'AUTOPILOT_FALLBACK_FORBIDDEN');

const rows = await loadRegistryRows();
const forcedContentItemId = process.env.MARKETING_AUTOPILOT_CONTENT_ITEM_ID?.trim() || null;

if (MODE === 'scan') {
  const leadSeconds = integerFromEnv(
    'MARKETING_AUTOPILOT_SCAN_LEAD_SECONDS',
    policy.schedule.preparationLeadSeconds,
  );
  const decision = selectCandidate(rows, { leadSeconds, forcedContentItemId });
  process.stdout.write(`${JSON.stringify(decision)}\n`);
  process.exit(0);
}

if (MODE === 'build-command') {
  assert(forcedContentItemId, 'AUTOPILOT_CONTENT_ITEM_ID_REQUIRED');
  const item = requireExactItem(rows, forcedContentItemId);
  const validated = validateBoundItem(item, forcedContentItemId);
  assertDue(validated.scheduledAtMs);
  const targetCodeSha = process.env.MARKETING_AUTOPILOT_TARGET_CODE_SHA?.trim() ?? '';
  assert(/^[a-f0-9]{40}$/.test(targetCodeSha), 'AUTOPILOT_TARGET_CODE_SHA_INVALID');
  const command = buildCommand(validated, targetCodeSha);
  process.stdout.write(`${JSON.stringify({ status: 'COMMAND_READY', command })}\n`);
  process.exit(0);
}

if (MODE === 'verify-command') {
  assert(forcedContentItemId, 'AUTOPILOT_CONTENT_ITEM_ID_REQUIRED');
  const item = requireExactItem(rows, forcedContentItemId);
  const validated = validateBoundItem(item, forcedContentItemId);
  assertDue(validated.scheduledAtMs);
  const commandPath =
    process.env.MARKETING_AUTOPILOT_COMMAND_PATH ?? 'control/marketing-publish-now-command.json';
  const command = JSON.parse(readFileSync(commandPath, 'utf8'));
  verifyCommand(command, validated);
  process.stdout.write(
    `${JSON.stringify({ status: 'COMMAND_VERIFIED', contentItemId: forcedContentItemId })}\n`,
  );
  process.exit(0);
}

throw new Error(`AUTOPILOT_MODE_UNSUPPORTED:${MODE}`);

function selectCandidate(registryRows, { leadSeconds, forcedContentItemId: forcedId }) {
  assert(Number.isSafeInteger(leadSeconds) && leadSeconds >= 0, 'AUTOPILOT_SCAN_LEAD_INVALID');
  const allowed = new Set(policy.rollout.allowedContentItemIds ?? []);
  const eligible = [];
  const rejected = [];

  for (const item of registryRows) {
    const id = text(item.content_item_id);
    if (!id || !allowed.has(id)) continue;
    if (forcedId && id !== forcedId) continue;
    try {
      const validated = validateBoundItem(item, id);
      const deltaMs = validated.scheduledAtMs - now.getTime();
      const lateMs = policy.schedule.lateWindowSeconds * 1000;
      if (deltaMs > leadSeconds * 1000) {
        rejected.push({ contentItemId: id, reason: 'NOT_IN_PREPARATION_WINDOW' });
        continue;
      }
      if (deltaMs < -lateMs) {
        rejected.push({ contentItemId: id, reason: 'STALE_WINDOW' });
        continue;
      }
      eligible.push({
        contentItemId: id,
        scheduledAt: validated.scheduledAt,
        waitSeconds: Math.max(0, Math.ceil(deltaMs / 1000)),
        operation: text(item.operation),
        format: text(item.format),
        expectedAssetSha256: validated.binding.outputSha256,
        correlationId: validated.binding.correlationId,
      });
    } catch (error) {
      rejected.push({ contentItemId: id, reason: errorMessage(error) });
    }
  }

  eligible.sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
  assert(
    eligible.length <= policy.schedule.maxCandidatesPerRun,
    'AUTOPILOT_MULTIPLE_CANDIDATES_FAIL_CLOSED',
  );
  if (eligible.length === 0) {
    return { status: 'NO_CANDIDATE', now: formatBahia(now), rejected };
  }
  return { status: 'READY', now: formatBahia(now), candidate: eligible[0], rejected };
}

function requireExactItem(registryRows, contentItemId) {
  const matches = registryRows.filter((row) => text(row.content_item_id) === contentItemId);
  assert(matches.length === 1, `AUTOPILOT_CONTENT_ITEM_CARDINALITY_INVALID:${matches.length}`);
  return matches[0];
}

function validateBoundItem(item, contentItemId) {
  const binding = policy.bindings?.[contentItemId];
  assert(binding, 'AUTOPILOT_EXACT_BINDING_REQUIRED');
  assert(
    (policy.rollout.allowedContentItemIds ?? []).includes(contentItemId),
    'AUTOPILOT_CONTENT_ITEM_NOT_CANARY_AUTHORIZED',
  );

  const required = policy.requiredEligibility;
  assert(
    text(item.status) === required.status,
    `AUTOPILOT_STATUS_NOT_ELIGIBLE:${text(item.status)}`,
  );
  assert(
    text(item.approval_status) === required.approvalStatus,
    `AUTOPILOT_APPROVAL_NOT_APPROVED:${text(item.approval_status)}`,
  );
  assert(
    text(item.approval_mode) === required.approvalMode,
    `AUTOPILOT_APPROVAL_MODE_INVALID:${text(item.approval_mode)}`,
  );
  assert(text(item.channel) === required.channel, 'AUTOPILOT_CHANNEL_INVALID');
  assert(text(item.timezone) === policy.timezone, 'AUTOPILOT_ITEM_TIMEZONE_INVALID');
  assert(blank(item.publication_id), 'AUTOPILOT_PUBLICATION_ID_ALREADY_PRESENT');
  assert(blank(item.provider_external_id), 'AUTOPILOT_PROVIDER_EXTERNAL_ID_ALREADY_PRESENT');
  assert(text(item.operation) === binding.operation, 'AUTOPILOT_OPERATION_BINDING_MISMATCH');
  assert(text(item.format) === binding.format, 'AUTOPILOT_FORMAT_BINDING_MISMATCH');
  assert(text(item.creative_id) === binding.creativeId, 'AUTOPILOT_CREATIVE_BINDING_MISMATCH');
  assert(text(item.copy_id) === binding.copyId, 'AUTOPILOT_COPY_BINDING_MISMATCH');
  assert(text(item.message) === binding.registryMessage, 'AUTOPILOT_MESSAGE_BINDING_MISMATCH');
  assert(text(item.cta) === binding.registryCta, 'AUTOPILOT_CTA_BINDING_MISMATCH');
  assert(text(item.master_asset_id) === binding.masterAssetId, 'AUTOPILOT_MASTER_ASSET_MISMATCH');
  assert(text(item.master_drive_file_id) === binding.driveFileId, 'AUTOPILOT_DRIVE_FILE_MISMATCH');
  assert(text(item.master_status) === required.masterStatus, 'AUTOPILOT_MASTER_STATUS_INVALID');
  assert(
    text(item.creative_truth_policy_id) === required.creativeTruthPolicyId,
    'AUTOPILOT_CREATIVE_TRUTH_POLICY_MISMATCH',
  );
  assert(
    text(item.brand_integrity_status) === required.brandIntegrityStatus,
    'AUTOPILOT_BRAND_INTEGRITY_NOT_PASSED',
  );
  assert(
    text(item.venue_fidelity_status) === required.venueFidelityStatus,
    'AUTOPILOT_VENUE_FIDELITY_NOT_PASSED',
  );
  assert(
    text(item.quality_gate_status) === required.qualityGateStatus,
    'AUTOPILOT_QUALITY_GATE_NOT_PASSED',
  );
  assert(
    text(item.exact_asset_binding).toUpperCase() === required.exactAssetBinding,
    'AUTOPILOT_EXACT_ASSET_BINDING_REQUIRED',
  );
  assert(
    text(item.output_sha256) === binding.outputSha256,
    'AUTOPILOT_OUTPUT_SHA256_BINDING_MISMATCH',
  );
  assert(
    binding.creativeTruthBinding?.outputSha256 === binding.outputSha256 &&
      binding.creativeTruthBinding?.exactAssetBinding === true &&
      binding.creativeTruthBinding?.brandIntegrityStatus === 'PASSED' &&
      binding.creativeTruthBinding?.venueFidelityStatus === 'PASSED' &&
      binding.creativeTruthBinding?.qualityGateStatus === 'PASSED',
    'AUTOPILOT_CREATIVE_TRUTH_BINDING_INVALID',
  );
  assert(
    binding.brandDeterminism?.status === 'VERIFIED' &&
      binding.brandDeterminism?.assetSha256 === binding.outputSha256,
    'AUTOPILOT_BRAND_DETERMINISM_BINDING_INVALID',
  );
  assert(
    binding.rightsClearance?.status === 'CLEARED' &&
      binding.rightsClearance?.scope === 'INSTAGRAM_ORGANIC_PUBLICATION' &&
      binding.rightsClearance?.assetSha256 === binding.outputSha256,
    'AUTOPILOT_RIGHTS_CLEARANCE_BINDING_INVALID',
  );

  const scheduledAt = canonicalScheduledAt(item.scheduled_at);
  const scheduledAtMs = Date.parse(scheduledAt);
  assert(Number.isFinite(scheduledAtMs), 'AUTOPILOT_SCHEDULED_AT_INVALID');
  assert(
    scheduledAtMs === Date.parse(binding.expectedScheduledAt),
    'AUTOPILOT_SCHEDULE_BINDING_MISMATCH',
  );

  return { item, binding, scheduledAt, scheduledAtMs };
}

function assertDue(scheduledAtMs) {
  const deltaMs = scheduledAtMs - now.getTime();
  assert(deltaMs <= 0, 'AUTOPILOT_PUBLICATION_NOT_DUE');
  assert(
    deltaMs >= -policy.schedule.lateWindowSeconds * 1000,
    'AUTOPILOT_PUBLICATION_WINDOW_EXPIRED',
  );
}

function buildCommand(validated, targetCodeSha) {
  const { item, binding, scheduledAt, scheduledAtMs } = validated;
  const contentItemId = text(item.content_item_id);
  const issuedAt = formatBahia(now);
  const expiresAt = formatBahia(new Date(scheduledAtMs + policy.schedule.lateWindowSeconds * 1000));
  const timestampKey = issuedAt.replace(/[-:T]/g, '').replace('-0300', '').replace('-03:00', '');
  const idempotencyKey = `GCP-AUTOPILOT-${contentItemId}-${binding.outputSha256.slice(0, 12)}-${binding.idempotencyVersion}`;

  assert(
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(idempotencyKey),
    'AUTOPILOT_IDEMPOTENCY_KEY_INVALID',
  );

  return {
    schemaVersion: 1,
    commandId: `autopilot-${contentItemId}-${timestampKey}`.slice(0, 128),
    action: 'PUBLISH_NOW',
    issuedAt,
    timezone: policy.timezone,
    scheduledAt,
    orchestrationIntent: 'SCHEDULED_PUBLICATION',
    operation: binding.operation,
    channel: 'INSTAGRAM',
    format: binding.publishNowFormat,
    contentItemId,
    assetId: binding.masterAssetId,
    driveFileId: binding.driveFileId,
    contentType: binding.contentType,
    expectedAssetSha256: binding.outputSha256,
    instagramAccountId: policy.instagramAccountId,
    caption: binding.approvedCaption,
    correlationId: binding.correlationId,
    idempotencyKey,
    targetCodeSha,
    creativeTruthBinding: structuredClone(binding.creativeTruthBinding),
    brandDeterminism: structuredClone(binding.brandDeterminism),
    rightsClearance: structuredClone(binding.rightsClearance),
    approvalMode: 'EXPLICIT_APPROVAL',
    approvalStatus: 'APPROVED',
    publicationIntent: 'SHARE_NOW',
    schedulerBinding: {
      source: 'MARKETING_AUTOPILOT_GCP',
      policyId: policy.policyId,
      rolloutPhase: policy.rollout.phase,
      spreadsheetId: policy.spreadsheetId,
      sheetName: policy.contentSheet,
      scheduledAt,
      notBefore: scheduledAt,
      expiresAt,
      bindingSourceCommit: binding.bindingSource?.commit ?? null,
    },
  };
}

function verifyCommand(command, validated) {
  const { item, binding, scheduledAt, scheduledAtMs } = validated;
  const contentItemId = text(item.content_item_id);
  const expectedIdempotency = `GCP-AUTOPILOT-${contentItemId}-${binding.outputSha256.slice(0, 12)}-${binding.idempotencyVersion}`;
  const targetCodeSha = process.env.MARKETING_AUTOPILOT_TARGET_CODE_SHA?.trim() ?? '';

  assert(command.action === 'PUBLISH_NOW', 'AUTOPILOT_COMMAND_ACTION_INVALID');
  assert(command.contentItemId === contentItemId, 'AUTOPILOT_COMMAND_CONTENT_ITEM_MISMATCH');
  assert(command.scheduledAt === scheduledAt, 'AUTOPILOT_COMMAND_SCHEDULE_MISMATCH');
  assert(command.driveFileId === binding.driveFileId, 'AUTOPILOT_COMMAND_DRIVE_FILE_MISMATCH');
  assert(command.assetId === binding.masterAssetId, 'AUTOPILOT_COMMAND_ASSET_ID_MISMATCH');
  assert(command.expectedAssetSha256 === binding.outputSha256, 'AUTOPILOT_COMMAND_SHA_MISMATCH');
  assert(command.caption === binding.approvedCaption, 'AUTOPILOT_COMMAND_CAPTION_MISMATCH');
  assert(command.correlationId === binding.correlationId, 'AUTOPILOT_COMMAND_CORRELATION_MISMATCH');
  assert(command.idempotencyKey === expectedIdempotency, 'AUTOPILOT_COMMAND_IDEMPOTENCY_MISMATCH');
  assert(
    command.instagramAccountId === policy.instagramAccountId,
    'AUTOPILOT_COMMAND_ACCOUNT_MISMATCH',
  );
  assert(command.targetCodeSha === targetCodeSha, 'AUTOPILOT_COMMAND_TARGET_CODE_SHA_MISMATCH');
  assert(
    deepEqual(command.creativeTruthBinding, binding.creativeTruthBinding),
    'AUTOPILOT_COMMAND_CREATIVE_TRUTH_MISMATCH',
  );
  assert(
    deepEqual(command.brandDeterminism, binding.brandDeterminism),
    'AUTOPILOT_COMMAND_BRAND_MISMATCH',
  );
  assert(
    deepEqual(command.rightsClearance, binding.rightsClearance),
    'AUTOPILOT_COMMAND_RIGHTS_MISMATCH',
  );
  assert(command.approvalMode === 'EXPLICIT_APPROVAL', 'AUTOPILOT_COMMAND_APPROVAL_MODE_INVALID');
  assert(command.approvalStatus === 'APPROVED', 'AUTOPILOT_COMMAND_APPROVAL_STATUS_INVALID');
  assert(command.publicationIntent === 'SHARE_NOW', 'AUTOPILOT_COMMAND_PUBLICATION_INTENT_INVALID');
  assert(
    command.schedulerBinding?.source === 'MARKETING_AUTOPILOT_GCP',
    'AUTOPILOT_SCHEDULER_BINDING_SOURCE_INVALID',
  );
  assert(
    command.schedulerBinding?.policyId === policy.policyId,
    'AUTOPILOT_SCHEDULER_POLICY_BINDING_MISMATCH',
  );
  assert(command.schedulerBinding?.notBefore === scheduledAt, 'AUTOPILOT_NOT_BEFORE_MISMATCH');
  assert(
    Date.parse(command.schedulerBinding?.expiresAt ?? '') ===
      scheduledAtMs + policy.schedule.lateWindowSeconds * 1000,
    'AUTOPILOT_EXPIRES_AT_MISMATCH',
  );

  const issuedAtMs = Date.parse(command.issuedAt ?? '');
  assert(Number.isFinite(issuedAtMs), 'AUTOPILOT_COMMAND_ISSUED_AT_INVALID');
  const ageMs = now.getTime() - issuedAtMs;
  assert(ageMs >= -120_000 && ageMs <= 1_800_000, 'AUTOPILOT_COMMAND_NOT_FRESH');
}

async function loadRegistryRows() {
  const fixture = process.env.MARKETING_AUTOPILOT_REGISTRY_FIXTURE?.trim();
  if (fixture) {
    const parsed = JSON.parse(readFileSync(fixture, 'utf8'));
    assert(Array.isArray(parsed), 'AUTOPILOT_FIXTURE_MUST_BE_ARRAY');
    return parsed;
  }

  const token = process.env.GOOGLE_ACCESS_TOKEN?.trim();
  assert(token, 'GOOGLE_ACCESS_TOKEN_REQUIRED');
  const range = `${policy.contentSheet}!A1:CI1000`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(policy.spreadsheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    throw new Error(`AUTOPILOT_REGISTRY_READ_FAILED:${response.status}`);
  }
  const payload = await response.json();
  const values = Array.isArray(payload.values) ? payload.values : [];
  assert(values.length >= 1, 'AUTOPILOT_REGISTRY_EMPTY');
  const headers = values[0].map((value) => text(value));
  return values
    .slice(1)
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
}

function canonicalScheduledAt(value) {
  const raw = text(value);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?-03:00$/.test(raw)) {
    return raw.replace(/\.\d+-03:00$/, '-03:00');
  }
  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    const serial = Number(raw);
    assert(Number.isFinite(serial), 'AUTOPILOT_SHEETS_SERIAL_INVALID');
    const utc = new Date((serial - 25569) * 86_400_000);
    const yyyy = utc.getUTCFullYear();
    const mm = pad2(utc.getUTCMonth() + 1);
    const dd = pad2(utc.getUTCDate());
    const hh = pad2(utc.getUTCHours());
    const mi = pad2(utc.getUTCMinutes());
    const ss = pad2(utc.getUTCSeconds());
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}-03:00`;
  }
  const parsed = Date.parse(raw);
  assert(Number.isFinite(parsed), 'AUTOPILOT_SCHEDULED_AT_UNPARSABLE');
  return formatBahia(new Date(parsed));
}

function formatBahia(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bahia',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}-03:00`;
}

function parseNow(raw) {
  if (!raw) return new Date();
  const parsed = Date.parse(raw);
  assert(Number.isFinite(parsed), 'AUTOPILOT_NOW_INVALID');
  return new Date(parsed);
}

function integerFromEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  assert(Number.isSafeInteger(parsed), `${name}_INVALID`);
  return parsed;
}

function blank(value) {
  return text(value) === '';
}

function text(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function assert(condition, code) {
  if (condition) return;
  throw new Error(code);
}
