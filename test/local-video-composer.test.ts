import { writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type { BrandAsset, CreativeStandard, VenueAsset } from '../src/contracts/creative-truth.js';
import { LocalVideoComposer } from '../src/providers/local/local-video-composer.js';

const standard: CreativeStandard = {
  standardId: 'TOCA_VIDEO_V1',
  version: '1.0',
  brandScope: 'TOCA_DO_MORCEGO',
  operation: 'ALL',
  channel: 'ALL',
  format: 'VIDEO|REEL',
  parentPolicyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
  canonicalDriveId: 'drive-video-standard',
  repoMirrorPath: 'control/creative-standards/toca-video-standard.v1.json',
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
  integrityMode: 'DRIVE_FILE_ID_PINNED',
  status: 'ACTIVE_APPROVED',
  aiReconstructionAllowed: false,
};

describe('LocalVideoComposer', () => {
  it('builds a deterministic video from verified shots and official logo files', async () => {
    const runner = vi.fn((command: string, args: readonly string[]) => {
      void command;
      const outputPath = args.at(-1);
      if (!outputPath) return Promise.reject(new Error('missing output path'));
      return writeFile(
        outputPath,
        Uint8Array.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]),
      );
    });
    const composer = new LocalVideoComposer(runner);
    const result = await composer.compose({
      contentItemId: 'CONTENT-VIDEO-1',
      creativeId: 'CREATIVE-VIDEO-1',
      standard,
      creativeMode: 'REAL_COMPOSITE',
      shots: [
        {
          shotId: 'SHOT-1',
          venueAsset: venue,
          videoBytes: Uint8Array.from([1, 2, 3, 4]),
          contentType: 'video/mp4',
        },
      ],
      requiredBrands: ['TOCA_DO_MORCEGO'],
      brandAssets: [
        {
          registry: toca,
          bytes: Uint8Array.from([10, 11, 12]),
          contentType: 'image/png',
          driveFileId: toca.driveFileId,
        },
      ],
      createdAt: '2026-08-17T22:00:00-03:00',
    });

    expect(result.readyForReview).toBe(true);
    expect(result.manifest.sourceAssetIds).toEqual(['SUN-0244']);
    expect(result.manifest.brandAssetIds).toEqual(['BRAND-TOCA-WHITE-V1']);
    expect(result.manifest.gates.every((gate) => gate.status === 'PASSED')).toBe(true);
    const commandArgs = runner.mock.calls[0]?.[1] ?? [];
    expect(commandArgs.join(' ')).toContain('logo-0');
  });

  it('rejects a video shot that is not venue verified before ffmpeg runs', async () => {
    const runner = vi.fn(() => Promise.resolve());
    const composer = new LocalVideoComposer(runner);

    await expect(
      composer.compose({
        contentItemId: 'CONTENT-VIDEO-2',
        creativeId: 'CREATIVE-VIDEO-2',
        standard,
        creativeMode: 'REAL_COMPOSITE',
        shots: [
          {
            shotId: 'SHOT-2',
            venueAsset: { ...venue, venueVerified: false },
            videoBytes: Uint8Array.from([1, 2, 3, 4]),
            contentType: 'video/mp4',
          },
        ],
        requiredBrands: ['TOCA_DO_MORCEGO'],
        brandAssets: [
          {
            registry: toca,
            bytes: Uint8Array.from([10, 11, 12]),
            contentType: 'image/png',
            driveFileId: toca.driveFileId,
          },
        ],
      }),
    ).rejects.toThrow('FAILED_NO_VENUE_VERIFIED_ASSET');
    expect(runner).not.toHaveBeenCalled();
  });
});
