import { describe, expect, it } from 'vitest';
import type { OperationScopedGenerativeExceptionApproval } from '../src/contracts/creative-truth-generative-reference-sets.js';
import type { FidelityEvidence, VenueReference } from '../src/contracts/creative-truth.js';
import { evaluateOperationScopedGenerativeFidelity } from '../src/creative/operation-scoped-generative-fidelity.js';

const candidateSha256 = 'c'.repeat(64);
const approval: OperationScopedGenerativeExceptionApproval = {
  exceptionId: 'GEN-SUN-1',
  contentItemId: 'CONTENT-SUN-1',
  requestedBy: 'LUIZ',
  approvedBy: 'LUIZ',
  approvalRef: 'approval:gen-sun-1',
  reason: 'Explicit controlled Sunset generation',
  referenceSetId: 'TOCA_VENUE_REFERENCE_SET_SUNSET_V1',
  minReferenceCount: 3,
  allowArchitecturalInvention: false,
  allowEnvironmentDrift: false,
  allowAiLogoGeneration: false,
  status: 'APPROVED',
  createdAt: '2026-08-18T03:00:00Z',
  expiresAt: '2026-08-19T03:00:00Z',
  operation: 'SUNSET',
};

function reference(index: number, overrides: Partial<VenueReference> = {}): VenueReference {
  return {
    referenceSetId: 'TOCA_VENUE_REFERENCE_SET_SUNSET_V1',
    referenceId: `REF-SUN-${index}`,
    assetId: `SUN-${index}`,
    driveFileId: `drive-${index}`,
    referenceClass: 'VENUE_REFERENCE',
    purpose: 'GENERATIVE_VENUE_TRUTH',
    requiredForGenerativeException: true,
    venueVerified: true,
    protectedElements: ['DECK', 'HORIZONTE'],
    status: 'ACTIVE',
    ...overrides,
  };
}

const references = [reference(1), reference(2), reference(3)];

function evidence(overrides: Partial<FidelityEvidence> = {}): FidelityEvidence {
  return {
    verifier: 'HUMAN_CREATIVE_TRUTH_REVIEWER',
    verificationMethod: 'MULTIMODAL_PLUS_HUMAN',
    candidateSha256,
    sourceIdentityPreserved: true,
    architectureDriftDetected: false,
    sceneInventionDetected: false,
    logoReconstructionDetected: false,
    referenceSetId: 'TOCA_VENUE_REFERENCE_SET_SUNSET_V1',
    referenceAssetIds: references.map((item) => item.assetId),
    reviewRef: 'review:content-sun-1:candidate-c',
    notes: [],
    ...overrides,
  };
}

describe('evaluateOperationScopedGenerativeFidelity', () => {
  it('passes only exact Sunset-scoped candidate evidence after human review', () => {
    const gate = evaluateOperationScopedGenerativeFidelity({
      contentItemId: 'CONTENT-SUN-1',
      operation: 'SUNSET',
      approval,
      references,
      evidence: evidence(),
      candidateSha256,
      nowIso: '2026-08-18T04:00:00Z',
    });

    expect(gate.status).toBe('PASSED');
    expect(gate.failureCodes).toEqual([]);
    expect(gate.evidence).toMatchObject({
      operation: 'SUNSET',
      referenceSetId: 'TOCA_VENUE_REFERENCE_SET_SUNSET_V1',
      candidateSha256,
      outputSpecificHumanReview: true,
      crossOperationReferenceReuse: false,
    });
  });

  it('rejects a Sunset approval at a The Party finalization boundary', () => {
    const gate = evaluateOperationScopedGenerativeFidelity({
      contentItemId: 'CONTENT-SUN-1',
      operation: 'THE_PARTY',
      approval,
      references,
      evidence: evidence(),
      candidateSha256,
      nowIso: '2026-08-18T04:00:00Z',
    });

    expect(gate.status).toBe('FAILED');
    expect(gate.failureCodes).toContain('FAILED_UNAPPROVED_GENERATIVE_EXCEPTION');
  });

  it('rejects reference evidence from another operation set', () => {
    const gate = evaluateOperationScopedGenerativeFidelity({
      contentItemId: 'CONTENT-SUN-1',
      operation: 'SUNSET',
      approval,
      references,
      evidence: evidence({ referenceSetId: 'TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1' }),
      candidateSha256,
      nowIso: '2026-08-18T04:00:00Z',
    });

    expect(gate.status).toBe('FAILED');
    expect(gate.failureCodes).toContain('FAILED_FIDELITY_EVIDENCE_BINDING');
  });

  it('rejects evidence replayed against another generated candidate', () => {
    const gate = evaluateOperationScopedGenerativeFidelity({
      contentItemId: 'CONTENT-SUN-1',
      operation: 'SUNSET',
      approval,
      references,
      evidence: evidence(),
      candidateSha256: 'd'.repeat(64),
      nowIso: '2026-08-18T04:00:00Z',
    });

    expect(gate.status).toBe('FAILED');
    expect(gate.failureCodes).toContain('FAILED_FIDELITY_EVIDENCE_BINDING');
  });

  it('rejects output without human review even when candidate and references match', () => {
    const withReview = evidence();
    const { reviewRef: _omittedReviewRef, ...withoutReview } = withReview;
    const gate = evaluateOperationScopedGenerativeFidelity({
      contentItemId: 'CONTENT-SUN-1',
      operation: 'SUNSET',
      approval,
      references,
      evidence: { ...withoutReview, verificationMethod: 'MULTIMODAL_REVIEW' },
      candidateSha256,
      nowIso: '2026-08-18T04:00:00Z',
    });

    expect(gate.status).toBe('FAILED');
    expect(gate.failureCodes).toContain('FAILED_GENERATIVE_OUTPUT_REVIEW_MISSING');
  });

  it('rejects any architecture, scene or logo drift signal', () => {
    for (const overrides of [
      { architectureDriftDetected: true },
      { sceneInventionDetected: true },
      { logoReconstructionDetected: true },
    ] satisfies Partial<FidelityEvidence>[]) {
      const gate = evaluateOperationScopedGenerativeFidelity({
        contentItemId: 'CONTENT-SUN-1',
        operation: 'SUNSET',
        approval,
        references,
        evidence: evidence(overrides),
        candidateSha256,
        nowIso: '2026-08-18T04:00:00Z',
      });
      expect(gate.status).toBe('FAILED');
    }
  });
});
