import { readFileSync, writeFileSync } from 'node:fs';

function replaceSection(path, startMarker, endMarker, replacement) {
  const current = readFileSync(path, 'utf8');
  const start = current.indexOf(startMarker);
  const end = current.indexOf(endMarker, start);
  if (start === -1 || end === -1) throw new Error(`SECTION_NOT_FOUND:${path}`);
  writeFileSync(path, `${current.slice(0, start)}${replacement}${current.slice(end)}`);
}

replaceSection(
  'src/local-discovery/google-business.ts',
  'function stableValue(value: unknown): string {',
  'function normalizeSearchText(value: string): string {',
  `function stableValue(value: unknown): string {
  return JSON.stringify(normalizeStableValue(value));
}

function normalizeStableValue(value: unknown): unknown {
  if (value === undefined) return '__undefined__';
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => normalizeStableValue(item));
  const record = value as Readonly<Record<string, unknown>>;
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    normalized[key] = normalizeStableValue(record[key]);
  }
  return normalized;
}

`,
);

const testPath = 'test/google-business-local-discovery.test.ts';
let test = readFileSync(testPath, 'utf8');
test = test.replace(
  `get: async (eventId: string) => (eventId === EVENT.eventId ? EVENT : undefined),`,
  `get: (eventId: string) => Promise.resolve(eventId === EVENT.eventId ? EVENT : undefined),`,
);
test = test.replace(
  `const store = { get: async () => EVENT } as unknown as EventRecordStore;`,
  `const store = { get: () => Promise.resolve(EVENT) } as unknown as EventRecordStore;`,
);
writeFileSync(testPath, test);

console.log('Google Business lint findings fixed.');
