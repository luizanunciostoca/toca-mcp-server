import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const controlledGenerationPath =
  'src/creative/controlled-operation-scoped-static-image-generation.ts';
const controlledFinalizerPath =
  'src/creative/controlled-operation-scoped-generative-finalization.ts';
const primitiveFinalizerPath = 'src/providers/local/local-operation-scoped-generative-composer.ts';
const providerGeneratorPath =
  'src/providers/openai/creative-truth-operation-scoped-image-generator.ts';
const operatorGeneratePath = 'src/marketing-autopilot-image-generate.ts';
const supersededFinalizerPath =
  'src/providers/local/controlled-operation-scoped-generative-finalization.ts';
const candidateManifestPath = 'src/contracts/operation-scoped-generative-candidate.ts';
const canonicalBrandBindingPath = 'src/creative/canonical-generative-brand-binding.ts';
const baseRegistryPath = 'src/providers/google-sheets/creative-truth-registry.ts';
const required = [
  'src/contracts/creative-truth-generative-reference-sets.ts',
  candidateManifestPath,
  canonicalBrandBindingPath,
  baseRegistryPath,
  'src/providers/google-sheets/creative-truth-operation-scoped-generative-registry.ts',
  providerGeneratorPath,
  controlledGenerationPath,
  'src/creative/operation-scoped-generative-fidelity.ts',
  controlledFinalizerPath,
  primitiveFinalizerPath,
  operatorGeneratePath,
  'src/creative/creative-truth-resolver.ts',
  'test/creative-truth-operation-scoped-reference-sets.test.ts',
  'test/creative-truth-operation-scoped-generative-registry.test.ts',
  'test/controlled-operation-scoped-static-image-generation.test.ts',
  'test/creative-truth-operation-scoped-image-generator.test.ts',
  'test/operation-scoped-generative-fidelity.test.ts',
  'test/canonical-generative-brand-binding.test.ts',
  'test/local-operation-scoped-generative-composer.test.ts',
  'test/controlled-operation-scoped-generative-finalization.test.ts',
  'test/creative-truth-resolver.test.ts',
  'test/creative-truth-registry-ambiguity.test.ts',
];
for (const path of required) {
  if (!existsSync(path)) fail(`Operation-scoped Creative Truth file missing: ${path}`);
}
if (existsSync(supersededFinalizerPath)) {
  fail(`Superseded parallel generative finalizer must not exist: ${supersededFinalizerPath}`);
}

requireIncludes('src/contracts/creative-truth-generative-reference-sets.ts', [
  'TOCA_VENUE_REFERENCE_SET_SUNSET_V1',
  'TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1',
  "LEGACY_TOCA_VENUE_REFERENCE_SET_ID = 'TOCA_VENUE_REFERENCE_SET_V1'",
  "tocaGenerativeOperationSchema = z.enum(['SUNSET', 'THE_PARTY'])",
  'operationScopedGenerativeExceptionApprovalSchema',
  'FAILED_GENERATIVE_REFERENCE_SET_OPERATION_MISMATCH',
  'referenceSetOperation(approval.referenceSetId) !== approval.operation',
]);

requireIncludes(candidateManifestPath, [
  'operationScopedGenerativeCandidateManifestSchema',
  "status: z.literal('GENERATED_REVIEW_REQUIRED')",
  "creativeMode: z.literal('GENERATIVE_EXCEPTION')",
  'candidateSha256',
  'referenceAssetIds',
  'referenceSha256s',
  "provider: z.literal('OPENAI_IMAGE_GENERATION')",
  "imageToolModelSelection: z.literal('RESPONSES_TOOL_MANAGED')",
  "readyForFinalComposition: z.literal(false)",
  "publicationEligible: z.literal(false)",
  'GENERATIVE_CANDIDATE_REFERENCE_LINEAGE_LENGTH_MISMATCH',
  'GENERATIVE_CANDIDATE_REFERENCE_LINEAGE_DUPLICATE',
]);

requireIncludes(canonicalBrandBindingPath, [
  'resolveCanonicalGenerativeBrandInputs',
  'getBrandAsset(brand: string, variant: string)',
  'suppliedByBrand.size !== uniqueRequiredBrands.size',
  "canonical.status !== 'ACTIVE_APPROVED'",
  "canonical.integrityMode !== 'SHA256_PINNED'",
  'canonical.aiReconstructionAllowed !== false',
  "canonical.brandAssetId !== 'BRAND-THE-PARTY-WHITE-V1'",
  "visualStandard.standardId === THE_PARTY_NETWORKS && !partyEnvironment",
  "SUNSET_STANDARDS.has(visualStandard.standardId) && !required.has('TOCA_DO_MORCEGO')",
]);

requireIncludes(
  'src/providers/google-sheets/creative-truth-operation-scoped-generative-registry.ts',
  [
    'POLICY!A2:Z20',
    'VENUE_REFERENCE_SET!A2:K1000',
    'GENERATIVE_EXCEPTIONS!A2:O1000',
    'CONTENT_ITEMS!A2:E2000',
    '1r02HLhmnTijFNkmZv4o1yeZPxCEUMXZC_QreDFB6yTw',
    'getContentItemOperation',
    'FAILED_GENERATIVE_CONTENT_OPERATION_AMBIGUOUS',
    'FAILED_GENERATIVE_CONTENT_OPERATION_UNSUPPORTED',
    'OPERATION_SCOPED_ONLY_V1',
    'LEGACY_DEPRECATED',
    'FAILED_GENERATIVE_REFERENCE_SET_POLICY_DRIFT',
    'FAILED_GENERATIVE_REFERENCE_SET_DEPRECATED',
    'FAILED_GENERATIVE_REFERENCE_SET_OPERATION_MISMATCH',
    'FAILED_GENERATIVE_REFERENCE_MISSING',
    'operation: cell(row[14])',
    'getBrandAsset(brand: string, variant: string)',
    'getCreativeStandard(standardId: string)',
  ],
);

requireIncludes(controlledGenerationPath, [
  'readonly now?: () => string',
  'this.now = dependencies.now ?? (() => new Date().toISOString())',
  'const nowIso = trustedNowIso(this.now)',
  'getContentItemOperation(contentItemId)',
  'FAILED_GENERATIVE_CONTENT_OPERATION_MISSING',
  'approval.operation !== operation',
  'referenceSetOperation(approval.referenceSetId) !== operation',
  'getReferenceSet(approval.referenceSetId)',
  'uniqueReferenceIds',
  'uniqueAssetIds',
  'nowIso,',
  'GENERATIVE_TRUSTED_CLOCK_INVALID',
]);
requireExcludes(controlledGenerationPath, ['readonly nowIso?: string']);

requireIncludes(providerGeneratorPath, [
  "const DEFAULT_RESPONSE_MODEL = 'gpt-5.6'",
  "const IMAGE_TOOL_MODEL_SELECTION = 'RESPONSES_TOOL_MANAGED' as const",
  'referenceSetOperation(approval.referenceSetId) !== approval.operation',
  'registry.getContentItemOperation(request.contentItemId)',
  'canonical.operation !== contentOperation',
  'canonical.operation === supplied.operation',
  'operation: approval.operation',
  'const expectedOperation = approval.operation',
  'canonical.referenceSetId !== approval.referenceSetId',
  'venue.operation !== expectedOperation',
  'referenceSha256s: references.map((reference) => reference.observedSha256)',
  'Do not borrow venue facts from another Toca operation',
  'readyForFinalComposition: false',
  'requiresPostGenerationHumanReview: true',
]);

requireIncludes('src/creative/operation-scoped-generative-fidelity.ts', [
  'evaluateOperationScopedGenerativeFidelity',
  'fidelityEvidenceSchema.safeParse',
  'venueReferenceSchema.safeParse',
  'MALFORMED_FIDELITY_EVIDENCE',
  'MALFORMED_REFERENCE_EVIDENCE',
  'CANDIDATE_SHA_INVALID',
  'approval.operation !== input.operation',
  'referenceSetOperation(approval.referenceSetId)',
  'evidence.candidateSha256 !== input.candidateSha256',
  'evidence.referenceSetId !== approval.referenceSetId',
  'FAILED_GENERATIVE_OUTPUT_REVIEW_MISSING',
  "['HUMAN_REVIEW', 'MULTIMODAL_PLUS_HUMAN']",
  'architectureDriftDetected',
  'sceneInventionDetected',
  'logoReconstructionDetected',
  'crossOperationReferenceReuse: false',
]);

requireIncludes(controlledFinalizerPath, [
  'ControlledOperationScopedGenerativeFinalizationService',
  'OperationScopedGenerativeFinalizationRegistry',
  'operationScopedGenerativeCandidateManifestSchema',
  'assertCandidateBytes',
  'const nowIso = trustedNowIso(this.now)',
  'getContentItemOperation(',
  'getApprovedGenerativeException(',
  'approval.exceptionId !== manifest.exceptionId',
  'approval.approvalRef !== manifest.approvalRef',
  'referenceSetOperation(approval.referenceSetId) !== operation',
  'assertApprovalCurrent(approval.expiresAt, nowIso)',
  'getReferenceSet(referenceSetId)',
  'uniqueReferenceIds',
  'uniqueAssetIds',
  'getVenueAssetBySourceAssetId(reference.assetId)',
  'venue.sourceSha256.toLowerCase()',
  'getCreativeStandard(normalizedOutputId)',
  'getCreativeStandard(normalizedVisualId)',
  'resolveCanonicalGenerativeBrandInputs',
  'this.dependencies.registry',
  'brandAssets: canonicalBrandAssets',
  'createdAt: nowIso',
  'GENERATIVE_TRUSTED_CLOCK_INVALID',
  'GENERATIVE_FINALIZATION_CANDIDATE_HASH_MISMATCH',
  'GENERATIVE_FINALIZATION_APPROVAL_BINDING_MISMATCH',
  'GENERATIVE_FINALIZATION_REFERENCE_IDENTITY_MISMATCH',
  'GENERATIVE_FINALIZATION_REFERENCE_HASH_MISMATCH',
]);
requireExcludes(controlledFinalizerPath, [
  'readonly nowIso?: string',
  'this.dependencies.brandRegistry',
]);

requireIncludes(primitiveFinalizerPath, [
  'LocalOperationScopedGenerativeComposer',
  'evaluateOperationScopedGenerativeFidelity',
  "creativeMode: 'GENERATIVE_EXCEPTION'",
  'candidateSha256',
  'requiredBrands',
  'evaluateBrandIntegrity',
  'evaluateQualityGate',
  'exactAssetBinding: true',
  "pipelineVersion: 'local-operation-scoped-generative-composer-v1'",
  'GENERATIVE_OPERATION_SCOPED_VISUAL_STANDARD_REQUIRED',
]);

// Provider and compositor primitives are wiring/rendering dependencies, never alternate execution authorities.
assertNoDirectPrimitiveFinalizerImports('src', controlledFinalizerPath);
assertNoDirectProviderGeneratorImports('src', [controlledGenerationPath, operatorGeneratePath]);

requireIncludes('src/creative/creative-truth-resolver.ts', [
  "if (creativeMode === 'GENERATIVE_EXCEPTION')",
  'GENERATIVE_EXCEPTION_REQUIRES_OPERATION_SCOPED_PIPELINE',
  'ControlledOperationScopedStaticImageGenerationService',
]);
requireIncludes('test/creative-truth-resolver.test.ts', [
  'legacy global-set reads cannot bypass operation-scoped generation',
  'GENERATIVE_EXCEPTION_REQUIRES_OPERATION_SCOPED_PIPELINE',
]);

// Legacy global-set fidelity may remain as compatibility surface, but it must never pass finalization.
requireIncludes('src/creative/creative-truth.ts', [
  'The original V1 global venue set is now canonically DEPRECATED in Drive',
  "if (approval.referenceSetId === TOCA_VENUE_REFERENCE_SET_ID)",
  "failures.add('FAILED_UNAPPROVED_GENERATIVE_EXCEPTION')",
]);

requireIncludes(baseRegistryPath, [
  'const matches = rows.filter((row) => cell(row[0]) === TOCA_CREATIVE_TRUTH_POLICY_ID)',
  'if (matches.length !== 1)',
  "const matches = rows.filter(\n      (candidate) => cell(candidate[1]) === brand && cell(candidate[2]) === variant,",
  "const matches = rows.filter((candidate) => cell(candidate[0]) === standardId)",
  "const matches = rows.filter((candidate) => cell(candidate[0]) === venueAssetId)",
  "const matches = rows.filter((candidate) => cell(candidate[0]) === shotId)",
]);
requireIncludes('test/creative-truth-registry-ambiguity.test.ts', [
  'rejects duplicate canonical policy identities',
  'brand plus variant identity is ambiguous',
  'creative standard when standard identity is ambiguous',
  'venue when venue asset identity is ambiguous',
  'video shot when shot identity is ambiguous',
]);

requireIncludes(operatorGeneratePath, [
  'GoogleSheetsOperationScopedGenerativeRegistry',
  'ControlledOperationScopedStaticImageGenerationService',
  'CreativeTruthOperationScopedImageGenerator',
  'candidateSha256: result.candidateSha256',
  'referenceSha256s: result.referenceSha256s',
  'operation: result.operation',
  'referenceSetId: result.referenceSetId',
  'publicationEligible: false',
  'IMAGE_GENERATE_CALLER_TIME_FORBIDDEN',
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

requireIncludes('test/creative-truth-operation-scoped-reference-sets.test.ts', [
  'rejects the deprecated global reference set from new approvals',
  'rejects operation/reference-set mismatch',
  'FAILED_GENERATIVE_REFERENCE_SET_OPERATION_MISMATCH',
]);
requireIncludes('test/creative-truth-operation-scoped-generative-registry.test.ts', [
  'POLICY!A2:Z20',
  'VENUE_REFERENCE_SET!A2:K1000',
  'GENERATIVE_EXCEPTIONS!A2:O1000',
  'fails closed on ambiguous approved rows',
  'rejects a deprecated global reference set',
  'explicit operation conflicts with its active reference set',
  'accepts only the canonical operation-scoped policy and reference topology',
  'fails closed when The Party reference rows claim Sunset operation scope',
]);
requireIncludes('test/controlled-operation-scoped-static-image-generation.test.ts', [
  'uses only required references from the approved Sunset set',
  'canonical content operation is missing',
  'conflicts with the canonical content operation',
  'does not accept a cross-operation reference row',
  'cannot backdate an expired approval because the clock is an injected trusted dependency',
  'trusted clock itself is invalid',
]);
requireIncludes('test/creative-truth-operation-scoped-image-generator.test.ts', [
  'canonical content operation is missing',
  'canonical content operation conflicts with the approved reference set',
  'approval object whose operation does not match its own reference set',
  'VENUE_VISUALS operation does not match the approved reference set',
  'rejects The Party references attached to a Sunset approval',
  'managed Responses image tool',
]);
requireIncludes('test/operation-scoped-generative-fidelity.test.ts', [
  'passes only exact Sunset-scoped candidate evidence after human review',
  'rejects a Sunset approval at a The Party finalization boundary',
  'rejects evidence replayed against another generated candidate',
  'rejects output without human review',
]);
requireIncludes('test/canonical-generative-brand-binding.test.ts', [
  'replaces caller registry metadata with the exact canonical official BRAND_ASSETS record',
  'requires Toca branding for Sunset standards and rejects unrequired extras',
  'requires the official white The Party hero asset',
  'requires an explicit environment for The Party networks',
]);
requireIncludes('test/local-operation-scoped-generative-composer.test.ts', [
  'renders only after exact scoped human-reviewed candidate evidence passes',
  'candidate hash substitution',
  'legacy generative finalization denial',
  'FAILED_UNAPPROVED_GENERATIVE_EXCEPTION',
]);
requireIncludes('test/controlled-operation-scoped-generative-finalization.test.ts', [
  'source hashes, standard and brands before final render',
  'candidate hash substitution before canonical state or composer access',
  'CONTENT_ITEMS operation changes after candidate generation',
  'canonical approval no longer matches the generated candidate manifest',
  'current canonical reference source hash differs from generation lineage',
  'approved minimum reference count immediately before finalization',
  'duplicate canonical reference identity',
  'caller-forged standard metadata with canonical CREATIVE_STANDARDS readback',
  'caller-forged brand registry metadata with canonical BRAND_ASSETS readback',
  'canonical standard does not exist',
  'expired approval against trusted service time',
  'trusted finalization clock is invalid',
]);

console.log('Operation-scoped generative Creative Truth contract OK');

function assertNoDirectPrimitiveFinalizerImports(root, allowedPath) {
  for (const path of walk(root)) {
    if (!path.endsWith('.ts') || path === allowedPath || path === primitiveFinalizerPath) continue;
    const content = readFileSync(path, 'utf8');
    if (content.includes('local-operation-scoped-generative-composer.js')) {
      fail(
        `Operation-scoped generative primitive finalizer imported outside controlled boundary: ${path}`,
      );
    }
  }
}

function assertNoDirectProviderGeneratorImports(root, allowedPaths) {
  const allowed = new Set(allowedPaths);
  for (const path of walk(root)) {
    if (!path.endsWith('.ts') || path === providerGeneratorPath || allowed.has(path)) continue;
    const content = readFileSync(path, 'utf8');
    if (content.includes('creative-truth-operation-scoped-image-generator.js')) {
      fail(`Operation-scoped image provider imported outside controlled generation boundary: ${path}`);
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

function requireIncludes(path, markers) {
  const content = readFileSync(path, 'utf8');
  for (const marker of markers) {
    if (!content.includes(marker)) fail(`Missing marker in ${path}: ${marker}`);
  }
}

function requireExcludes(path, markers) {
  const content = readFileSync(path, 'utf8');
  for (const marker of markers) {
    if (content.includes(marker)) fail(`Forbidden marker in ${path}: ${marker}`);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
