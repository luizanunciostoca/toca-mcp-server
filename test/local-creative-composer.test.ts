import { writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type { BrandAsset, CreativeStandard, VenueAsset } from '../src/contracts/creative-truth.js';
import { LocalCreativeComposer } from '../src/providers/local/local-creative-composer.js';

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
  venueAssetId: 'VENUE-SUN-0244',
  sourceAssetId: 'SUN-0244',
  sourceDriveFileId: 'source-drive',
  masterAssetId: 'MM-SUN-0244-V1',
  masterDriveFileId: 'master-drive',
  sourceSha256: 'a'.repeat(64),
  masterSha256: 'b'.repeat(64),
  operation: 'SUNSET',
  locationSignature: 'ambiente_toca',
  dominantSubject: 'lifestyle',
  venueVerified: true,
  marketingReady: true,
  generativeReferenceAllowed: true,
  protectedElements: ['DECK', 'HORIZONTE'],
  status: 'ACTIVE_APPROVED',
};

function brand(brandAssetId: string, name: string, driveFileId: string): BrandAsset {
  return {
    brandAssetId,
    brand: name,
    variant: 'WHITE',
    driveFileId,
    fileName: `${name}.png`,
    contentType: 'image/png',
    integrityMode: 'DRIVE_FILE_ID_PINNED',
    status: 'ACTIVE_APPROVED',
    aiReconstructionAllowed: false,
  };
}

describe('LocalCreativeComposer', () => {
  it('uses real venue lineage and official logo files in the deterministic render', async () => {
    const runner = vi.fn(async (_command: string, args: readonly string[]) => {
      const outputPath = args.at(-1);
      if (!outputPath) throw new Error('missing output path');
      await writeFile(outputPath, Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]));
    });
    const composer = new LocalCreativeComposer(runner);
    const toca = brand('BRAND-TOCA-WHITE-V1', 'TOCA_DO_MORCEGO', 'drive-toca');
    const morro = brand('BRAND-MORRO-WHITE-V1', 'MORRO_DIGITAL', 'drive-morro');

    const result = await composer.compose({
      contentItemId: 'CONTENT-001',
      creativeId: 'CREATIVE-001',
      standard,
      creativeMode: 'REAL_COMPOSITE',
      venueAsset: venue,
      sourceImageBytes: Uint8Array.from([1, 2, 3, 4]),
      sourceContentType: 'image/jpeg',
      canvas: '1080x1350',
      headline: 'Pôr do sol na Toca',
      supportCopy: 'Viva o fim de tarde mais desejado da ilha.',
      cta: 'Garanta seu ingresso',
      functionalInfo: '16:30H ÀS 22H',
      requiredBrands: ['TOCA_DO_MORCEGO', 'MORRO_DIGITAL'],
      brandAssets: [
        {
          registry: toca,
          bytes: Uint8Array.from([10, 11, 12]),
          contentType: 'image/png',
          driveFileId: toca.driveFileId,
        },
        {
          registry: morro,
          bytes: Uint8Array.from([20, 21, 22]),
          contentType: 'image/png',
          driveFileId: morro.driveFileId,
        },
      ],
      createdAt: '2026-08-17T22:00:00-03:00',
    });

    expect(result.readyForReview).toBe(true);
    expect(result.manifest.sourceAssetIds).toEqual(['SUN-0244']);
    expect(result.manifest.masterAssetIds).toEqual(['MM-SUN-0244-V1']);
    expect(result.manifest.brandAssetIds).toEqual(['BRAND-TOCA-WHITE-V1', 'BRAND-MORRO-WHITE-V1']);
    expect(result.manifest.gates.map((gate) => gate.status)).toEqual([
      'PASSED',
      'PASSED',
      'PASSED',
    ]);
    const commandArgs = runner.mock.calls[0]?.[1] ?? [];
    expect(commandArgs.some((arg) => arg.includes('brand-0'))).toBe(true);
    expect(commandArgs.some((arg) => arg.includes('brand-1'))).toBe(true);
    expect(commandArgs.join(' ')).not.toContain('MORRO DIGITAL LOGO');
  });

  it('fails before rendering when a logo is AI-generated', async () => {
    const runner = vi.fn();
    const composer = new LocalCreativeComposer(runner);
    const morro = brand('BRAND-MORRO-WHITE-V1', 'MORRO_DIGITAL', 'drive-morro');

    await expect(
      composer.compose({
        contentItemId: 'CONTENT-002',
        creativeId: 'CREATIVE-002',
        standard,
        creativeMode: 'REAL_COMPOSITE',
        venueAsset: venue,
        sourceImageBytes: Uint8Array.from([1, 2, 3]),
        sourceContentType: 'image/jpeg',
        canvas: '1080x1350',
        headline: 'Sunset',
        requiredBrands: ['MORRO_DIGITAL'],
        brandAssets: [
          {
            registry: morro,
            bytes: Uint8Array.from([20, 21, 22]),
            contentType: 'image/png',
            driveFileId: morro.driveFileId,
            aiGenerated: true,
          },
        ],
      }),
    ).rejects.toThrow('FAILED_AI_LOGO_RECONSTRUCTION');
    expect(runner).not.toHaveBeenCalled();
  });
});
