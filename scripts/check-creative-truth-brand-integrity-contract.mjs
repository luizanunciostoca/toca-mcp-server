import { readFileSync } from 'node:fs';

const contracts = read('src/contracts/creative-truth.ts');
const creativeTruth = read('src/creative/creative-truth.ts');
const composer = read('src/providers/local/local-creative-composer.ts');
const policy = JSON.parse(read('control/creative-truth-policy.v1.json'));

if (!contracts.includes("videoGenerativeException: z.literal('UNSUPPORTED_V1')")) {
  fail('Creative Truth schema must lock full-generative video as UNSUPPORTED_V1');
}

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
  policy.rules?.videoGenerativeException !== 'UNSUPPORTED_V1' ||
  policy.rules?.failClosed !== true
) {
  fail('Creative Truth policy mirror does not preserve canonical fail-closed brand/video controls');
}

console.log('Creative Truth exact official-logo integrity contract OK');

function read(path) {
  return readFileSync(path, 'utf8');
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
