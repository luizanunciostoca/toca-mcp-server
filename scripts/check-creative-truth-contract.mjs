import { existsSync, readFileSync } from 'node:fs';

const requiredFiles = [
  'control/creative-truth-policy.v1.json',
  'control/creative-tool-routing.v1.json',
  'control/creative-standards/sunset-story-standard.v1.json',
  'control/creative-standards/sunset-feed-standard.v1.json',
  'control/creative-standards/sunset-ad-standard.v1.json',
  'control/creative-standards/toca-video-standard.v1.json',
  'control/creative-standards/toca-thumbnail-standard.v1.json',
  'src/contracts/creative-truth.ts',
  'src/contracts/creative-truth-generative-reference-sets.ts',
  'src/creative/creative-truth.ts',
  'src/creative/creative-truth-resolver.ts',
  'src/creative/controlled-operation-scoped-static-image-generation.ts',
  'src/creative/controlled-operation-scoped-generative-finalization.ts',
  'src/content/video.ts',
  'src/content/video-thumbnail-creative-truth.ts',
  'src/providers/google-sheets/creative-truth-registry.ts',
  'src/providers/google-sheets/creative-truth-operation-scoped-generative-registry.ts',
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
  'src/marketing-autopilot-image-generate.ts',
  'src/marketing-autopilot-image-finalize.ts',
  'src/providers/meta-ads/meta-ads-controlled-write.ts',
  'src/scheduler/toca-managed-instagram-scheduler.ts',
  'src/worker/instagram-publication-composition.ts',
  'src/worker/toca-managed-instagram-worker-runtime.ts',
  'scripts/check-creative-tool-routing-contract.mjs',
  'docs/architecture/creative-truth-and-venue-fidelity.md',
];

const missing = requiredFiles.filter((path) => !existsSync(path));
if (missing.length > 0) fail(`Creative Truth architecture files missing: ${missing.join(', ')}`);

const policy = JSON.parse(read('control/creative-truth-policy.v1.json'));
const requiredGateSet = new Set(policy.requiredGates ?? []);
const generative = policy.generativeException ?? {};
if (
  policy.schemaVersion !== '1.1' ||
  policy.policyVersion !== '1.1' ||
  policy.policyId !== 'TOCA_CREATIVE_TRUTH_POLICY_V1' ||
  policy.status !== 'ACTIVE_CANONICAL' ||
  policy.rules?.aiLogoReconstructionAllowed !== false ||
  policy.rules?.architecturalInventionAllowed !== false ||
  policy.rules?.environmentDriftAllowed !== false ||
  policy.rules?.enhancementProvenanceRequired !== true ||
  policy.rules?.videoRealPlusEnhancement !== 'FAIL_CLOSED_UNTIL_SHOT_LEVEL_PROVENANCE' ||
  policy.rules?.videoEnhancementFailure !== 'VIDEO_ENHANCEMENT_PROVENANCE_UNSUPPORTED' ||
  policy.rules?.videoGenerativeException !== 'UNSUPPORTED_V1' ||
  policy.rules?.exactApprovedAssetMustBePublished !== true ||
  policy.rules?.failClosed !== true ||
  generative.explicitApprovalRequired !== true ||
  generative.approvalRecordRequired !== true ||
  generative.referenceStrategy !== 'OPERATION_SCOPED_ONLY_V1' ||
  generative.legacyReferenceSetId !== 'TOCA_VENUE_REFERENCE_SET_V1' ||
  generative.legacyReferenceSetStatus !== 'DEPRECATED' ||
  generative.sunsetReferenceSetId !== 'TOCA_VENUE_REFERENCE_SET_SUNSET_V1' ||
  generative.thePartyReferenceSetId !== 'TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1' ||
  generative.crossOperationReferenceReuse !== 'FORBIDDEN' ||
  generative.referenceSetOperationMatch !== 'REQUIRED' ||
  generative.legacyReferenceSetExecution !== 'DENY' ||
  generative.minimumVerifiedReferences !== 3 ||
  generative.venueFidelityGateStillRequired !== true ||
  generative.officialBrandAssetsStillRequired !== true ||
  generative.architecturalInventionStillForbidden !== true ||
  generative.environmentDriftStillForbidden !== true ||
  !Array.isArray(policy.requiredGates) ||
  policy.requiredGates.length !== 3 ||
  requiredGateSet.size !== 3 ||
  !requiredGateSet.has('BRAND_INTEGRITY') ||
  !requiredGateSet.has('VENUE_FIDELITY') ||
  !requiredGateSet.has('QUALITY') ||
  policy.publicationBoundary?.allRequiredGatesMustPass !== true ||
  policy.publicationBoundary?.outputSha256Required !== true ||
  policy.publicationBoundary?.exactAssetBindingRequired !== true ||
  policy.publicationBoundary?.publicationMayNotRebuildCreative !== true
) {
  fail('Creative Truth parent policy violates the fail-closed contract');
}

requireIncludes('src/contracts/creative-truth.ts', [
  'creativeTruthPolicySchema',
  "referenceStrategy: z.literal('OPERATION_SCOPED_ONLY_V1')",
  'legacyReferenceSetId: z.literal(TOCA_VENUE_REFERENCE_SET_ID)',
  "legacyReferenceSetStatus: z.literal('DEPRECATED')",
  'sunsetReferenceSetId: z.literal(TOCA_SUNSET_VENUE_REFERENCE_SET_ID)',
  'thePartyReferenceSetId: z.literal(TOCA_THE_PARTY_VENUE_REFERENCE_SET_ID)',
  "crossOperationReferenceReuse: z.literal('FORBIDDEN')",
  "referenceSetOperationMatch: z.literal('REQUIRED')",
  "legacyReferenceSetExecution: z.literal('DENY')",
  'minimumVerifiedReferences: z.number().int().min(3)',
  'Legacy global-set approval schema retained only for compatibility evidence parsing',
  'enhancementProvenanceRequired: z.literal(true)',
  "videoRealPlusEnhancement: z.literal('FAIL_CLOSED_UNTIL_SHOT_LEVEL_PROVENANCE')",
  "videoEnhancementFailure: z.literal('VIDEO_ENHANCEMENT_PROVENANCE_UNSUPPORTED')",
  "videoGenerativeException: z.literal('UNSUPPORTED_V1')",
  'creativeEnhancementProvenanceSchema',
  'fidelityEvidenceSchema',
  'deterministicRenderManifestSchema',
  'creativeTruthPublicationBindingSchema',
]);

requireIncludes('src/creative/creative-truth.ts', [
  'evaluateBrandIntegrity',
  'evaluateVenueFidelity',
  'evaluateQualityGate',
  'assertCreativeReadyForPublication',
  'buildCreativeTruthPublicationBinding',
  'FAILED_BRAND_ASSET_HASH_MISMATCH',
  'FAILED_FIDELITY_EVIDENCE_BINDING',
  'The original V1 global venue set is now canonically DEPRECATED in Drive',
  "if (approval.referenceSetId === TOCA_VENUE_REFERENCE_SET_ID)",
  "failures.add('FAILED_UNAPPROVED_GENERATIVE_EXCEPTION')",
]);

requireIncludes('src/creative/creative-truth-resolver.ts', [
  'resolveVideoShots',
  'VIDEO_SHOT_RIGHTS_NOT_CLEARED',
  'FAILED_LINEAGE_MISSING',
  "if (creativeMode === 'GENERATIVE_EXCEPTION')",
  'GENERATIVE_EXCEPTION_REQUIRES_OPERATION_SCOPED_PIPELINE',
]);

requireIncludes('src/creative/controlled-operation-scoped-static-image-generation.ts', [
  'ControlledOperationScopedStaticImageGenerationService',
  'getContentItemOperation(contentItemId)',
  'referenceSetOperation(approval.referenceSetId) !== operation',
  'uniqueReferenceIds',
  'uniqueAssetIds',
  'GENERATIVE_TRUSTED_CLOCK_INVALID',
]);

requireIncludes('src/creative/controlled-operation-scoped-generative-finalization.ts', [
  'createControlledOperationScopedGenerativeFinalizationService',
  'OperationScopedGenerativeFinalizationRegistry',
  'getCreativeStandard(',
  'resolveCanonicalGenerativeBrandInputs',
  'thePartyContextResolver',
  'assertApprovalCurrent(approval.expiresAt, nowIso)',
  'GENERATIVE_TRUSTED_CLOCK_INVALID',
]);

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

const thumbnailStandard = JSON.parse(read('control/creative-standards/toca-thumbnail-standard.v1.json'));
if (
  thumbnailStandard.standardId !== 'TOCA_THUMBNAIL_V1' ||
  thumbnailStandard.r29Boundary?.videoThumbnailGenerateIsNonFinalRenderIntent !== true ||
  thumbnailStandard.r29Boundary?.finalThumbnailBytesMustComeFromCreativeTruthComposer !== true ||
  thumbnailStandard.creativeTruth?.aiLogoReconstructionForbidden !== true ||
  thumbnailStandard.creativeTruth?.architectureInventionForbidden !== true
) {
  fail('Toca thumbnail standard must keep R29 thumbnail intent non-final and Creative Truth-bound');
}

const storyStandard = JSON.parse(read('control/creative-standards/sunset-story-standard.v1.json'));
if (
  storyStandard.referencePolicy?.derivedExamplesClassification !==
    'VISUAL_DIRECTION_REFERENCE_ONLY' ||
  storyStandard.referencePolicy?.venueTruthComesOnlyFromVenueRegistry !== true
) {
  fail('Synthetic Sunset examples must never become venue truth');
}

requireIncludes('src/content/video.ts', [
  'CreativeTruthPublicationBinding',
  'creativeTruthPublicationBindingSchema',
  'finalAssetSha256',
  'VIDEO_EXPORT_CREATIVE_TRUTH_BINDING_INVALID',
  'VIDEO_EXPORT_CREATIVE_TRUTH_HASH_MISMATCH',
]);
requireIncludes('src/content/video-thumbnail-creative-truth.ts', [
  "const TOCA_THUMBNAIL_STANDARD_ID = 'TOCA_THUMBNAIL_V1'",
  'assertCreativeReadyForPublication',
]);

requireIncludes('src/providers/google-sheets/creative-truth-registry.ts', [
  'POLICY!A2:AK20',
  "MINIMUM_CREATIVE_TRUTH_POLICY_VERSION = '1.3'",
  "cell(policy[29]) !== 'DENY'",
  "cell(policy[30]) !== 'NON_FINAL_BACKGROUND_CANDIDATE_ONLY'",
  "cell(policy[34]) !== 'FAIL_CLOSED_NO_FINAL_ASSET'",
  "cell(policy[35]) !== 'ENFORCED'",
  "cell(policy[36]) !== 'FAILED_DIRECT_GENERATIVE_FINALIZATION'",
  'if (matches.length !== 1)',
  'getBrandAsset(brand: string, variant: string)',
  'getVenueAsset(venueAssetId: string)',
  'getVenueAssetBySourceAssetId(sourceAssetId: string)',
  'getVideoShot(shotId: string)',
  'getCreativeStandard(standardId: string)',
]);
requireIncludes('src/providers/google-sheets/creative-truth-operation-scoped-generative-registry.ts', [
  'POLICY!A2:Z20',
  'CONTENT_ITEMS!A2:E2000',
  'GENERATIVE_EXCEPTIONS!A2:O1000',
  'VENUE_REFERENCE_SET!A2:K1000',
  'OPERATION_SCOPED_ONLY_V1',
  'LEGACY_DEPRECATED',
  'getBrandAsset(brand: string, variant: string)',
  'getCreativeStandard(standardId: string)',
]);

requireIncludes('src/providers/local/local-photo-enhancer.ts', [
  'creativeEnhancementProvenanceSchema',
  "creativeMode: 'REAL_PLUS_ENHANCEMENT'",
  'requiresVenueFidelityGate: true',
]);
requireIncludes('src/providers/openai/creative-truth-openai-image-enhancer.ts', [
  'creativeEnhancementProvenanceSchema',
  'OPENAI_ENHANCEMENT_SOURCE_BINDING_REQUIRED',
  'sha256(input.imageBytes)',
  'sha256(result.outputBytes)',
]);
requireIncludes('src/providers/local/local-creative-composer.ts', [
  'CREATIVE_MASTER_HASH_MISMATCH',
  'FAILED_ENHANCEMENT_PROVENANCE',
  'evaluateBrandIntegrity',
  'evaluateVenueFidelity',
  'evaluateQualityGate',
]);
requireIncludes('src/providers/local/local-video-composer.ts', [
  'VIDEO_SHOT_REGISTRY_BINDING_REQUIRED',
  'VIDEO_SHOT_MASTER_HASH_MISMATCH',
  'VIDEO_SHOT_RIGHTS_NOT_CLEARED',
  'VIDEO_ENHANCEMENT_PROVENANCE_UNSUPPORTED',
  'VIDEO_GENERATIVE_EXCEPTION_UNSUPPORTED',
]);

requireIncludes('src/marketing-autopilot-image-generate.ts', [
  'ControlledOperationScopedStaticImageGenerationService',
  'IMAGE_GENERATE_CALLER_TIME_FORBIDDEN',
  'publicationEligible: false',
]);
requireIncludes('src/marketing-autopilot-image-finalize.ts', [
  'createControlledOperationScopedGenerativeFinalizationService',
  'GoogleSheetsThePartyContentOrchestration',
  'thePartyContextResolver',
  'IMAGE_FINALIZE_CALLER_CANONICAL_CONTEXT_FORBIDDEN',
  'publicationAuthorized: false',
]);

requireIncludes('src/providers/gcp/gcs-publication-asset-stager.ts', [
  'video/mp4',
  'validatePublicMediaUrl',
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
