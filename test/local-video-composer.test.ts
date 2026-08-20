import { createHash } from 'node:crypto';
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

const overlayBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const overlaySha256 = createHash('sha256').update(overlayBytes).digest('hex');

describe('LocalVideoComposer', () => {
  it('builds a deterministic video from verified shots, official logos and hash-bound overlays', async () => {
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
      brandPosition: 'TOP_CENTER',
      overlays: [
        {
          overlayId: 'headline-1',
          role: 'HEADLINE',
          bytes: overlayBytes,
          sha256: overlaySha256,
          contentType: 'image/png',
          startMs: 100,
          endMs: 500,
          x: 120,
          y: 300,
          width: 840,
          height: 220,
        },
      ],
      createdAt: '2026-08-17T22:00:00-03:00',
    });

    expect(result.readyForReview).toBe(true);
    expect(result.manifest.sourceAssetIds).toEqual(['SUN-0244']);
    expect(result.manifest.brandAssetIds).toEqual(['BRAND-TOCA-WHITE-V1']);
    expect(result.manifest.gates.every((gate) => gate.status === 'PASSED')).toBe(true);
    expect(result.brandPosition).toBe('TOP_CENTER');
    expect(result.overlayBindings).toEqual([
      {
        overlayId: 'headline-1',
        role: 'HEADLINE',
        sha256: overlaySha256,
        startMs: 100,
        endMs: 500,
      },
    ]);
    const commandArgs = runner.mock.calls[0]?.[1] ?? [];
    const command = commandArgs.join(' ');
    expect(command).toContain('logo-0');
    expect(command).toContain('overlay-0');
    expect(command).toContain("enable='between(t,0.100,0.500)'");
    expect(command).toContain('overlay=');
    expect(command).toContain(':90:format=auto');
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

  it('rejects changed overlay bytes before ffmpeg runs', async () => {
    const runner = vi.fn(() => Promise.resolve());
    const composer = new LocalVideoComposer(runner);

    await expect(
      composer.compose({
        contentItemId: 'CONTENT-VIDEO-3',
        creativeId: 'CREATIVE-VIDEO-3',
        standard,
        creativeMode: 'REAL_COMPOSITE',
        shots: [
          {
            shotId: 'SHOT-3',
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
        overlays: [
          {
            overlayId: 'subtitle-1',
            role: 'SUBTITLE',
            bytes: Uint8Array.from([9, 9, 9]),
            sha256: overlaySha256,
            contentType: 'image/png',
            startMs: 0,
            endMs: 1_000,
            x: 120,
            y: 1500,
            width: 840,
            height: 160,
          },
        ],
      }),
    ).rejects.toThrow('VIDEO_OVERLAY_HASH_BINDING_INVALID');
    expect(runner).not.toHaveBeenCalled();
  });

  it('rejects overlays outside the 1080x1920 safe frame', async () => {
    const runner = vi.fn(() => Promise.resolve());
    const composer = new LocalVideoComposer(runner);

    await expect(
      composer.compose({
        contentItemId: 'CONTENT-VIDEO-4',
        creativeId: 'CREATIVE-VIDEO-4',
        standard,
        creativeMode: 'REAL_COMPOSITE',
        shots: [
          {
            shotId: 'SHOT-4',
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
        overlays: [
          {
            overlayId: 'cta-1',
            role: 'CTA',
            bytes: overlayBytes,
            sha256: overlaySha256,
            contentType: 'image/png',
            startMs: 0,
            endMs: 1_000,
            x: 1000,
            y: 1800,
            width: 200,
            height: 200,
          },
        ],
      }),
    ).rejects.toThrow('VIDEO_OVERLAY_SAFE_AREA_INVALID');
    expect(runner).not.toHaveBeenCalled();
  });
});
