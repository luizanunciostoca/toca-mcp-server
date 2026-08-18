import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type { BrandAsset, CreativeStandard, VenueAsset } from '../src/contracts/creative-truth.js';
import { LocalThumbnailComposer } from '../src/providers/local/local-thumbnail-composer.js';

const imageBytes = Uint8Array.from([1, 2, 3, 4]);
const imageSha256 = createHash('sha256').update(imageBytes).digest('hex');
const brandBytes = Uint8Array.from([10, 11, 12]);
const brandSha256 = createHash('sha256').update(brandBytes).digest('hex');

const standard: CreativeStandard = {
  standardId: 'TOCA_THUMBNAIL_V1',
  version: '1.0',
  brandScope: 'TOCA_DO_MORCEGO',
  operation: 'ALL',
  channel: 'ALL',
  format: 'THUMBNAIL',
  parentPolicyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
  canonicalDriveId: 'drive-thumbnail-standard',
  repoMirrorPath: 'control/creative-standards/toca-thumbnail-standard.v1.json',
  status: 'ACTIVE_CANONICAL',
  realAssetRequired: true,
  deterministicBrandInsertion: true,
  venueFidelityGateRequired: true,
};

const venue: VenueAsset = {
  venueAssetId: 'VENUE-THUMB-1',
  sourceAssetId: 'SOURCE-THUMB-1',
  sourceDriveFileId: 'drive-source-thumb',
  masterAssetId: 'MASTER-THUMB-1',
  masterDriveFileId: 'drive-master-thumb',
  masterSha256: imageSha256,
  operation: 'SUNSET',
  locationSignature: 'deck_ocean_view',
  dominantSubject: 'experience',
  venueVerified: true,
  marketingReady: true,
  generativeReferenceAllowed: true,
  protectedElements: ['DECK', 'HORIZONTE'],
  status: 'ACTIVE_APPROVED',
};

const toca: BrandAsset = {
  brandAssetId: 'BRAND-TOCA-WHITE-V1',
  brand: 'TOCA_DO_MORCEGO',
  variant: 'WHITE',
  driveFileId: 'drive-toca-logo',
  fileName: 'toca.png',
  contentType: 'image/png',
  integrityMode: 'SHA256_PINNED',
  sha256: brandSha256,
  status: 'ACTIVE_APPROVED',
  aiReconstructionAllowed: false,
};

function brandInput() {
  return {
    registry: toca,
    bytes: brandBytes,
    contentType: 'image/png' as const,
    driveFileId: toca.driveFileId,
  };
}

function runner() {
  return vi.fn(async (_command: string, args: readonly string[]) => {
    const outputPath = args.at(-1);
    if (!outputPath) throw new Error('missing output path');
    await writeFile(outputPath, Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]));
  });
}

describe('LocalThumbnailComposer', () => {
  it('renders final thumbnail bytes only through the universal Creative Truth standard', async () => {
    const commandRunner = runner();
    const composer = new LocalThumbnailComposer(commandRunner);
    const result = await composer.compose({
      thumbnailCreativeId: 'THUMB-001',
      contentItemId: 'CONTENT-001',
      standard,
      creativeMode: 'REAL_COMPOSITE',
      venueAsset: venue,
      imageBytes,
      contentType: 'image/jpeg',
      canvas: '1080x1920',
      headline: 'Celebrar a Vida.',
      requiredBrands: ['TOCA_DO_MORCEGO'],
      brandAssets: [brandInput()],
    });

    expect(result.readyForReview).toBe(true);
    expect(result.pipelineVersion).toBe('local-thumbnail-composer-v1');
    expect(result.manifest.standardId).toBe('TOCA_THUMBNAIL_V1');
    expect(result.manifest.sourceAssetIds).toEqual(['SOURCE-THUMB-1']);
    expect(result.manifest.masterAssetIds).toEqual(['MASTER-THUMB-1']);
    expect(result.manifest.brandAssetIds).toEqual(['BRAND-TOCA-WHITE-V1']);
    expect(result.manifest.gates.every((gate) => gate.status === 'PASSED')).toBe(true);
    expect(commandRunner).toHaveBeenCalledTimes(1);
  });

  it('fails closed when another creative standard is supplied', async () => {
    const commandRunner = vi.fn();
    const composer = new LocalThumbnailComposer(commandRunner);
    await expect(
      composer.compose({
        thumbnailCreativeId: 'THUMB-WRONG',
        contentItemId: 'CONTENT-WRONG',
        standard: { ...standard, standardId: 'SUNSET_FEED_V1', format: 'SINGLE_IMAGE' },
        creativeMode: 'REAL_COMPOSITE',
        venueAsset: venue,
        imageBytes,
        contentType: 'image/jpeg',
        canvas: '1080x1920',
        requiredBrands: ['TOCA_DO_MORCEGO'],
        brandAssets: [brandInput()],
      }),
    ).rejects.toThrow('TOCA_THUMBNAIL_STANDARD_REQUIRED');
    expect(commandRunner).not.toHaveBeenCalled();
  });
});
