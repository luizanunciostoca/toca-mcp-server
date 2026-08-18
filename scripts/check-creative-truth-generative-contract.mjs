import { existsSync, readFileSync } from 'node:fs';

const requiredFiles = [
  'src/providers/openai/creative-truth-openai-image-generator.ts',
  'test/creative-truth-openai-image-generator.test.ts',
];

for (const path of requiredFiles) {
  if (!existsSync(path)) fail(`Creative Truth static generative file missing: ${path}`);
}

requireIncludes('control/creative-truth-policy.v1.json', [
  '"generativeMode": "GENERATIVE_EXCEPTION"',
  '"venueReferenceSetRequired": "TOCA_VENUE_REFERENCE_SET_V1"',
  '"minimumVerifiedReferences": 3',
  '"architecturalInventionStillForbidden": true',
  '"environmentDriftStillForbidden": true',
  '"videoGenerativeException": "UNSUPPORTED_V1"',
]);

requireIncludes('src/providers/openai/creative-truth-openai-image-generator.ts', [
  "const OPENAI_RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses'",
  "const DEFAULT_IMAGE_MODEL = 'gpt-image-1'",
  'CreativeTruthOpenAiImageGenerator',
  "creativeMode: 'GENERATIVE_EXCEPTION'",
  "generationMode: 'FULL_STATIC_IMAGE_WITH_VERIFIED_REFERENCES'",
  'requiresPostGenerationHumanReview: true',
  'requiresVenueFidelityGate: true',
  'readyForFinalComposition: false',
  "role: 'developer'",
  "type: 'input_image'",
  "type: 'image_generation'",
  "action: 'generate'",
  "input_fidelity: 'high'",
  'approval.contentItemId !== request.contentItemId',
  'approval.referenceSetId !== TOCA_VENUE_REFERENCE_SET_ID',
  'approval.minReferenceCount < 3',
  'reference.registry.status !== \'ACTIVE\'',
  '!reference.registry.venueVerified',
  '!reference.registry.requiredForGenerativeException',
  'FAILED_GENERATIVE_REFERENCE_MISSING',
  'FAILED_UNAPPROVED_GENERATIVE_EXCEPTION',
  'Do not generate, redraw, repair, imitate or approximate',
  'NOT approved final creative',
  'candidateSha256: sha256(outputBytes)',
]);

requireIncludes('src/creative/creative-truth.ts', [
  'FAILED_GENERATIVE_OUTPUT_REVIEW_MISSING',
  'validateEvidenceCandidateBinding',
  "!['HUMAN_REVIEW', 'MULTIMODAL_PLUS_HUMAN'].includes(evidence.verificationMethod)",
]);

requireIncludes('test/creative-truth-openai-image-generator.test.ts', [
  'fails closed before provider access when approval belongs to another content item',
  'fails closed when fewer than three verified venue references are supplied',
  'fails closed on revoked, unverified, duplicate or empty reference evidence',
  'sends the exact verified reference images under a higher-priority Creative Truth policy',
  'requiresPostGenerationHumanReview',
  'readyForFinalComposition',
]);

console.log('Creative Truth static generative contract OK');

function requireIncludes(path, markers) {
  const content = readFileSync(path, 'utf8');
  for (const marker of markers) {
    if (!content.includes(marker)) fail(`Creative Truth generative contract missing in ${path}: ${marker}`);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
