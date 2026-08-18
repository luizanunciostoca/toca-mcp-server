import { existsSync, readFileSync } from 'node:fs';

const providerPath = 'src/providers/google-sheets/the-party-content-orchestration.ts';
const cliPath = 'src/marketing-autopilot-the-party-context.ts';
const controlPath = 'control/creative-standards/the-party-content-orchestration.v1.json';
const packagePath = 'package.json';
const testPath = 'test/the-party-content-orchestration.test.ts';

for (const path of [providerPath, cliPath, controlPath, packagePath, testPath]) {
  if (!existsSync(path)) fail(`The Party content-context contract file missing: ${path}`);
}

const control = JSON.parse(read(controlPath));
if (
  control.contractId !== 'THE_PARTY_CONTENT_ORCHESTRATION_V1' ||
  control.sourceOfTruth?.contentRegistryDriveId !==
    '1r02HLhmnTijFNkmZv4o1yeZPxCEUMXZC_QreDFB6yTw' ||
  control.sourceOfTruth?.editionRegistryDriveId !==
    '1YI0xfOaSiD6UfLx97M9pQBSHqFVnDMnh5tIH68VwLlw' ||
  control.environmentPolicy?.mustNotBeInferred !== true ||
  control.environmentPolicy?.missingStatus !== 'BLOCKED_NEEDS_ENVIRONMENT' ||
  control.editionContext?.neverCrossEditionBoundary !== true
) {
  fail('The Party content-context control contract drift detected');
}

requireIncludes(providerPath, [
  'GoogleSheetsThePartyContentOrchestration',
  'buildCreativeTruthResolutionInput',
  'CONTENT_ITEMS!A1:BX2000',
  'EDITIONS!A1:P2000',
  'THE_PARTY_CONTENT_STANDARD_INTENT_MISMATCH',
  'THE_PARTY_CONTENT_HERO_BRAND_MISMATCH',
  'THE_PARTY_ENVIRONMENT_REQUIRED',
  'THE_PARTY_EDITION_CONTEXT_NOT_FOUND',
  'THE_PARTY_CONTENT_EDITION_ENVIRONMENT_CONFLICT',
]);

requireIncludes(cliPath, [
  'GoogleSheetsThePartyContentOrchestration',
  'buildCreativeTruthResolutionInput',
  'BLOCKED_NEEDS_ENVIRONMENT',
  'READY_FOR_CREATIVE_TRUTH_RESOLUTION',
  'executableCreativeTruthResolution: false',
  'creativeTruthGatesSatisfied: false',
  'publicationAuthorized: false',
  'GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY',
  'THE_PARTY_CONTEXT_REQUESTED_MODE_INVALID',
]);

const packageJson = JSON.parse(read(packagePath));
if (
  packageJson.scripts?.['dev:marketing-autopilot-the-party-context'] !==
    'tsx src/marketing-autopilot-the-party-context.ts' ||
  packageJson.scripts?.['start:marketing-autopilot-the-party-context'] !==
    'node dist/src/marketing-autopilot-the-party-context.js' ||
  !packageJson.scripts?.['architecture:check']?.includes(
    'node scripts/check-the-party-content-context-contract.mjs',
  )
) {
  fail('The Party content-context executable/package binding drift detected');
}

requireIncludes(testPath, [
  'BLOCKED_NEEDS_ENVIRONMENT',
  'PENDING_DECISION',
  "environment_status: 'DECIDED'",
  'THE_PARTY_EDITION_CONTEXT_NOT_FOUND',
  'THE_PARTY_CONTENT_STANDARD_INTENT_MISMATCH',
  'THE_PARTY_CONTENT_HERO_BRAND_MISMATCH',
  'THE_PARTY_CONTENT_EDITION_ENVIRONMENT_CONFLICT',
]);

console.log('The Party content-context executable contract OK');

function read(path) {
  return readFileSync(path, 'utf8');
}

function requireIncludes(path, markers) {
  const content = read(path);
  for (const marker of markers) {
    if (!content.includes(marker)) fail(`The Party content-context marker missing in ${path}: ${marker}`);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
