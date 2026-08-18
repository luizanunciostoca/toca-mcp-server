import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { BrandAsset } from '../src/contracts/creative-truth.js';
import type { SecretResolver } from '../src/core/secrets.js';
import { GoogleDriveCreativeTruthBrandAssetLoader } from '../src/providers/google-drive/creative-truth-brand-asset-loader.js';

const secretResolver: SecretResolver = {
  resolve: () => Promise.resolve('drive-token'),
};
const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const brand: BrandAsset = {
  brandAssetId: 'BRAND-TOCA-WHITE-V1',
  brand: 'TOCA_DO_MORCEGO',
  variant: 'WHITE',
  driveFileId: 'drive-brand-1',
  fileName: 'TOCA_WHITE.png',
  contentType: 'image/png',
  integrityMode: 'SHA256_PINNED',
  sha256: createHash('sha256').update(pngBytes).digest('hex'),
  status: 'ACTIVE_APPROVED',
  aiReconstructionAllowed: false,
};

describe('GoogleDriveCreativeTruthBrandAssetLoader', () => {
  it('downloads the exact official SHA-256-pinned Drive brand asset', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      expect(init?.headers).toEqual({ Authorization: 'Bearer drive-token' });
      if (url.searchParams.get('alt') === 'media') {
        return new Response(pngBytes, { status: 200, headers: { 'content-type': 'image/png' } });
      }
      return new Response(
        JSON.stringify({
          id: brand.driveFileId,
          mimeType: brand.contentType,
          capabilities: { canDownload: true },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const loader = new GoogleDriveCreativeTruthBrandAssetLoader({
      secretResolver,
      accessTokenReference: { provider: 'env', key: 'DRIVE_TOKEN' },
      fetchImpl,
    });

    const loaded = await loader.load(brand);

    expect(loaded.registry).toEqual(brand);
    expect(loaded.bytes).toEqual(pngBytes);
    expect(loaded.driveFileId).toBe(brand.driveFileId);
    expect(loaded.aiGenerated).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('fails closed when downloaded official-brand bytes do not match the pinned SHA-256', async () => {
    const substituted = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9,
    ]);
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get('alt') === 'media') return new Response(substituted, { status: 200 });
      return new Response(
        JSON.stringify({
          id: brand.driveFileId,
          mimeType: brand.contentType,
          capabilities: { canDownload: true },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const loader = new GoogleDriveCreativeTruthBrandAssetLoader({
      secretResolver,
      accessTokenReference: { provider: 'env', key: 'DRIVE_TOKEN' },
      fetchImpl,
    });

    await expect(loader.load(brand)).rejects.toThrow('BRAND_ASSET_DRIVE_HASH_MISMATCH');
  });

  it('rejects non-canonical or non-SHA-pinned brand metadata before Drive access', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const loader = new GoogleDriveCreativeTruthBrandAssetLoader({
      secretResolver,
      accessTokenReference: { provider: 'env', key: 'DRIVE_TOKEN' },
      fetchImpl,
    });

    await expect(
      loader.load({ ...brand, integrityMode: 'DRIVE_FILE_ID_PINNED' }),
    ).rejects.toThrow('FAILED_BRAND_ASSET_MISSING');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
