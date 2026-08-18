import { existsSync, readFileSync } from 'node:fs';

const requiredFiles = [
  'control/creative-truth-policy.v1.json',
  'src/contracts/creative-truth-generative-reference-sets.ts',
  'src/contracts/operation-scoped-generative-candidate.ts',
  'src/providers/google-sheets/creative-truth-operation-scoped-generative-registry.ts',
  'src/providers/google-drive/creative-truth-reference-loader.ts',
  'src/providers/openai/creative-truth-operation-scoped-image-generator.ts',
  'src/creative/controlled-operation-scoped-static-image-generation.ts',
  'src/creative/controlled-operation-scoped-generative-finalization.ts',
  'src/providers/local/local-operation-scoped-generative-composer.ts',
  'src/marketing-autopilot-image-generate.ts',
  'src/marketing-autopilot-image-finalize.ts',
  'src/creative/creative-truth-resolver.ts',
  'docs/architecture/controlled-static-image-generation.md',
  'docs/architecture/operation-scoped-generative-content-standard-binding.md',
];
for (const path of requiredFiles) {
  if (!existsSync(path)) fail(`Creative Truth static generative file missing: ${path}`);
}

requireIncludes('control/creative-truth-policy.v1.json', [
  '"policyVersion": "1.3"',
  '"generativeMode": "GENERATIVE_EXCEPTION"',
  '"referenceStrategy": "OPERATION_SCOPED_ONLY_V1"',
  '"legacyReferenceSetStatus": "DEPRECATED"',
  '"sunsetReferenceSetId": "TOCA_VENUE_REFERENCE_SET_SUNSET_V1"',
  '"thePartyReferenceSetId": "TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1"',
  '"crossOperationReferenceReuse": "FORBIDDEN"',
  '"referenceSetOperationMatch": "REQUIRED"',
  '"legacyReferenceSetExecution": "DENY"',
  '"videoGenerativeException": "SOURCE_ANCHORED_SCENE_CONTINUATION_GOVERNED_V1"',
  '"fullSyntheticVenueVideo": "UNSUPPORTED_V1"',
  '"photoToVideoPolicyId": "TOCA_PHOTO_TO_VIDEO_POLICY_V1"',
]);

requireIncludes('src/creative/creative-truth-resolver.ts', [
  "if (creativeMode === 'GENERATIVE_EXCEPTION')",
  'GENERATIVE_EXCEPTION_REQUIRES_OPERATION_SCOPED_PIPELINE',
]);
requireIncludes('src/contracts/creative-truth-generative-reference-sets.ts', [
  "LEGACY_TOCA_VENUE_REFERENCE_SET_ID = 'TOCA_VENUE_REFERENCE_SET_V1'",
  'TOCA_VENUE_REFERENCE_SET_SUNSET_V1',
  'TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1',
  'operationScopedGenerativeExceptionApprovalSchema',
  'FAILED_GENERATIVE_REFERENCE_SET_OPERATION_MISMATCH',
]);
requireIncludes('src/contracts/operation-scoped-generative-candidate.ts', [
  'operationScopedGenerativeCandidateManifestSchema',
  "status: z.literal('GENERATED_REVIEW_REQUIRED')",
  'candidateSha256',
  'referenceAssetIds',
  'referenceSha256s',
  "publicationEligible: z.literal(false)",
]);

requireIncludes('src/providers/google-sheets/creative-truth-operation-scoped-generative-registry.ts', [
  "const CONTENT_OPERATION_RANGE = 'CONTENT_ITEMS!A2:E2000'",
  "const CONTENT_CREATIVE_CONTEXT_RANGE = 'CONTENT_ITEMS!A1:BX2000'",
  'getContentItemOperation',
  'getContentItemCreativeStandardId',
  "headers.get('content_item_id')",
  "headers.get('creative_standard_id')",
  'FAILED_GENERATIVE_CONTENT_STANDARD_SCHEMA_INVALID',
  'FAILED_GENERATIVE_CONTENT_STANDARD_AMBIGUOUS',
  'getCreativeStandard(standardId: string)',
  'getBrandAsset(brand: string, variant: string)',
]);

requireIncludes('src/providers/openai/creative-truth-operation-scoped-image-generator.ts', [
  "const DEFAULT_RESPONSE_MODEL = 'gpt-5.6'",
  "const IMAGE_TOOL_MODEL_SELECTION = 'RESPONSES_TOOL_MANAGED' as const",
  'registry.getContentItemOperation(request.contentItemId)',
  'canonical.referenceSetId !== approval.referenceSetId',
  'venue.operation !== expectedOperation',
  'Do not borrow venue facts from another Toca operation',
  "type: 'image_generation'",
  "action: 'generate'",
  "quality: 'high'",
  "size: '1024x1536'",
  "output_format: 'jpeg'",
  'requiresPostGenerationHumanReview: true',
  'readyForFinalComposition: false',
]);
forbidIncludes('src/providers/openai/creative-truth-operation-scoped-image-generator.ts', [
  "const DEFAULT_IMAGE_MODEL = 'gpt-image-2'",
  "input_fidelity: 'high'",
  'model: this.imageModel',
]);

requireIncludes('src/creative/controlled-operation-scoped-static-image-generation.ts', [
  'ControlledOperationScopedStaticImageGenerationService',
  'readonly now?: () => string',
  'const nowIso = trustedNowIso(this.now)',
  'getContentItemOperation(contentItemId)',
  'getReferenceSet(approval.referenceSetId)',
  'uniqueReferenceIds',
  'uniqueAssetIds',
  'GENERATIVE_TRUSTED_CLOCK_INVALID',
]);

requireIncludes('src/creative/controlled-operation-scoped-generative-finalization.ts', [
  'createControlledOperationScopedGenerativeFinalizationService',
  'OperationScopedGenerativeFinalizationRegistry',
  'getContentItemOperation(',
  'getApprovedGenerativeException(',
  'getCreativeStandard(',
  'assertCanonicalContentStandard(',
  'getContentItemCreativeStandardId(',
  'GENERATIVE_FINALIZATION_CONTENT_STANDARD_REQUIRED',
  'GENERATIVE_FINALIZATION_CONTENT_STANDARD_MISMATCH',
  'resolveCanonicalGenerativeBrandInputs',
  'thePartyContextResolver',
  'assertApprovalCurrent(approval.expiresAt, nowIso)',
  'GENERATIVE_TRUSTED_CLOCK_INVALID',
]);

requireIncludes('src/providers/local/local-operation-scoped-generative-composer.ts', [
  'evaluateOperationScopedGenerativeFidelity',
  'evaluateBrandIntegrity',
  'evaluateQualityGate',
  "creativeMode: 'GENERATIVE_EXCEPTION'",
  'exactAssetBinding: true',
]);

requireIncludes('src/marketing-autopilot-image-generate.ts', [
  'GoogleSheetsOperationScopedGenerativeRegistry',
  'ControlledOperationScopedStaticImageGenerationService',
  'CreativeTruthOperationScopedImageGenerator',
  "status: 'GENERATED_REVIEW_REQUIRED'",
  'publicationEligible: false',
  'IMAGE_GENERATE_CALLER_TIME_FORBIDDEN',
]);
requireIncludes('src/marketing-autopilot-image-finalize.ts', [
  'createControlledOperationScopedGenerativeFinalizationService',
  'GoogleSheetsThePartyContentOrchestration',
  'GoogleDriveCreativeTruthBrandAssetLoader',
  'IMAGE_FINALIZE_CALLER_CANONICAL_CONTEXT_FORBIDDEN',
  'publicationAuthorized: false',
]);

requireIncludes('src/providers/google-drive/creative-truth-reference-loader.ts', [
  'GoogleDriveCreativeTruthReferenceLoader',
  "url.searchParams.set('alt', 'media')",
  'metadata.capabilities?.canDownload !== true',
  'GENERATIVE_REFERENCE_DRIVE_BYTES_INVALID',
]);

requireIncludes('docs/architecture/controlled-static-image-generation.md', [
  'operation-scoped',
  'ControlledOperationScopedGenerativeFinalizationService',
  'publicationAuthorized=false',
]);
requireIncludes('docs/architecture/operation-scoped-generative-content-standard-binding.md', [
  'CONTENT_ITEMS.creative_standard_id',
  'GENERATIVE_FINALIZATION_CONTENT_STANDARD_REQUIRED',
  'GENERATIVE_FINALIZATION_CONTENT_STANDARD_MISMATCH',
  'GoogleSheetsThePartyContentOrchestration',
]);

requireIncludes('package.json', [
  '"dev:marketing-autopilot-image-generate": "tsx src/marketing-autopilot-image-generate.ts"',
  '"start:marketing-autopilot-image-generate": "node dist/src/marketing-autopilot-image-generate.js"',
  '"dev:marketing-autopilot-image-finalize": "tsx src/marketing-autopilot-image-finalize.ts"',
  '"start:marketing-autopilot-image-finalize": "node dist/src/marketing-autopilot-image-finalize.js"',
  'check-operation-scoped-generative-truth.mjs',
]);

console.log('Creative Truth static generative contract OK');

function requireIncludes(path, markers) {
  const content = readFileSync(path, 'utf8');
  for (const marker of markers) {
    if (!content.includes(marker)) fail(`Creative Truth generative contract missing in ${path}: ${marker}`);
  }
}
function forbidIncludes(path, markers) {
  const content = readFileSync(path, 'utf8');
  for (const marker of markers) {
    if (content.includes(marker)) fail(`Creative Truth generative contract forbidden in ${path}: ${marker}`);
  }
}
function fail(message) {
  console.error(message);
  process.exit(1);
}
