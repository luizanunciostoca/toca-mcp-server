import { describe, expect, it } from 'vitest';
import { operationScopedGenerativeCandidateManifestSchema } from '../src/contracts/operation-scoped-generative-candidate.js';

function candidate() {
  return {
    status: 'GENERATED_REVIEW_REQUIRED' as const,
    contentItemId: 'CONTENT-SUN-1',
    creativeMode: 'GENERATIVE_EXCEPTION' as const,
    policyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1' as const,
    operation: 'SUNSET' as const,
    referenceSetId: 'TOCA_VENUE_REFERENCE_SET_SUNSET_V1' as const,
    exceptionId: 'GEN-SUN-1',
    approvalRef: 'approval:gen-sun-1',
    candidateSha256: 'a'.repeat(64),
    referenceAssetIds: ['SUN-1', 'SUN-2', 'SUN-3'],
    referenceSha256s: ['1'.repeat(64), '2'.repeat(64), '3'.repeat(64)],
    provider: 'OPENAI_IMAGE_GENERATION' as const,
    generationMode: 'FULL_STATIC_IMAGE_WITH_OPERATION_SCOPED_VERIFIED_REFERENCES' as const,
    responseModel: 'gpt-5.6',
    imageToolModelSelection: 'RESPONSES_TOOL_MANAGED' as const,
    outputContentType: 'image/jpeg' as const,
    outputSizeBytes: 1234,
    requiresPostGenerationHumanReview: true as const,
    requiresVenueFidelityGate: true as const,
    readyForFinalComposition: false as const,
    publicationEligible: false as const,
  };
}

describe('operation-scoped generative candidate manifest', () => {
  it('accepts exact operation-scoped generation lineage only', () => {
    expect(operationScopedGenerativeCandidateManifestSchema.parse(candidate())).toMatchObject({
      operation: 'SUNSET',
      referenceSetId: 'TOCA_VENUE_REFERENCE_SET_SUNSET_V1',
      publicationEligible: false,
      readyForFinalComposition: false,
    });
  });

  it('rejects a reference set that belongs to another operation', () => {
    const parsed = operationScopedGenerativeCandidateManifestSchema.safeParse({
      ...candidate(),
      referenceSetId: 'TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1',
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((issue) => issue.message)).toContain(
        'GENERATIVE_CANDIDATE_REFERENCE_SET_OPERATION_MISMATCH',
      );
    }
  });

  it('rejects duplicate reference asset identities', () => {
    const parsed = operationScopedGenerativeCandidateManifestSchema.safeParse({
      ...candidate(),
      referenceAssetIds: ['SUN-1', 'SUN-1', 'SUN-3'],
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((issue) => issue.message)).toContain(
        'GENERATIVE_CANDIDATE_REFERENCE_LINEAGE_DUPLICATE',
      );
    }
  });

  it('rejects duplicate reference source hashes', () => {
    const parsed = operationScopedGenerativeCandidateManifestSchema.safeParse({
      ...candidate(),
      referenceSha256s: ['1'.repeat(64), '1'.repeat(64), '3'.repeat(64)],
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((issue) => issue.message)).toContain(
        'GENERATIVE_CANDIDATE_REFERENCE_HASH_DUPLICATE',
      );
    }
  });
});
