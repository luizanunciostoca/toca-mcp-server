import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const controlledFinalizerPath =
  'src/providers/local/controlled-operation-scoped-generative-finalization.ts';
const primitiveFinalizerPath = 'src/providers/local/local-operation-scoped-generative-composer.ts';
const required = [
  'src/contracts/creative-truth-generative-reference-sets.ts',
  'src/providers/google-sheets/creative-truth-operation-scoped-generative-registry.ts',
  'src/providers/openai/creative-truth-operation-scoped-image-generator.ts',
  'src/creative/controlled-operation-scoped-static-image-generation.ts',
  'src/creative/operation-scoped-generative-fidelity.ts',
  primitiveFinalizerPath,
  controlledFinalizerPath,
  'src/marketing-autopilot-image-generate.ts',
  'test/creative-truth-operation-scoped-reference-sets.test.ts',
  'test/creative-truth-operation-scoped-generative-registry.test.ts',
  'test/controlled-operation-scoped-static-image-generation.test.ts',
  'test/creative-truth-operation-scoped-image-generator.test.ts',
  'test/operation-scoped-generative-fidelity.test.ts',
  'test/local-operation-scoped-generative-composer.test.ts',
  'test/controlled-operation-scoped-generative-finalization.test.ts',
];
for (const path of required) {
  if (!existsSync(path)) fail(`Operation-scoped Creative Truth file missing: ${path}`);
}

requireIncludes('src/contracts/creative-truth-generative-reference-sets.ts', [
  'TOCA_VENUE_REFERENCE_SET_SUNSET_V1',
  'TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1',
  "LEGACY_TOCA_VENUE_REFERENCE_SET_ID = 'TOCA_VENUE_REFERENCE_SET_V1'",
  "tocaGenerativeOperationSchema = z.enum(['SUNSET', 'THE_PARTY'])",
  'tocaGenerativeVenueReferenceSetIdSchema',
  'operationScopedGenerativeExceptionApprovalSchema',
  'operation: tocaGenerativeOperationSchema',
  'FAILED_GENERATIVE_REFERENCE_SET_OPERATION_MISMATCH',
  'referenceSetOperation(approval.referenceSetId) !== approval.operation',
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
  ],
);

requireIncludes('src/creative/controlled-operation-scoped-static-image-generation.ts', [
  'getContentItemOperation(contentItemId)',
  'FAILED_GENERATIVE_CONTENT_OPERATION_MISSING',
  'approval.operation !== operation',
  'referenceSetOperation(approval.referenceSetId) !== operation',
  'getReferenceSet(approval.referenceSetId)',
  'reference.referenceSetId === approval.referenceSetId',
  'requiredForGenerativeException',
]);

requireIncludes('src/providers/openai/creative-truth-operation-scoped-image-generator.ts', [
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
  'Do not borrow venue facts from another Toca operation',
  'readyForFinalComposition: false',
  'requiresPostGenerationHumanReview: true',
]);

requireIncludes('src/creative/operation-scoped-generative-fidelity.ts', [
  'evaluateOperationScopedGenerativeFidelity',
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

requireIncludes(controlledFinalizerPath, [
  'ControlledOperationScopedGenerativeFinalizationService',
  "Omit<",
  "'approval' | 'references'",
  'registry.assertCanonicalPolicy()',
  'registry.getContentItemOperation(contentItemId)',
  'registry.getApprovedGenerativeException(contentItemId)',
  'referenceSetOperation(approval.referenceSetId) !== operation',
  'registry.getReferenceSet(',
  'FAILED_GENERATIVE_CONTENT_OPERATION_MISSING',
  'FAILED_GENERATIVE_REFERENCE_SET_OPERATION_MISMATCH',
  'FAILED_GENERATIVE_REFERENCE_MISSING',
  'approval,',
  'references:',
]);

// The raw ImageMagick finalizer is a rendering primitive, not an execution authority.
// Any production source importing it directly would bypass canonical CONTENT_ITEMS/approval/reference readback.
assertNoDirectPrimitiveFinalizerImports('src', controlledFinalizerPath);

// Legacy global-set fidelity may remain as compatibility surface, but it must never pass finalization.
requireIncludes('src/creative/creative-truth.ts', [
  'The original V1 global venue set is now canonically DEPRECATED in Drive',
  "if (approval.referenceSetId === TOCA_VENUE_REFERENCE_SET_ID)",
  "failures.add('FAILED_UNAPPROVED_GENERATIVE_EXCEPTION')",
]);

requireIncludes('src/marketing-autopilot-image-generate.ts', [
  'GoogleSheetsOperationScopedGenerativeRegistry',
  'ControlledOperationScopedStaticImageGenerationService',
  'CreativeTruthOperationScopedImageGenerator',
  'operation: result.operation',
  'referenceSetId: result.referenceSetId',
  'publicationEligible: false',
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
requireIncludes('test/local-operation-scoped-generative-composer.test.ts', [
  'renders only after exact scoped human-reviewed candidate evidence passes',
  'candidate hash substitution',
  'legacy generative finalization denial',
  'FAILED_UNAPPROVED_GENERATIVE_EXCEPTION',
]);
requireIncludes('test/controlled-operation-scoped-generative-finalization.test.ts', [
  'resolves approval and references canonically and overwrites caller-forged context',
  'canonical content operation is unavailable',
  'canonical approval operation conflicts with CONTENT_ITEMS',
  'canonical required references are insufficient',
  'duplicate canonical reference identity',
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

function fail(message) {
  console.error(message);
  process.exit(1);
}
