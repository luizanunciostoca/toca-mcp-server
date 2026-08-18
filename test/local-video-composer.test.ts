import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type { BrandAsset, CreativeStandard, VideoShot } from '../src/contracts/creative-truth.js';
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

const videoBytes = Uint8Array.from([1, 2, 3, 4]);
const videoSha256 = createHash('sha256').update(videoBytes).digest('hex');

const shotRegistry: VideoShot = {
  shotId: 'SHOT-1',
  sourceAssetId: 'SUN-0244',
  sourceDriveFileId: 'source-drive',
  masterAssetId: 'MM-SUN-0244-V1',
  masterDriveFileId: 'master-drive',
  sourceSha256: 'a'.repeat(64),
  masterSha256: videoSha256,
  operation: 'SUNSET',
  locationSignature: 'ambiente_toca',
  shotClass: 'experience',
  durationMs: 6000,
  orientation: '9:16',
  venueVerified: true,
  marketingReady: true,
  rightsStatus: 'OWNED',
  status: 'ACTIVE_APPROVED',
  notes: '',
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

function brandInput() {
  return {
    registry: toca,
    bytes: Uint8Array.from([10, 11, 12]),
    contentType: 'image/png' as const,
    driveFileId: toca.driveFileId,
  };
}

describe('LocalVideoComposer', () => {
  it('builds a deterministic video only from registered verified shots and official logos', async () => {
    const runner = vi.fn(async (_command: string, args: readonly string[]) => {
      const outputPath = args.at(-1);
      if (!outputPath) throw new Error('missing output path');
      await writeFile(
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
          shotId: shotRegistry.shotId,
          registry: shotRegistry,
          videoBytes,
          contentType: 'video/mp4',
        },
      ],
      requiredBrands: ['TOCA_DO_MORCEGO'],
      brandAssets: [brandInput()],
      createdAt: '2026-08-17T22:00:00-03:00',
    });

    expect(result.readyForReview).toBe(true);
    expect(result.editManifest).toEqual({
      schemaVersion: 1,
      creativeId: 'CREATIVE-VIDEO-1',
      standardId: 'TOCA_VIDEO_V1',
      creativeMode: 'REAL_COMPOSITE',
      outputDimensions: '1080x1920',
      shots: [
        {
          order: 1,
          shotId: 'SHOT-1',
          sourceAssetId: 'SUN-0244',
          masterAssetId: 'MM-SUN-0244-V1',
          masterSha256: videoSha256,
          expectedDurationMs: 6000,
          registryBound: true,
        },
      ],
      referenceAssetIds: [],
      exactMasterByteBinding: true,
    });
    expect(result.manifest.sourceAssetIds).toEqual(['SUN-0244']);
    expect(result.manifest.masterAssetIds).toEqual(['MM-SUN-0244-V1']);
    expect(result.manifest.brandAssetIds).toEqual(['BRAND-TOCA-WHITE-V1']);
    expect(result.manifest.gates.every((gate) => gate.status === 'PASSED')).toBe(true);
    const commandArgs = runner.mock.calls[0]?.[1] ?? [];
    expect(commandArgs.join(' ')).toContain('logo-0');
  });

  it('fails closed on REAL_PLUS_ENHANCEMENT until video has shot-level enhancement provenance', async () => {
    const runner = vi.fn();
    const composer = new LocalVideoComposer(runner);

    await expect(
      composer.compose({
        contentItemId: 'CONTENT-VIDEO-ENHANCED',
        creativeId: 'CREATIVE-VIDEO-ENHANCED',
        standard,
        creativeMode: 'REAL_PLUS_ENHANCEMENT',
        shots: [
          {
            shotId: shotRegistry.shotId,
            registry: shotRegistry,
            videoBytes,
            contentType: 'video/mp4',
          },
        ],
        requiredBrands: ['TOCA_DO_MORCEGO'],
        brandAssets: [brandInput()],
      }),
    ).rejects.toThrow('VIDEO_ENHANCEMENT_PROVENANCE_UNSUPPORTED');
    expect(runner).not.toHaveBeenCalled();
  });

  it('rejects real video bytes that are not bound to a VIDEO_SHOTS record', async () => {
    const runner = vi.fn();
    const composer = new LocalVideoComposer(runner);

    await expect(
      composer.compose({
        contentItemId: 'CONTENT-VIDEO-NO-REGISTRY',
        creativeId: 'CREATIVE-VIDEO-NO-REGISTRY',
        standard,
        creativeMode: 'REAL_COMPOSITE',
        shots: [
          {
            shotId: 'SHOT-NOT-REGISTERED',
            videoBytes,
            contentType: 'video/mp4',
          },
        ],
        requiredBrands: ['TOCA_DO_MORCEGO'],
        brandAssets: [brandInput()],
      }),
    ).rejects.toThrow('VIDEO_SHOT_REGISTRY_BINDING_REQUIRED');
    expect(runner).not.toHaveBeenCalled();
  });

  it('rejects a registered shot that is not venue verified before ffmpeg runs', async () => {
    const runner = vi.fn();
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
            registry: { ...shotRegistry, shotId: 'SHOT-2', venueVerified: false },
            videoBytes,
            contentType: 'video/mp4',
          },
        ],
        requiredBrands: ['TOCA_DO_MORCEGO'],
        brandAssets: [brandInput()],
      }),
    ).rejects.toThrow('FAILED_NO_VENUE_VERIFIED_ASSET');
    expect(runner).not.toHaveBeenCalled();
  });

  it('rejects a registered shot whose bytes do not match the approved master hash', async () => {
    const runner = vi.fn();
    const composer = new LocalVideoComposer(runner);

    await expect(
      composer.compose({
        contentItemId: 'CONTENT-VIDEO-HASH',
        creativeId: 'CREATIVE-VIDEO-HASH',
        standard,
        creativeMode: 'REAL_COMPOSITE',
        shots: [
          {
            shotId: shotRegistry.shotId,
            registry: shotRegistry,
            videoBytes: Uint8Array.from([9, 8, 7]),
            contentType: 'video/mp4',
          },
        ],
        requiredBrands: ['TOCA_DO_MORCEGO'],
        brandAssets: [brandInput()],
      }),
    ).rejects.toThrow('VIDEO_SHOT_MASTER_HASH_MISMATCH');
    expect(runner).not.toHaveBeenCalled();
  });

  it('rejects a registered shot whose rights are not cleared', async () => {
    const runner = vi.fn();
    const composer = new LocalVideoComposer(runner);

    await expect(
      composer.compose({
        contentItemId: 'CONTENT-VIDEO-RIGHTS',
        creativeId: 'CREATIVE-VIDEO-RIGHTS',
        standard,
        creativeMode: 'REAL_COMPOSITE',
        shots: [
          {
            shotId: shotRegistry.shotId,
            registry: { ...shotRegistry, rightsStatus: 'PENDING' },
            videoBytes,
            contentType: 'video/mp4',
          },
        ],
        requiredBrands: ['TOCA_DO_MORCEGO'],
        brandAssets: [brandInput()],
      }),
    ).rejects.toThrow('VIDEO_SHOT_RIGHTS_NOT_CLEARED');
    expect(runner).not.toHaveBeenCalled();
  });
});
