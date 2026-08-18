import { describe, expect, it } from 'vitest';
import type {
  BrandAsset,
  FidelityEvidence,
  GenerativeExceptionApproval,
  VenueAsset,
  VenueReference,
} from '../src/contracts/creative-truth.js';
import {
  evaluateBrandIntegrity,
  evaluateVenueFidelity,
  requireGatePassed,
} from '../src/creative/creative-truth.js';

const morroLogo: BrandAsset = {
  brandAssetId: 'BRAND-MORRO-WHITE-V1',
  brand: 'MORRO_DIGITAL',
  variant: 'WHITE',
  driveFileId: 'drive-morro-white',
  fileName: 'MORRO_DIGITAL_LOGO_BRANCO.png',
  contentType: 'image/png',
  integrityMode: 'DRIVE_FILE_ID_PINNED',
  status: 'ACTIVE_APPROVED',
  aiReconstructionAllowed: false,
};

const coronaLogo: BrandAsset = {
  brandAssetId: 'BRAND-CORONA-WHITE-V1',
  brand: 'CORONA',
  variant: 'WHITE',
  driveFileId: 'drive-corona-white',
  fileName: 'CORONA_LOGO_BRANCO.png',
  contentType: 'image/png',
  integrityMode: 'SHA256_PINNED',
  sha256: 'c'.repeat(64),
  status: 'ACTIVE_APPROVED',
  aiReconstructionAllowed: false,
};

const venue: VenueAsset = {
  venueAssetId: 'VENUE-SUN-0244',
  sourceAssetId: 'SUN-0244',
  sourceDriveFileId: 'source-drive',
  masterAssetId: 'MM-SUN-0244-V1',
  masterDriveFileId: 'master-drive',
  sourceSha256: 'a'.repeat(64),
  masterSha256: 'b'.repeat(64),
  operation: 'SUNSET',
  locationSignature: 'ambiente_toca',
  dominantSubject: 'experiencia_premium_lifestyle',
  venueVerified: true,
  marketingReady: true,
  generativeReferenceAllowed: true,
  protectedElements: ['DECK', 'AMBIENTE', 'ILUMINACAO'],
  status: 'ACTIVE_APPROVED',
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
    const gate = evaluateBrandIntegrity(['MORRO_DIGITAL'], [
      {
        asset: morroLogo,
        observedDriveFileId: morroLogo.driveFileId,
        aiGenerated: true,
      },
    ]);

    expect(gate.status).toBe('FAILED');
    expect(gate.failureCodes).toContain('FAILED_AI_LOGO_RECONSTRUCTION');
    expect(() => requireGatePassed(gate)).toThrow('FAILED_AI_LOGO_RECONSTRUCTION');
  });

  it('rejects an unapproved partner asset even when a file with the expected brand is supplied', () => {
    const gate = evaluateBrandIntegrity(['CORONA'], [
      {
        asset: { ...coronaLogo, status: 'REVOKED' },
        observedDriveFileId: coronaLogo.driveFileId,
        observedSha256: coronaLogo.sha256,
      },
    ]);

    expect(gate.status).toBe('FAILED');
    expect(gate.failureCodes).toContain('FAILED_BRAND_ASSET_MISSING');
  });

  it('rejects a pinned official partner file whose bytes do not match the registered SHA-256', () => {
    const gate = evaluateBrandIntegrity(['CORONA'], [
      {
        asset: coronaLogo,
        observedDriveFileId: coronaLogo.driveFileId,
        observedSha256: 'd'.repeat(64),
      },
    ]);

    expect(gate.status).toBe('FAILED');
    expect(gate.failureCodes).toContain('FAILED_BRAND_ASSET_HASH_MISMATCH');
  });

  it('rejects unverified or non-marketing-ready venue assets by default', () => {
    const gate = evaluateVenueFidelity({
      creativeMode: 'REAL_COMPOSITE',
      venueAsset: { ...venue, venueVerified: false, marketingReady: false },
    });

    expect(gate.status).toBe('FAILED');
    expect(gate.failureCodes).toContain('FAILED_NO_VENUE_VERIFIED_ASSET');
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

  it('rejects generative creation without explicit approval', () => {
    const gate = evaluateVenueFidelity({
      creativeMode: 'GENERATIVE_EXCEPTION',
      evidence: cleanEvidence,
    });

    expect(gate.status).toBe('FAILED');
    expect(gate.failureCodes).toContain('FAILED_UNAPPROVED_GENERATIVE_EXCEPTION');
  });

  it('rejects an approved generative exception when venue references are insufficient', () => {
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
      nowIso: '2026-08-17T22:00:00-03:00',
    });

    expect(gate.status).toBe('FAILED');
    expect(gate.failureCodes).toContain('FAILED_GENERATIVE_REFERENCE_MISSING');
  });

  it('still rejects environment/architecture drift after a generative exception has enough real references', () => {
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
        architectureDriftDetected: true,
        sceneInventionDetected: true,
      },
      nowIso: '2026-08-17T22:00:00-03:00',
    });

    expect(gate.status).toBe('FAILED');
    expect(gate.failureCodes).toContain('FAILED_ARCHITECTURE_DRIFT');
    expect(gate.failureCodes).toContain('FAILED_SCENE_INVENTION_DETECTED');
  });

  it('passes a controlled generative exception only with enough verified references and no drift', () => {
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
      nowIso: '2026-08-17T22:00:00-03:00',
    });

    expect(gate.status).toBe('PASSED');
    expect(gate.failureCodes).toEqual([]);
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
    referenceSetId: 'TOCA_VENUE_REFERENCE_SET_V1',
    minReferenceCount: 3,
    allowArchitecturalInvention: false,
    allowEnvironmentDrift: false,
    allowAiLogoGeneration: false,
    status: 'APPROVED',
    createdAt: '2026-08-17T21:00:00-03:00',
  };
}

function reference(referenceId: string, assetId: string): VenueReference {
  return {
    referenceSetId: 'TOCA_VENUE_REFERENCE_SET_V1',
    referenceId,
    assetId,
    driveFileId: `drive-${assetId}`,
    referenceClass: 'VENUE_REFERENCE',
    purpose: 'spatial truth',
    requiredForGenerativeException: true,
    venueVerified: true,
    protectedElements: ['DECK', 'HORIZONTE'],
    status: 'ACTIVE',
  };
}
