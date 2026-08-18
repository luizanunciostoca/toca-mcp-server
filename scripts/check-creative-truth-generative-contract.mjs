import { existsSync, readFileSync } from 'node:fs';

const requiredFiles = [
  'src/providers/openai/creative-truth-openai-image-generator.ts',
  'src/providers/google-drive/creative-truth-reference-loader.ts',
  'src/creative/controlled-static-image-generation.ts',
  'src/marketing-autopilot-image-generate.ts',
  'test/creative-truth-openai-image-generator.test.ts',
  'test/creative-truth-reference-loader.test.ts',
  'test/controlled-static-image-generation.test.ts',
  'test/creative-truth-registry.test.ts',
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
  "const DEFAULT_RESPONSE_MODEL = 'gpt-5.6-sol'",
  "const DEFAULT_IMAGE_MODEL = 'gpt-image-2'",
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
  "reference.registry.status !== 'ACTIVE'",
  '!reference.registry.venueVerified',
  '!reference.registry.requiredForGenerativeException',
  'hasExpectedImageSignature',
  'await this.options.registry.assertCanonicalPolicy()',
  "'getApprovedGenerativeException'",
  "'getReferenceSet'",
  "'getVenueAssetBySourceAssetId'",
  'resolveCanonicalApproval',
  'registry.getApprovedGenerativeException(request.contentItemId)',
  'sameApprovalIdentity',
  'GENERATIVE_APPROVAL_CANONICAL_IDENTITY_MISMATCH',
  'exceptionId: approval.exceptionId',
  'approvalRef: approval.approvalRef',
  'const canonicalReferenceSet = await registry.getReferenceSet(TOCA_VENUE_REFERENCE_SET_ID)',
  'registry.getVenueAssetBySourceAssetId(canonical.assetId)',
  'canonical.referenceId !== supplied.registry.referenceId',
  'canonical.driveFileId !== supplied.registry.driveFileId',
  'venue.sourceDriveFileId !== canonical.driveFileId',
  '!venue.generativeReferenceAllowed',
  '!venue.sourceSha256',
  'venue.sourceSha256.toLowerCase() !== observedSha256',
  'GENERATIVE_REFERENCE_CANONICAL_AMBIGUITY',
  'GENERATIVE_REFERENCE_CANONICAL_IDENTITY_MISMATCH',
  'GENERATIVE_REFERENCE_SOURCE_HASH_MISMATCH',
  'FAILED_GENERATIVE_REFERENCE_MISSING',
  'FAILED_UNAPPROVED_GENERATIVE_EXCEPTION',
  'Canonical verified references',
  'Do not generate, redraw, repair, imitate or approximate',
  'NOT approved final creative',
  'candidateSha256: sha256(outputBytes)',
]);

requireIncludes('src/providers/google-drive/creative-truth-reference-loader.ts', [
  'GoogleDriveCreativeTruthReferenceLoader',
  "const DEFAULT_GOOGLE_DRIVE_BASE_URL = 'https://www.googleapis.com/drive/v3'",
  "url.searchParams.set('fields', 'id,name,mimeType,size,capabilities(canDownload)')",
  "url.searchParams.set('alt', 'media')",
  "url.searchParams.set('supportsAllDrives', 'true')",
  'metadata.capabilities?.canDownload !== true',
  'GENERATIVE_REFERENCE_DRIVE_METADATA_REJECTED',
  'GENERATIVE_REFERENCE_DRIVE_BYTES_INVALID',
  "'SOURCE_IMAGE_FETCH_BLOCK'",
]);

requireIncludes('src/creative/controlled-static-image-generation.ts', [
  'ControlledStaticImageGenerationService',
  'getApprovedGenerativeException',
  'getReferenceSet',
  'referenceLoader.load(reference)',
  "reference.referenceSetId === TOCA_VENUE_REFERENCE_SET_ID",
  'uniqueAssetIds.size !== eligible.length',
  'left.referenceId.localeCompare(right.referenceId)',
  'this.dependencies.generator.generate',
]);

requireIncludes('src/marketing-autopilot-image-generate.ts', [
  'ControlledStaticImageGenerationService',
  'GoogleDriveCreativeTruthReferenceLoader',
  'CreativeTruthOpenAiImageGenerator',
  "requiredEnv('GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY')",
  'GOOGLE_DRIVE_ACCESS_TOKEN_ENV_KEY',
  "requiredEnv('OPENAI_API_KEY_ENV_KEY')",
  'OPENAI_CREATIVE_RESPONSE_MODEL',
  'OPENAI_CREATIVE_IMAGE_MODEL',
  "status: 'GENERATED_REVIEW_REQUIRED'",
  'publicationEligible: false',
  'readyForFinalComposition: result.readyForFinalComposition',
]);

requireIncludes('package.json', [
  '"dev:marketing-autopilot-image-generate": "tsx src/marketing-autopilot-image-generate.ts"',
  '"start:marketing-autopilot-image-generate": "node dist/src/marketing-autopilot-image-generate.js"',
]);

requireIncludes('src/creative/creative-truth.ts', [
  'FAILED_GENERATIVE_OUTPUT_REVIEW_MISSING',
  'validateEvidenceCandidateBinding',
  "!['HUMAN_REVIEW', 'MULTIMODAL_PLUS_HUMAN'].includes(evidence.verificationMethod)",
]);

requireIncludes('src/providers/google-sheets/creative-truth-registry.ts', [
  'getApprovedGenerativeException',
  'getVenueAssetBySourceAssetId',
  'const matches = rows.filter(',
  'if (matches.length !== 1) return undefined',
]);

requireIncludes('test/creative-truth-openai-image-generator.test.ts', [
  'fails closed before canonical/provider access when approval belongs to another content item',
  'fails closed when the canonical exception approval is missing',
  'rejects a caller approval that differs from the canonical approval record',
  'fails closed when fewer than three verified venue references are supplied',
  'fails closed on revoked, duplicate, empty or MIME-signature-invalid supplied references',
  'rejects caller metadata that does not match the canonical reference identity',
  'rejects reference bytes that do not equal the source SHA pinned in canonical VENUE_VISUALS',
  'rejects canonical reference assets with mismatched source SHA or Drive identity',
  'rejects ambiguous duplicate canonical rows for the same source asset',
  'uses canonical metadata, not caller-supplied descriptive text, in the provider policy prompt',
  'sends the exact canonical verified reference images under a higher-priority Creative Truth policy',
  "expect(body.model).toBe('gpt-5.6-sol')",
  "model: 'gpt-image-2'",
  'GENERATIVE_APPROVAL_CANONICAL_IDENTITY_MISMATCH',
  'GENERATIVE_REFERENCE_SOURCE_HASH_MISMATCH',
  'requiresPostGenerationHumanReview',
  'readyForFinalComposition',
]);

requireIncludes('test/creative-truth-reference-loader.test.ts', [
  'downloads only a canonical downloadable image blob and preserves reference identity',
  'fails closed when Drive metadata says the reference cannot be downloaded',
  'fails closed when downloaded bytes do not match the canonical MIME signature',
  'classifies forbidden Drive access as a source fetch block instead of retrying generation',
]);

requireIncludes('test/controlled-static-image-generation.test.ts', [
  'loads canonical approved references deterministically before invoking the generator',
  'fails closed when no canonical approved exception exists',
  'fails closed when canonical references are insufficient or duplicated',
  'rejects expired canonical approval before any reference download',
]);

requireIncludes('test/creative-truth-registry.test.ts', [
  'resolves a venue source asset only when canonical identity is unique',
  'resolves exactly one approved generative exception and rejects approval ambiguity',
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
