import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const paths = {
  refSets: 'src/contracts/creative-truth-generative-reference-sets.ts',
  candidate: 'src/contracts/operation-scoped-generative-candidate.ts',
  registry: 'src/providers/google-sheets/creative-truth-operation-scoped-generative-registry.ts',
  baseRegistry: 'src/providers/google-sheets/creative-truth-registry.ts',
  referenceLoader: 'src/providers/google-drive/creative-truth-reference-loader.ts',
  brandLoader: 'src/providers/google-drive/creative-truth-brand-asset-loader.ts',
  provider: 'src/providers/openai/creative-truth-operation-scoped-image-generator.ts',
  generator: 'src/creative/controlled-operation-scoped-static-image-generation.ts',
  fidelity: 'src/creative/operation-scoped-generative-fidelity.ts',
  brandBinding: 'src/creative/canonical-generative-brand-binding.ts',
  finalizer: 'src/creative/controlled-operation-scoped-generative-finalization.ts',
  primitive: 'src/providers/local/local-operation-scoped-generative-composer.ts',
  supersededPrimitive: 'src/providers/local/controlled-operation-scoped-generative-finalization.ts',
  generateCli: 'src/marketing-autopilot-image-generate.ts',
  finalizeCli: 'src/marketing-autopilot-image-finalize.ts',
  genericResolver: 'src/creative/creative-truth-resolver.ts',
};

const requiredFiles = [
  ...Object.values(paths).filter((path) => path !== paths.supersededPrimitive),
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
if (existsSync(paths.supersededPrimitive)) {
  fail(`Superseded parallel generative finalizer must not exist: ${paths.supersededPrimitive}`);
}

requireIncludes(paths.refSets, [
  'TOCA_VENUE_REFERENCE_SET_SUNSET_V1',
  'TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1',
  "LEGACY_TOCA_VENUE_REFERENCE_SET_ID = 'TOCA_VENUE_REFERENCE_SET_V1'",
  "tocaGenerativeOperationSchema = z.enum(['SUNSET', 'THE_PARTY'])",
  'operationScopedGenerativeExceptionApprovalSchema',
  'FAILED_GENERATIVE_REFERENCE_SET_OPERATION_MISMATCH',
]);

requireIncludes(paths.candidate, [
  'operationScopedGenerativeCandidateManifestSchema',
  "status: z.literal('GENERATED_REVIEW_REQUIRED')",
  "creativeMode: z.literal('GENERATIVE_EXCEPTION')",
  "publicationEligible: z.literal(false)",
  'referenceAssetIds',
  'referenceSha256s',
  'GENERATIVE_CANDIDATE_REFERENCE_LINEAGE_LENGTH_MISMATCH',
  'GENERATIVE_CANDIDATE_REFERENCE_LINEAGE_DUPLICATE',
]);

requireIncludes(paths.registry, [
  "const CONTENT_OPERATION_RANGE = 'CONTENT_ITEMS!A2:E2000'",
  "const CONTENT_CREATIVE_CONTEXT_RANGE = 'CONTENT_ITEMS!A1:BX2000'",
  'getContentItemOperation',
  'getContentItemCreativeStandardId',
  "headers.get('content_item_id')",
  "headers.get('creative_standard_id')",
  'FAILED_GENERATIVE_CONTENT_STANDARD_SCHEMA_INVALID',
  'FAILED_GENERATIVE_CONTENT_STANDARD_AMBIGUOUS',
  'GENERATIVE_EXCEPTIONS!A2:O1000',
  'VENUE_REFERENCE_SET!A2:K1000',
  'getBrandAsset(brand: string, variant: string)',
  'getCreativeStandard(standardId: string)',
  'OPERATION_SCOPED_ONLY_V1',
  'LEGACY_DEPRECATED',
]);

requireIncludes(paths.baseRegistry, [
  'if (matches.length !== 1)',
  'getBrandAsset(brand: string, variant: string)',
  'getVenueAsset(venueAssetId: string)',
  'getVenueAssetBySourceAssetId(sourceAssetId: string)',
  'getVideoShot(shotId: string)',
  'getCreativeStandard(standardId: string)',
]);

requireIncludes(paths.referenceLoader, [
  'GoogleDriveCreativeTruthReferenceLoader',
  "url.searchParams.set('alt', 'media')",
  'metadata.capabilities?.canDownload !== true',
  'GENERATIVE_REFERENCE_DRIVE_BYTES_INVALID',
]);
requireIncludes(paths.brandLoader, [
  'GoogleDriveCreativeTruthBrandAssetLoader',
  "asset.integrityMode !== 'SHA256_PINNED'",
  "url.searchParams.set('alt', 'media')",
  'BRAND_ASSET_DRIVE_HASH_MISMATCH',
]);

requireIncludes(paths.generator, [
  'ControlledOperationScopedStaticImageGenerationService',
  'readonly now?: () => string',
  'const nowIso = trustedNowIso(this.now)',
  'getContentItemOperation(contentItemId)',
  'getApprovedGenerativeException(contentItemId)',
  'referenceSetOperation(approval.referenceSetId) !== operation',
  'uniqueReferenceIds',
  'uniqueAssetIds',
  'GENERATIVE_TRUSTED_CLOCK_INVALID',
]);
forbidIncludes(paths.generator, ['readonly nowIso?: string']);

requireIncludes(paths.provider, [
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

requireIncludes(paths.fidelity, [
  'evaluateOperationScopedGenerativeFidelity',
  'fidelityEvidenceSchema.safeParse',
  'venueReferenceSchema.safeParse',
  'approval.operation !== input.operation',
  'evidence.candidateSha256 !== input.candidateSha256',
  'evidence.referenceSetId !== approval.referenceSetId',
  'FAILED_GENERATIVE_OUTPUT_REVIEW_MISSING',
  'architectureDriftDetected',
  'sceneInventionDetected',
  'logoReconstructionDetected',
  'crossOperationReferenceReuse: false',
]);

requireIncludes(paths.brandBinding, [
  'resolveCanonicalGenerativeBrandInputs',
  'getBrandAsset(brand: string, variant: string)',
  "canonical.status !== 'ACTIVE_APPROVED'",
  "canonical.integrityMode !== 'SHA256_PINNED'",
  'canonical.aiReconstructionAllowed !== false',
  "canonical.brandAssetId !== 'BRAND-THE-PARTY-WHITE-V1'",
]);

requireIncludes(paths.finalizer, [
  'OperationScopedGenerativeFinalizationRegistry',
  'getContentItemCreativeStandardId(contentItemId: string)',
  'createControlledOperationScopedGenerativeFinalizationService',
  'composer: new LocalOperationScopedGenerativeComposer()',
  'operationScopedGenerativeCandidateManifestSchema.safeParse',
  'const nowIso = trustedNowIso(this.now)',
  'getContentItemOperation(',
  'getApprovedGenerativeException(',
  'assertApprovalCurrent(approval.expiresAt, nowIso)',
  'getCreativeStandard(normalizedOutputId)',
  'getCreativeStandard(normalizedVisualId)',
  'assertCanonicalContentStandard(',
  'getContentItemCreativeStandardId(',
  'GENERATIVE_FINALIZATION_CONTENT_STANDARD_REQUIRED',
  'GENERATIVE_FINALIZATION_CONTENT_STANDARD_MISMATCH',
  'resolveCanonicalThePartyEnvironment(',
  'GENERATIVE_FINALIZATION_THE_PARTY_CONTEXT_REQUIRED',
  'GENERATIVE_FINALIZATION_THE_PARTY_STANDARD_CONTEXT_MISMATCH',
  'getVenueAssetBySourceAssetId(reference.assetId)',
  'resolveCanonicalGenerativeBrandInputs',
  'brandAssets: canonicalBrandAssets',
  'createdAt: nowIso',
  'GENERATIVE_FINALIZATION_CANDIDATE_HASH_MISMATCH',
  'GENERATIVE_FINALIZATION_REFERENCE_HASH_MISMATCH',
  'GENERATIVE_TRUSTED_CLOCK_INVALID',
]);
forbidIncludes(paths.finalizer, [
  'readonly nowIso?: string',
  'readonly partyEnvironment?: ThePartyEnvironment',
  'this.dependencies.brandRegistry',
]);

requireIncludes(paths.primitive, [
  'LocalOperationScopedGenerativeComposer',
  'evaluateOperationScopedGenerativeFidelity',
  'evaluateBrandIntegrity',
  'evaluateQualityGate',
  "creativeMode: 'GENERATIVE_EXCEPTION'",
  'candidateSha256',
  'exactAssetBinding: true',
]);
assertNoDirectPrimitiveFinalizerImports('src', paths.finalizer);

requireIncludes(paths.generateCli, [
  'ControlledOperationScopedStaticImageGenerationService',
  'GoogleSheetsOperationScopedGenerativeRegistry',
  'GoogleDriveCreativeTruthReferenceLoader',
  'CreativeTruthOperationScopedImageGenerator',
  'candidateSha256: result.candidateSha256',
  'referenceSha256s: result.referenceSha256s',
  'publicationEligible: false',
  'IMAGE_GENERATE_CALLER_TIME_FORBIDDEN',
]);
requireIncludes(paths.finalizeCli, [
  'operationScopedGenerativeCandidateManifestSchema.parse',
  'fidelityEvidenceSchema.parse',
  'GoogleDriveCreativeTruthBrandAssetLoader',
  'GoogleSheetsThePartyContentOrchestration',
  'createControlledOperationScopedGenerativeFinalizationService(registry, {',
  'IMAGE_FINALIZE_CALLER_CANONICAL_CONTEXT_FORBIDDEN',
  'publicationAuthorized: false',
]);
forbidIncludes(paths.finalizeCli, ['local-operation-scoped-generative-composer.js', 'partyEnvironment:']);

requireIncludes(paths.genericResolver, [
  "if (creativeMode === 'GENERATIVE_EXCEPTION')",
  'GENERATIVE_EXCEPTION_REQUIRES_OPERATION_SCOPED_PIPELINE',
]);
requireIncludes('src/creative/creative-truth.ts', [
  'The original V1 global venue set is now canonically DEPRECATED in Drive',
  "if (approval.referenceSetId === TOCA_VENUE_REFERENCE_SET_ID)",
  "failures.add('FAILED_UNAPPROVED_GENERATIVE_EXCEPTION')",
]);

requireIncludes('test/creative-truth-operation-scoped-generative-registry.test.ts', [
  'creative_standard_id by canonical header name instead of a hard-coded column guess',
  'content registry schema does not expose creative_standard_id',
]);
requireIncludes('test/controlled-operation-scoped-static-image-generation.test.ts', [
  'cannot backdate an expired approval because the clock is an injected trusted dependency',
  'trusted clock itself is invalid',
]);
requireIncludes('test/controlled-operation-scoped-generative-finalization.test.ts', [
  'source hashes, content standard and brands before final render',
  'CONTENT_ITEMS creative_standard_id is missing',
  'CONTENT_ITEMS creative_standard_id disagrees',
  'expired approval against trusted service time',
  'trusted finalization clock is invalid',
]);
requireIncludes('test/controlled-operation-scoped-generative-finalization-party-context.test.ts', [
  'no canonical The Party context resolver is available',
  'canonical same-item Networks environment',
]);
requireIncludes('test/creative-truth-resolver.test.ts', [
  'legacy global-set reads cannot bypass operation-scoped generation',
]);
requireIncludes('test/creative-truth-registry-ambiguity.test.ts', [
  'rejects duplicate canonical policy identities',
  'brand plus variant identity is ambiguous',
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
    if (!path.endsWith('.ts') || path === allowedPath || path === paths.primitive) continue;
    if (read(path).includes('local-operation-scoped-generative-composer.js')) {
      fail(`Operation-scoped generative primitive finalizer imported outside controlled boundary: ${path}`);
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
