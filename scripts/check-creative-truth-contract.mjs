import { existsSync, readFileSync } from 'node:fs';

const required = [
  'control/creative-truth-policy.v1.json',
  'control/creative-standards/sunset-story-standard.v1.json',
  'control/creative-standards/sunset-feed-standard.v1.json',
  'control/creative-standards/sunset-ad-standard.v1.json',
  'control/creative-standards/toca-video-standard.v1.json',
  'src/contracts/creative-truth.ts',
  'src/creative/creative-truth.ts',
  'src/creative/creative-truth-resolver.ts',
  'src/providers/google-sheets/creative-truth-registry.ts',
  'src/providers/local/local-creative-composer.ts',
  'src/providers/local/local-video-composer.ts',
  'src/providers/meta-ads/meta-ads-controlled-write.ts',
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
  policy.status !== 'ACTIVE_CANONICAL' ||
  policy.rules?.aiLogoReconstructionAllowed !== false ||
  policy.rules?.architecturalInventionAllowed !== false ||
  policy.rules?.environmentDriftAllowed !== false ||
  policy.rules?.failClosed !== true ||
  policy.publicationBoundary?.exactAssetBindingRequired !== true
) {
  console.error('Creative Truth parent policy violates the fail-closed contract');
  process.exit(1);
}

for (const path of [
  'control/creative-standards/sunset-story-standard.v1.json',
  'control/creative-standards/sunset-feed-standard.v1.json',
  'control/creative-standards/sunset-ad-standard.v1.json',
  'control/creative-standards/toca-video-standard.v1.json',
]) {
  const standard = JSON.parse(readFileSync(path, 'utf8'));
  if (
    standard.parentPolicyId !== 'TOCA_CREATIVE_TRUTH_POLICY_V1' ||
    standard.status !== 'ACTIVE_CANONICAL'
  ) {
    console.error(`Creative standard is not bound to Creative Truth: ${path}`);
    process.exit(1);
  }
}

const story = JSON.parse(
  readFileSync('control/creative-standards/sunset-story-standard.v1.json', 'utf8'),
);
if (
  story.referencePolicy?.derivedExamplesClassification !== 'VISUAL_DIRECTION_REFERENCE_ONLY' ||
  story.referencePolicy?.venueTruthComesOnlyFromVenueRegistry !== true
) {
  console.error('Synthetic Sunset examples must never become venue truth');
  process.exit(1);
}

const contracts = readFileSync('src/contracts/creative-truth.ts', 'utf8');
for (const locator of [
  'MEDIA_URL',
  'META_IMAGE_HASH',
  'META_VIDEO_ID',
  'META_SOURCE_CREATIVE_ID',
]) {
  if (!contracts.includes(locator)) {
    console.error(`Creative Truth asset locator missing: ${locator}`);
    process.exit(1);
  }
}

const creativeTruth = readFileSync('src/creative/creative-truth.ts', 'utf8');
for (const marker of [
  'FAILED_AI_LOGO_RECONSTRUCTION',
  'FAILED_SCENE_INVENTION_DETECTED',
  'FAILED_ARCHITECTURE_DRIFT',
  'FAILED_UNAPPROVED_GENERATIVE_EXCEPTION',
  'FAILED_GENERATIVE_REFERENCE_MISSING',
  'buildCreativeTruthPublicationBinding',
]) {
  if (!creativeTruth.includes(marker)) {
    console.error(`Creative Truth runtime missing hard requirement: ${marker}`);
    process.exit(1);
  }
}

const openAiEdit = readFileSync('src/providers/openai/openai-image-edit-provider.ts', 'utf8');
if (!openAiEdit.includes('buildTocaImageEditPrompt') || !openAiEdit.includes('creativeTruthBound')) {
  console.error('OpenAI image edit path must remain Creative Truth bound');
  process.exit(1);
}

const publicationComposition = readFileSync(
  'src/worker/instagram-publication-composition.ts',
  'utf8',
);
if (!publicationComposition.includes('new InstagramPublicationExecutor') || !publicationComposition.includes('true,')) {
  console.error('Production Instagram publication must require Creative Truth binding');
  process.exit(1);
}

const instagramExecutor = readFileSync(
  'src/providers/instagram/instagram-publication-executor.ts',
  'utf8',
);
if (!instagramExecutor.includes('CREATIVE_TRUTH_ASSET_LOCATOR_MISMATCH')) {
  console.error('Instagram publication must bind the exact approved media URL');
  process.exit(1);
}

const metaAdsWrite = readFileSync('src/providers/meta-ads/meta-ads-controlled-write.ts', 'utf8');
if (
  !metaAdsWrite.includes('META_ADS_CREATIVE_TRUTH_BINDING_REQUIRED') ||
  !metaAdsWrite.includes('META_ADS_CREATIVE_TRUTH_ASSET_LOCATOR_MISMATCH') ||
  !metaAdsWrite.includes('allowUnboundCreativeForProviderValidation')
) {
  console.error('Meta Ads creative writes must enforce Creative Truth except explicit provider validation');
  process.exit(1);
}

console.log('Creative Truth architecture contract OK');
