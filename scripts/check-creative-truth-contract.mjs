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
  'src/providers/gcp/gcs-publication-asset-stager.ts',
  'src/providers/gcp/gcs-publication-asset-delivery.ts',
  'src/providers/local/local-creative-composer.ts',
  'src/providers/local/local-story-composer.ts',
  'src/providers/local/local-video-composer.ts',
  'src/providers/meta-ads/meta-ads-controlled-write.ts',
  'src/scheduler/toca-managed-instagram-scheduler.ts',
  'src/worker/toca-managed-instagram-worker-runtime.ts',
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
for (const marker of [
  'creativeTruthPolicySchema',
  'videoShotSchema',
  'MEDIA_URL',
  'META_IMAGE_HASH',
  'META_VIDEO_ID',
  'META_SOURCE_CREATIVE_ID',
  'DRIVE_FILE_ID',
]) {
  if (!contracts.includes(marker)) {
    console.error(`Creative Truth contract missing: ${marker}`);
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

const resolver = readFileSync('src/creative/creative-truth-resolver.ts', 'utf8');
for (const marker of ['resolveVideoShots', 'VIDEO_SHOT_RIGHTS_NOT_CLEARED', 'FAILED_LINEAGE_MISSING']) {
  if (!resolver.includes(marker)) {
    console.error(`Creative Truth resolver missing canonical video resolution: ${marker}`);
    process.exit(1);
  }
}

const registry = readFileSync('src/providers/google-sheets/creative-truth-registry.ts', 'utf8');
if (
  !registry.includes('VIDEO_SHOTS!A2:Q2000') ||
  !registry.includes('getVideoShot') ||
  !registry.includes('listVideoShots')
) {
  console.error('VIDEO_SHOTS must be a first-class Creative Truth registry');
  process.exit(1);
}

const localCreative = readFileSync('src/providers/local/local-creative-composer.ts', 'utf8');
if (!localCreative.includes('CREATIVE_MASTER_HASH_MISMATCH')) {
  console.error('Static creative bytes must match the verified marketing-ready master hash');
  process.exit(1);
}

const localStory = readFileSync('src/providers/local/local-story-composer.ts', 'utf8');
if (
  !localStory.includes('LocalCreativeComposer') ||
  !localStory.includes('LOCAL_STORY_COMPOSER_MASTER_BINDING_MISMATCH') ||
  localStory.includes('brandLabel')
) {
  console.error('Story composition must use Creative Truth and official logo files only');
  process.exit(1);
}

const localVideo = readFileSync('src/providers/local/local-video-composer.ts', 'utf8');
for (const marker of [
  'VIDEO_SHOT_REGISTRY_BINDING_REQUIRED',
  'VIDEO_SHOT_MASTER_HASH_MISMATCH',
  'VIDEO_SHOT_RIGHTS_NOT_CLEARED',
]) {
  if (!localVideo.includes(marker)) {
    console.error(`Video Creative Truth binding missing: ${marker}`);
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

const gcsStager = readFileSync('src/providers/gcp/gcs-publication-asset-stager.ts', 'utf8');
for (const marker of ['video/mp4', 'validatePublicMediaUrl', "return 'mp4'"]) {
  if (!gcsStager.includes(marker)) {
    console.error(`Reel staging is not Creative Truth publication-ready: ${marker}`);
    process.exit(1);
  }
}

const managedScheduler = readFileSync(
  'src/scheduler/toca-managed-instagram-scheduler.ts',
  'utf8',
);
for (const marker of [
  'creativeTruthBinding',
  'TOCA_MANAGED_INSTAGRAM_CREATIVE_TRUTH_HASH_MISMATCH',
  'createVerifiedDeliveryUrl',
  'TOCA_MANAGED_INSTAGRAM_REEL_MP4_REQUIRED',
  'TOCA_MANAGED_INSTAGRAM_CAROUSEL_REQUIRES_MULTI_ASSET_DESCRIPTOR',
]) {
  if (!managedScheduler.includes(marker)) {
    console.error(`TOCA-managed publication Creative Truth boundary missing: ${marker}`);
    process.exit(1);
  }
}

const managedRuntime = readFileSync(
  'src/worker/toca-managed-instagram-worker-runtime.ts',
  'utf8',
);
if (!managedRuntime.includes('new InstagramPublicationExecutor(store, transport, undefined, true)')) {
  console.error('TOCA-managed Instagram runtime must require Creative Truth binding');
  process.exit(1);
}

const gcsDelivery = readFileSync('src/providers/gcp/gcs-publication-asset-delivery.ts', 'utf8');
if (
  !gcsDelivery.includes('createVerifiedDeliveryUrl') ||
  !gcsDelivery.includes('PUBLICATION_ASSET_SHA256_MISMATCH') ||
  !gcsDelivery.includes('video/mp4')
) {
  console.error('GCS delivery must verify exact approved image/Reel bytes before publication');
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
