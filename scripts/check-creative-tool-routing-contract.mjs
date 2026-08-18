import { readFileSync } from 'node:fs';

const routing = JSON.parse(read('control/creative-tool-routing.v1.json'));
const generator = read('src/providers/openai/creative-truth-operation-scoped-image-generator.ts');
const generateCli = read('src/marketing-autopilot-image-generate.ts');
const finalizer = read('src/marketing-autopilot-image-finalize.ts');
const composer = read('src/providers/local/local-creative-composer.ts');
const storyComposer = read('src/providers/local/local-story-composer.ts');
const sunsetRenderer = read('src/providers/local/local-sunset-story-renderer.ts');
const sunsetStandard = JSON.parse(read('control/creative-standards/sunset-story-standard.v1.json'));

if (
  routing.status !== 'ACTIVE_CANONICAL_MIRROR' ||
  routing.sourceOfTruth?.canonicalPolicyVersion !== '1.3' ||
  routing.routing?.directImageGenerationFinalCreative !== 'DENY' ||
  routing.routing?.imageGenerationRole !== 'NON_FINAL_BACKGROUND_CANDIDATE_ONLY' ||
  routing.routing?.deterministicFinalizationRequired !== true ||
  routing.routing?.generativeExceptionMaySelfFinalize !== false ||
  routing.routing?.composerUnavailableBehavior !== 'FAIL_CLOSED_NO_FINAL_ASSET' ||
  routing.generatedCandidate?.modelRenderedBrandPixels !== 'DENY' ||
  routing.generatedCandidate?.modelRenderedMarketingText !== 'DENY' ||
  routing.finalAsset?.officialBrandAssetsOnly !== true ||
  routing.finalAsset?.brandAssetSha256Required !== true ||
  routing.finalAsset?.deterministicBrandInsertionRequired !== true ||
  routing.finalAsset?.exactAssetBindingRequired !== true ||
  routing.finalAsset?.publicationMayRecompose !== false ||
  routing.ag01?.mayReturnGeneratedCandidateAsFinalTocaCreative !== false ||
  routing.ag01?.mustFailClosedWhenDeterministicFinalizerUnavailable !== true ||
  routing.failureCodes?.directGenerativeFinalization !== 'FAILED_DIRECT_GENERATIVE_FINALIZATION'
) {
  fail('Creative tool routing canonical mirror is not fail-closed');
}

for (const marker of [
  'Leave final branding to the deterministic compositor using official registered files.',
  'Do not add marketing text, CTA, event time, price, sponsor mark or fabricated signage into the generated pixels.',
  'The generated pixels are NOT approved final creative.',
]) {
  if (!generator.includes(marker)) {
    fail(`Generative provider can bypass deterministic finalization: ${marker}`);
  }
}

for (const marker of [
  "status: 'GENERATED_REVIEW_REQUIRED'",
  'readyForFinalComposition: false',
  'publicationEligible: false',
]) {
  if (!generateCli.includes(marker)) {
    fail(`Generation CLI no longer proves candidate-only state: ${marker}`);
  }
}

for (const marker of [
  'GoogleDriveCreativeTruthBrandAssetLoader',
  'createControlledOperationScopedGenerativeFinalizationService',
  'brandLoader.load(canonicalBrand)',
  'publicationAuthorized: false',
]) {
  if (!finalizer.includes(marker)) {
    fail(`Controlled finalizer invariant missing: ${marker}`);
  }
}

for (const marker of [
  'observedDriveFileId: entry.driveFileId',
  'observedSha256: sha256(entry.bytes)',
  'requireGatePassed(brandGate)',
  'exactAssetBinding: true',
]) {
  if (!composer.includes(marker)) {
    fail(`Deterministic compositor exact-brand invariant missing: ${marker}`);
  }
}

for (const marker of [
  "input.creativeMode === 'GENERATIVE_EXCEPTION'",
  'GENERATIVE_EXCEPTION_REQUIRES_OPERATION_SCOPED_PIPELINE',
]) {
  if (!storyComposer.includes(marker)) {
    fail(`Story composer can bypass controlled generative routing: ${marker}`);
  }
}

for (const activeEntrypoint of [generateCli, finalizer]) {
  if (activeEntrypoint.includes('LocalCreativeComposer') || activeEntrypoint.includes('LocalStoryComposer')) {
    fail('Generative entrypoint imports a generic local composer instead of controlled operation-scoped services');
  }
}

for (const marker of [
  'SUNSET_STORY_REQUIRED_BRANDS',
  'SUNSET_STORY_REQUIRED_BRAND_ASSET_IDS',
  'buildSunsetStoryArgs',
  'exactAssetBinding: true',
]) {
  if (!sunsetRenderer.includes(marker)) {
    fail(`Dedicated Sunset renderer invariant missing: ${marker}`);
  }
}

if (
  sunsetStandard.standardVersion !== '1.2' ||
  sunsetStandard.toolRouting?.directImageGenerationFinalization !== 'DENY' ||
  sunsetStandard.toolRouting?.imageGenerationRole !== 'GENERATIVE_EXCEPTION_CANDIDATE_ONLY' ||
  sunsetStandard.toolRouting?.finalizer !== 'LOCAL_SUNSET_STORY_RENDERER_V1' ||
  sunsetStandard.toolRouting?.genericFinalizerAllowed !== false ||
  sunsetStandard.toolRouting?.officialBrandAssetByteBindingRequired !== true ||
  sunsetStandard.toolRouting?.modelRenderedLogoAllowed !== false ||
  sunsetStandard.toolRouting?.modelRenderedMarketingTextAllowed !== false ||
  sunsetStandard.toolRouting?.composerUnavailableBehavior !== 'FAIL_CLOSED'
) {
  fail('SUNSET_STORY_V1 does not preserve the dedicated brand-safe tool-routing contract');
}

console.log('Creative tool routing fail-closed contract OK');

function read(path) {
  return readFileSync(path, 'utf8');
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
