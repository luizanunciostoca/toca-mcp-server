import { existsSync, readFileSync } from 'node:fs';

const requiredFiles = [
  'control/creative-truth-policy.v1.json',
  'control/creative-standards/sunset-story-standard.v1.json',
  'control/creative-standards/sunset-feed-standard.v1.json',
  'control/creative-standards/sunset-ad-standard.v1.json',
  'control/creative-standards/toca-video-standard.v1.json',
  'control/creative-standards/toca-thumbnail-standard.v1.json',
  'src/contracts/creative-truth.ts',
  'src/creative/creative-truth.ts',
  'src/creative/creative-truth-resolver.ts',
  'src/content/video.ts',
  'src/content/video-thumbnail-creative-truth.ts',
  'src/providers/google-sheets/creative-truth-registry.ts',
  'src/providers/gcp/gcs-publication-asset-stager.ts',
  'src/providers/gcp/gcs-publication-asset-delivery.ts',
  'src/providers/local/local-photo-enhancer.ts',
  'src/providers/local/local-creative-composer.ts',
  'src/providers/local/local-story-composer.ts',
  'src/providers/local/local-thumbnail-composer.ts',
  'src/providers/local/local-video-composer.ts',
  'src/providers/openai/openai-image-edit-provider.ts',
  'src/providers/openai/creative-truth-openai-image-enhancer.ts',
  'src/marketing-autopilot-image-edit.ts',
  'src/providers/meta-ads/meta-ads-controlled-write.ts',
  'src/scheduler/toca-managed-instagram-scheduler.ts',
  'src/worker/instagram-publication-composition.ts',
  'src/worker/toca-managed-instagram-worker-runtime.ts',
  'docs/architecture/creative-truth-and-venue-fidelity.md',
];

const missing = requiredFiles.filter((path) => !existsSync(path));
if (missing.length > 0) fail(`Creative Truth architecture files missing: ${missing.join(', ')}`);

const policy = JSON.parse(read('control/creative-truth-policy.v1.json'));
const requiredGateSet = new Set(policy.requiredGates ?? []);
if (
  policy.policyId !== 'TOCA_CREATIVE_TRUTH_POLICY_V1' ||
  policy.status !== 'ACTIVE_CANONICAL' ||
  policy.rules?.aiLogoReconstructionAllowed !== false ||
  policy.rules?.architecturalInventionAllowed !== false ||
  policy.rules?.environmentDriftAllowed !== false ||
  policy.rules?.enhancementProvenanceRequired !== true ||
  policy.rules?.videoRealPlusEnhancement !== 'FAIL_CLOSED_UNTIL_SHOT_LEVEL_PROVENANCE' ||
  policy.rules?.videoEnhancementFailure !== 'VIDEO_ENHANCEMENT_PROVENANCE_UNSUPPORTED' ||
  policy.rules?.failClosed !== true ||
  policy.generativeException?.venueReferenceSetRequired !== 'TOCA_VENUE_REFERENCE_SET_V1' ||
  policy.generativeException?.minimumVerifiedReferences !== 3 ||
  policy.generativeException?.architecturalInventionStillForbidden !== true ||
  policy.generativeException?.environmentDriftStillForbidden !== true ||
  !Array.isArray(policy.requiredGates) ||
  policy.requiredGates.length !== 3 ||
  requiredGateSet.size !== 3 ||
  !requiredGateSet.has('BRAND_INTEGRITY') ||
  !requiredGateSet.has('VENUE_FIDELITY') ||
  !requiredGateSet.has('QUALITY') ||
  policy.publicationBoundary?.exactAssetBindingRequired !== true ||
  policy.failureCodes?.includes('FAILED_ENHANCEMENT_PROVENANCE') !== true ||
  policy.failureCodes?.includes('FAILED_FIDELITY_EVIDENCE_BINDING') !== true ||
  policy.failureCodes?.includes('FAILED_GENERATIVE_OUTPUT_REVIEW_MISSING') !== true
) {
  fail('Creative Truth parent policy violates the fail-closed contract');
}

requireIncludes('src/contracts/creative-truth.ts', [
  'creativeTruthPolicySchema',
  'enhancementProvenanceRequired: z.literal(true)',
  "videoRealPlusEnhancement: z.literal('FAIL_CLOSED_UNTIL_SHOT_LEVEL_PROVENANCE')",
  "videoEnhancementFailure: z.literal('VIDEO_ENHANCEMENT_PROVENANCE_UNSUPPORTED')",
  'minimumVerifiedReferences: z.number().int().min(3)',
  'referenceSetId: z.literal(TOCA_VENUE_REFERENCE_SET_ID)',
  'minReferenceCount: z.number().int().min(3).default(3)',
  'allowArchitecturalInvention: z.literal(false)',
  'allowEnvironmentDrift: z.literal(false)',
  'allowAiLogoGeneration: z.literal(false)',
  'PASSED Creative Truth gates cannot contain failure codes',
  'FAILED Creative Truth gates require at least one failure code',
  'Render manifests require BRAND_INTEGRITY, VENUE_FIDELITY and QUALITY exactly once',
  'creativeEnhancementProvenanceSchema',
  'fidelityVerificationMethodSchema',
  'candidateSha256',
  'sourceSha256',
  'reviewRef',
  'FAILED_FIDELITY_EVIDENCE_BINDING',
  'FAILED_GENERATIVE_OUTPUT_REVIEW_MISSING',
  'policyId: z.literal(TOCA_CREATIVE_TRUTH_POLICY_ID)',
  "creativeMode: z.literal('REAL_PLUS_ENHANCEMENT')",
  'enhancementProvenance: creativeEnhancementProvenanceSchema.optional()',
  'FAILED_ENHANCEMENT_PROVENANCE',
  'videoShotSchema',
  'MEDIA_URL',
  'META_IMAGE_HASH',
  'META_VIDEO_ID',
  'META_SOURCE_CREATIVE_ID',
  'DRIVE_FILE_ID',
]);

const policyContract = read('src/contracts/creative-truth.ts');
if (!policyContract.includes('export const creativeTruthPolicySchema')) {
  fail('Creative Truth policy schema missing');
}

for (const path of [
  'control/creative-standards/sunset-story-standard.v1.json',
  'control/creative-standards/sunset-feed-standard.v1.json',
  'control/creative-standards/sunset-ad-standard.v1.json',
  'control/creative-standards/toca-video-standard.v1.json',
  'control/creative-standards/toca-thumbnail-standard.v1.json',
]) {
  const standard = JSON.parse(read(path));
  if (
    standard.parentPolicyId !== 'TOCA_CREATIVE_TRUTH_POLICY_V1' ||
    standard.status !== 'ACTIVE_CANONICAL'
  ) {
    fail(`Creative standard is not bound to Creative Truth: ${path}`);
  }
}

const thumbnailStandard = JSON.parse(
  read('control/creative-standards/toca-thumbnail-standard.v1.json'),
);
if (
  thumbnailStandard.standardId !== 'TOCA_THUMBNAIL_V1' ||
  thumbnailStandard.r29Boundary?.videoThumbnailGenerateIsNonFinalRenderIntent !== true ||
  thumbnailStandard.r29Boundary?.finalThumbnailBytesMustComeFromCreativeTruthComposer !== true ||
  thumbnailStandard.creativeTruth?.aiLogoReconstructionForbidden !== true ||
  thumbnailStandard.creativeTruth?.architectureInventionForbidden !== true
) {
  fail('Toca thumbnail standard must keep R29 thumbnail intent non-final and Creative Truth-bound');
}

const storyStandard = JSON.parse(
  read('control/creative-standards/sunset-story-standard.v1.json'),
);
if (
  storyStandard.referencePolicy?.derivedExamplesClassification !==
    'VISUAL_DIRECTION_REFERENCE_ONLY' ||
  storyStandard.referencePolicy?.venueTruthComesOnlyFromVenueRegistry !== true
) {
  fail('Synthetic Sunset examples must never become venue truth');
}

requireIncludes('src/creative/creative-truth.ts', [
  'TOCA_VENUE_REFERENCE_SET_ID',
  'FAILED_AI_LOGO_RECONSTRUCTION',
  'FAILED_SCENE_INVENTION_DETECTED',
  'FAILED_ARCHITECTURE_DRIFT',
  'FAILED_UNAPPROVED_GENERATIVE_EXCEPTION',
  'FAILED_GENERATIVE_REFERENCE_MISSING',
  'FAILED_FIDELITY_EVIDENCE_BINDING',
  'FAILED_GENERATIVE_OUTPUT_REVIEW_MISSING',
  'approval.contentItemId !== input.contentItemId',
  'approval.minReferenceCount < 3',
  'Math.max(3, approval.minReferenceCount)',
  '!Number.isFinite(nowTimestamp)',
  '!Number.isFinite(expiresTimestamp)',
  'validateEvidenceCandidateBinding',
  'candidateSha256',
  'reviewRef',
  'MULTIMODAL_PLUS_HUMAN',
  'buildCreativeTruthPublicationBinding',
]);

requireIncludes('src/creative/creative-truth-resolver.ts', [
  'resolveVideoShots',
  'VIDEO_SHOT_RIGHTS_NOT_CLEARED',
  'FAILED_LINEAGE_MISSING',
]);

requireIncludes('src/content/video.ts', [
  'CreativeTruthPublicationBinding',
  'creativeTruthPublicationBindingSchema',
  'finalAssetSha256',
  'VIDEO_EXPORT_CREATIVE_TRUTH_BINDING_INVALID',
  'VIDEO_EXPORT_CREATIVE_TRUTH_HASH_MISMATCH',
  'Prepare non-final thumbnail render-intent manifest',
]);

requireIncludes('src/content/video-thumbnail-creative-truth.ts', [
  "const TOCA_THUMBNAIL_STANDARD_ID = 'TOCA_THUMBNAIL_V1'",
  'R29_VIDEO_THUMBNAIL_CREATIVE_TRUTH_STANDARD_MISMATCH',
  'R29_VIDEO_THUMBNAIL_CREATIVE_TRUTH_CONTENT_MISMATCH',
  'R29_VIDEO_THUMBNAIL_CREATIVE_TRUTH_HASH_MISMATCH',
  'assertCreativeReadyForPublication',
]);

requireIncludes('src/providers/google-sheets/creative-truth-registry.ts', [
  'POLICY!A2:R20',
  "const CREATIVE_TRUTH_PLAN_DRIVE_ID = '1UR_LD8Gw4rlQkGsYh-VGW1ns8AzEx_m4fazpcCW-2wM'",
  "const CANONICAL_DEFAULT_MODES = ['REAL_COMPOSITE', 'REAL_PLUS_ENHANCEMENT']",
  "cell(policy[3]) !== 'TOCA_DO_MORCEGO'",
  "cell(policy[5]) !== 'GENERATIVE_EXCEPTION'",
  '!bool(policy[6])',
  '!bool(policy[7])',
  '!bool(policy[8])',
  '!bool(policy[9])',
  '!bool(policy[10])',
  '!bool(policy[11])',
  'cell(policy[12]) !== CREATIVE_TRUTH_PLAN_DRIVE_ID',
  '!bool(policy[14])',
  'FAIL_CLOSED_UNTIL_SHOT_LEVEL_PROVENANCE',
  'VIDEO_ENHANCEMENT_PROVENANCE_UNSUPPORTED',
  "cell(policy[17]) !== 'UNSUPPORTED_V1'",
  'VIDEO_SHOTS!A2:Q2000',
  'getVideoShot',
  'listVideoShots',
]);

requireIncludes('src/providers/local/local-photo-enhancer.ts', [
  'LOCAL_PHOTO_ENHANCER_CREATIVE_TRUTH_REQUIRED',
  'creativeEnhancementProvenanceSchema',
  'policyId: TOCA_CREATIVE_TRUTH_POLICY_ID',
  "creativeMode: 'REAL_PLUS_ENHANCEMENT'",
  'requiresVenueFidelityGate: true',
]);

requireIncludes('src/providers/openai/creative-truth-openai-image-enhancer.ts', [
  'creativeEnhancementProvenanceSchema',
  'policyId: TOCA_CREATIVE_TRUTH_POLICY_ID',
  "creativeMode: 'REAL_PLUS_ENHANCEMENT'",
  'OPENAI_ENHANCEMENT_SOURCE_BINDING_REQUIRED',
  'sha256(input.imageBytes)',
  'sha256(result.outputBytes)',
]);

requireIncludes('src/marketing-autopilot-image-edit.ts', [
  'CreativeTruthOpenAiImageEnhancer',
  'creativeTruthPolicyId: result.policyId',
  'creativeTruthBound: result.creativeTruthBound',
  'creativeMode: result.creativeMode',
]);

requireIncludes('src/providers/local/local-creative-composer.ts', [
  'CREATIVE_MASTER_HASH_MISMATCH',
  'FAILED_ENHANCEMENT_PROVENANCE',
  'FAILED_STANDARD_NOT_RESOLVED',
  'creativeEnhancementProvenanceSchema',
  "provenance.creativeMode !== 'REAL_PLUS_ENHANCEMENT'",
  'provenance.outputSha256 !== sha256(input.sourceImageBytes)',
  'contentItemId: input.contentItemId',
  'candidateSha256: sha256(input.sourceImageBytes)',
  "input.standard.operation !== 'ALL' && venue.operation !== input.standard.operation",
  'enhancementProvenance: input.enhancementProvenance',
]);

const storyComposer = read('src/providers/local/local-story-composer.ts');
for (const marker of [
  'LocalCreativeComposer',
  'LOCAL_STORY_COMPOSER_MASTER_BINDING_MISMATCH',
  'enhancementProvenance',
]) {
  if (!storyComposer.includes(marker)) fail(`Story Creative Truth binding missing: ${marker}`);
}
if (storyComposer.includes('brandLabel')) {
  fail('Story composition must not use literal text as a brand/logo substitute');
}

requireIncludes('src/providers/local/local-thumbnail-composer.ts', [
  'TOCA_THUMBNAIL_V1',
  'TOCA_THUMBNAIL_STANDARD_REQUIRED',
  'LocalCreativeComposer',
  'assertVideoThumbnailCreativeTruth',
  'brandAssets',
  'manifest: composed.manifest',
]);

requireIncludes('src/providers/local/local-video-composer.ts', [
  'VIDEO_SHOT_REGISTRY_BINDING_REQUIRED',
  'VIDEO_SHOT_MASTER_HASH_MISMATCH',
  'VIDEO_SHOT_RIGHTS_NOT_CLEARED',
  'VIDEO_ENHANCEMENT_PROVENANCE_UNSUPPORTED',
  'VIDEO_GENERATIVE_EXCEPTION_UNSUPPORTED',
  'VIDEO_GENERATIVE_CONTEXT_NOT_ALLOWED',
  'LocalVideoEditManifest',
  'VIDEO_EDIT_MANIFEST_INCOMPLETE',
  'exactMasterByteBinding',
]);

requireIncludes('src/providers/openai/openai-image-edit-provider.ts', [
  'buildTocaImageEditPrompt',
  'creativeTruthBound',
]);

requireIncludes('src/providers/gcp/gcs-publication-asset-stager.ts', [
  'video/mp4',
  'validatePublicMediaUrl',
  "return 'mp4'",
]);

requireIncludes('src/providers/gcp/gcs-publication-asset-delivery.ts', [
  'createVerifiedDeliveryUrl',
  'PUBLICATION_ASSET_SHA256_MISMATCH',
  'video/mp4',
]);

requireIncludes('src/worker/instagram-publication-composition.ts', [
  'new InstagramPublicationExecutor',
  'true,',
]);

requireIncludes('src/scheduler/toca-managed-instagram-scheduler.ts', [
  'creativeTruthBinding',
  'TOCA_MANAGED_INSTAGRAM_CREATIVE_TRUTH_HASH_MISMATCH',
  'createVerifiedDeliveryUrl',
  'TOCA_MANAGED_INSTAGRAM_REEL_MP4_REQUIRED',
  'TOCA_MANAGED_INSTAGRAM_CAROUSEL_REQUIRES_MULTI_ASSET_DESCRIPTOR',
]);

requireIncludes('src/worker/toca-managed-instagram-worker-runtime.ts', [
  'new InstagramPublicationExecutor(store, transport, undefined, true)',
]);

requireIncludes('src/providers/instagram/instagram-publication-executor.ts', [
  'CREATIVE_TRUTH_ASSET_LOCATOR_MISMATCH',
]);

requireIncludes('src/providers/meta-ads/meta-ads-controlled-write.ts', [
  'META_ADS_CREATIVE_TRUTH_BINDING_REQUIRED',
  'META_ADS_CREATIVE_TRUTH_ASSET_LOCATOR_MISMATCH',
  'allowUnboundCreativeForProviderValidation',
]);

console.log('Creative Truth architecture contract OK');

function read(path) {
  return readFileSync(path, 'utf8');
}

function requireIncludes(path, markers) {
  const content = read(path);
  for (const marker of markers) {
    if (!content.includes(marker)) fail(`Creative Truth contract missing in ${path}: ${marker}`);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
