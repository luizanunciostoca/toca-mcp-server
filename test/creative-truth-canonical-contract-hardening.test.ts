import { describe, expect, it } from 'vitest';
import {
  creativeTruthGateResultSchema,
  deterministicRenderManifestSchema,
  generativeExceptionApprovalSchema,
  type FidelityEvidence,
  type GenerativeExceptionApproval,
  type VenueReference,
} from '../src/contracts/creative-truth.js';
import { evaluateVenueFidelity } from '../src/creative/creative-truth.js';

const candidateSha256 = 'a'.repeat(64);

function approval(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    exceptionId: 'GEN-HARDEN-1',
    contentItemId: 'CONTENT-HARDEN-1',
    requestedBy: 'requester',
    approvedBy: 'approver',
    approvalRef: 'approval:gen-harden-1',
    reason: 'controlled generative exception test',
    referenceSetId: 'TOCA_VENUE_REFERENCE_SET_V1',
    minReferenceCount: 3,
    allowArchitecturalInvention: false,
    allowEnvironmentDrift: false,
    allowAiLogoGeneration: false,
    status: 'APPROVED',
    createdAt: '2026-08-18T00:00:00-03:00',
    ...overrides,
  };
}

function reference(index: number): VenueReference {
  return {
    referenceSetId: 'TOCA_VENUE_REFERENCE_SET_V1',
    referenceId: `REF-HARDEN-${index}`,
    assetId: `ASSET-HARDEN-${index}`,
    driveFileId: `drive-harden-${index}`,
    referenceClass: 'VENUE_REFERENCE',
    purpose: 'spatial truth',
    requiredForGenerativeException: true,
    venueVerified: true,
    protectedElements: ['DECK', 'HORIZONTE'],
    status: 'ACTIVE',
  };
}

function evidence(references: readonly VenueReference[]): FidelityEvidence {
  return {
    verifier: 'HARDENING_TEST',
    verificationMethod: 'MULTIMODAL_PLUS_HUMAN',
    candidateSha256,
    sourceIdentityPreserved: true,
    architectureDriftDetected: false,
    sceneInventionDetected: false,
    logoReconstructionDetected: false,
    referenceSetId: 'TOCA_VENUE_REFERENCE_SET_V1',
    referenceAssetIds: references.map((item) => item.assetId),
    reviewRef: 'review:gen-harden-1',
    notes: [],
  };
}

describe('Creative Truth canonical contract hardening', () => {
  it('rejects internally inconsistent gate results', () => {
    expect(() =>
      creativeTruthGateResultSchema.parse({
        gate: 'QUALITY',
        status: 'PASSED',
        failureCodes: ['FAILED_QUALITY_GATE'],
        evidence: {},
      }),
    ).toThrow();

    expect(() =>
      creativeTruthGateResultSchema.parse({
        gate: 'QUALITY',
        status: 'FAILED',
        failureCodes: [],
        evidence: {},
      }),
    ).toThrow();
  });

  it('rejects render manifests that duplicate a gate and omit another canonical gate', () => {
    expect(() =>
      deterministicRenderManifestSchema.parse({
        contentItemId: 'CONTENT-HARDEN-1',
        creativeId: 'CREATIVE-HARDEN-1',
        policyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
        standardId: 'SUNSET_FEED_V1',
        creativeMode: 'REAL_COMPOSITE',
        sourceAssetIds: ['SOURCE-HARDEN-1'],
        masterAssetIds: ['MASTER-HARDEN-1'],
        brandAssetIds: ['BRAND-TOCA-WHITE-V1'],
        outputSha256: candidateSha256,
        outputDimensions: '1080x1350',
        exactAssetBinding: true,
        gates: [
          { gate: 'BRAND_INTEGRITY', status: 'PASSED', failureCodes: [], evidence: {} },
          { gate: 'BRAND_INTEGRITY', status: 'PASSED', failureCodes: [], evidence: {} },
          { gate: 'QUALITY', status: 'PASSED', failureCodes: [], evidence: {} },
        ],
        createdAt: '2026-08-18T00:00:00-03:00',
      }),
    ).toThrow();
  });

  it('does not allow an approval row to weaken canonical generative controls', () => {
    expect(() => generativeExceptionApprovalSchema.parse(approval())).not.toThrow();
    expect(() =>
      generativeExceptionApprovalSchema.parse(approval({ minReferenceCount: 1 })),
    ).toThrow();
    expect(() =>
      generativeExceptionApprovalSchema.parse(approval({ referenceSetId: 'OTHER_REFERENCE_SET' })),
    ).toThrow();
    expect(() =>
      generativeExceptionApprovalSchema.parse(approval({ allowArchitecturalInvention: true })),
    ).toThrow();
    expect(() =>
      generativeExceptionApprovalSchema.parse(approval({ expiresAt: 'not-a-timestamp' })),
    ).toThrow();
  });

  it('fails closed even if an unparsed caller supplies a weakened generative approval object', () => {
    const references = [reference(1), reference(2), reference(3)];
    const weakened = approval({ minReferenceCount: 1 }) as unknown as GenerativeExceptionApproval;
    const gate = evaluateVenueFidelity({
      contentItemId: 'CONTENT-HARDEN-1',
      creativeMode: 'GENERATIVE_EXCEPTION',
      generativeException: weakened,
      references,
      evidence: evidence(references),
      candidateSha256,
      nowIso: '2026-08-18T00:30:00-03:00',
    });

    expect(gate.status).toBe('FAILED');
    expect(gate.failureCodes).toContain('FAILED_UNAPPROVED_GENERATIVE_EXCEPTION');
  });

  it('fails closed on an invalid evaluation clock instead of bypassing expiry checks', () => {
    const references = [reference(1), reference(2), reference(3)];
    const validApproval = generativeExceptionApprovalSchema.parse(
      approval({ expiresAt: '2026-08-19T00:00:00-03:00' }),
    );
    const gate = evaluateVenueFidelity({
      contentItemId: 'CONTENT-HARDEN-1',
      creativeMode: 'GENERATIVE_EXCEPTION',
      generativeException: validApproval,
      references,
      evidence: evidence(references),
      candidateSha256,
      nowIso: 'not-a-timestamp',
    });

    expect(gate.status).toBe('FAILED');
    expect(gate.failureCodes).toContain('FAILED_UNAPPROVED_GENERATIVE_EXCEPTION');
  });
});
