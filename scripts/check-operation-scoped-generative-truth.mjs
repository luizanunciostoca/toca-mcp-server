import { existsSync, readFileSync } from 'node:fs';

const required = [
  'src/contracts/creative-truth-generative-reference-sets.ts',
  'src/providers/google-sheets/creative-truth-operation-scoped-generative-registry.ts',
  'src/providers/openai/creative-truth-operation-scoped-image-generator.ts',
  'src/creative/controlled-operation-scoped-static-image-generation.ts',
  'src/marketing-autopilot-image-generate.ts',
  'test/creative-truth-operation-scoped-reference-sets.test.ts',
  'test/creative-truth-operation-scoped-generative-registry.test.ts',
  'test/controlled-operation-scoped-static-image-generation.test.ts',
  'test/creative-truth-operation-scoped-image-generator.test.ts',
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

console.log('Operation-scoped generative Creative Truth contract OK');

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
