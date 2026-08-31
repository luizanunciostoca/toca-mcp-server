import { describe, expect, it, vi } from 'vitest';
import type { ArtistAsset } from '../src/contracts/artist-integrity.js';
import { ArtistSegmentationService } from '../src/creative/artist-segmentation.js';
import { sha256Artist } from '../src/creative/artist-integrity.js';
import { LocalRembgSegmentationProvider } from '../src/providers/segmentation/local-rembg-segmentation-provider.js';

const bytes = Uint8Array.from([1, 2, 3, 4]);

function assetFor(sourceBytes: Uint8Array): ArtistAsset {
  return {
    artistAssetId: 'ARTIST-SEGMENT-001',
    artist: 'ILLUSIONIZE',
    sourceAssetId: 'PRESSKIT-001',
    sourceDriveFileId: 'drive-artist',
    sourceSha256: sha256Artist(sourceBytes),
    usageScope: ['THE_PARTY'],
    aiModificationAllowed: false,
    physicalModificationAllowed: false,
    conventionalTreatmentAllowed: true,
    cropAllowed: true,
    compositionAllowed: true,
    protectedElements: ['FACE', 'HAIR', 'SKIN', 'BODY', 'HANDS', 'CLOTHING'],
    status: 'ACTIVE_APPROVED',
  };
}

describe('artist segmentation integrity', () => {
  it('fails before segmentation when source hash does not match approved artist asset', async () => {
    const provider = { segment: vi.fn() };
    const service = new ArtistSegmentationService(provider);
    const wrongAsset = assetFor(Uint8Array.from([9, 9, 9]));

    await expect(
      service.segment({
        artistAsset: wrongAsset,
        sourceBytes: bytes,
        sourceContentType: 'image/jpeg',
      }),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect(provider.segment).not.toHaveBeenCalled();
  });

  it('invokes local rembg with a human-segmentation model and alpha matting', async () => {
    const runner = vi.fn(() => {
      const error = Object.assign(new Error('missing'), { code: 'ENOENT' });
      return Promise.reject(error);
    });
    const provider = new LocalRembgSegmentationProvider('rembg-test', 'u2net_human_seg', runner);

    await expect(
      provider.segment({ sourceBytes: bytes, contentType: 'image/jpeg' }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });

    expect(runner).toHaveBeenCalledTimes(1);
    const args = runner.mock.calls[0]?.[1] ?? [];
    expect(args.slice(0, 4)).toEqual(['i', '-m', 'u2net_human_seg', '-a']);
  });
});
