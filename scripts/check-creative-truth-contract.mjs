import { existsSync, readFileSync } from 'node:fs';

const standardPaths = [
  'control/creative-standards/sunset-story-standard.v1.json',
  'control/creative-standards/sunset-feed-standard.v1.json',
  'control/creative-standards/sunset-ad-standard.v1.json',
  'control/creative-standards/toca-video-standard.v1.json',
  'control/creative-standards/toca-thumbnail-standard.v1.json',
  'control/creative-standards/the-party-hybrid-networks-standard.v1.json',
  'control/creative-standards/the-party-hybrid-minimalist-standard.v1.json',
];

const required = [
  'control/creative-truth-policy.v1.json',
  ...standardPaths,
  'src/contracts/creative-truth.ts',
  'src/creative/creative-truth.ts',
  'src/creative/creative-truth-resolver.ts',
  'src/providers/google-sheets/creative-truth-registry.ts',
  'src/providers/google-sheets/the-party-content-orchestration.ts',
  'src/providers/local/local-creative-composer.ts',
  'src/providers/local/local-video-composer.ts',
  'docs/architecture/creative-truth-and-venue-fidelity.md',
];

const missing = required.filter((path) => !existsSync(path));
if (missing.length > 0) {
  console.error(`Creative Truth architecture files missing: ${missing.join(', ')}`);
  process.exit(1);
}

const policy = JSON.parse(readFileSync('control/creative-truth-policy.v1.json', 'utf8'));
if (
  policy.policyId !== 'TOCA_CREATIVE_TRUTH_POLICY_V1' ||
  policy.policyVersion !== '1.3' ||
  policy.status !== 'ACTIVE_CANONICAL' ||
  policy.rules?.aiLogoReconstructionAllowed !== false ||
  policy.rules?.architecturalInventionAllowed !== false ||
  policy.rules?.environmentDriftAllowed !== false ||
  policy.rules?.failClosed !== true ||
  policy.referenceSets?.strategy !== 'OPERATION_SCOPED_ONLY_V1' ||
  policy.referenceSets?.legacy?.id !== 'TOCA_VENUE_REFERENCE_SET_V1' ||
  policy.referenceSets?.legacy?.status !== 'DEPRECATED' ||
  policy.referenceSets?.legacy?.execution !== 'DENY' ||
  policy.referenceSets?.byOperation?.SUNSET !== 'TOCA_VENUE_REFERENCE_SET_SUNSET_V1' ||
  policy.referenceSets?.byOperation?.THE_PARTY !== 'TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1' ||
  policy.referenceSets?.crossOperationReuse !== 'FORBIDDEN' ||
  policy.referenceSets?.operationMatchRequired !== true ||
  policy.publicationBoundary?.exactAssetBindingRequired !== true ||
  policy.publicationBoundary?.publishedAssetSha256MustEqualApprovedOutputSha256 !== true
) {
  console.error('Creative Truth parent policy violates canonical v1.3 fail-closed contract');
  process.exit(1);
}

for (const path of standardPaths) {
  const standard = JSON.parse(readFileSync(path, 'utf8'));
  if (
    standard.parentPolicyId !== 'TOCA_CREATIVE_TRUTH_POLICY_V1' ||
    standard.status !== 'ACTIVE_CANONICAL'
  ) {
    console.error(`Creative standard is not bound to Creative Truth: ${path}`);
    process.exit(1);
  }
}

for (const path of [
  'control/creative-standards/sunset-story-standard.v1.json',
  'control/creative-standards/sunset-feed-standard.v1.json',
  'control/creative-standards/sunset-ad-standard.v1.json',
]) {
  const standard = JSON.parse(readFileSync(path, 'utf8'));
  const referenceSet =
    standard.sourceOfTruth?.venueReferenceSetId ??
    standard.creativeTruth?.venueReferenceSetRequiredForGenerativeException;
  if (referenceSet !== 'TOCA_VENUE_REFERENCE_SET_SUNSET_V1') {
    console.error(`Sunset standard must resolve the operation-scoped reference set: ${path}`);
    process.exit(1);
  }
}

const thePartyPaths = [
  'control/creative-standards/the-party-hybrid-networks-standard.v1.json',
  'control/creative-standards/the-party-hybrid-minimalist-standard.v1.json',
];
const expectedThePartyPalette = {
  black: '#0D0D0D',
  white: '#FFFFFF',
  gold: '#FFC629',
  amber: '#FFA900',
  neonPurple: '#8A2BE2',
  red: '#FF2D20',
};
const expectedThePartyFooter = ['TOCA_DO_MORCEGO', 'CORONA', 'RED_BULL', 'MORRO_DIGITAL'];

for (const path of thePartyPaths) {
  const standard = JSON.parse(readFileSync(path, 'utf8'));
  if (
    standard.sourceOfTruth?.venueReferenceSetId !== 'TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1'
  ) {
    console.error(`The Party standard must resolve the operation-scoped reference set: ${path}`);
    process.exit(1);
  }
  if (
    standard.standardVersion !== '2.0' ||
    standard.sourceOfTruth?.canonicalDriveId !==
      '1CnsYiSYvNXvma4giDSiYbIhuYhmh0_BBse2UoOLB4BI' ||
    standard.sourceOfTruth?.brandSystemDriveId !==
      '1X_ppNT3-BckHea9HmzjhI1xULI1CFfhk3wmi4ALH7Ag' ||
    standard.sourceOfTruth?.approvedReferencesFolderId !==
      '1RyxWk6kaJcnKRb88NY9evN2BfLBnRLNm' ||
    standard.sourceOfTruth?.quickGuideDriveId !== '1Ko5ZOoLkX4nQ41HUBE5IvQfEQE0FExPb' ||
    JSON.stringify(standard.designTokens?.palette) !== JSON.stringify(expectedThePartyPalette) ||
    standard.designTokens?.typography?.display !== 'Bebas Neue Condensed Bold' ||
    standard.designTokens?.typography?.expressive !== 'Brush Script' ||
    standard.designTokens?.typography?.support !== 'Montserrat Regular / Medium / Bold' ||
    standard.brandSystem?.heroBrandAssetId !== 'BRAND-THE-PARTY-WHITE-V1' ||
    standard.brandSystem?.heroBrandRequired !== true ||
    JSON.stringify(standard.brandSystem?.institutionalFooterOrder) !==
      JSON.stringify(expectedThePartyFooter) ||
    standard.brandSystem?.officialBrandAssetsOnly !== true ||
    standard.qualityGate?.requiresVisualRegressionAgainstV2References !== true ||
    standard.qualityGate?.requiresFooterOrderValidation !== true ||
    standard.qualityGate?.requiresTypographyAndPaletteValidation !== true
  ) {
    console.error(`The Party visual standard is not synchronized to canonical v2.0: ${path}`);
    process.exit(1);
  }
}

const thePartyNetworks = JSON.parse(
  readFileSync('control/creative-standards/the-party-hybrid-networks-standard.v1.json', 'utf8'),
);
if (
  thePartyNetworks.environmentSystem?.required !== true ||
  thePartyNetworks.environmentSystem?.inferenceForbidden !== true ||
  !thePartyNetworks.environmentSystem?.allowed?.includes('INTERNATIONAL') ||
  !thePartyNetworks.environmentSystem?.allowed?.includes('NATIONAL')
) {
  console.error('The Party Hybrid Networks v2.0 must remain fail-closed on environment selection');
  process.exit(1);
}

const thePartyMinimalist = JSON.parse(
  readFileSync('control/creative-standards/the-party-hybrid-minimalist-standard.v1.json', 'utf8'),
);
if (
  thePartyMinimalist.composition?.peopleFirstPreferred !== true ||
  thePartyMinimalist.composition?.lowerGraphicDensity !== true ||
  thePartyMinimalist.composition?.generousNegativeSpace !== true
) {
  console.error('The Party Hybrid Minimalist v2.0 must preserve people-first premium composition');
  process.exit(1);
}

const thePartyContentOrchestration = readFileSync(
  'src/providers/google-sheets/the-party-content-orchestration.ts',
  'utf8',
);
for (const marker of [
  "THE_PARTY_VISUAL_STANDARD_VERSION = '2.0'",
  'THE_PARTY_CONTENT_STANDARD_VERSION_MISMATCH',
  'THE_PARTY_CONTENT_STANDARD_INTENT_MISMATCH',
  'THE_PARTY_ENVIRONMENT_REQUIRED',
]) {
  if (!thePartyContentOrchestration.includes(marker)) {
    console.error(`The Party content orchestration missing v2.0 runtime contract: ${marker}`);
    process.exit(1);
  }
}

const story = JSON.parse(
  readFileSync('control/creative-standards/sunset-story-standard.v1.json', 'utf8'),
);
if (
  story.standardVersion !== '1.2' ||
  story.referencePolicy?.derivedExamplesClassification !== 'VISUAL_DIRECTION_REFERENCE_ONLY' ||
  story.referencePolicy?.venueTruthComesOnlyFromVenueRegistry !== true
) {
  console.error('Sunset Story mirror must preserve canonical v1.2 venue-truth constraints');
  process.exit(1);
}

const video = JSON.parse(
  readFileSync('control/creative-standards/toca-video-standard.v1.json', 'utf8'),
);
if (
  video.standardVersion !== '1.1' ||
  video.shotRules?.videoShotRegistryRequired !== true ||
  video.shotRules?.shotLevelProvenanceRequiredForEnhancement !== true ||
  video.generativeException?.fullSyntheticVenueVideo !== 'UNSUPPORTED_V1'
) {
  console.error('TOCA_VIDEO_V1 must remain bound to canonical shot provenance v1.1');
  process.exit(1);
}

const creativeTruth = readFileSync('src/creative/creative-truth.ts', 'utf8');
for (const marker of [
  'FAILED_AI_LOGO_RECONSTRUCTION',
  'FAILED_SCENE_INVENTION_DETECTED',
  'FAILED_ARCHITECTURE_DRIFT',
  'FAILED_UNAPPROVED_GENERATIVE_EXCEPTION',
  'FAILED_GENERATIVE_REFERENCE_MISSING',
  'FAILED_GENERATIVE_REFERENCE_OPERATION_MISMATCH',
  'FAILED_PUBLICATION_ASSET_HASH_MISMATCH',
]) {
  if (!creativeTruth.includes(marker)) {
    console.error(`Creative Truth runtime missing hard failure: ${marker}`);
    process.exit(1);
  }
}

const registry = readFileSync('src/providers/google-sheets/creative-truth-registry.ts', 'utf8');
for (const marker of [
  'POLICY!A2:AK20',
  'VENUE_REFERENCE_SET!A2:K1000',
  'GENERATIVE_EXCEPTIONS!A2:O1000',
  'VIDEO_SHOTS!A2:Q2000',
]) {
  if (!registry.includes(marker)) {
    console.error(`Creative Truth registry missing canonical range: ${marker}`);
    process.exit(1);
  }
}

const openAiEdit = readFileSync('src/providers/openai/openai-image-edit-provider.ts', 'utf8');
if (
  !openAiEdit.includes('buildTocaImageEditPrompt') ||
  !openAiEdit.includes('creativeTruthBound')
) {
  console.error('OpenAI image edit path must remain Creative Truth bound');
  process.exit(1);
}

const publicationComposition = readFileSync(
  'src/worker/instagram-publication-composition.ts',
  'utf8',
);
if (
  !publicationComposition.includes('new InstagramPublicationExecutor') ||
  !publicationComposition.includes('true,')
) {
  console.error('Production Instagram publication must require Creative Truth binding');
  process.exit(1);
}

const publicationExecutor = readFileSync(
  'src/providers/instagram/instagram-publication-executor.ts',
  'utf8',
);
if (
  !publicationExecutor.includes('publicationAssetSha256') ||
  !publicationExecutor.includes('assertCreativePublicationAssetHash')
) {
  console.error('Publication boundary must bind staged bytes to the approved output SHA-256');
  process.exit(1);
}

console.log('Creative Truth architecture contract OK');
