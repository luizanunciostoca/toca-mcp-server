import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const requiredFiles = [
  'control/creative-truth-policy.v1.json',
  'control/creative-tool-routing.v1.json',
  'control/creative-standards/sunset-story-standard.v1.json',
  'control/creative-standards/sunset-feed-standard.v1.json',
  'control/creative-standards/sunset-ad-standard.v1.json',
  'control/creative-standards/toca-video-standard.v1.json',
  'control/creative-standards/toca-thumbnail-standard.v1.json',
  'control/creative-standards/the-party-hybrid-networks-standard.v1.json',
  'control/creative-standards/the-party-hybrid-minimalist-standard.v1.json',
  'src/contracts/creative-truth.ts',
  'src/contracts/creative-truth-generative-reference-sets.ts',
  'src/creative/creative-truth.ts',
  'src/creative/creative-truth-resolver.ts',
  'src/creative/controlled-operation-scoped-static-image-generation.ts',
  'src/creative/controlled-operation-scoped-generative-finalization.ts',
  'src/providers/google-sheets/creative-truth-registry.ts',
  'src/providers/google-sheets/creative-truth-operation-scoped-generative-registry.ts',
  'src/providers/local/local-creative-composer.ts',
  'src/providers/local/local-story-composer.ts',
  'src/providers/local/local-sunset-story-renderer.ts',
  'src/providers/local/local-video-composer.ts',
  'src/providers/gcp/gcs-publication-asset-stager.ts',
  'src/providers/gcp/gcs-publication-asset-delivery.ts',
  'src/providers/meta-ads/meta-ads-controlled-write.ts',
  'src/scheduler/toca-managed-instagram-scheduler.ts',
  'src/marketing-autopilot-image-generate.ts',
  'src/marketing-autopilot-image-finalize.ts',
  'test/creative-truth-resolver.test.ts',
  'docs/architecture/creative-truth-and-venue-fidelity.md',
];

const missing = requiredFiles.filter((path) => !existsSync(path));
if (missing.length > 0) fail(`Creative Truth architecture files missing: ${missing.join(', ')}`);

const policy = json('control/creative-truth-policy.v1.json');
const routing = json('control/creative-tool-routing.v1.json');
const story = json('control/creative-standards/sunset-story-standard.v1.json');
const feed = json('control/creative-standards/sunset-feed-standard.v1.json');
const ad = json('control/creative-standards/sunset-ad-standard.v1.json');
const video = json('control/creative-standards/toca-video-standard.v1.json');
const thumbnail = json('control/creative-standards/toca-thumbnail-standard.v1.json');
const partyNetworks = json('control/creative-standards/the-party-hybrid-networks-standard.v1.json');
const partyMinimalist = json('control/creative-standards/the-party-hybrid-minimalist-standard.v1.json');

assertPolicyV13(policy);
assertRoutingV13(routing);
assertStandards({ story, feed, ad, video, thumbnail, partyNetworks, partyMinimalist });
assertRuntimeMarkers();
assertNoActiveLegacyDrift();

console.log('Creative Truth canonical contract + drift guard OK');

function assertPolicyV13(value) {
  const requiredGates = new Set(value.requiredGates ?? []);
  const generative = value.generativeException ?? {};
  const photoToVideo = value.photoToVideo ?? {};
  if (
    value.schemaVersion !== '1.3' ||
    value.policyVersion !== '1.3' ||
    value.policyId !== 'TOCA_CREATIVE_TRUTH_POLICY_V1' ||
    value.status !== 'ACTIVE_CANONICAL' ||
    value.sourceOfTruth?.registrySpreadsheetId !==
      '1bqF5zN5Lhesy_uls6gHMkOT-KLFRGo81OJMB_LPwXaU' ||
    value.rules?.officialBrandAssetsOnly !== true ||
    value.rules?.aiLogoReconstructionAllowed !== false ||
    value.rules?.architecturalInventionAllowed !== false ||
    value.rules?.environmentDriftAllowed !== false ||
    value.rules?.deterministicTextAndBrandCompositionRequired !== true ||
    value.rules?.assetLineageRequired !== true ||
    value.rules?.enhancementProvenanceRequired !== true ||
    value.rules?.videoRealPlusEnhancement !== 'FAIL_CLOSED_UNTIL_SHOT_LEVEL_PROVENANCE' ||
    value.rules?.videoEnhancementFailure !== 'VIDEO_ENHANCEMENT_PROVENANCE_UNSUPPORTED' ||
    value.rules?.videoPhotoMotion !== 'ACTIVE_V1' ||
    value.rules?.videoGenerativeException !== 'SOURCE_ANCHORED_SCENE_CONTINUATION_GOVERNED_V1' ||
    value.rules?.fullSyntheticVenueVideo !== 'UNSUPPORTED_V1' ||
    value.rules?.photoToVideoPolicyId !== 'TOCA_PHOTO_TO_VIDEO_POLICY_V1' ||
    value.rules?.exactApprovedAssetMustBePublished !== true ||
    value.rules?.failClosed !== true ||
    generative.explicitApprovalRequired !== true ||
    generative.approvalRecordRequired !== true ||
    generative.referenceStrategy !== 'OPERATION_SCOPED_ONLY_V1' ||
    generative.legacyReferenceSetId !== 'TOCA_VENUE_REFERENCE_SET_V1' ||
    generative.legacyReferenceSetStatus !== 'DEPRECATED' ||
    generative.legacyReferenceSetExecution !== 'DENY' ||
    generative.sunsetReferenceSetId !== 'TOCA_VENUE_REFERENCE_SET_SUNSET_V1' ||
    generative.thePartyReferenceSetId !== 'TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1' ||
    generative.crossOperationReferenceReuse !== 'FORBIDDEN' ||
    generative.referenceSetOperationMatch !== 'REQUIRED' ||
    generative.minimumVerifiedReferences < 3 ||
    photoToVideo.policyId !== 'TOCA_PHOTO_TO_VIDEO_POLICY_V1' ||
    photoToVideo.realPhotoToMotionVideo !== 'ACTIVE_V1' ||
    photoToVideo.generativeSceneContinuationVideo !== 'EXPLICIT_APPROVAL_AND_RIGHTS_REQUIRED' ||
    photoToVideo.canonicalSourcePhotoRequired !== true ||
    photoToVideo.canonicalSourceSha256Required !== true ||
    photoToVideo.marketingReadyMasterRequired !== true ||
    photoToVideo.rightsEvidenceRequired !== true ||
    photoToVideo.likenessConsentRequiredWhenPeoplePresentForSceneContinuation !== true ||
    photoToVideo.postGenerationHumanReviewRequired !== true ||
    photoToVideo.sceneContinuationFidelityGateRequired !== true ||
    photoToVideo.fullSyntheticVenueVideoWithoutCanonicalSourcePhoto !== 'UNSUPPORTED_V1' ||
    photoToVideo.publicationAuthorizedByGeneration !== false ||
    requiredGates.size !== 3 ||
    !requiredGates.has('BRAND_INTEGRITY') ||
    !requiredGates.has('VENUE_FIDELITY') ||
    !requiredGates.has('QUALITY') ||
    value.publicationBoundary?.allRequiredGatesMustPass !== true ||
    value.publicationBoundary?.outputSha256Required !== true ||
    value.publicationBoundary?.exactAssetBindingRequired !== true ||
    value.publicationBoundary?.publicationMayNotRebuildCreative !== true
  ) {
    fail('Creative Truth parent policy is not the canonical fail-closed v1.3 mirror');
  }
}

function assertRoutingV13(value) {
  if (
    value.status !== 'ACTIVE_CANONICAL_MIRROR' ||
    value.sourceOfTruth?.canonicalPolicyVersion !== '1.3' ||
    value.routing?.directImageGenerationFinalCreative !== 'DENY' ||
    value.routing?.imageGenerationRole !== 'NON_FINAL_BACKGROUND_CANDIDATE_ONLY' ||
    value.routing?.generativeExceptionMaySelfFinalize !== false ||
    value.routing?.deterministicFinalizationRequired !== true ||
    value.routing?.composerUnavailableBehavior !== 'FAIL_CLOSED_NO_FINAL_ASSET' ||
    value.generatedCandidate?.modelRenderedBrandPixels !== 'DENY' ||
    value.generatedCandidate?.modelRenderedMarketingText !== 'DENY' ||
    value.finalAsset?.officialBrandAssetsOnly !== true ||
    value.finalAsset?.brandAssetSha256Required !== true ||
    value.finalAsset?.deterministicBrandInsertionRequired !== true ||
    value.finalAsset?.exactAssetBindingRequired !== true ||
    value.finalAsset?.publicationMayRecompose !== false ||
    value.ag01?.mayReturnGeneratedCandidateAsFinalTocaCreative !== false
  ) {
    fail('Creative tool routing can drift from the canonical v1.3 policy');
  }
}

function assertStandards(values) {
  const all = Object.values(values);
  for (const standard of all) {
    if (
      standard.parentPolicyId !== 'TOCA_CREATIVE_TRUTH_POLICY_V1' ||
      standard.status !== 'ACTIVE_CANONICAL'
    ) {
      fail(`Creative standard is not bound to active Creative Truth: ${standard.standardId ?? 'UNKNOWN'}`);
    }
  }

  if (
    values.story.standardId !== 'SUNSET_STORY_V1' ||
    values.story.standardVersion !== '1.2' ||
    values.story.rendererContract?.rendererId !== 'LOCAL_SUNSET_STORY_RENDERER_V1' ||
    values.story.rendererContract?.dedicatedRendererRequired !== true ||
    values.story.rendererContract?.genericRendererFallbackAllowed !== false ||
    values.story.toolRouting?.finalizer !== 'LOCAL_SUNSET_STORY_RENDERER_V1' ||
    values.story.toolRouting?.genericFinalizerAllowed !== false ||
    values.story.brandFooter?.allFourRequired !== true ||
    values.story.brandFooter?.orderFixed !== true
  ) {
    fail('SUNSET_STORY_V1 drifted from canonical v1.2 dedicated-renderer rules');
  }

  if (values.feed.standardId !== 'SUNSET_FEED_V1' || values.ad.standardId !== 'SUNSET_AD_V1') {
    fail('Sunset Feed/Ads standards missing or replaced');
  }
  if (
    values.partyNetworks.standardId !== 'THE_PARTY_HYBRID_NETWORKS_V1' ||
    values.partyMinimalist.standardId !== 'THE_PARTY_HYBRID_MINIMALIST_V1'
  ) {
    fail('The Party active visual standards drifted to a deprecated placeholder');
  }
  if (values.thumbnail.standardId !== 'TOCA_THUMBNAIL_V1' || values.video.standardId !== 'TOCA_VIDEO_V1') {
    fail('Video/thumbnail Creative Truth standards missing');
  }
}

function assertRuntimeMarkers() {
  requireIncludes('src/contracts/creative-truth.ts', [
    "schemaVersion: z.literal('1.3')",
    "policyVersion: z.literal('1.3')",
    "referenceStrategy: z.literal('OPERATION_SCOPED_ONLY_V1')",
    "legacyReferenceSetStatus: z.literal('DEPRECATED')",
    "legacyReferenceSetExecution: z.literal('DENY')",
    "crossOperationReferenceReuse: z.literal('FORBIDDEN')",
    "referenceSetOperationMatch: z.literal('REQUIRED')",
    "videoPhotoMotion: z.literal('ACTIVE_V1')",
    "videoGenerativeException: z.literal('SOURCE_ANCHORED_SCENE_CONTINUATION_GOVERNED_V1')",
    "photoToVideoPolicyId: z.literal('TOCA_PHOTO_TO_VIDEO_POLICY_V1')",
    'photoToVideo: z.object({',
    'creativeEnhancementProvenanceSchema',
    'deterministicRenderManifestSchema',
    'creativeTruthPublicationBindingSchema',
  ]);
  requireIncludes('src/providers/google-sheets/creative-truth-registry.ts', [
    "MINIMUM_CREATIVE_TRUTH_POLICY_VERSION = '1.3'",
    'POLICY!A2:AK20',
    "cell(policy[17]) !== 'SOURCE_ANCHORED_SCENE_CONTINUATION_GOVERNED_V1'",
    "cell(policy[18]) !== 'OPERATION_SCOPED_ONLY_V1'",
    "cell(policy[26]) !== 'UNSUPPORTED_V1'",
    "cell(policy[27]) !== 'TOCA_PHOTO_TO_VIDEO_POLICY_V1'",
    "cell(policy[28]) !== 'ACTIVE_V1'",
    "cell(policy[29]) !== 'DENY'",
    "cell(policy[34]) !== 'FAIL_CLOSED_NO_FINAL_ASSET'",
    "cell(policy[35]) !== 'ENFORCED'",
  ]);
  requireIncludes('test/creative-truth-resolver.test.ts', [
    "range === 'POLICY!A2:AK20'",
    "'1.3'",
    'VENUE_VERIFIED_LEGACY_MASTER_REVALIDATION_REQUIRED',
    'does not auto-select a legacy venue whose master is no longer MARKETING_READY',
    'blocks an explicitly requested legacy venue until a v2 master is promoted',
  ]);
  requireExcludes('test/creative-truth-resolver.test.ts', ['POLICY!A2:R20']);
  requireIncludes('src/creative/controlled-operation-scoped-static-image-generation.ts', [
    'ControlledOperationScopedStaticImageGenerationService',
    'getContentItemOperation(contentItemId)',
    'referenceSetOperation(approval.referenceSetId) !== operation',
  ]);
  requireIncludes('src/creative/controlled-operation-scoped-generative-finalization.ts', [
    'createControlledOperationScopedGenerativeFinalizationService',
    'getContentItemCreativeStandardId',
    'assertCanonicalContentStandard',
    'GENERATIVE_FINALIZATION_CONTENT_STANDARD_REQUIRED',
    'GENERATIVE_FINALIZATION_CONTENT_STANDARD_MISMATCH',
  ]);
  requireIncludes('src/providers/local/local-story-composer.ts', [
    'LocalSunsetStoryRenderer',
    'SUNSET_STORY_STANDARD_ID',
    'resolveSunsetTemplateClass',
  ]);
  requireIncludes('src/providers/local/local-sunset-story-renderer.ts', [
    "SUNSET_STORY_STANDARD_VERSION = '1.2'",
    'SUNSET_STORY_REQUIRED_BRANDS',
    'SUNSET_STORY_REQUIRED_BRAND_ASSET_IDS',
    'buildSunsetStoryArgs',
    'exactAssetBinding: true',
  ]);
  requireIncludes('src/providers/local/local-creative-composer.ts', [
    'evaluateBrandIntegrity',
    'evaluateVenueFidelity',
    'evaluateQualityGate',
    'CREATIVE_MASTER_HASH_MISMATCH',
  ]);
  requireIncludes('src/providers/local/local-video-composer.ts', [
    'VIDEO_SHOT_REGISTRY_BINDING_REQUIRED',
    'VIDEO_SHOT_RIGHTS_NOT_CLEARED',
    'VIDEO_GENERATIVE_EXCEPTION_UNSUPPORTED',
  ]);
  requireIncludes('src/marketing-autopilot-image-generate.ts', [
    'ControlledOperationScopedStaticImageGenerationService',
    'publicationEligible: false',
  ]);
  requireIncludes('src/marketing-autopilot-image-finalize.ts', [
    'createControlledOperationScopedGenerativeFinalizationService',
    'publicationAuthorized: false',
  ]);
  requireIncludes('src/providers/gcp/gcs-publication-asset-delivery.ts', [
    'createVerifiedDeliveryUrl',
    'PUBLICATION_ASSET_SHA256_MISMATCH',
  ]);
  requireIncludes('src/scheduler/toca-managed-instagram-scheduler.ts', [
    'creativeTruthBinding',
    'TOCA_MANAGED_INSTAGRAM_CREATIVE_TRUTH_HASH_MISMATCH',
  ]);
  requireIncludes('src/providers/meta-ads/meta-ads-controlled-write.ts', [
    'META_ADS_CREATIVE_TRUTH_BINDING_REQUIRED',
    'META_ADS_CREATIVE_TRUTH_ASSET_LOCATOR_MISMATCH',
  ]);
}

function assertNoActiveLegacyDrift() {
  const activeFiles = [
    ...collectFiles('control', (path) => path.endsWith('.json')),
    ...collectFiles('docs/architecture', (path) => path.endsWith('.md')),
  ];
  for (const path of activeFiles) {
    const content = read(path);
    if (content.includes('THE_PARTY_STORY_V1')) {
      fail(`Deprecated The Party placeholder remains in active repository material: ${path}`);
    }
    if (content.includes('SUNSET_STORY_V1') && content.includes('"standardVersion": "1.1"')) {
      fail(`Stale Sunset Story v1.1 remains active: ${path}`);
    }
  }

  const legacyId = 'TOCA_VENUE_REFERENCE_SET_V1';
  const policyText = read('control/creative-truth-policy.v1.json');
  if (
    !policyText.includes(`"legacyReferenceSetId": "${legacyId}"`) ||
    !policyText.includes('"legacyReferenceSetStatus": "DEPRECATED"') ||
    !policyText.includes('"legacyReferenceSetExecution": "DENY"')
  ) {
    fail('Legacy global reference set is not explicitly DEPRECATED/DENY');
  }
}

function collectFiles(root, predicate) {
  if (!existsSync(root)) return [];
  const out = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) out.push(...collectFiles(path, predicate));
    else if (predicate(path)) out.push(path);
  }
  return out;
}

function json(path) {
  return JSON.parse(read(path));
}

function read(path) {
  return readFileSync(path, 'utf8');
}

function requireIncludes(path, markers) {
  const content = read(path);
  for (const marker of markers) {
    if (!content.includes(marker)) fail(`Creative Truth contract missing in ${path}: ${marker}`);
  }
}

function requireExcludes(path, markers) {
  const content = read(path);
  for (const marker of markers) {
    if (content.includes(marker)) fail(`Creative Truth legacy drift found in ${path}: ${marker}`);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
