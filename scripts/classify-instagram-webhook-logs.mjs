import { readFileSync } from 'node:fs';

const [filePath, expectedRevision] = process.argv.slice(2);
if (!filePath || !/^toca-webhook-next-production-[a-z0-9-]+$/.test(expectedRevision ?? '')) {
  throw new Error('WEBHOOK_LOG_DIAGNOSTIC_EXACT_REVISION_REQUIRED');
}

const entries = JSON.parse(readFileSync(filePath, 'utf8'));
if (!Array.isArray(entries) || entries.length > 1000) {
  throw new Error('WEBHOOK_LOG_DIAGNOSTIC_BOUNDED_ARRAY_REQUIRED');
}

const service = 'toca-webhook-next-production';
for (const entry of entries) {
  if (
    !entry ||
    typeof entry !== 'object' ||
    entry.resource?.type !== 'cloud_run_revision' ||
    entry.resource?.labels?.service_name !== service ||
    entry.resource?.labels?.revision_name !== expectedRevision
  ) {
    throw new Error('WEBHOOK_LOG_DIAGNOSTIC_PROVIDER_SCOPE_MISMATCH');
  }
}

// Deliberately process arbitrary log text only in memory. No raw entry, URL,
// request body, token, user identifier, stack trace or customer input is printed.
const signals = [
  ['CLOUD_RUN_INSTANCE_START_FAILURE', /Container failed to start|failed to start and listen|startup probe failed/i],
  ['RUNTIME_RESOURCE_PRESSURE', /memory limit exceeded|out of memory|OOMKilled/i],
  ['STARTUP_DEPENDENCY_CONNECTIVITY', /ECONNREFUSED|EAI_AGAIN|ENOTFOUND|ETIMEDOUT|connection refused/i],
  ['PERSISTENCE_OR_SCHEMA', /READINESS_DATABASE_POOL_UNAVAILABLE|READINESS_DATABASE_URL_REQUIRED|relation .{0,60} does not exist|schema_migrations/i],
  ['MODULE_LOAD_FAILURE', /ERR_MODULE_NOT_FOUND|Cannot find module|MODULE_NOT_FOUND/i],
  ['SERVER_PORT_BIND_FAILURE', /EADDRINUSE|EACCES.*listen/i],
  ['APPLICATION_UNHANDLED_FAILURE', /uncaughtException|unhandledRejection|UnhandledPromiseRejection/i],
  ['SECRET_OR_CONFIG_REFERENCE_FAILURE', /META_WEBHOOK_VERIFY_TOKEN_REFERENCE_MISSING|META_APP_SECRET_REFERENCE_MISSING|META_APP_SECRET_KEY_REQUIRED/i],
  ['PROVIDER_AUTHORIZATION_FAILURE', /PERMISSION_DENIED|The caller does not have permission/i],
];

const observedSignals = new Set();
let http500RequestCount = 0;
let errorSeverityCount = 0;
for (const entry of entries) {
  if (Number(entry.httpRequest?.status) === 500) http500RequestCount += 1;
  if (['ERROR', 'CRITICAL', 'ALERT', 'EMERGENCY'].includes(entry.severity)) {
    errorSeverityCount += 1;
  }
  const candidates = [
    entry.textPayload,
    entry.jsonPayload?.message,
    entry.jsonPayload?.errorCode,
    entry.jsonPayload?.event,
    entry.jsonPayload?.error?.message,
    entry.protoPayload?.status?.message,
  ].filter((value) => typeof value === 'string');
  for (const [label, pattern] of signals) {
    if (candidates.some((value) => pattern.test(value))) observedSignals.add(label);
  }
}

const classification =
  observedSignals.size > 0
    ? 'ALLOWLIST_ERROR_SIGNALS_OBSERVED_ROOT_CAUSE_NOT_YET_PROVEN'
    : http500RequestCount > 0
      ? 'HTTP500_REQUEST_LOGS_WITHOUT_ALLOWLIST_ROOT_CAUSE'
      : entries.length > 0
        ? 'LOG_ENTRIES_NO_HTTP500_OR_ALLOWLIST_SIGNAL'
        : 'NO_LOG_EVIDENCE_IN_BOUNDED_WINDOW';

process.stdout.write(
  JSON.stringify({
    schemaVersion: 1,
    service,
    servingRevision: expectedRevision,
    entryCount: entries.length,
    http500RequestCount,
    errorSeverityCount,
    observedAllowlistSignals: [...observedSignals],
    classification,
    rootCauseProven: false,
    rawLogPayloadPublished: false,
    providerWrites: false,
    externalReplyWrites: false,
  }) + '\n',
);
