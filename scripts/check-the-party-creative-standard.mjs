import { existsSync, readFileSync } from 'node:fs';

const networkPath = 'control/creative-standards/the-party-hybrid-networks-standard.v1.json';
const minimalistPath = 'control/creative-standards/the-party-hybrid-minimalist-standard.v1.json';
const docsPath = 'docs/architecture/the-party-creative-standard.md';

for (const path of [networkPath, minimalistPath, docsPath]) {
  if (!existsSync(path)) fail(`The Party canonical creative file missing: ${path}`);
}

const networks = JSON.parse(read(networkPath));
const minimalist = JSON.parse(read(minimalistPath));

assertStandard(networks, 'THE_PARTY_HYBRID_NETWORKS_V1');
assertStandard(minimalist, 'THE_PARTY_HYBRID_MINIMALIST_V1');

if (
  networks.visualFamily?.id !== 'HYBRID_NETWORKS' ||
  networks.visualFamily?.environments?.international?.dominantEnergy !== 'PURPLE_VIOLET' ||
  networks.visualFamily?.environments?.national?.dominantEnergy !==
    'GOLD_AMBER_ORANGE_WARM_RED'
) {
  fail('The Party Hybrid Networks standard must preserve international and national energy modes');
}

if (
  minimalist.visualFamily?.id !== 'HYBRID_MINIMALIST' ||
  minimalist.composition?.reducedGraphicDensity !== true ||
  minimalist.composition?.negativeSpacePriority !== true
) {
  fail('The Party Hybrid Minimalist standard must preserve the approved minimalist hierarchy');
}

for (const standard of [networks, minimalist]) {
  if (
    standard.sourceOfTruth?.driveDocumentId !==
      '1yFY-1NXjWs1bKvRP3smRuRKWT6OR3WK-FkDcoLqAmPk' ||
    standard.sourceOfTruth?.canonicalManualDriveId !==
      '1QQRReW6dLwAh0BrJUiVpbXHGsbV-5ze81MOYkSx7WIU' ||
    standard.sourceOfTruth?.canonicalReferenceImageDriveId !==
      '1-xLSxr4qlKg-3OrI5hTPUpVvsAgqi2gD' ||
    standard.sourceOfTruth?.officialHeroLogoDriveId !==
      '1V09F8w1BcgwzONnZk1ROpOJACuDF2dPF'
  ) {
    fail(`The Party source-of-truth binding is incomplete: ${standard.standardId}`);
  }
  const footer = standard.brandHierarchy?.footerOrder ?? [];
  if (
    standard.brandHierarchy?.heroBrand !== 'THE_PARTY' ||
    standard.brandHierarchy?.heroLogoSource !== 'OFFICIAL_DRIVE_ASSET_ONLY' ||
    standard.brandHierarchy?.forbidAiLogoReconstruction !== true ||
    footer.join('|') !== 'TOCA_DO_MORCEGO|CORONA|RED_BULL|MORRO_DIGITAL'
  ) {
    fail(`The Party brand hierarchy drift detected: ${standard.standardId}`);
  }
  if (
    standard.creativeTruth?.realVenueAssetRequiredByDefault !== true ||
    standard.creativeTruth?.officialBrandAssetsOnly !== true ||
    standard.creativeTruth?.aiLogoReconstructionAllowed !== false ||
    standard.creativeTruth?.architecturalInventionAllowed !== false ||
    standard.creativeTruth?.environmentDriftAllowed !== false ||
    standard.creativeTruth?.venueFidelityGateRequired !== true ||
    standard.creativeTruth?.brandIntegrityGateRequired !== true ||
    standard.creativeTruth?.qualityGateRequired !== true
  ) {
    fail(`The Party Creative Truth boundary drift detected: ${standard.standardId}`);
  }
}

requireIncludes('src/creative/creative-truth-resolver.ts', [
  'THE_PARTY_HYBRID_NETWORKS_V1',
  'THE_PARTY_HYBRID_MINIMALIST_V1',
  "request.operation === 'THE_PARTY'",
  "request.requiredBrands.includes('THE_PARTY')",
]);

requireIncludes('src/providers/local/local-creative-composer.ts', [
  'THE_PARTY_HYBRID_NETWORKS_V1',
  'THE_PARTY_HYBRID_MINIMALIST_V1',
  'buildThePartyArgs',
  "export type ThePartyEnvironment = 'INTERNATIONAL' | 'NATIONAL'",
  'THE_PARTY_ENVIRONMENT_REQUIRED',
  "'TOCA_DO_MORCEGO',",
  "'CORONA',",
  "'RED_BULL',",
  "'MORRO_DIGITAL',",
  "entry.registry.brand === 'THE_PARTY'",
]);

requireIncludes('src/providers/local/local-video-composer.ts', [
  'THE_PARTY_HYBRID_NETWORKS_V1',
  'THE_PARTY_HYBRID_MINIMALIST_V1',
  "entry.registry.brand === 'THE_PARTY'",
  'THE_PARTY_FOOTER_ORDER',
  'THE_PARTY_ENVIRONMENT_REQUIRED',
  'visualStandardApplied: input.standard.standardId',
  'VIDEO_GENERATIVE_EXCEPTION_UNSUPPORTED',
]);

requireIncludes(docsPath, [
  'THE_PARTY_HYBRID_NETWORKS_V1',
  'THE_PARTY_HYBRID_MINIMALIST_V1',
  '1-xLSxr4qlKg-3OrI5hTPUpVvsAgqi2gD',
  '1V09F8w1BcgwzONnZk1ROpOJACuDF2dPF',
  'TOCA_DO_MORCEGO` → `CORONA` → `RED_BULL` → `MORRO_DIGITAL',
]);

console.log('The Party creative standard contract OK');

function assertStandard(standard, expectedId) {
  if (
    standard.standardId !== expectedId ||
    standard.status !== 'ACTIVE_CANONICAL' ||
    standard.parentPolicyId !== 'TOCA_CREATIVE_TRUTH_POLICY_V1' ||
    standard.scope?.operation !== 'THE_PARTY'
  ) {
    fail(`Invalid The Party canonical standard: ${expectedId}`);
  }
}

function read(path) {
  return readFileSync(path, 'utf8');
}

function requireIncludes(path, markers) {
  const content = read(path);
  for (const marker of markers) {
    if (!content.includes(marker)) fail(`The Party contract missing in ${path}: ${marker}`);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
