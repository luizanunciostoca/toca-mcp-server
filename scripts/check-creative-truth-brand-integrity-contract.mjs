import { readFileSync } from 'node:fs';

const creativeTruth = read('src/creative/creative-truth.ts');
const composer = read('src/providers/local/local-creative-composer.ts');
const policy = JSON.parse(read('control/creative-truth-policy.v1.json'));

for (const marker of [
  'const assetsByBrand = new Map<string, ResolvedBrandAsset[]>()',
  'candidates.length !== 1',
  "resolved.asset.integrityMode !== 'SHA256_PINNED'",
  '!resolved.asset.sha256',
  '!resolved.observedSha256',
  'resolved.asset.sha256.toLowerCase() !== resolved.observedSha256.toLowerCase()',
  'sha256PinnedOnly: true',
]) {
  if (!creativeTruth.includes(marker)) {
    fail(`Creative Truth exact-logo integrity invariant missing: ${marker}`);
  }
}

for (const marker of [
  'observedDriveFileId: entry.driveFileId',
  'observedSha256: sha256(entry.bytes)',
  'evaluateBrandIntegrity(',
  'requireGatePassed(brandGate)',
]) {
  if (!composer.includes(marker)) {
    fail(`Static compositor brand-byte verification missing: ${marker}`);
  }
}

if (
  policy.rules?.officialBrandAssetsOnly !== true ||
  policy.rules?.aiLogoReconstructionAllowed !== false ||
  policy.rules?.deterministicTextAndBrandCompositionRequired !== true ||
  policy.rules?.failClosed !== true
) {
  fail('Creative Truth policy mirror does not preserve official-logo-only fail-closed composition');
}

console.log('Creative Truth exact official-logo integrity contract OK');

function read(path) {
  return readFileSync(path, 'utf8');
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
