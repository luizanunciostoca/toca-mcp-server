#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const service = 'toca-webhook-next-production';
const project = 'toca-mcp-production';
const region = 'southamerica-east1';
const approvedTokens = [
  'META_WEBHOOK_VERIFY_TOKEN_REFERENCE_MISSING',
  'META_WEBHOOK_DERIVED_VERIFY_TOKEN_REQUIRES_ENV_APP_SECRET',
  'META_APP_SECRET_KEY_REQUIRED',
  'META_APP_SECRET_REFERENCE_MISSING',
  'READINESS_DATABASE_URL_REQUIRED',
  'READINESS_DATABASE_POOL_UNAVAILABLE',
  'READINESS_MIGRATIONS_PENDING',
  'READINESS_SCHEMA_MISSING',
  'EFFECTIVE_AUTONOMY_POLICY_NOT_FOUND',
  'CAPABILITY_VALIDATION_EVIDENCE_MANIFEST_NOT_FOUND',
  'CAPABILITY_EVIDENCE_MANIFEST_EXACT_HEAD_MISMATCH',
  'CAPABILITY_EVIDENCE_EXPIRED',
  'ERR_MODULE_NOT_FOUND',
  'EADDRINUSE',
  'EACCES',
];
const signalPatterns = [
  ['PERSISTENCE_SCHEMA', /relation .* does not exist|undefined table|migration.*missing/i],
  [
    'DEPENDENCY_CONNECTIVITY',
    /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|connection refused|connection timed out/i,
  ],
  ['PERMISSION', /permission denied|PERMISSION_DENIED/i],
  ['MODULE_LOAD', /Cannot find module|ERR_MODULE_NOT_FOUND|module not found/i],
  ['CONTAINER_STARTUP', /failed to start and listen|startup probe/i],
  ['CONFIG_VALIDATION', /ZodError|Invalid input|configuration/i],
  ['HTTP_HANDLER', /HTTP request failed/i],
];

export function validateWebhookServiceUrl(value) {
  const invalid = () => {
    throw new Error('WEBHOOK_DIAGNOSTIC_URL_INVALID');
  };
  if (typeof value !== 'string' || /[\s\\]/.test(value)) return invalid();
  let url;
  try {
    url = new URL(value);
  } catch {
    return invalid();
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !url.hostname.startsWith(service + '-') ||
    !url.hostname.endsWith('.run.app') ||
    !/^[a-z0-9.-]+$/.test(url.hostname)
  )
    return invalid();
  return url.origin;
}

export function summarizeWebhookRuntimeLogs(entries, { revision, since, until }) {
  if (!Array.isArray(entries) || entries.length > 200) {
    throw new Error('WEBHOOK_DIAGNOSTIC_LOG_ARRAY_LIMIT');
  }
  if (
    typeof revision !== 'string' ||
    revision.length > 63 ||
    !new RegExp(`^${service}-[a-z0-9]+(?:-[a-z0-9]+)*$`).test(revision)
  ) {
    throw new Error('WEBHOOK_DIAGNOSTIC_REVISION_INVALID');
  }
  const start = Date.parse(since);
  const end = Date.parse(until);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 7_200_000) {
    throw new Error('WEBHOOK_DIAGNOSTIC_WINDOW_INVALID');
  }
  const httpStatusCounts = {};
  const tokens = new Set();
  const signals = new Set();
  let matchedEntries = 0;
  for (const entry of entries) {
    const labels = entry?.resource?.labels;
    const timestamp = Date.parse(entry?.timestamp);
    if (
      entry?.resource?.type !== 'cloud_run_revision' ||
      labels?.project_id !== project ||
      labels?.location !== region ||
      labels?.service_name !== service ||
      labels?.revision_name !== revision ||
      !Number.isFinite(timestamp) ||
      timestamp < start ||
      timestamp > end
    )
      continue;
    matchedEntries++;
    const status = entry?.httpRequest?.status;
    if (Number.isInteger(status) && status >= 100 && status <= 599) {
      httpStatusCounts[status] = (httpStatusCounts[status] ?? 0) + 1;
    }
    // Inspect only server message/error fields. Never return arbitrary log strings,
    // request URLs, headers, identities, exception messages or customer payloads.
    const message = [
      entry.textPayload,
      entry.jsonPayload?.message,
      entry.jsonPayload?.errorCode,
      entry.jsonPayload?.event,
    ]
      .filter((value) => typeof value === 'string')
      .join('\n');
    for (const token of approvedTokens) {
      if (new RegExp(`(?:^|[^A-Z0-9_])${token}(?:$|[^A-Z0-9_])`).test(message)) tokens.add(token);
    }
    for (const [name, pattern] of signalPatterns) {
      if (pattern.test(message)) signals.add(name);
    }
  }
  const httpErrors = Object.entries(httpStatusCounts).some(([status]) => Number(status) >= 500);
  return {
    schemaVersion: 1,
    classification:
      matchedEntries === 0
        ? 'INSUFFICIENT_CURRENT_LOG_EVIDENCE'
        : tokens.size || signals.size || httpErrors
          ? 'RUNTIME_ERROR_SIGNALS_OBSERVED'
          : 'NO_ERROR_SIGNAL_IN_BOUNDED_SAMPLE',
    matchedEntries,
    excludedEntries: entries.length - matchedEntries,
    sampleLimitReached: entries.length === 200,
    httpStatusCounts,
    approvedErrorTokens: [...tokens].sort(),
    errorSignals: [...signals].sort(),
    rootCause: 'NOT_PROVEN_BY_LOG_CLASSIFICATION',
    runtimeHealth: 'NOT_PROVEN_BY_LOG_CLASSIFICATION',
    rawLogPayloadPublished: false,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 6) throw new Error('WEBHOOK_DIAGNOSTIC_ARGUMENTS_INVALID');
    const [, , file, revision, since, until] = process.argv;
    process.stdout.write(
      JSON.stringify(
        summarizeWebhookRuntimeLogs(JSON.parse(readFileSync(file, 'utf8')), {
          revision,
          since,
          until,
        }),
      ) + '\n',
    );
  } catch {
    // JSON parser and filesystem errors can contain fragments of sensitive input.
    process.stderr.write('WEBHOOK_DIAGNOSTIC_INPUT_REJECTED\n');
    process.exitCode = 1;
  }
}
