import { describe, expect, it } from 'vitest';
import type {
  BrandAsset,
  CreativeTruthPublicationBinding,
  FidelityEvidence,
  GenerativeExceptionApproval,
  VenueAsset,
  VenueReference,
} from '../src/contracts/creative-truth.js';
import {
  assertCreativePublicationAssetHash,
  evaluateBrandIntegrity,
  evaluateVenueFidelity,
  requireGatePassed,
} from '../src/creative/creative-truth.js';

const morroLogo: BrandAsset = {
  brandAssetId: 'BRAND-MORRO-WHITE-V1',
  brand: 'MORRO_DIGITAL',
  variant: 'WHITE',
  driveFileId: 'drive-morro-white',
  fileName: 'MORRO_DIGITAL_LOGO_BRANCA.png',
  contentType: 'image/png',
  integrityMode: 'SHA256_PINNED',
  sha256: 'd'.repeat(64),
  status: 'ACTIVE_APPROVED',
  aiReconstructionAllowed: false,
};

const venue: VenueAsset = {
  venueAssetId: 'VENUE-SUN-0087',
  sourceAssetId: 'SUN-0087',
  sourceDriveFileId: 'source-drive',
  masterAssetId: 'MM-SUN-0087-V2',
  masterDriveFileId: 'master-drive',
  sourceSha256: 'a'.repeat(64),
  masterSha256: 'b'.repeat(64),
  operation: 'SUNSET',
  locationSignature: 'bar_toca',
  dominantSubject: 'drinks_bar',
  venueVerified: true,
  marketingReady: true,
  generativeReferenceAllowed: true,
  protectedElements: ['BAR', 'DRINKS', 'MATERIAIS', 'ILUMINACAO'],
  status: 'VENUE_VERIFIED_MARKETING_READY',
};

const cleanEvidence: FidelityEvidence = {
  verifier: 'TEST_VERIFIER',
  sourceIdentityPreserved: true,
  architectureDriftDetected: false,
  sceneInventionDetected: false,
  logoReconstructionDetected: false,
  referenceAssetIds: [],
  notes: [],
};

describe('Creative Truth gates', () => {
  it('rejects an AI-reconstructed Morro Digital logo even when the brand name matches', () => {
    const gate = evaluateBrandIntegrity(
      ['MORRO_DIGITAL'],
      [
        {
          asset: morroLogo,
          observedDriveFileId: morroLogo.driveFileId,
          observedSha256: 'd'.repeat(64),
          aiGenerated: true,
        },
      ],
    );

    expect(gate.status).toBe('FAILED');
    expect(gate.failureCodes).toContain('FAILED_AI_LOGO_RECONSTRUCTION');
    expect(() => requireGatePassed(gate)).toThrow('FAILED_AI_LOGO_RECONSTRUCTION');
  });

  it('rejects an approximated official logo when the bytes do not match the pinned hash', () => {
    const gate = evaluateBrandIntegrity(
      ['MORRO_DIGITAL'],
      [
        {
          asset: morroLogo,
          observedDriveFileId: morroLogo.driveFileId,
          observedSha256: 'e'.repeat(64),
        },
      ],
    );

    expect(gate.status).toBe('FAILED');
    expect(gate.failureCodes).toContain('FAILED_BRAND_ASSET_HASH_MISMATCH');
  });

  it('rejects a venue asset with no promoted master lineage', () => {
    const gate = evaluateVenueFidelity({
      creativeMode: 'REAL_COMPOSITE',
      venueAsset: {
        ...venue,
        marketingReady: false,
        masterAssetId: undefined,
        masterDriveFileId: undefined,
        masterSha256: undefined,
        status: 'VENUE_VERIFIED_SOURCE',
      },
    });

    expect(gate.status).toBe('FAILED');
    expect(gate.failureCodes).toContain('FAILED_LINEAGE_MISSING');
  });

  it('rejects architecture drift after an enhancement', () => {
    const gate = evaluateVenueFidelity({
      creativeMode: 'REAL_PLUS_ENHANCEMENT',
      venueAsset: venue,
      evidence: { ...cleanEvidence, architectureDriftDetected: true },
    });

    expect(gate.status).toBe('FAILED');
    expect(gate.failureCodes).toContain('FAILED_ARCHITECTURE_DRIFT');
  });

  it('rejects an invented scene even when the source identity is otherwise preserved', () => {
    const gate = evaluateVenueFidelity({
      creativeMode: 'REAL_PLUS_ENHANCEMENT',
      venueAsset: venue,
      evidence: { ...cleanEvidence, sceneInventionDetected: true },
    });

    expect(gate.status).toBe('FAILED');
    expect(gate.failureCodes).toContain('FAILED_SCENE_INVENTION_DETECTED');
  });

  it('rejects generative creation without explicit approval', () => {
    const gate = evaluateVenueFidelity({
      creativeMode: 'GENERATIVE_EXCEPTION',
      evidence: cleanEvidence,
    });

    expect(gate.status).toBe('FAILED');
    expect(gate.failureCodes).toContain('FAILED_UNAPPROVED_GENERATIVE_EXCEPTION');
  });

  it('rejects the deprecated global venue reference set even with an approval-shaped record', () => {
    const approval = {
      ...approvedException(),
      referenceSetId: 'TOCA_VENUE_REFERENCE_SET_V1',
    };
    const gate = evaluateVenueFidelity({
      creativeMode: 'GENERATIVE_EXCEPTION',
      generativeException: approval,
      references: [],
      evidence: {
        ...cleanEvidence,
        referenceSetId: approval.referenceSetId,
      },
      nowIso: '2026-08-20T02:00:00-03:00',
    });

    expect(gate.status).toBe('FAILED');
    expect(gate.failureCodes).toContain('FAILED_GENERATIVE_REFERENCE_OPERATION_MISMATCH');
  });

  it('rejects an approved generative exception when verified references are insufficient', () => {
    const approval = approvedException();
    const gate = evaluateVenueFidelity({
      creativeMode: 'GENERATIVE_EXCEPTION',
      generativeException: approval,
      references: [reference('REF-1', 'SUN-0001')],
      evidence: {
        ...cleanEvidence,
        referenceSetId: approval.referenceSetId,
        referenceAssetIds: ['SUN-0001'],
      },
      nowIso: '2026-08-20T02:00:00-03:00',
    });

    expect(gate.status).toBe('FAILED');
    expect(gate.failureCodes).toContain('FAILED_GENERATIVE_REFERENCE_MISSING');
  });

  it('rejects a cross-operation reference inside a Sunset generative exception', () => {
    const approval = approvedException();
    const references = [
      reference('REF-1', 'SUN-0001'),
      reference('REF-2', 'SUN-0004'),
      { ...reference('REF-3', 'TP-0130'), operationScope: 'THE_PARTY' },
    ];
    const gate = evaluateVenueFidelity({
      creativeMode: 'GENERATIVE_EXCEPTION',
      generativeException: approval,
      references,
      evidence: {
        ...cleanEvidence,
        referenceSetId: approval.referenceSetId,
        referenceAssetIds: references.map((item) => item.assetId),
      },
      nowIso: '2026-08-20T02:00:00-03:00',
    });

    expect(gate.status).toBe('FAILED');
    expect(gate.failureCodes).toContain('FAILED_GENERATIVE_REFERENCE_MISSING');
  });

  it('passes a controlled Sunset generative exception only with enough operation-scoped references and no drift', () => {
    const approval = approvedException();
    const references = [
      reference('REF-1', 'SUN-0001'),
      reference('REF-2', 'SUN-0004'),
      reference('REF-3', 'SUN-0009'),
    ];
    const gate = evaluateVenueFidelity({
      creativeMode: 'GENERATIVE_EXCEPTION',
      generativeException: approval,
      references,
      evidence: {
        ...cleanEvidence,
        referenceSetId: approval.referenceSetId,
        referenceAssetIds: references.map((item) => item.assetId),
      },
      nowIso: '2026-08-20T02:00:00-03:00',
    });

    expect(gate.status).toBe('PASSED');
    expect(gate.failureCodes).toEqual([]);
  });

  it('rejects publication when staged bytes differ from the approved final creative hash', () => {
    const binding: CreativeTruthPublicationBinding = {
      policyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
      standardId: 'SUNSET_FEED_V1',
      creativeId: 'CREATIVE-1',
      outputSha256: 'a'.repeat(64),
      brandIntegrityStatus: 'PASSED',
      venueFidelityStatus: 'PASSED',
      qualityGateStatus: 'PASSED',
      exactAssetBinding: true,
    };

    expect(() => assertCreativePublicationAssetHash(binding, 'b'.repeat(64))).toThrow(
      'FAILED_PUBLICATION_ASSET_HASH_MISMATCH',
    );
  });
});

function approvedException(): GenerativeExceptionApproval {
  return {
    exceptionId: 'GEN-001',
    contentItemId: 'CONTENT-001',
    requestedBy: 'LUIZ',
    approvedBy: 'LUIZ',
    approvalRef: 'approval-001',
    reason: 'Explicit controlled concept generation',
    referenceSetId: 'TOCA_VENUE_REFERENCE_SET_SUNSET_V1',
    minReferenceCount: 3,
    allowArchitecturalInvention: false,
    allowEnvironmentDrift: false,
    allowAiLogoGeneration: false,
    status: 'APPROVED',
    createdAt: '2026-08-20T01:00:00-03:00',
    operation: 'SUNSET',
  };
}

function reference(referenceId: string, assetId: string): VenueReference {
  return {
    referenceSetId: 'TOCA_VENUE_REFERENCE_SET_SUNSET_V1',
    referenceId,
    assetId,
    driveFileId: `drive-${assetId}`,
    referenceClass: 'VENUE_REFERENCE',
    purpose: 'spatial truth',
    requiredForGenerativeException: true,
    venueVerified: true,
    protectedElements: ['DECK', 'HORIZONTE'],
    status: 'ACTIVE',
    operationScope: 'SUNSET',
  };
}
