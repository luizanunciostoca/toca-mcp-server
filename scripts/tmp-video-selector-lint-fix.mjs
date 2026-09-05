import { readFileSync, writeFileSync } from 'node:fs';

const selectorPath = 'src/creative/intelligent-video-asset-selector.ts';
const testPath = 'test/intelligent-video-asset-selector.test.ts';

let selector = readFileSync(selectorPath, 'utf8');
const oldFreshness = `  if (days <= 7) return 35;\n  if (days <= 14) return 60;\n  if (days <= 30) return 80;\n  return 100;`;
const newFreshness = `  const recencyFactor =\n    policy.recency.find((window) => days <= window.days)?.factor ?? policy.recencyDefault;\n  return clampScore(recencyFactor * 100);`;
if (!selector.includes(oldFreshness)) throw new Error('FRESHNESS_PATCH_TARGET_NOT_FOUND');
selector = selector.replace(oldFreshness, newFreshness);
writeFileSync(selectorPath, selector);

let test = readFileSync(testPath, 'utf8');
for (const signature of [
  `  async readRange(_spreadsheetId: string, range: string) {\n`,
  `  async appendRow(_spreadsheetId: string, range: string, values: readonly unknown[]) {\n`,
  `  async updateRanges(_spreadsheetId: string, updates: readonly SpreadsheetRangeUpdate[]) {\n`,
]) {
  if (!test.includes(signature)) throw new Error(`TEST_PATCH_TARGET_NOT_FOUND:${signature}`);
  test = test.replace(signature, `${signature}    await Promise.resolve();\n`);
}
writeFileSync(testPath, test);
