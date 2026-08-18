import { existsSync, readFileSync } from 'node:fs';

const required = [
  'src/contracts/creative-truth-generative-reference-sets.ts',
  'src/providers/google-sheets/creative-truth-operation-scoped-generative-registry.ts',
  'src/providers/openai/creative-truth-operation-scoped-image-generator.ts',
  'src/creative/controlled-operation-scoped-static-image-generation.ts',
  'src/marketing-autopilot-image-generate.ts',
];
for (const path of required) {
  if (!existsSync(path)) fail(`Operation-scoped Creative Truth file missing: ${path}`);
}

requireIncludes('src/contracts/creative-truth-generative-reference-sets.ts', [
  "TOCA_VENUE_REFERENCE_SET_SUNSET_V1",
  "TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1",
  "LEGACY_TOCA_VENUE_REFERENCE_SET_ID = 'TOCA_VENUE_REFERENCE_SET_V1'",
  'tocaGenerativeVenueReferenceSetIdSchema',
  'operationScopedGenerativeExceptionApprovalSchema',
]);

requireIncludes('src/creative/controlled-operation-scoped-static-image-generation.ts', [
  'approval.referenceSetId',
  'getReferenceSet(approval.referenceSetId)',
  'reference.referenceSetId === approval.referenceSetId',
  'requiredForGenerativeException',
]);

requireIncludes('src/providers/openai/creative-truth-operation-scoped-image-generator.ts', [
  'referenceSetOperation(approval.referenceSetId)',
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
  'publicationEligible: false',
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
