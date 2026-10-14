#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const probePaths = Object.freeze({
  health: { method: 'GET', path: '/health' },
  ready: { method: 'GET', path: '/ready' },
  grounding: { method: 'POST', path: '/v1/knowledge/answer' },
});

function sanitizedStatus(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 100 && n <= 599 ? String(n) : 'NOT_OBSERVED';
}

function requestPath(value) {
  if (typeof value !== 'string') return '';
  try {
    return new URL(value).pathname;
  } catch {
    return '';
  }
}

function safePayload(entry) {
  if (typeof entry?.jsonPayload?.event === 'string') return entry.jsonPayload;
  for (const source of [entry?.jsonPayload?.message, entry?.textPayload]) {
    if (typeof source !== 'string') continue;
    try {
      const value = JSON.parse(source);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch {
      // Cloud Logging carries unrelated free-form text; never publish it.
    }
  }
  return {};
}

const errorCategories = new Set([
  'AG01_GROUNDED_MODEL_TIMEOUT',
  'AG01_MODEL_TIMEOUT',
  'AG01_MODEL_PROVIDER_UNAVAILABLE',
  'AG01_TOCA_OS_REGISTRY_TIMEOUT',
  'AG01_PERSISTENCE_NOT_READY',
  'AG01_PRODUCTION_GCP_METADATA_REQUIRED',
]);

export function summarizeAg01ProbeLogs(rawEntries) {
  if (!Array.isArray(rawEntries)) throw new Error('AG01_SANITIZED_LOGS_ARRAY_REQUIRED');
  const http = { health: 'NOT_OBSERVED', ready: 'NOT_OBSERVED', grounding: 'NOT_OBSERVED' };
  let groundingResult = 'NOT_OBSERVED';
  let citedResourceCount = 0;
  let appErrorCategory = 'NOT_OBSERVED';
  let groundedEventCount = 0;

  // gcloud read --order=desc: first trusted match is the most recent entry.
  for (const entry of rawEntries.slice(0, 200)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const request = entry.httpRequest;
    if (request && typeof request === 'object') {
      for (const [kind, expected] of Object.entries(probePaths)) {
        if (
          http[kind] === 'NOT_OBSERVED' &&
          request.requestMethod === expected.method &&
          requestPath(request.requestUrl) === expected.path
        ) {
          http[kind] = sanitizedStatus(request.status);
        }
      }
    }

    const payload = safePayload(entry);
    if (payload.event === 'ag01.grounded_knowledge.completed') {
      groundedEventCount += 1;
      if (groundingResult === 'NOT_OBSERVED') {
        groundingResult = ['GROUNDED', 'NO_GROUNDED_ANSWER'].includes(payload.status)
          ? payload.status
          : 'UNKNOWN';
        const count = Number(payload.citedResourceCount);
        citedResourceCount = Number.isSafeInteger(count) && count >= 0 && count <= 1000 ? count : 0;
      }
    }
    if (
      appErrorCategory === 'NOT_OBSERVED' &&
      (payload.event === 'ag01.http.failed' || payload.event === 'ag01.readiness.failed')
    ) {
      appErrorCategory = errorCategories.has(payload.errorCode)
        ? payload.errorCode
        : 'REDACTED_OTHER_APP_ERROR';
    }
  }

  let classification = 'INSUFFICIENT_LOG_PROOF';
  if (http.health !== 'NOT_OBSERVED' && http.health !== '200') {
    classification = 'PRIVATE_HEALTH_HTTP_NON200';
  } else if (http.ready !== 'NOT_OBSERVED' && http.ready !== '200') {
    classification = 'PRIVATE_READY_HTTP_NON200';
  } else if (http.grounding !== 'NOT_OBSERVED' && http.grounding !== '200') {
    classification = 'PRIVATE_GROUNDING_HTTP_NON200';
  } else if (groundingResult === 'NO_GROUNDED_ANSWER') {
    classification = 'GROUNDED_KNOWLEDGE_NO_VERIFIED_ANSWER';
  } else if (groundingResult === 'GROUNDED' && citedResourceCount === 0) {
    classification = 'GROUNDED_KNOWLEDGE_MISSING_CITATIONS';
  } else if (groundingResult === 'GROUNDED' && citedResourceCount > 0) {
    classification = 'APPLICATION_GROUNDING_EVENT_PASS_OTHER_PROBE_ASSERTION_UNPROVEN';
  }

  return Object.freeze({
    schemaVersion: 1,
    classification,
    healthHttpStatus: http.health,
    readyHttpStatus: http.ready,
    groundingHttpStatus: http.grounding,
    groundingResult,
    citedResourceCount,
    groundedEventCount,
    appErrorCategory,
    rawLogPayloadPublished: false,
  });
}

if (process.argv[1]?.endsWith('ag01-grounded-probe-log-summary.mjs')) {
  if (process.argv.length !== 3) throw new Error('AG01_SANITIZED_LOG_FILE_REQUIRED');
  const entries = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  process.stdout.write(JSON.stringify(summarizeAg01ProbeLogs(entries)) + '\n');
}
