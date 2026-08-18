import { existsSync, readFileSync } from 'node:fs';

const requiredFiles = [
  'src/providers/openai/creative-truth-openai-image-generator.ts',
  'src/providers/google-drive/creative-truth-reference-loader.ts',
  'src/creative/controlled-static-image-generation.ts',
  'src/contracts/creative-truth-generative-reference-sets.ts',
  'src/providers/google-sheets/creative-truth-operation-scoped-generative-registry.ts',
  'src/providers/openai/creative-truth-operation-scoped-image-generator.ts',
  'src/creative/controlled-operation-scoped-static-image-generation.ts',
  'src/marketing-autopilot-image-generate.ts',
  'docs/architecture/controlled-static-image-generation.md',
];
for (const path of requiredFiles) {
  if (!existsSync(path)) fail(`Creative Truth static generative file missing: ${path}`);
}

requireIncludes('control/creative-truth-policy.v1.json', [
  '"generativeMode": "GENERATIVE_EXCEPTION"',
  '"minimumVerifiedReferences": 3',
  '"architecturalInventionStillForbidden": true',
  '"environmentDriftStillForbidden": true',
  '"videoGenerativeException": "UNSUPPORTED_V1"',
]);

// Legacy global-set implementation remains fail-closed for compatibility but is not the operator entrypoint.
requireIncludes('src/providers/openai/creative-truth-openai-image-generator.ts', [
  "const DEFAULT_RESPONSE_MODEL = 'gpt-5.6'",
  "const IMAGE_TOOL_MODEL_SELECTION = 'RESPONSES_TOOL_MANAGED' as const",
  'CreativeTruthOpenAiImageGenerator',
  'readyForFinalComposition: false',
]);

requireIncludes('src/contracts/creative-truth-generative-reference-sets.ts', [
  "LEGACY_TOCA_VENUE_REFERENCE_SET_ID = 'TOCA_VENUE_REFERENCE_SET_V1'",
  'TOCA_VENUE_REFERENCE_SET_SUNSET_V1',
  'TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1',
  'operationScopedGenerativeExceptionApprovalSchema',
]);

requireIncludes('src/providers/openai/creative-truth-operation-scoped-image-generator.ts', [
  "const DEFAULT_RESPONSE_MODEL = 'gpt-5.6'",
  "const IMAGE_TOOL_MODEL_SELECTION = 'RESPONSES_TOOL_MANAGED' as const",
  'CreativeTruthOperationScopedImageGenerator',
  'referenceSetOperation(approval.referenceSetId)',
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
  'requiresVenueFidelityGate: true',
  'readyForFinalComposition: false',
]);
forbidIncludes('src/providers/openai/creative-truth-operation-scoped-image-generator.ts', [
  "const DEFAULT_IMAGE_MODEL = 'gpt-image-2'",
  "input_fidelity: 'high'",
  'model: this.imageModel',
]);

requireIncludes('src/providers/google-sheets/creative-truth-operation-scoped-generative-registry.ts', [
  'GoogleSheetsOperationScopedGenerativeRegistry',
  'operationScopedGenerativeExceptionApprovalSchema.safeParse',
  'getContentItemOperation',
  "const CONTENT_OPERATION_RANGE = 'CONTENT_ITEMS!A2:E2000'",
  'if (matches.length !== 1) return undefined',
]);

requireIncludes('src/creative/controlled-operation-scoped-static-image-generation.ts', [
  'ControlledOperationScopedStaticImageGenerationService',
  'getContentItemOperation(contentItemId)',
  'getReferenceSet(approval.referenceSetId)',
  'reference.referenceSetId === approval.referenceSetId',
  'requiredForGenerativeException',
]);

requireIncludes('src/marketing-autopilot-image-generate.ts', [
  'GoogleSheetsOperationScopedGenerativeRegistry',
  'ControlledOperationScopedStaticImageGenerationService',
  'CreativeTruthOperationScopedImageGenerator',
  "requiredEnv('GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY')",
  'GOOGLE_DRIVE_ACCESS_TOKEN_ENV_KEY',
  "requiredEnv('OPENAI_API_KEY_ENV_KEY')",
  "status: 'GENERATED_REVIEW_REQUIRED'",
  'operation: result.operation',
  'referenceSetId: result.referenceSetId',
  'imageToolModelSelection: result.imageToolModelSelection',
  'publicationEligible: false',
  'readyForFinalComposition: result.readyForFinalComposition',
]);
forbidIncludes('src/marketing-autopilot-image-generate.ts', ['OPENAI_CREATIVE_IMAGE_MODEL']);

requireIncludes('src/providers/google-drive/creative-truth-reference-loader.ts', [
  'GoogleDriveCreativeTruthReferenceLoader',
  "url.searchParams.set('alt', 'media')",
  'metadata.capabilities?.canDownload !== true',
  'GENERATIVE_REFERENCE_DRIVE_BYTES_INVALID',
]);

requireIncludes('package.json', [
  '"dev:marketing-autopilot-image-generate": "tsx src/marketing-autopilot-image-generate.ts"',
  '"start:marketing-autopilot-image-generate": "node dist/src/marketing-autopilot-image-generate.js"',
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
