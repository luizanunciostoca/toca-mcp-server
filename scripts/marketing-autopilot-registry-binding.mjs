import { createHash } from 'node:crypto';

export function canonicalRegistrySnapshot(row) {
  const entries = Object.entries(row ?? {})
    .map(([key, value]) => [String(key), normalize(value)])
    .sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries);
}

export function hashRegistrySnapshot(row) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalRegistrySnapshot(row)))
    .digest('hex');
}

function normalize(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}
