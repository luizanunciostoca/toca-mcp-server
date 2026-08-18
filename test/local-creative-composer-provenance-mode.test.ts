import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { BrandAsset, CreativeStandard, VenueAsset } from '../src/contracts/creative-truth.js';
import { LocalCreativeComposer } from '../src/providers/local/local-creative-composer.js';

const masterBytes = Uint8Array.from([1, 2, 3, 4]);
const masterSha256 = createHash('sha256').update(masterBytes).digest('hex');
const brandBytes = Uint8Array.from([9, 9, 9]);
const brandSha256 = createHash('sha256').update(brandBytes).digest('hex');

const standard: CreativeStandard = {
  standardId: 'SUNSET_FEED_V1',
  version: '1.0',
  brandScope: 'TOCA_DO_MORCEGO',
  operation: 'SUNSET',
  channel: 'INSTAGRAM',
  format: 'SINGLE_IMAGE',
  parentPolicyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
  canonicalDriveId: 'drive-standard',
  repoMirrorPath: 'control/creative-standards/sunset-feed-standard.v1.json',
  status: 'ACTIVE_CANONICAL',
  realAssetRequired: true,
  deterministicBrandInsertion: true,
  venueFidelityGateRequired: true,
};

const venue: VenueAsset = {
  venueAssetId: 'VENUE-SUN-1',
  sourceAssetId: 'SUN-1',
  sourceDriveFileId: 'source-drive',
  masterAssetId: 'MM-SUN-1-V1',
  masterDriveFileId: 'master-drive',
  masterSha256,
  operation: 'SUNSET',
  locationSignature: 'deck',
  dominantSubject: 'experience',
  venueVerified: true,
  marketingReady: true,
  generativeReferenceAllowed: true,
  protectedElements: ['DECK'],
  status: 'ACTIVE_APPROVED',
};

const toca: BrandAsset = {
  brandAssetId: 'BRAND-TOCA-WHITE-V1',
  brand: 'TOCA_DO_MORCEGO',
  variant: 'WHITE',
  driveFileId: 'drive-logo',
  fileName: 'toca.png',
  contentType: 'image/png',
  integrityMode: 'SHA256_PINNED',
  sha256: brandSha256,
  status: 'ACTIVE_APPROVED',
  aiReconstructionAllowed: false,
};

const enhancementProvenance = {
  policyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1' as const,
  creativeMode: 'REAL_PLUS_ENHANCEMENT' as const,
  editorProvider: 'OPENAI_IMAGE_EDIT',
  sourceAssetId: 'MM-SUN-1-V1',
  sourceDriveFileId: 'master-drive',
  sourceSha256: masterSha256,
  outputSha256: masterSha256,
  sourceImageBound: true as const,
  creativeTruthBound: true as const,
  requiresVenueFidelityGate: true as const,
};

function brandInput() {
  return {
    registry: toca,
    bytes: brandBytes,
    contentType: 'image/png' as const,
    driveFileId: toca.driveFileId,
  };
}

describe('LocalCreativeComposer enhancement mode isolation', () => {
  it('fails closed if enhancement provenance is attached to REAL_COMPOSITE', async () => {
    const runner = vi.fn();
    const composer = new LocalCreativeComposer(runner);

    await expect(
      composer.compose({
        contentItemId: 'CONTENT-REAL',
        creativeId: 'CREATIVE-REAL',
        standard,
        creativeMode: 'REAL_COMPOSITE',
        venueAsset: venue,
        sourceImageBytes: masterBytes,
        sourceContentType: 'image/jpeg',
        enhancementProvenance,
        canvas: '1080x1350',
        requiredBrands: ['TOCA_DO_MORCEGO'],
        brandAssets: [brandInput()],
      }),
    ).rejects.toThrow('FAILED_ENHANCEMENT_PROVENANCE');
    expect(runner).not.toHaveBeenCalled();
  });

  it('fails closed if enhancement provenance is attached to GENERATIVE_EXCEPTION', async () => {
    const runner = vi.fn();
    const composer = new LocalCreativeComposer(runner);

    await expect(
      composer.compose({
        contentItemId: 'CONTENT-GENERATIVE',
        creativeId: 'CREATIVE-GENERATIVE',
        standard,
        creativeMode: 'GENERATIVE_EXCEPTION',
        sourceImageBytes: masterBytes,
        sourceContentType: 'image/jpeg',
        enhancementProvenance,
        canvas: '1080x1350',
        requiredBrands: ['TOCA_DO_MORCEGO'],
        brandAssets: [brandInput()],
        generativeException: {
          exceptionId: 'EX-1',
          contentItemId: 'CONTENT-GENERATIVE',
          requestedBy: 'user',
          approvedBy: 'approver',
          approvalRef: 'APR-1',
          reason: 'controlled test',
          referenceSetId: 'TOCA_VENUE_REFERENCE_SET_V1',
          minReferenceCount: 3,
          allowArchitecturalInvention: false,
          allowEnvironmentDrift: false,
          allowAiLogoGeneration: false,
          status: 'APPROVED',
          createdAt: '2026-08-18T00:00:00-03:00',
        },
        references: [
          {
            referenceSetId: 'TOCA_VENUE_REFERENCE_SET_V1',
            referenceId: 'REF-1',
            assetId: 'SUN-REF-1',
            driveFileId: 'drive-ref-1',
            referenceClass: 'DECK',
            purpose: 'VENUE_FIDELITY',
            requiredForGenerativeException: true,
            venueVerified: true,
            protectedElements: ['DECK'],
            status: 'ACTIVE',
          },
          {
            referenceSetId: 'TOCA_VENUE_REFERENCE_SET_V1',
            referenceId: 'REF-2',
            assetId: 'SUN-REF-2',
            driveFileId: 'drive-ref-2',
            referenceClass: 'DECK',
            purpose: 'VENUE_FIDELITY',
            requiredForGenerativeException: true,
            venueVerified: true,
            protectedElements: ['DECK'],
            status: 'ACTIVE',
          },
          {
            referenceSetId: 'TOCA_VENUE_REFERENCE_SET_V1',
            referenceId: 'REF-3',
            assetId: 'SUN-REF-3',
            driveFileId: 'drive-ref-3',
            referenceClass: 'DECK',
            purpose: 'VENUE_FIDELITY',
            requiredForGenerativeException: true,
            venueVerified: true,
            protectedElements: ['DECK'],
            status: 'ACTIVE',
          },
        ],
        fidelityEvidence: {
          verifier: 'TEST',
          verificationMethod: 'MULTIMODAL_PLUS_HUMAN',
          candidateSha256: masterSha256,
          sourceIdentityPreserved: true,
          architectureDriftDetected: false,
          sceneInventionDetected: false,
          logoReconstructionDetected: false,
          referenceSetId: 'TOCA_VENUE_REFERENCE_SET_V1',
          referenceAssetIds: ['SUN-REF-1', 'SUN-REF-2', 'SUN-REF-3'],
          reviewRef: 'review:content-generative',
          notes: [],
        },
      }),
    ).rejects.toThrow('FAILED_ENHANCEMENT_PROVENANCE');
    expect(runner).not.toHaveBeenCalled();
  });
});
