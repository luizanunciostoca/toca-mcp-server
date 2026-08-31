import { writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type { ArtistAsset } from '../src/contracts/artist-integrity.js';
import { sha256Artist } from '../src/creative/artist-integrity.js';
import { LocalMultiLayerCreativeComposer } from '../src/providers/local/local-multilayer-creative-composer.js';

const artistBytes = Uint8Array.from([1, 2, 3, 4]);
const venueBytes = Uint8Array.from([5, 6, 7, 8]);
const maskBytes = Uint8Array.from([9, 10, 11]);
const artistSourceSha256 = sha256Artist(artistBytes);

const registry: ArtistAsset = {
  artistAssetId: 'ARTIST-ILLUSIONIZE-001',
  artist: 'ILLUSIONIZE',
  sourceAssetId: 'PRESSKIT-001',
  sourceDriveFileId: 'drive-artist',
  sourceSha256: artistSourceSha256,
  usageScope: ['THE_PARTY'],
  aiModificationAllowed: false,
  physicalModificationAllowed: false,
  conventionalTreatmentAllowed: true,
  cropAllowed: true,
  compositionAllowed: true,
  protectedElements: ['FACE', 'HAIR', 'BODY', 'CLOTHING'],
  status: 'ACTIVE_APPROVED',
};

describe('LocalMultiLayerCreativeComposer', () => {
  it('renders with a protected artist mask and no generative provider', async () => {
    const runner = vi.fn(async (_command: string, args: readonly string[]) => {
      const output = args.at(-1);
      if (!output) throw new Error('missing output');
      await writeFile(
        output,
        Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
    });
    const composer = new LocalMultiLayerCreativeComposer('convert', runner);
    const result = await composer.compose({
      artist: {
        assetId: 'PRESSKIT-001',
        driveFileId: 'drive-artist',
        bytes: artistBytes,
        contentType: 'image/jpeg',
        registry,
      },
      venue: {
        assetId: 'VENUE-001',
        driveFileId: 'drive-venue',
        bytes: venueBytes,
        contentType: 'image/jpeg',
      },
      artistProtectionMaskBytes: maskBytes,
      maskContentType: 'image/png',
      maskForArtistSourceSha256: artistSourceSha256,
      canvas: '1080x1350',
      venueOpacityPercent: 55,
      orangeTint: '#d96b16',
      fadeDirection: 'RIGHT_TO_LEFT',
    });

    expect(result.nonGenerative).toBe(true);
    expect(result.creativeMode).toBe('REAL_COMPOSITE');
    expect(result.artistIntegrity.status).toBe('PASSED');
    expect(result.artistSourceSha256).toBe(registry.sourceSha256);
    expect(result.maskForArtistSourceSha256).toBe(registry.sourceSha256);

    const command = runner.mock.calls[0]?.[1]?.join(' ') ?? '';
    expect(command).toContain('softlight');
    expect(command).toContain('multiply');
    expect(command).toContain('55%');
  });

  it('fails closed when artist source hash does not match registry', async () => {
    const composer = new LocalMultiLayerCreativeComposer('convert', vi.fn());
    await expect(
      composer.compose({
        artist: {
          assetId: 'PRESSKIT-001',
          driveFileId: 'drive-artist',
          bytes: Uint8Array.from([99]),
          contentType: 'image/jpeg',
          registry,
        },
        venue: {
          assetId: 'VENUE-001',
          driveFileId: 'drive-venue',
          bytes: venueBytes,
          contentType: 'image/jpeg',
        },
        artistProtectionMaskBytes: maskBytes,
        maskContentType: 'image/png',
        maskForArtistSourceSha256: sha256Artist(Uint8Array.from([99])),
        canvas: '1080x1350',
      }),
    ).rejects.toThrow('FAILED_ARTIST_SOURCE_MISMATCH');
  });

  it('fails closed when mask lineage targets a different artist source', async () => {
    const composer = new LocalMultiLayerCreativeComposer('convert', vi.fn());
    await expect(
      composer.compose({
        artist: {
          assetId: 'PRESSKIT-001',
          driveFileId: 'drive-artist',
          bytes: artistBytes,
          contentType: 'image/jpeg',
          registry,
        },
        venue: {
          assetId: 'VENUE-001',
          driveFileId: 'drive-venue',
          bytes: venueBytes,
          contentType: 'image/jpeg',
        },
        artistProtectionMaskBytes: maskBytes,
        maskContentType: 'image/png',
        maskForArtistSourceSha256: 'f'.repeat(64),
        canvas: '1080x1350',
      }),
    ).rejects.toThrow('FAILED_ARTIST_MASK_INTRUSION');
  });
});
