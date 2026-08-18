import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { BrandAsset, CreativeStandard, VenueAsset } from '../src/contracts/creative-truth.js';
import { LocalCreativeComposer } from '../src/providers/local/local-creative-composer.js';

const masterBytes = Uint8Array.from([1, 2, 3, 4]);
const masterSha256 = createHash('sha256').update(masterBytes).digest('hex');

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
  integrityMode: 'DRIVE_FILE_ID_PINNED',
  status: 'ACTIVE_APPROVED',
  aiReconstructionAllowed: false,
};

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
        enhancementProvenance: {
          policyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
          creativeMode: 'REAL_PLUS_ENHANCEMENT',
          editorProvider: 'OPENAI_IMAGE_EDIT',
          sourceAssetId: 'MM-SUN-1-V1',
          sourceDriveFileId: 'master-drive',
          sourceSha256: masterSha256,
          outputSha256: masterSha256,
          sourceImageBound: true,
          creativeTruthBound: true,
          requiresVenueFidelityGate: true,
        },
        canvas: '1080x1350',
        requiredBrands: ['TOCA_DO_MORCEGO'],
        brandAssets: [
          {
            registry: toca,
            bytes: Uint8Array.from([9, 9, 9]),
            contentType: 'image/png',
            driveFileId: toca.driveFileId,
          },
        ],
      }),
    ).rejects.toThrow('FAILED_ENHANCEMENT_PROVENANCE');
    expect(runner).not.toHaveBeenCalled();
  });
});
