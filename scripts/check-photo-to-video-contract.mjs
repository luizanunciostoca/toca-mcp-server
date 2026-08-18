import { existsSync, readFileSync } from 'node:fs';

const requiredFiles = [
  'control/photo-to-video-policy.v1.json',
  'src/contracts/photo-to-video.ts',
  'src/providers/google-sheets/photo-to-video-registry.ts',
  'src/providers/google-drive/creative-video-source-loader.ts',
  'src/providers/local/local-photo-motion-video-composer.ts',
  'src/providers/local/local-photo-to-video-brand-composer.ts',
  'src/providers/openai/openai-scene-continuation-video-provider.ts',
  'src/creative/controlled-photo-to-video-generation.ts',
  'src/creative/controlled-photo-to-video-finalization.ts',
  'src/marketing-autopilot-video-generate.ts',
  'src/marketing-autopilot-video-finalize.ts',
  'docs/architecture/photo-to-video-routes-v1.md',
];
for (const path of requiredFiles) {
  if (!existsSync(path)) fail(`Photo-to-video contract file missing: ${path}`);
}

requireIncludes('control/photo-to-video-policy.v1.json', [
  'TOCA_PHOTO_TO_VIDEO_POLICY_V1',
  'REAL_PHOTO_TO_MOTION_VIDEO',
  'GENERATIVE_SCENE_CONTINUATION_VIDEO',
  'likenessConsentRequiredWhenPeoplePresent',
  'OPENAI_VIDEO_API',
  'sora-2',
  'fullSyntheticVenueVideoWithoutSourceImage',
  'UNSUPPORTED_V1',
]);

requireIncludes('src/contracts/photo-to-video.ts', [
  'photoToVideoRouteTypeSchema',
  'photoToVideoCandidateManifestSchema',
  'photoToVideoReviewEvidenceSchema',
  'photoToVideoFinalManifestSchema',
  "publicationEligible: z.literal(false)",
  "publicationAuthorized: z.literal(false)",
]);

requireIncludes('src/providers/google-sheets/photo-to-video-registry.ts', [
  'PRODUCT_VISUAL_POLICIES!A1:I1000',
  'VIDEO_CREATIVE_STANDARDS!A1:N1000',
  'VIDEO_SOURCE_RIGHTS!A1:I2000',
  'VIDEO_GENERATIVE_EXCEPTIONS!A1:Q1000',
  'VIDEO_OUTPUTS!A1:Q5000',
  'GoogleSheetsThePartyContentOrchestration',
  'VIDEO_LIKENESS_CONSENT_REQUIRED',
  'VIDEO_SCENE_CONTINUATION_APPROVAL_BINDING_MISMATCH',
  'recordFinalOutput',
]);

requireIncludes('src/providers/google-drive/creative-video-source-loader.ts', [
  'expectedSha256',
  "url.searchParams.set('alt', 'media')",
  'VIDEO_SOURCE_DRIVE_HASH_MISMATCH',
]);

requireIncludes('src/providers/local/local-photo-motion-video-composer.ts', [
  'semanticGenerationUsed: false',
  'sceneExpansionAllowed: false',
  'zoompan=',
  'PHOTO_MOTION_SOURCE_HASH_MISMATCH',
]);

requireIncludes('src/providers/openai/openai-scene-continuation-video-provider.ts', [
  "const OPENAI_VIDEOS_ENDPOINT = 'https://api.openai.com/v1/videos'",
  "form.set('input_reference'",
  "form.set('seconds'",
  "form.set('size'",
  '/content',
  'sora-2-pro',
  'Do not generate, redraw, repair or hallucinate any logo',
  'requiresSceneContinuationFidelityGate: true',
]);

requireIncludes('src/providers/local/local-photo-to-video-brand-composer.ts', [
  'LocalPhotoToVideoBrandComposer',
  'heroBrand.aiGenerated !== false',
  'exactAssetBinding: true',
]);

requireIncludes('src/creative/controlled-photo-to-video-generation.ts', [
  'ControlledPhotoToVideoGenerationService',
  'registry.resolve(request.contentItemId, request.routeType)',
  'brandLoader.load',
  'publicationEligible: false',
  'PHOTO_TO_VIDEO_TRUSTED_CLOCK_INVALID',
]);

requireIncludes('src/creative/controlled-photo-to-video-finalization.ts', [
  'ControlledPhotoToVideoFinalizationService',
  'PHOTO_TO_VIDEO_FINAL_ASSET_HASH_MISMATCH',
  'PHOTO_TO_VIDEO_REVIEW_ASSET_BINDING_MISMATCH',
  'SCENE_CONTINUATION_FIDELITY_REVIEW_REQUIRED',
  'PHOTO_TO_VIDEO_CANONICAL_CONTEXT_CHANGED',
  'publicationAuthorized: false',
  'recordFinalOutput',
]);

requireIncludes('src/marketing-autopilot-video-generate.ts', [
  'GoogleSheetsPhotoToVideoRegistry',
  'OpenAiSceneContinuationVideoProvider',
  'LocalPhotoMotionVideoComposer',
  'VIDEO_GENERATE_CALLER_TIME_FORBIDDEN',
]);
requireIncludes('src/marketing-autopilot-video-finalize.ts', [
  'ControlledPhotoToVideoFinalizationService',
  'VIDEO_FINALIZE_CALLER_TIME_FORBIDDEN',
  'publicationAuthorized: false',
]);

requireIncludes('package.json', [
  'check-photo-to-video-contract.mjs',
  'dev:marketing-autopilot-video-generate',
  'dev:marketing-autopilot-video-finalize',
]);

console.log('Photo-to-video governed routes contract OK');

function requireIncludes(path, markers) {
  const content = readFileSync(path, 'utf8');
  for (const marker of markers) {
    if (!content.includes(marker)) fail(`Photo-to-video contract missing in ${path}: ${marker}`);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
