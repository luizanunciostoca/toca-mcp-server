import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const refSetContractPath = 'src/contracts/creative-truth-generative-reference-sets.ts';
const candidateManifestPath = 'src/contracts/operation-scoped-generative-candidate.ts';
const operationRegistryPath =
  'src/providers/google-sheets/creative-truth-operation-scoped-generative-registry.ts';
const baseRegistryPath = 'src/providers/google-sheets/creative-truth-registry.ts';
const referenceLoaderPath = 'src/providers/google-drive/creative-truth-reference-loader.ts';
const brandLoaderPath = 'src/providers/google-drive/creative-truth-brand-asset-loader.ts';
const generatorPath = 'src/providers/openai/creative-truth-operation-scoped-image-generator.ts';
const controlledGeneratorPath = 'src/creative/controlled-operation-scoped-static-image-generation.ts';
const fidelityPath = 'src/creative/operation-scoped-generative-fidelity.ts';
const canonicalBrandBindingPath = 'src/creative/canonical-generative-brand-binding.ts';
const controlledFinalizerPath =
  'src/creative/controlled-operation-scoped-generative-finalization.ts';
const primitiveFinalizerPath = 'src/providers/local/local-operation-scoped-generative-composer.ts';
const supersededFinalizerPath =
  'src/providers/local/controlled-operation-scoped-generative-finalization.ts';
const generationCliPath = 'src/marketing-autopilot-image-generate.ts';
const finalizationCliPath = 'src/marketing-autopilot-image-finalize.ts';
const genericResolverPath = 'src/creative/creative-truth-resolver.ts';

const requiredFiles = [
  refSetContractPath,
  candidateManifestPath,
  operationRegistryPath,
  baseRegistryPath,
  referenceLoaderPath,
  brandLoaderPath,
  generatorPath,
  controlledGeneratorPath,
  fidelityPath,
  canonicalBrandBindingPath,
  controlledFinalizerPath,
  primitiveFinalizerPath,
  generationCliPath,
  finalizationCliPath,
  genericResolverPath,
  'test/creative-truth-operation-scoped-reference-sets.test.ts',
  'test/creative-truth-operation-scoped-generative-registry.test.ts',
  'test/creative-truth-operation-scoped-image-generator.test.ts',
  'test/controlled-operation-scoped-static-image-generation.test.ts',
  'test/operation-scoped-generative-fidelity.test.ts',
  'test/canonical-generative-brand-binding.test.ts',
  'test/creative-truth-brand-asset-loader.test.ts',
  'test/local-operation-scoped-generative-composer.test.ts',
  'test/controlled-operation-scoped-generative-finalization.test.ts',
  'test/controlled-operation-scoped-generative-finalization-party-context.test.ts',
  'test/creative-truth-resolver.test.ts',
  'test/creative-truth-registry-ambiguity.test.ts',
];
for (const path of requiredFiles) {
  if (!existsSync(path)) fail(`Operation-scoped Creative Truth file missing: ${path}`);
}
if (existsSync(supersededFinalizerPath)) {
  fail(`Superseded parallel generative finalizer must not exist: ${supersededFinalizerPath}`);
}

requireIncludes(refSetContractPath, [
  'TOCA_VENUE_REFERENCE_SET_SUNSET_V1',
  'TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1',
  "LEGACY_TOCA_VENUE_REFERENCE_SET_ID = 'TOCA_VENUE_REFERENCE_SET_V1'",
  "tocaGenerativeOperationSchema = z.enum(['SUNSET', 'THE_PARTY'])",
  'operationScopedGenerativeExceptionApprovalSchema',
  'referenceSetOperation(approval.referenceSetId) !== approval.operation',
  'FAILED_GENERATIVE_REFERENCE_SET_OPERATION_MISMATCH',
]);

requireIncludes(candidateManifestPath, [
  'operationScopedGenerativeCandidateManifestSchema',
  "status: z.literal('GENERATED_REVIEW_REQUIRED')",
  "creativeMode: z.literal('GENERATIVE_EXCEPTION')",
  "provider: z.literal('OPENAI_IMAGE_GENERATION')",
  "imageToolModelSelection: z.literal('RESPONSES_TOOL_MANAGED')",
  "readyForFinalComposition: z.literal(false)",
  "publicationEligible: z.literal(false)",
  'referenceSetOperation(manifest.referenceSetId) !== manifest.operation',
  'GENERATIVE_CANDIDATE_REFERENCE_SET_OPERATION_MISMATCH',
  'GENERATIVE_CANDIDATE_REFERENCE_LINEAGE_LENGTH_MISMATCH',
  'GENERATIVE_CANDIDATE_REFERENCE_LINEAGE_DUPLICATE',
  'GENERATIVE_CANDIDATE_REFERENCE_HASH_DUPLICATE',
]);

requireIncludes(operationRegistryPath, [
  'GoogleSheetsOperationScopedGenerativeRegistry',
  'CONTENT_ITEMS!A2:E2000',
  'GENERATIVE_EXCEPTIONS!A2:O1000',
  'VENUE_REFERENCE_SET!A2:K1000',
  'getContentItemOperation',
  'getBrandAsset',
  'getCreativeStandard',
  'FAILED_GENERATIVE_CONTENT_OPERATION_AMBIGUOUS',
  'FAILED_GENERATIVE_CONTENT_OPERATION_UNSUPPORTED',
  'OPERATION_SCOPED_ONLY_V1',
  'LEGACY_DEPRECATED',
]);

requireIncludes(baseRegistryPath, [
  'if (matches.length !== 1)',
  'getBrandAsset(brand: string, variant: string)',
  'getCreativeStandard(standardId: string)',
]);

requireIncludes(referenceLoaderPath, [
  'GoogleDriveCreativeTruthReferenceLoader',
  "url.searchParams.set('alt', 'media')",
  'metadata.capabilities?.canDownload !== true',
  'GENERATIVE_REFERENCE_DRIVE_BYTES_INVALID',
]);

requireIncludes(brandLoaderPath, [
  'GoogleDriveCreativeTruthBrandAssetLoader',
  "asset.integrityMode !== 'SHA256_PINNED'",
  "url.searchParams.set('alt', 'media')",
  'metadata.capabilities?.canDownload !== true',
  'BRAND_ASSET_DRIVE_HASH_MISMATCH',
  'BRAND_ASSET_DRIVE_BYTES_INVALID',
]);

requireIncludes(controlledGeneratorPath, [
  'ControlledOperationScopedStaticImageGenerationService',
  'readonly now?: () => string',
  'this.now = dependencies.now ?? (() => new Date().toISOString())',
  'const nowIso = trustedNowIso(this.now)',
  'getContentItemOperation(contentItemId)',
  'getApprovedGenerativeException(contentItemId)',
  'referenceSetOperation(approval.referenceSetId) !== operation',
  'Math.max(3, approval.minReferenceCount)',
  'uniqueReferenceIds',
  'uniqueAssetIds',
  'GENERATIVE_TRUSTED_CLOCK_INVALID',
]);
forbidIncludes(controlledGeneratorPath, ['readonly nowIso?: string']);

requireIncludes(generatorPath, [
  "const DEFAULT_RESPONSE_MODEL = 'gpt-5.6'",
  "const IMAGE_TOOL_MODEL_SELECTION = 'RESPONSES_TOOL_MANAGED' as const",
  'registry.getContentItemOperation(request.contentItemId)',
  'referenceSetOperation(approval.referenceSetId) !== approval.operation',
  'canonical.referenceSetId !== approval.referenceSetId',
  'venue.operation !== expectedOperation',
  'referenceSha256s: references.map((reference) => reference.observedSha256)',
  'Do not borrow venue facts from another Toca operation',
  'requiresPostGenerationHumanReview: true',
  'readyForFinalComposition: false',
]);

requireIncludes(fidelityPath, [
  'evaluateOperationScopedGenerativeFidelity',
  'fidelityEvidenceSchema.safeParse',
  'venueReferenceSchema.safeParse',
  'CANDIDATE_SHA_INVALID',
  'MALFORMED_REFERENCE_EVIDENCE',
  'MALFORMED_FIDELITY_EVIDENCE',
  'approval.operation !== input.operation',
  'evidence.candidateSha256 !== input.candidateSha256',
  'evidence.referenceSetId !== approval.referenceSetId',
  'FAILED_GENERATIVE_OUTPUT_REVIEW_MISSING',
  "['HUMAN_REVIEW', 'MULTIMODAL_PLUS_HUMAN']",
  'architectureDriftDetected',
  'sceneInventionDetected',
  'logoReconstructionDetected',
  'crossOperationReferenceReuse: false',
]);

requireIncludes(canonicalBrandBindingPath, [
  'resolveCanonicalGenerativeBrandInputs',
  'getBrandAsset(brand: string, variant: string)',
  'suppliedByBrand.size !== uniqueRequiredBrands.size',
  "canonical.status !== 'ACTIVE_APPROVED'",
  "canonical.integrityMode !== 'SHA256_PINNED'",
  'canonical.aiReconstructionAllowed !== false',
  "canonical.brandAssetId !== 'BRAND-THE-PARTY-WHITE-V1'",
  "SUNSET_STANDARDS.has(visualStandard.standardId) && !required.has('TOCA_DO_MORCEGO')",
  "visualStandard.standardId === THE_PARTY_NETWORKS && !partyEnvironment",
]);

requireIncludes(controlledFinalizerPath, [
  'OperationScopedGenerativeThePartyContextResolver',
  'createControlledOperationScopedGenerativeFinalizationService',
  'composer: new LocalOperationScopedGenerativeComposer()',
  'thePartyContextResolver: options.thePartyContextResolver',
  'ControlledOperationScopedGenerativeFinalizationService',
  'operationScopedGenerativeCandidateManifestSchema.safeParse',
  'const nowIso = trustedNowIso(this.now)',
  'assertApprovalCurrent(approval.expiresAt, nowIso)',
  'getContentItemOperation(',
  'getApprovedGenerativeException(',
  'approval.exceptionId !== manifest.exceptionId',
  'approval.approvalRef !== manifest.approvalRef',
  'getCreativeStandard(normalizedOutputId)',
  'getCreativeStandard(normalizedVisualId)',
  'resolveCanonicalThePartyEnvironment(',
  'this.dependencies.thePartyContextResolver',
  'context.standardId !== effectiveStandard.standardId',
  'GENERATIVE_FINALIZATION_THE_PARTY_CONTEXT_REQUIRED',
  'GENERATIVE_FINALIZATION_THE_PARTY_STANDARD_CONTEXT_MISMATCH',
  'THE_PARTY_ENVIRONMENT_REQUIRED',
  'getVenueAssetBySourceAssetId(reference.assetId)',
  'venue.sourceSha256.toLowerCase()',
  'resolveCanonicalGenerativeBrandInputs',
  'this.dependencies.registry',
  'brandAssets: canonicalBrandAssets',
  'createdAt: nowIso',
  'GENERATIVE_FINALIZATION_CANDIDATE_HASH_MISMATCH',
  'GENERATIVE_FINALIZATION_APPROVAL_BINDING_MISMATCH',
  'GENERATIVE_FINALIZATION_REFERENCE_IDENTITY_MISMATCH',
  'GENERATIVE_FINALIZATION_REFERENCE_HASH_MISMATCH',
  'GENERATIVE_TRUSTED_CLOCK_INVALID',
]);
forbidIncludes(controlledFinalizerPath, [
  'readonly nowIso?: string',
  'readonly partyEnvironment?: ThePartyEnvironment',
  'this.dependencies.brandRegistry',
]);

requireIncludes(primitiveFinalizerPath, [
  'LocalOperationScopedGenerativeComposer',
  'evaluateOperationScopedGenerativeFidelity',
  'evaluateBrandIntegrity',
  'evaluateQualityGate',
  "creativeMode: 'GENERATIVE_EXCEPTION'",
  'candidateSha256',
  'exactAssetBinding: true',
  "pipelineVersion: 'local-operation-scoped-generative-composer-v1'",
]);

// The raw ImageMagick compositor is only a rendering primitive. No operator/worker may import it.
assertNoDirectPrimitiveFinalizerImports('src', controlledFinalizerPath);

requireIncludes(generationCliPath, [
  'ControlledOperationScopedStaticImageGenerationService',
  'GoogleSheetsOperationScopedGenerativeRegistry',
  'GoogleDriveCreativeTruthReferenceLoader',
  'CreativeTruthOperationScopedImageGenerator',
  'candidateSha256: result.candidateSha256',
  'referenceSha256s: result.referenceSha256s',
  'publicationEligible: false',
  'IMAGE_GENERATE_CALLER_TIME_FORBIDDEN',
]);
forbidIncludes(generationCliPath, ['readonly nowIso?:', 'nowIso: args.nowIso']);

requireIncludes(finalizationCliPath, [
  'operationScopedGenerativeCandidateManifestSchema.parse',
  'fidelityEvidenceSchema.parse',
  'GoogleDriveCreativeTruthBrandAssetLoader',
  'GoogleSheetsThePartyContentOrchestration',
  'thePartyContextResolver = new GoogleSheetsThePartyContentOrchestration(sheets)',
  'createControlledOperationScopedGenerativeFinalizationService(registry, {',
  'thePartyContextResolver,',
  'IMAGE_FINALIZE_CALLER_CANONICAL_CONTEXT_FORBIDDEN',
  'publicationAuthorized: false',
]);
forbidIncludes(finalizationCliPath, [
  'local-operation-scoped-generative-composer.js',
  'partyEnvironment:',
]);

requireIncludes(genericResolverPath, [
  'GENERATIVE_EXCEPTION_REQUIRES_OPERATION_SCOPED_PIPELINE',
]);

// Legacy global-set fidelity may remain for compatibility, but it must never pass finalization.
requireIncludes('src/creative/creative-truth.ts', [
  'The original V1 global venue set is now canonically DEPRECATED in Drive',
  "if (approval.referenceSetId === TOCA_VENUE_REFERENCE_SET_ID)",
  "failures.add('FAILED_UNAPPROVED_GENERATIVE_EXCEPTION')",
]);

for (const path of [
  'control/creative-standards/sunset-story-standard.v1.json',
  'control/creative-standards/sunset-feed-standard.v1.json',
  'control/creative-standards/sunset-ad-standard.v1.json',
]) {
  requireIncludes(path, ['TOCA_VENUE_REFERENCE_SET_SUNSET_V1']);
}
for (const path of [
  'control/creative-standards/the-party-hybrid-networks-standard.v1.json',
  'control/creative-standards/the-party-hybrid-minimalist-standard.v1.json',
  'control/creative-standards/the-party-content-orchestration.v1.json',
]) {
  requireIncludes(path, ['TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1']);
}
for (const path of [
  'control/creative-standards/toca-thumbnail-standard.v1.json',
  'control/creative-standards/toca-video-standard.v1.json',
]) {
  requireIncludes(path, [
    'OPERATION_SCOPED',
    'TOCA_VENUE_REFERENCE_SET_SUNSET_V1',
    'TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1',
    'DEPRECATED',
  ]);
}

const packageJson = JSON.parse(read('package.json'));
if (
  packageJson.scripts?.['dev:marketing-autopilot-image-generate'] !==
    'tsx src/marketing-autopilot-image-generate.ts' ||
  packageJson.scripts?.['start:marketing-autopilot-image-generate'] !==
    'node dist/src/marketing-autopilot-image-generate.js' ||
  packageJson.scripts?.['dev:marketing-autopilot-image-finalize'] !==
    'tsx src/marketing-autopilot-image-finalize.ts' ||
  packageJson.scripts?.['start:marketing-autopilot-image-finalize'] !==
    'node dist/src/marketing-autopilot-image-finalize.js' ||
  !packageJson.scripts?.['architecture:check']?.includes(
    'node scripts/check-operation-scoped-generative-truth.mjs',
  )
) {
  fail('Operation-scoped generative executable/package binding drift detected');
}

console.log('Operation-scoped generative Creative Truth contract OK');

function assertNoDirectPrimitiveFinalizerImports(root, allowedPath) {
  for (const path of walk(root)) {
    if (!path.endsWith('.ts') || path === allowedPath || path === primitiveFinalizerPath) continue;
    const content = read(path);
    if (content.includes('local-operation-scoped-generative-composer.js')) {
      fail(
        `Operation-scoped generative primitive finalizer imported outside controlled boundary: ${path}`,
      );
    }
  }
}

function walk(root) {
  const files = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry).replaceAll('\\', '/');
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

function read(path) {
  return readFileSync(path, 'utf8');
}

function requireIncludes(path, markers) {
  const content = read(path);
  for (const marker of markers) {
    if (!content.includes(marker)) fail(`Missing marker in ${path}: ${marker}`);
  }
}

function forbidIncludes(path, markers) {
  const content = read(path);
  for (const marker of markers) {
    if (content.includes(marker)) fail(`Forbidden marker in ${path}: ${marker}`);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
