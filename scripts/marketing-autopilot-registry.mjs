#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const MODE = process.argv[2] ?? '';
const POLICY_PATH =
  process.env.MARKETING_AUTOPILOT_POLICY_PATH ??
  'control/marketing-autopilot-scheduler-policy.json';
const policy = JSON.parse(readFileSync(POLICY_PATH, 'utf8'));
const token = process.env.GOOGLE_ACCESS_TOKEN?.trim() ?? '';
const contentItemId = process.env.MARKETING_AUTOPILOT_CONTENT_ITEM_ID?.trim() ?? '';
const evidencePath = 'marketing-autopilot-registry-reconciliation.json';

try {
  assert(token, 'GOOGLE_ACCESS_TOKEN_REQUIRED');
  assert(contentItemId, 'AUTOPILOT_CONTENT_ITEM_ID_REQUIRED');
  assert(policy.schemaVersion === 1, 'AUTOPILOT_POLICY_SCHEMA_INVALID');

  if (MODE === 'record-precheck') {
    await recordPrecheck();
    writeEvidence({ status: 'PRECHECK_RECORDED', contentItemId });
  } else if (MODE === 'reconcile-publication') {
    await reconcilePublication();
  } else {
    throw new Error(`AUTOPILOT_REGISTRY_MODE_UNSUPPORTED:${MODE}`);
  }
} catch (error) {
  writeEvidence({ status: 'RECONCILIATION_REQUIRED', contentItemId, error: errorMessage(error) });
  throw error;
}

async function recordPrecheck() {
  const binding = policy.bindings?.[contentItemId];
  assert(binding, 'AUTOPILOT_EXACT_BINDING_REQUIRED');
  const now = formatBahia(new Date());
  await appendSchedulerLog([
    `AUTOPILOT-PRECHECK-${process.env.GITHUB_RUN_ID ?? 'local'}`,
    now,
    contentItemId,
    process.env.GITHUB_RUN_ID ?? '',
    'GITHUB_ACTIONS_CONTROL_PLANE',
    binding.expectedScheduledAt,
    'PRECHECK',
    'CANARY_READY',
    '0',
    '0',
    '',
    'NOT_CALLED',
    '',
    '',
    `run=${process.env.GITHUB_RUN_ID ?? ''};sha=${process.env.GITHUB_SHA ?? ''};provider_called=false;writer=${policy.canonicalWriter.workflow}`,
    'GCP_PUBLISH_NOW_AUTOPILOT_CANARY',
  ]);
}

async function reconcilePublication() {
  const command = JSON.parse(readFileSync('control/marketing-publish-now-command.json', 'utf8'));
  const publication = JSON.parse(
    readFileSync(requiredPath('MARKETING_AUTOPILOT_PUBLICATION_EVIDENCE'), 'utf8'),
  );
  const reconciliation = JSON.parse(
    readFileSync(requiredPath('MARKETING_AUTOPILOT_RECONCILIATION_EVIDENCE'), 'utf8'),
  );

  assert(command.action === 'PUBLISH_NOW', 'AUTOPILOT_RECONCILE_COMMAND_NOT_PUBLISH_NOW');
  assert(command.contentItemId === contentItemId, 'AUTOPILOT_RECONCILE_CONTENT_ITEM_MISMATCH');
  assert(publication.status === 'PUBLISHED', 'AUTOPILOT_PROVIDER_STATUS_NOT_PUBLISHED');
  assert(text(publication.publicationId), 'AUTOPILOT_PROVIDER_PUBLICATION_ID_REQUIRED');
  assert(
    reconciliation.outcome === 'PUBLISHED_VERIFIED' ||
      reconciliation.outcome === 'PUBLISHED_VERIFIED_AFTER_EXECUTE_ERROR',
    'AUTOPILOT_RECONCILIATION_OUTCOME_NOT_VERIFIED',
  );
  assert(reconciliation.providerReadbackAttempted === true, 'AUTOPILOT_PROVIDER_READBACK_REQUIRED');
  assert(reconciliation.readbackExitCode === 0, 'AUTOPILOT_PROVIDER_READBACK_FAILED');
  assert(
    reconciliation.writeCapabilityDisabledAfterAttempt === true,
    'AUTOPILOT_WRITE_DISABLE_REQUIRED',
  );
  assert(
    reconciliation.finalWriteCapabilityDisabled === true,
    'AUTOPILOT_FINAL_WRITE_DISABLE_REQUIRED',
  );
  assert(
    reconciliation.finalDisableVerificationExitCode === 0,
    'AUTOPILOT_FINAL_WRITE_DISABLE_FAILED',
  );
  assert(
    publication.correlationId === command.correlationId,
    'AUTOPILOT_PROVIDER_CORRELATION_MISMATCH',
  );
  assert(
    publication.idempotencyKey === command.idempotencyKey,
    'AUTOPILOT_PROVIDER_IDEMPOTENCY_MISMATCH',
  );

  const sheet = await readContentSheet();
  const row = findRow(sheet, contentItemId);
  const currentPublicationId = text(row.object.publication_id);
  const currentProviderExternalId = text(row.object.provider_external_id);
  const providerId = text(publication.publicationId);

  if (currentPublicationId || currentProviderExternalId) {
    assert(currentPublicationId === providerId, 'AUTOPILOT_EXISTING_PUBLICATION_ID_CONFLICT');
    assert(currentProviderExternalId === providerId, 'AUTOPILOT_EXISTING_PROVIDER_ID_CONFLICT');
  }

  const updatedAt = formatBahia(new Date());
  const evidenceSummary = [
    `writer_run=${process.env.GITHUB_RUN_ID ?? ''}`,
    `provider_id=${providerId}`,
    `readback=PUBLISHED`,
    `write_disabled=true`,
    `outcome=${reconciliation.outcome}`,
  ].join(';');

  const updates = {
    status: 'PUBLISHED',
    publication_id: providerId,
    provider_external_id: providerId,
    execution_id: `GH-${process.env.GITHUB_RUN_ID ?? 'UNKNOWN'}`,
    correlation_id: command.correlationId,
    last_error: '',
    updated_at: updatedAt,
    command_id: command.commandId,
    permalink: text(publication.permalink),
    prepared_request_sha256: text(reconciliation.approvedRequestSha256),
    production_idempotency_key: command.idempotencyKey,
    registry_revision: `MKTREG-GCP-${process.env.GITHUB_RUN_ID ?? 'UNKNOWN'}`,
    decision_reason: 'GCP_AUTOPILOT_PUBLISHED_VERIFIED',
    scheduled_run_id: process.env.GITHUB_RUN_ID ?? '',
    scheduling_mode: 'GCP_AUTOPILOT',
    scheduling_status: 'PUBLISHED_VERIFIED',
    scheduling_evidence: evidenceSummary,
    scheduling_policy: 'GCP_PUBLISH_NOW_AUTOPILOT_CANARY',
    publication_intent: 'SHARE_NOW',
    toca_scheduled_at: command.scheduledAt,
    scheduler_backend: 'GITHUB_ACTIONS_CONTROL_PLANE',
    provider_status: 'PUBLISHED',
  };

  await batchUpdateRow(sheet, row.rowNumber, updates);
  await appendSchedulerLog([
    `AUTOPILOT-PUBLISH-${process.env.GITHUB_RUN_ID ?? 'local'}`,
    updatedAt,
    contentItemId,
    process.env.GITHUB_RUN_ID ?? '',
    'GITHUB_ACTIONS_CONTROL_PLANE',
    command.scheduledAt,
    'APPROVED',
    'PUBLISHED',
    '1',
    '0',
    '',
    'PUBLISHED',
    providerId,
    text(publication.permalink),
    evidenceSummary,
    'GCP_PUBLISH_NOW_AUTOPILOT_CANARY',
  ]);

  const readbackSheet = await readContentSheet();
  const readback = findRow(readbackSheet, contentItemId).object;
  assert(text(readback.status) === 'PUBLISHED', 'AUTOPILOT_REGISTRY_STATUS_READBACK_FAILED');
  assert(
    text(readback.publication_id) === providerId,
    'AUTOPILOT_REGISTRY_PUBLICATION_ID_READBACK_FAILED',
  );
  assert(
    text(readback.provider_external_id) === providerId,
    'AUTOPILOT_REGISTRY_PROVIDER_ID_READBACK_FAILED',
  );
  assert(
    text(readback.provider_status) === 'PUBLISHED',
    'AUTOPILOT_REGISTRY_PROVIDER_STATUS_READBACK_FAILED',
  );

  writeEvidence({
    status: 'PUBLISHED_RECONCILED',
    contentItemId,
    providerPublicationId: providerId,
    providerPermalink: text(publication.permalink),
    providerReadback: 'PUBLISHED',
    finalWriteCapabilityDisabled: true,
    updatedAt,
  });
}

async function readContentSheet() {
  const range = `${policy.contentSheet}!A1:CI1000`;
  const payload = await sheetsRequest(
    `values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`,
    { method: 'GET' },
  );
  const values = Array.isArray(payload.values) ? payload.values : [];
  assert(values.length >= 1, 'AUTOPILOT_REGISTRY_EMPTY');
  const headers = values[0].map((value) => text(value));
  return {
    headers,
    rows: values.slice(1).map((valuesRow, index) => ({
      rowNumber: index + 2,
      object: Object.fromEntries(
        headers.map((header, column) => [header, valuesRow[column] ?? '']),
      ),
    })),
  };
}

function findRow(sheet, id) {
  const matches = sheet.rows.filter((entry) => text(entry.object.content_item_id) === id);
  assert(matches.length === 1, `AUTOPILOT_CONTENT_ITEM_CARDINALITY_INVALID:${matches.length}`);
  return matches[0];
}

async function batchUpdateRow(sheet, rowNumber, updates) {
  const data = [];
  for (const [header, value] of Object.entries(updates)) {
    const index = sheet.headers.indexOf(header);
    assert(index >= 0, `AUTOPILOT_REGISTRY_HEADER_MISSING:${header}`);
    const column = columnLetter(index + 1);
    data.push({ range: `${policy.contentSheet}!${column}${rowNumber}`, values: [[value]] });
  }
  await sheetsRequest('values:batchUpdate', {
    method: 'POST',
    body: JSON.stringify({ valueInputOption: 'RAW', data }),
  });
}

async function appendSchedulerLog(row) {
  const range = `${policy.schedulerExecutionLogSheet}!A:P`;
  await sheetsRequest(
    `values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: [row] }) },
  );
}

async function sheetsRequest(path, init) {
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(policy.spreadsheetId)}/${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    },
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`AUTOPILOT_SHEETS_WRITE_FAILED:${response.status}:${body.slice(0, 300)}`);
  }
  return body ? JSON.parse(body) : {};
}

function requiredPath(name) {
  const value = process.env[name]?.trim();
  assert(value, `${name}_REQUIRED`);
  return value;
}

function columnLetter(columnNumber) {
  let n = columnNumber;
  let result = '';
  while (n > 0) {
    n -= 1;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

function writeEvidence(payload) {
  writeFileSync(
    evidencePath,
    `${JSON.stringify({ ...payload, policyId: policy.policyId }, null, 2)}\n`,
    'utf8',
  );
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

function text(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function assert(condition, code) {
  if (condition) return;
  throw new Error(code);
}
