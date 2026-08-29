#!/usr/bin/env node

const ALLOWED_VALIDATIONS = new Set([
  'instagram-engagement-readiness',
  'instagram-engagement-shadow-e2e',
  'instagram-engagement-meta-subscriptions',
]);

const validation = process.argv[2]?.trim();
if (!validation || !ALLOWED_VALIDATIONS.has(validation)) {
  console.error('Unsupported Instagram engagement validation selector');
  process.exit(2);
}

let input = '';
for await (const chunk of process.stdin) input += chunk;

let entries;
try {
  entries = JSON.parse(input || '[]');
} catch {
  console.error('Cloud Logging response is not valid JSON');
  process.exit(3);
}

if (!Array.isArray(entries)) {
  console.error('Cloud Logging response must be a JSON array');
  process.exit(4);
}

function parseJsonObject(value) {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizePayload(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;

  const structured = entry.jsonPayload;
  if (structured && typeof structured === 'object' && !Array.isArray(structured)) {
    if (typeof structured.validation === 'string') return structured;
    const messagePayload = parseJsonObject(structured.message);
    if (messagePayload) return messagePayload;
  }

  return parseJsonObject(entry.textPayload);
}

let matched = null;
for (const entry of entries) {
  const payload = normalizePayload(entry);
  if (payload?.validation === validation) matched = payload;
}

if (!matched) {
  console.error(`Cloud Run validation evidence missing: ${validation}`);
  process.exit(5);
}

process.stdout.write(`${JSON.stringify(matched)}\n`);
