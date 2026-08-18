import { existsSync, readFileSync } from 'node:fs';

const orchestrationPath = 'control/creative-standards/the-party-content-orchestration.v1.json';
const writebackPath = 'src/providers/google-sheets/the-party-content-writeback.ts';
const clientPath = 'src/providers/google-sheets/client.ts';
const mediaAssetsPath = 'src/providers/google-sheets/media-assets.ts';
const docsPath = 'docs/architecture/the-party-creative-standard.md';
const writebackTestPath = 'test/the-party-content-writeback.test.ts';
const sheetsTestPath = 'test/google-sheets-batch-update.test.ts';

for (const path of [
  orchestrationPath,
  writebackPath,
  clientPath,
  mediaAssetsPath,
  docsPath,
  writebackTestPath,
  sheetsTestPath,
]) {
  if (!existsSync(path)) fail(`The Party writeback contract file missing: ${path}`);
}

const orchestration = JSON.parse(read(orchestrationPath));
const writeback = orchestration.writeback;
if (
  writeback?.runtime !== 'GoogleSheetsThePartyContentWriteback' ||
  writeback?.method !== 'writeFinalCreativeTruthEvidence' ||
  writeback?.sheetWriteMode !== 'VALUES_BATCH_UPDATE_RAW' ||
  writeback?.requiresExactObservedOutputSha256 !== true ||
  writeback?.requiresCreativeTruthPublicationReadyManifest !== true ||
  writeback?.requiresOfficialHeroBrandAsset !== 'BRAND-THE-PARTY-WHITE-V1' ||
  writeback?.requiresVisualStandardEvidenceMatch !== true ||
  writeback?.requiresNetworksEnvironmentEvidenceMatch !== true ||
  writeback?.requiresRealMasterLineageOutsideGenerativeException !== true ||
  writeback?.bindVenueAssetFromVenueFidelityEvidenceWhenMissing !== true ||
  writeback?.propagateDecidedSameEditionEnvironmentWhenMissing !== true ||
  writeback?.revalidateImmediatelyBeforeWrite !== true ||
  writeback?.stateConflictFailsClosed !== true ||
  writeback?.sameExactOutputIsIdempotent !== true ||
  writeback?.differentApprovedOutputRequiresNewRevision !== true ||
  writeback?.providerReadbackRequired !== true ||
  writeback?.silentOverwriteForbidden !== true
) {
  fail('The Party exact-evidence writeback control contract drift detected');
}

requireIncludes(mediaAssetsPath, [
  'SpreadsheetRangeUpdate',
  'SpreadsheetValuesBatchWriter',
  'updateRanges',
]);

requireIncludes(clientPath, [
  'implements SpreadsheetValuesClient, SpreadsheetValuesBatchWriter',
  'async updateRanges',
  '/values:batchUpdate',
  "valueInputOption: 'RAW'",
  "majorDimension: 'ROWS'",
  "await assertGoogleSheetsResponse(response, 'batch update ranges')",
]);

requireIncludes(writebackPath, [
  'GoogleSheetsThePartyContentWriteback',
  'writeFinalCreativeTruthEvidence',
  'deterministicRenderManifestSchema.safeParse',
  'assertCreativeReadyForPublication',
  'BRAND-THE-PARTY-WHITE-V1',
  'THE_PARTY_WRITEBACK_VISUAL_STANDARD_MISMATCH',
  'THE_PARTY_WRITEBACK_ENVIRONMENT_MISMATCH',
  'THE_PARTY_WRITEBACK_VENUE_ASSET_MISMATCH',
  'THE_PARTY_CONTENT_CHANGED_BEFORE_WRITEBACK',
  'THE_PARTY_APPROVED_CREATIVE_REVISION_REQUIRED',
  'THE_PARTY_CONTENT_WRITEBACK_UNAVAILABLE',
  'CREATIVE_TRUTH_PASSED',
  "record.environmentSource === 'EDITION_CONTEXT'",
  "values.set('venue_asset_id', manifestContext.venueAssetId)",
  'updateRanges(THE_PARTY_CONTENT_REGISTRY_DRIVE_ID, updates)',
  'PROVIDER_READBACK_FAILED',
]);

requireIncludes(writebackTestPath, [
  'TOCA_THUMBNAIL_V1',
  'CREATIVE_TRUTH_PASSED',
  'THE_PARTY_APPROVED_CREATIVE_REVISION_REQUIRED',
  'THE_PARTY_WRITEBACK_OUTPUT_SHA256_MISMATCH',
  'CREATIVE_TRUTH_PUBLICATION_BLOCKED',
  'THE_PARTY_WRITEBACK_VISUAL_STANDARD_MISMATCH',
  'THE_PARTY_WRITEBACK_ENVIRONMENT_MISMATCH',
  'THE_PARTY_CONTENT_CHANGED_BEFORE_WRITEBACK',
  'THE_PARTY_CONTENT_WRITEBACK_UNAVAILABLE',
]);

requireIncludes(sheetsTestPath, [
  'values:batchUpdate',
  "valueInputOption: 'RAW'",
  'CREATIVE_TRUTH_PASSED',
  'permission denied',
]);

requireIncludes(docsPath, [
  'GoogleSheetsThePartyContentWriteback.writeFinalCreativeTruthEvidence',
  'values:batchUpdate',
  'THE_PARTY_CONTENT_CHANGED_BEFORE_WRITEBACK',
  'THE_PARTY_APPROVED_CREATIVE_REVISION_REQUIRED',
  'THE_PARTY_CONTENT_WRITEBACK_UNAVAILABLE',
  'Provider readback is mandatory',
  'successful registry write-back do not authorize publication',
]);

console.log('The Party exact-evidence writeback contract OK');

function read(path) {
  return readFileSync(path, 'utf8');
}

function requireIncludes(path, markers) {
  const content = read(path);
  for (const marker of markers) {
    if (!content.includes(marker)) fail(`The Party writeback marker missing in ${path}: ${marker}`);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
