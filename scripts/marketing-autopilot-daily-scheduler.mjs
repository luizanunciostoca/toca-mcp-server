#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { hashRegistrySnapshot } from './marketing-autopilot-registry-binding.mjs';

const MODE = process.argv[2] ?? 'scan';
const POLICY_PATH =
  process.env.MARKETING_AUTOPILOT_POLICY_PATH ??
  'control/marketing-autopilot-scheduler-policy.json';
const policy = JSON.parse(readFileSync(POLICY_PATH, 'utf8'));
const now = parseNow(process.env.MARKETING_AUTOPILOT_NOW);

validatePolicy();

const rows = await loadRegistryRows();
const rollout = resolveRollout(rows);
const forcedContentItemId = process.env.MARKETING_AUTOPILOT_CONTENT_ITEM_ID?.trim() || null;

if (MODE === 'scan') {
  const leadSeconds = integerFromEnv(
    'MARKETING_AUTOPILOT_SCAN_LEAD_SECONDS',
    policy.schedule.preparationLeadSeconds,
  );
  const decision = selectCandidate(rows, rollout, { leadSeconds, forcedContentItemId });
  process.stdout.write(`${JSON.stringify(decision)}\n`);
  process.exit(0);
}

if (MODE === 'build-command') {
  assert(forcedContentItemId, 'AUTOPILOT_CONTENT_ITEM_ID_REQUIRED');
  const item = requireExactItem(rows, forcedContentItemId);
  assertAuthorizedByRollout(item, rollout);
  const validated = validateItem(item);
  assertDue(validated.scheduledAtMs);
  const targetCodeSha = process.env.MARKETING_AUTOPILOT_TARGET_CODE_SHA?.trim() ?? '';
  assert(/^[a-f0-9]{40}$/.test(targetCodeSha), 'AUTOPILOT_TARGET_CODE_SHA_INVALID');
  const command = buildCommand(validated, targetCodeSha, rollout.phase);
  process.stdout.write(`${JSON.stringify({ status: 'COMMAND_READY', rolloutPhase: rollout.phase, command })}\n`);
  process.exit(0);
}

if (MODE === 'verify-command') {
  assert(forcedContentItemId, 'AUTOPILOT_CONTENT_ITEM_ID_REQUIRED');
  const item = requireExactItem(rows, forcedContentItemId);
  assertAuthorizedByRollout(item, rollout);
  const validated = validateItem(item);
  assertDue(validated.scheduledAtMs);
  const commandPath =
    process.env.MARKETING_AUTOPILOT_COMMAND_PATH ?? 'control/marketing-publish-now-command.json';
  const command = JSON.parse(readFileSync(commandPath, 'utf8'));
  verifyCommand(command, validated, rollout.phase);
  process.stdout.write(
    `${JSON.stringify({ status: 'COMMAND_VERIFIED', rolloutPhase: rollout.phase, contentItemId: forcedContentItemId })}\n`,
  );
  process.exit(0);
}

throw new Error(`AUTOPILOT_MODE_UNSUPPORTED:${MODE}`);

function validatePolicy() {
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
  assert(
    policy.canonicalWriter?.durableCommandRequiredState === 'NOOP',
    'AUTOPILOT_DURABLE_COMMAND_POLICY_MUST_BE_NOOP',
  );
  assert(
    policy.canonicalWriter?.ephemeralCommandAllowed === true,
    'AUTOPILOT_EPHEMERAL_COMMAND_MUST_BE_ALLOWED',
  );
  assert(
    policy.schedulerAuthority?.providerPublicationWriteAuthorized === false,
    'AUTOPILOT_SCHEDULER_DIRECT_PROVIDER_WRITE_FORBIDDEN',
  );
  assert(
    policy.schedulerAuthority?.metaCredentialAccessAuthorized === false,
    'AUTOPILOT_SCHEDULER_META_CREDENTIAL_ACCESS_FORBIDDEN',
  );
  assert(
    policy.schedulerAuthority?.directCloudRunPublicationAuthorized === false,
    'AUTOPILOT_SCHEDULER_DIRECT_CLOUD_RUN_FORBIDDEN',
  );
  assert(
    policy.schedulerAuthority?.manualAutopilotAuthorized === false,
    'AUTOPILOT_MANUAL_AUTOPILOT_FORBIDDEN',
  );
  assert(policy.dailyRollout?.phase === 'CANARY', 'AUTOPILOT_DAILY_ROLLOUT_PHASE_INVALID');
  assert(
    policy.dailyRollout?.promoteToLimitedAfterVerifiedCanary === true,
    'AUTOPILOT_LIMITED_PROMOTION_POLICY_REQUIRED',
  );
  assert(
    policy.dailyRollout?.generalAutonomy === false &&
      policy.dailyRollout?.limited?.generalAutonomy === false,
    'AUTOPILOT_DAILY_GENERAL_AUTONOMY_FORBIDDEN',
  );
  assert(policy.dailyRollout?.blindRetryAuthorized === false, 'AUTOPILOT_BLIND_RETRY_FORBIDDEN');
  assert(
    policy.dailyRollout?.automaticFallbackAuthorized === false,
    'AUTOPILOT_AUTOMATIC_FALLBACK_FORBIDDEN',
  );
  assert(policy.standingAuthorization?.enabled === true, 'AUTOPILOT_STANDING_AUTHORIZATION_REQUIRED');
  assert(
    policy.standingAuthorization?.allowCopyMutation === false &&
      policy.standingAuthorization?.allowAssetMutation === false,
    'AUTOPILOT_CONTENT_MUTATION_MUST_BE_FORBIDDEN',
  );
}

function resolveRollout(registryRows) {
  const canaryId = text(policy.dailyRollout.canaryContentItemId);
  assert(canaryId, 'AUTOPILOT_CANARY_CONTENT_ITEM_REQUIRED');
  const canary = requireExactItem(registryRows, canaryId);
  const verified = isVerifiedCanary(canary);
  return {
    phase: verified ? 'LIMITED' : 'CANARY',
    canaryId,
    canaryVerified: verified,
  };
}

function isVerifiedCanary(item) {
  const expectedStatus = text(policy.dailyRollout.verifiedCanarySchedulingStatus);
  return (
    text(item.status) === 'PUBLISHED' &&
    text(item.publication_id).length > 0 &&
    text(item.provider_external_id).length > 0 &&
    text(item.provider_status) === 'PUBLISHED' &&
    text(item.scheduling_status) === expectedStatus &&
    text(item.scheduling_policy) === policy.policyId
  );
}

function selectCandidate(registryRows, rolloutState, { leadSeconds, forcedContentItemId: forcedId }) {
  assert(Number.isSafeInteger(leadSeconds) && leadSeconds >= 0, 'AUTOPILOT_SCAN_LEAD_INVALID');
  const eligible = [];
  const rejected = [];

  for (const item of registryRows) {
    const id = text(item.content_item_id);
    if (!id) continue;
    if (forcedId && id !== forcedId) continue;
    if (!isAuthorizedByRollout(item, rolloutState)) continue;
    try {
      const validated = validateItem(item);
      const deltaMs = validated.scheduledAtMs - now.getTime();
      const lateMs = policy.schedule.lateWindowSeconds * 1000;
      if (deltaMs > leadSeconds * 1000) continue;
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
        expectedAssetSha256: validated.outputSha256,
        correlationId: validated.correlationId,
        registrySnapshotSha256: validated.registrySnapshotSha256,
        rolloutPhase: rolloutState.phase,
      });
    } catch (error) {
      rejected.push({ contentItemId: id, reason: errorMessage(error) });
    }
  }

  eligible.sort((left, right) => Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt));
  const maximum =
    rolloutState.phase === 'CANARY'
      ? 1
      : Number(policy.dailyRollout.limited.maxCandidatesPerRun ?? policy.schedule.maxCandidatesPerRun);
  assert(eligible.length <= maximum, 'AUTOPILOT_MULTIPLE_CANDIDATES_FAIL_CLOSED');
  if (eligible.length === 0) {
    return {
      status: 'NO_CANDIDATE',
      now: formatBahia(now),
      rolloutPhase: rolloutState.phase,
      canaryVerified: rolloutState.canaryVerified,
      rejected,
    };
  }
  return {
    status: 'READY',
    now: formatBahia(now),
    rolloutPhase: rolloutState.phase,
    canaryVerified: rolloutState.canaryVerified,
    candidate: eligible[0],
    rejected,
  };
}

function isAuthorizedByRollout(item, rolloutState) {
  const id = text(item.content_item_id);
  if (rolloutState.phase === 'CANARY') return id === rolloutState.canaryId;

  const limited = policy.dailyRollout.limited;
  return (
    (limited.allowedOperations ?? []).includes(text(item.operation)) &&
    (limited.allowedFormats ?? []).includes(text(item.format)) &&
    text(item.channel) === text(limited.allowedChannel)
  );
}

function assertAuthorizedByRollout(item, rolloutState) {
  assert(isAuthorizedByRollout(item, rolloutState), 'AUTOPILOT_CONTENT_ITEM_NOT_ROLLOUT_AUTHORIZED');
}

function requireExactItem(registryRows, contentItemId) {
  const matches = registryRows.filter((row) => text(row.content_item_id) === contentItemId);
  assert(matches.length === 1, `AUTOPILOT_CONTENT_ITEM_CARDINALITY_INVALID:${matches.length}`);
  return matches[0];
}

function validateItem(item) {
  const required = policy.requiredEligibility;
  const format = text(item.format);

  assert(text(item.status) === required.status, `AUTOPILOT_STATUS_NOT_ELIGIBLE:${text(item.status)}`);
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
  assert(text(item.operation).length > 0, 'AUTOPILOT_OPERATION_REQUIRED');
  assert(format === 'FEED' || format === 'STORY', 'AUTOPILOT_FORMAT_UNSUPPORTED');
  assert(text(item.message).length > 0, 'AUTOPILOT_MESSAGE_REQUIRED');
  assert(text(item.cta).length > 0, 'AUTOPILOT_CTA_REQUIRED');
  assert(text(item.correlation_id).length > 0, 'AUTOPILOT_CORRELATION_REQUIRED');

  const delivery = resolveDelivery(item, format, required);
  const expectedQuality =
    format === 'STORY' ? required.storyQualityGateStatus : required.feedQualityGateStatus;
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
    text(item.quality_gate_status) === expectedQuality,
    `AUTOPILOT_QUALITY_GATE_NOT_PASSED:${text(item.quality_gate_status)}`,
  );
  assert(
    text(item.exact_asset_binding).toUpperCase() === required.exactAssetBinding,
    'AUTOPILOT_EXACT_ASSET_BINDING_REQUIRED',
  );

  const outputSha256 = text(item.output_sha256);
  assert(/^[a-f0-9]{64}$/.test(outputSha256), 'AUTOPILOT_OUTPUT_SHA256_INVALID');
  const standardId = text(item.creative_standard_id);
  const standardVersion = text(item.creative_standard_version);
  assert(standardId.length > 0, 'AUTOPILOT_CREATIVE_STANDARD_REQUIRED');
  assert(standardVersion.length > 0, 'AUTOPILOT_CREATIVE_STANDARD_VERSION_REQUIRED');

  const scheduledAt = canonicalScheduledAt(item.scheduled_at);
  const scheduledAtMs = Date.parse(scheduledAt);
  assert(Number.isFinite(scheduledAtMs), 'AUTOPILOT_SCHEDULED_AT_INVALID');
  const registrySnapshotSha256 = hashRegistrySnapshot(item);
  assert(/^[a-f0-9]{64}$/.test(registrySnapshotSha256), 'AUTOPILOT_REGISTRY_SNAPSHOT_HASH_INVALID');

  const creativeId = text(item.creative_id) || delivery.assetId;
  const caption = `${text(item.message)}\n\n${text(item.cta)}`;
  const correlationId = text(item.correlation_id);

  return {
    item,
    format,
    scheduledAt,
    scheduledAtMs,
    registrySnapshotSha256,
    delivery,
    outputSha256,
    creativeId,
    caption,
    correlationId,
    creativeTruthBinding: {
      policyId: required.creativeTruthPolicyId,
      standardId,
      creativeId,
      outputSha256,
      brandIntegrityStatus: required.brandIntegrityStatus,
      venueFidelityStatus: required.venueFidelityStatus,
      qualityGateStatus: expectedQuality,
      exactAssetBinding: true,
    },
    brandDeterminism: {
      status: 'VERIFIED',
      standardRef: `TOCA_CREATIVE_TRUTH:${standardId}:${standardVersion}`,
      typographyRef: text(item.brand_asset_id) || 'EDITORIAL_TEXT_V1',
      assetSha256: outputSha256,
    },
    rightsClearance: {
      status: 'CLEARED',
      scope: policy.standingAuthorization.rightsScope,
      evidenceRef: `GOOGLE_DRIVE:${delivery.driveFileId}`,
      authority: policy.standingAuthorization.authority,
      clearedAt: policy.standingAuthorization.grantedAt,
      assetSha256: outputSha256,
    },
  };
}

function resolveDelivery(item, format, required) {
  if (format === 'FEED') {
    const assetId = text(item.master_asset_id);
    const driveFileId = text(item.master_drive_file_id);
    assert(assetId.length > 0, 'AUTOPILOT_MASTER_ASSET_REQUIRED');
    assert(driveFileId.length > 0, 'AUTOPILOT_MASTER_DRIVE_FILE_REQUIRED');
    assert(text(item.master_status) === required.masterStatus, 'AUTOPILOT_MASTER_STATUS_INVALID');
    return { assetId, driveFileId, publishNowFormat: 'FEED_IMAGE', contentType: 'image/jpeg' };
  }

  const assetId = text(item.story_creative_id);
  const driveFileId = text(item.story_drive_file_id);
  assert(assetId.length > 0, 'AUTOPILOT_STORY_CREATIVE_REQUIRED');
  assert(driveFileId.length > 0, 'AUTOPILOT_STORY_DRIVE_FILE_REQUIRED');
  assert(text(item.story_status) === required.storyStatus, 'AUTOPILOT_STORY_STATUS_INVALID');
  return { assetId, driveFileId, publishNowFormat: 'STORY_IMAGE', contentType: 'image/jpeg' };
}

function assertDue(scheduledAtMs) {
  const deltaMs = scheduledAtMs - now.getTime();
  assert(deltaMs <= 0, 'AUTOPILOT_PUBLICATION_NOT_DUE');
  assert(
    deltaMs >= -policy.schedule.lateWindowSeconds * 1000,
    'AUTOPILOT_PUBLICATION_WINDOW_EXPIRED',
  );
}

function buildCommand(validated, targetCodeSha, rolloutPhase) {
  const issuedAt = formatBahia(now);
  const expiresAt = formatBahia(
    new Date(validated.scheduledAtMs + policy.schedule.lateWindowSeconds * 1000),
  );
  const contentItemId = text(validated.item.content_item_id);
  const timestampKey = issuedAt.replace(/[-:T]/g, '').replace('-03:00', '');
  const idempotencyKey = `GCP-AUTOPILOT-${contentItemId}-${validated.outputSha256.slice(0, 12)}-V1`;
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
    scheduledAt: validated.scheduledAt,
    orchestrationIntent: 'SCHEDULED_PUBLICATION',
    operation: text(validated.item.operation),
    channel: 'INSTAGRAM',
    format: validated.delivery.publishNowFormat,
    contentItemId,
    assetId: validated.delivery.assetId,
    driveFileId: validated.delivery.driveFileId,
    contentType: validated.delivery.contentType,
    expectedAssetSha256: validated.outputSha256,
    instagramAccountId: policy.instagramAccountId,
    caption: validated.caption,
    correlationId: validated.correlationId,
    idempotencyKey,
    targetCodeSha,
    creativeTruthBinding: structuredClone(validated.creativeTruthBinding),
    brandDeterminism: structuredClone(validated.brandDeterminism),
    rightsClearance: structuredClone(validated.rightsClearance),
    approvalMode: 'EXPLICIT_APPROVAL',
    approvalStatus: 'APPROVED',
    publicationIntent: 'SHARE_NOW',
    schedulerBinding: {
      source: 'MARKETING_AUTOPILOT_GCP',
      policyId: policy.policyId,
      rolloutPhase,
      spreadsheetId: policy.spreadsheetId,
      sheetName: policy.contentSheet,
      scheduledAt: validated.scheduledAt,
      notBefore: validated.scheduledAt,
      expiresAt,
      registrySnapshotSha256: validated.registrySnapshotSha256,
      registryRevision: text(validated.item.registry_revision),
      approvalAuthority: policy.standingAuthorization.authority,
    },
  };
}

function verifyCommand(command, validated, rolloutPhase) {
  const contentItemId = text(validated.item.content_item_id);
  const expectedIdempotency = `GCP-AUTOPILOT-${contentItemId}-${validated.outputSha256.slice(0, 12)}-V1`;
  const targetCodeSha = process.env.MARKETING_AUTOPILOT_TARGET_CODE_SHA?.trim() ?? '';

  assert(command.action === 'PUBLISH_NOW', 'AUTOPILOT_COMMAND_ACTION_INVALID');
  assert(command.contentItemId === contentItemId, 'AUTOPILOT_COMMAND_CONTENT_ITEM_MISMATCH');
  assert(command.scheduledAt === validated.scheduledAt, 'AUTOPILOT_COMMAND_SCHEDULE_MISMATCH');
  assert(command.driveFileId === validated.delivery.driveFileId, 'AUTOPILOT_COMMAND_DRIVE_FILE_MISMATCH');
  assert(command.assetId === validated.delivery.assetId, 'AUTOPILOT_COMMAND_ASSET_ID_MISMATCH');
  assert(command.expectedAssetSha256 === validated.outputSha256, 'AUTOPILOT_COMMAND_SHA_MISMATCH');
  assert(command.caption === validated.caption, 'AUTOPILOT_COMMAND_CAPTION_MISMATCH');
  assert(command.correlationId === validated.correlationId, 'AUTOPILOT_COMMAND_CORRELATION_MISMATCH');
  assert(command.idempotencyKey === expectedIdempotency, 'AUTOPILOT_COMMAND_IDEMPOTENCY_MISMATCH');
  assert(command.instagramAccountId === policy.instagramAccountId, 'AUTOPILOT_COMMAND_ACCOUNT_MISMATCH');
  assert(command.targetCodeSha === targetCodeSha, 'AUTOPILOT_COMMAND_TARGET_CODE_SHA_MISMATCH');
  assert(deepEqual(command.creativeTruthBinding, validated.creativeTruthBinding), 'AUTOPILOT_COMMAND_CREATIVE_TRUTH_MISMATCH');
  assert(deepEqual(command.brandDeterminism, validated.brandDeterminism), 'AUTOPILOT_COMMAND_BRAND_MISMATCH');
  assert(deepEqual(command.rightsClearance, validated.rightsClearance), 'AUTOPILOT_COMMAND_RIGHTS_MISMATCH');
  assert(command.approvalMode === 'EXPLICIT_APPROVAL', 'AUTOPILOT_COMMAND_APPROVAL_MODE_INVALID');
  assert(command.approvalStatus === 'APPROVED', 'AUTOPILOT_COMMAND_APPROVAL_STATUS_INVALID');
  assert(command.publicationIntent === 'SHARE_NOW', 'AUTOPILOT_COMMAND_PUBLICATION_INTENT_INVALID');
  assert(command.schedulerBinding?.source === 'MARKETING_AUTOPILOT_GCP', 'AUTOPILOT_SCHEDULER_BINDING_SOURCE_INVALID');
  assert(command.schedulerBinding?.policyId === policy.policyId, 'AUTOPILOT_SCHEDULER_POLICY_BINDING_MISMATCH');
  assert(command.schedulerBinding?.rolloutPhase === rolloutPhase, 'AUTOPILOT_ROLLOUT_BINDING_MISMATCH');
  assert(command.schedulerBinding?.notBefore === validated.scheduledAt, 'AUTOPILOT_NOT_BEFORE_MISMATCH');
  assert(
    command.schedulerBinding?.registrySnapshotSha256 === validated.registrySnapshotSha256,
    'AUTOPILOT_REGISTRY_SNAPSHOT_MISMATCH',
  );
  assert(
    Date.parse(command.schedulerBinding?.expiresAt ?? '') ===
      validated.scheduledAtMs + policy.schedule.lateWindowSeconds * 1000,
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
  if (!response.ok) throw new Error(`AUTOPILOT_REGISTRY_READ_FAILED:${response.status}`);
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
    return `${utc.getUTCFullYear()}-${pad2(utc.getUTCMonth() + 1)}-${pad2(utc.getUTCDate())}T${pad2(utc.getUTCHours())}:${pad2(utc.getUTCMinutes())}:${pad2(utc.getUTCSeconds())}-03:00`;
  }
  const isoWallClock = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (isoWallClock) {
    const [, yyyy, mm, dd, hh, mi, ss = '00'] = isoWallClock;
    return assertBahiaWallClock(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}-03:00`);
  }
  const brWallClock = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (brWallClock) {
    const [, dd, mm, yyyy, hh, mi, ss = '00'] = brWallClock;
    return assertBahiaWallClock(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}-03:00`);
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) {
    const parsed = Date.parse(raw);
    assert(Number.isFinite(parsed), 'AUTOPILOT_SCHEDULED_AT_UNPARSABLE');
    return formatBahia(new Date(parsed));
  }
  throw new Error('AUTOPILOT_SCHEDULED_AT_UNPARSABLE');
}

function assertBahiaWallClock(value) {
  const parsed = Date.parse(value);
  assert(Number.isFinite(parsed), 'AUTOPILOT_SCHEDULED_AT_UNPARSABLE');
  const canonical = formatBahia(new Date(parsed));
  assert(canonical === value, 'AUTOPILOT_SCHEDULED_AT_WALL_CLOCK_INVALID');
  return value;
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
  if (!raw) return Number(fallback);
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
