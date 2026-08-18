import { readFileSync } from 'node:fs';

const standard = JSON.parse(read('control/creative-standards/sunset-story-standard.v1.json'));
const storyComposer = read('src/providers/local/local-story-composer.ts');
const renderer = read('src/providers/local/local-sunset-story-renderer.ts');
const tests = read('test/local-story-composer.test.ts');

const requiredBrands = ['TOCA_DO_MORCEGO', 'CORONA', 'RED_BULL', 'MORRO_DIGITAL'];
const requiredAssetIds = [
  'BRAND-TOCA-WHITE-V1',
  'BRAND-CORONA-WHITE-V1',
  'BRAND-REDBULL-WHITE-V1',
  'BRAND-MORRO-WHITE-V1',
];

if (
  standard.standardId !== 'SUNSET_STORY_V1' ||
  standard.standardVersion !== '1.2' ||
  standard.rendererContract?.rendererId !== 'LOCAL_SUNSET_STORY_RENDERER_V1' ||
  standard.rendererContract?.dedicatedRendererRequired !== true ||
  standard.rendererContract?.genericRendererFallbackAllowed !== false ||
  standard.toolRouting?.finalizer !== 'LOCAL_SUNSET_STORY_RENDERER_V1' ||
  standard.toolRouting?.genericFinalizerAllowed !== false
) {
  fail('SUNSET_STORY_V1 dedicated renderer routing is not canonical/fail-closed');
}

if (
  standard.canvas?.width !== 1080 ||
  standard.canvas?.height !== 1920 ||
  standard.safeArea?.brandFooterTopPx !== 1680 ||
  standard.safeArea?.brandFooterBottomPx !== 1830 ||
  standard.layoutSystem?.footer?.slotTopPx !== 1700 ||
  JSON.stringify(standard.layoutSystem?.footer?.slotLeftPx) !== JSON.stringify([45, 270, 495, 720])
) {
  fail('SUNSET_STORY_V1 grid/footer geometry drift detected');
}

if (
  standard.brandFooter?.required !== true ||
  standard.brandFooter?.allFourRequired !== true ||
  standard.brandFooter?.orderFixed !== true ||
  JSON.stringify(standard.brandFooter?.requiredBrands) !== JSON.stringify(requiredBrands) ||
  JSON.stringify(standard.brandFooter?.requiredBrandAssetIds) !== JSON.stringify(requiredAssetIds)
) {
  fail('SUNSET_STORY_V1 mandatory sponsor footer contract drift detected');
}

for (const template of [
  'SUNSET_HERO_LIFESTYLE',
  'SUNSET_VIEW_SCENERY',
  'SUNSET_SOCIAL_EXPERIENCE',
  'SUNSET_DRINKS_EXPERIENCE',
  'SUNSET_INFO_HOURS',
]) {
  if (!standard.layoutSystem?.templatePresets?.[template]) {
    fail(`SUNSET_STORY_V1 missing fixed layout preset: ${template}`);
  }
}

for (const marker of [
  "SUNSET_STORY_STANDARD_ID = 'SUNSET_STORY_V1'",
  "SUNSET_STORY_STANDARD_VERSION = '1.2'",
  'export function buildSunsetStoryArgs',
  'SUNSET_STORY_REQUIRED_BRANDS',
  'SUNSET_STORY_REQUIRED_BRAND_ASSET_IDS',
  "entry.registry.variant === 'WHITE'",
  "throw new ExecutionError('POLICY_DENIED', 'FAILED_BRAND_ASSET_MISSING'",
  'rectangle 0,1600 ${CANVAS_WIDTH},${CANVAS_HEIGHT}',
  'FOOTER_SLOT_TOP = 1700',
  "headlineFont: HEADLINE_FONT",
  "dedicatedRenderer: 'SUNSET_STORY_V1'",
  'exactAssetBinding: true',
]) {
  if (!renderer.includes(marker)) {
    fail(`Dedicated Sunset renderer invariant missing: ${marker}`);
  }
}

for (const marker of [
  'LocalSunsetStoryRenderer',
  'input.standard.standardId === SUNSET_STORY_STANDARD_ID',
  'resolveSunsetTemplateClass(input)',
]) {
  if (!storyComposer.includes(marker)) {
    fail(`Story routing can bypass dedicated Sunset renderer: ${marker}`);
  }
}

for (const marker of [
  'fails closed when any mandatory Sunset sponsor asset is absent',
  'fails closed when the caller omits a mandatory brand from requiredBrands',
  'rejects stale Sunset Story standard versions instead of silently rendering them',
  "standardVersion: '1.2'",
]) {
  if (!tests.includes(marker)) {
    fail(`Sunset renderer regression test missing: ${marker}`);
  }
}

console.log('SUNSET_STORY_V1 dedicated renderer contract OK');

function read(path) {
  return readFileSync(path, 'utf8');
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
