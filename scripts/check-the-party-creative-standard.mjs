import { existsSync, readFileSync } from 'node:fs';

const networkPath = 'control/creative-standards/the-party-hybrid-networks-standard.v1.json';
const minimalistPath = 'control/creative-standards/the-party-hybrid-minimalist-standard.v1.json';
const orchestrationPath = 'control/creative-standards/the-party-content-orchestration.v1.json';
const familyResolverPath = 'src/creative/the-party-visual-family-resolver.ts';
const docsPath = 'docs/architecture/the-party-creative-standard.md';

for (const path of [networkPath, minimalistPath, orchestrationPath, familyResolverPath, docsPath]) {
  if (!existsSync(path)) fail(`The Party canonical creative file missing: ${path}`);
}

const networks = JSON.parse(read(networkPath));
const minimalist = JSON.parse(read(minimalistPath));
const orchestration = JSON.parse(read(orchestrationPath));

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

const requiredOrchestrationColumns = [
  'the_party_intent',
  'the_party_environment',
  'creative_standard_id',
  'creative_standard_version',
  'visual_standard_status',
  'hero_brand_asset_id',
  'venue_asset_id',
  'creative_truth_policy_id',
  'brand_integrity_status',
  'venue_fidelity_status',
  'quality_gate_status',
  'exact_asset_binding',
  'output_sha256',
];

if (
  orchestration.contractId !== 'THE_PARTY_CONTENT_ORCHESTRATION_V1' ||
  orchestration.status !== 'ACTIVE_CANONICAL' ||
  orchestration.sourceOfTruth?.contentRegistryDriveId !==
    '1r02HLhmnTijFNkmZv4o1yeZPxCEUMXZC_QreDFB6yTw' ||
  orchestration.sourceOfTruth?.sheet !== 'CONTENT_ITEMS' ||
  orchestration.sourceOfTruth?.canonicalManualDriveId !==
    '1QQRReW6dLwAh0BrJUiVpbXHGsbV-5ze81MOYkSx7WIU' ||
  orchestration.sourceOfTruth?.creativeTruthRegistryDriveId !==
    '1bqF5zN5Lhesy_uls6gHMkOT-KLFRGo81OJMB_LPwXaU' ||
  !Array.isArray(orchestration.requiredColumns) ||
  requiredOrchestrationColumns.some((column) => !orchestration.requiredColumns.includes(column)) ||
  orchestration.environmentPolicy?.requiredForStandard !== 'THE_PARTY_HYBRID_NETWORKS_V1' ||
  orchestration.environmentPolicy?.mustNotBeInferred !== true ||
  orchestration.environmentPolicy?.missingStatus !== 'BLOCKED_NEEDS_ENVIRONMENT' ||
  orchestration.environmentPolicy?.failureCode !== 'THE_PARTY_ENVIRONMENT_REQUIRED' ||
  orchestration.brandPolicy?.heroBrand !== 'THE_PARTY' ||
  orchestration.brandPolicy?.heroBrandAssetId !== 'BRAND-THE-PARTY-WHITE-V1' ||
  orchestration.brandPolicy?.institutionalFooterOrder?.join('|') !==
    'TOCA_DO_MORCEGO|CORONA|RED_BULL|MORRO_DIGITAL' ||
  orchestration.goldenVenueAssets?.join('|') !==
    'VENUE-TP-0130|VENUE-TP-0087|VENUE-TP-0071|VENUE-TP-0048|VENUE-TP-0113' ||
  orchestration.gateDefaults?.brand_integrity_status !== 'PENDING' ||
  orchestration.gateDefaults?.venue_fidelity_status !== 'PENDING' ||
  orchestration.gateDefaults?.quality_gate_status !== 'PENDING' ||
  orchestration.readyBoundary?.resolvedVisualStandardDoesNotImplyReady !== true ||
  orchestration.readyBoundary?.allCreativeTruthGatesMustPass !== true ||
  orchestration.readyBoundary?.exactAssetBindingRequired !== true ||
  orchestration.readyBoundary?.outputSha256Required !== true
) {
  fail('The Party content orchestration contract violates canonical fail-closed boundaries');
}

requireIncludes(familyResolverPath, [
  'HIGH_IMPACT_CAMPAIGN',
  'LINEUP',
  'SOCIAL_PROMOTION',
  'INSTITUTIONAL_COMMUNICATION',
  'ELEGANT_AD',
  'PEOPLE_FIRST_CONVERSION',
  'THE_PARTY_HYBRID_NETWORKS_V1',
  'THE_PARTY_HYBRID_MINIMALIST_V1',
  'THE_PARTY_ENVIRONMENT_REQUIRED',
  'resolveThePartyVenueAssetPreferences',
  'VENUE-TP-0130',
  'VENUE-TP-0087',
  'VENUE-TP-0071',
  'VENUE-TP-0048',
  'VENUE-TP-0113',
]);

requireIncludes('src/creative/creative-truth-resolver.ts', [
  'resolveThePartyVisualFamily',
  'resolveThePartyVenueAssetPreferences',
  'thePartyIntent?: ThePartyCreativeIntent',
  'thePartyEnvironment?: ThePartyEnvironment',
  "request.operation === 'THE_PARTY'",
  "request.requiredBrands.includes('THE_PARTY')",
  'THE_PARTY_VISUAL_INTENT_REQUIRED',
  'THE_PARTY_STANDARD_INTENT_MISMATCH',
  'preferredAssetIds',
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
  '1QQRReW6dLwAh0BrJUiVpbXHGsbV-5ze81MOYkSx7WIU',
  '1c9DXMrl2emY8qgYrGN9oY0MbHBifod4I',
  '1Bz0pqHaHp_I06M2jiu-_WL0t1ik2LS0T',
  '1-xLSxr4qlKg-3OrI5hTPUpVvsAgqi2gD',
  '1V09F8w1BcgwzONnZk1ROpOJACuDF2dPF',
  'VENUE-TP-0130',
  'VENUE-TP-0087',
  'VENUE-TP-0071',
  'VENUE-TP-0048',
  'VENUE-TP-0113',
  'TOCA_DO_MORCEGO` → `CORONA` → `RED_BULL` → `MORRO_DIGITAL',
  'THE_PARTY_CONTENT_ORCHESTRATION_V1',
  '1r02HLhmnTijFNkmZv4o1yeZPxCEUMXZC_QreDFB6yTw',
  'BLOCKED_NEEDS_ENVIRONMENT',
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
