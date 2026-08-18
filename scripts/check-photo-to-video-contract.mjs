import { existsSync, readFileSync } from 'node:fs';

const requiredFiles = [
  'control/photo-to-video-policy.v1.json',
  'src/contracts/photo-to-video.ts',
  'src/providers/google-sheets/photo-to-video-registry.ts',
  'src/providers/google-sheets/photo-to-video-content-writeback.ts',
  'src/providers/google-drive/creative-video-source-loader.ts',
  'src/providers/gcp/gcs-photo-to-video-artifact-store.ts',
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
  'evidenceRef: z.string().trim().min(1)',
  'validatedAt: z.string().trim().min(1)',
  'artifactRef:',
  'artifactObjectName:',
  'sourceImageCompared: z.literal(true)',
  'architectureDriftDetected: z.literal(false)',
  'environmentDriftDetected: z.literal(false)',
  'aiLogoReconstructionDetected: z.literal(false)',
  "publicationEligible: z.literal(false)",
  "publicationAuthorized: z.literal(false)",
]);

requireIncludes('src/providers/google-sheets/photo-to-video-registry.ts', [
  'PRODUCT_VISUAL_POLICIES!A1:I1000',
  'VIDEO_CREATIVE_STANDARDS!A1:N1000',
  'VIDEO_SOURCE_RIGHTS!A1:I2000',
  'VIDEO_GENERATIVE_EXCEPTIONS!A1:Q1000',
  'VIDEO_OUTPUTS!A1:T5000',
  'GoogleSheetsThePartyContentOrchestration',
  'effectiveContent = { ...content, thePartyContext: partyContext }',
  'VIDEO_LIKENESS_CONSENT_REQUIRED',
  'VIDEO_SCENE_CONTINUATION_APPROVAL_BINDING_MISMATCH',
  'PHOTO_TO_VIDEO_TRUSTED_CLOCK_INVALID',
  "requireHeader(headers, 'review_method'",
  "requireHeader(headers, 'review_evidence_ref'",
  "requireHeader(headers, 'source_image_compared'",
  'recordFinalOutput',
]);

requireIncludes('src/providers/google-sheets/photo-to-video-content-writeback.ts', [
  'GoogleSheetsPhotoToVideoContentWriteback',
  'video_candidate_sha256',
  'video_candidate_artifact_ref',
  'video_final_asset_sha256',
  'video_final_artifact_ref',
  'video_output_evidence_id',
  'VIDEO_DIFFERENT_CANDIDATE_ALREADY_RECORDED',
  'VIDEO_CONTENT_CANDIDATE_BINDING_CHANGED',
  'VIDEO_CREATIVE_TRUTH_PASSED',
]);

requireIncludes('src/providers/google-drive/creative-video-source-loader.ts', [
  'expectedSha256',
  "url.searchParams.set('alt', 'media')",
  'VIDEO_SOURCE_DRIVE_HASH_MISMATCH',
]);

requireIncludes('src/providers/gcp/gcs-photo-to-video-artifact-store.ts', [
  'GcsPhotoToVideoArtifactStore',
  'GcsPublicationAssetStager',
  'GcsPublicationAssetDelivery',
  'PHOTO_TO_VIDEO_ARTIFACT_STAGE_HASH_MISMATCH',
  'PHOTO_TO_VIDEO_ARTIFACT_READBACK_HASH_MISMATCH',
  'loadExact',
]);

requireIncludes('src/providers/local/local-photo-motion-video-composer.ts', [
  'semanticGenerationUsed: false',
  'sceneExpansionAllowed: false',
  'zoompan=',
  'PHOTO_MOTION_SOURCE_HASH_MISMATCH',
]);

requireIncludes('src/providers/openai/openai-scene-continuation-video-provider.ts', [
  "const OPENAI_VIDEOS_ENDPOINT = 'https://api.openai.com/v1/videos'",
  "'input_reference'",
  "form.set('seconds'",
  "form.set('size'",
  '/content',
  'sora-2-pro',
  'approval.sourceAssetId !== request.sourceAssetId',
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
  'artifactStore.store',
  'candidateArtifactRef: manifest.artifactRef',
  'writeback.writeCandidate',
  'publicationEligible: false',
  'PHOTO_TO_VIDEO_TRUSTED_CLOCK_INVALID',
]);

requireIncludes('src/creative/controlled-photo-to-video-finalization.ts', [
  'ControlledPhotoToVideoFinalizationService',
  'artifactStore.loadExact',
  'PHOTO_TO_VIDEO_FINAL_ASSET_HASH_MISMATCH',
  'PHOTO_TO_VIDEO_REVIEW_ASSET_BINDING_MISMATCH',
  'SCENE_CONTINUATION_FIDELITY_REVIEW_REQUIRED',
  'PHOTO_TO_VIDEO_CANONICAL_CONTEXT_CHANGED',
  'finalArtifactRef: candidate.artifactRef',
  'writeback.writeFinal',
  'publicationAuthorized: false',
  'recordFinalOutput',
]);

requireIncludes('src/marketing-autopilot-video-generate.ts', [
  'GoogleSheetsPhotoToVideoRegistry',
  'GoogleSheetsPhotoToVideoContentWriteback',
  'GcsPhotoToVideoArtifactStore',
  'OpenAiSceneContinuationVideoProvider',
  'LocalPhotoMotionVideoComposer',
  'VIDEO_GENERATE_CALLER_TIME_FORBIDDEN',
]);
requireIncludes('src/marketing-autopilot-video-finalize.ts', [
  'ControlledPhotoToVideoFinalizationService',
  'GoogleSheetsPhotoToVideoContentWriteback',
  'GcsPhotoToVideoArtifactStore',
  'VIDEO_FINALIZE_CALLER_TIME_FORBIDDEN',
  'VIDEO_FINALIZE_CALLER_OUTPUT_FORBIDDEN',
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
    if (!content.includes(marker)) {
      fail(`Photo-to-video contract missing in ${path}: ${marker}`);
    }
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
