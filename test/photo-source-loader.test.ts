import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { SecretReference, SecretResolver } from '../src/core/secrets.js';
import { GoogleDrivePhotoSourceLoader } from '../src/providers/google-drive/photo-source-loader.js';

class FixedSecretResolver implements SecretResolver {
  resolve(_reference: SecretReference): Promise<string> {
    return Promise.resolve('drive-token');
  }
}

function jpegBytes(): Uint8Array<ArrayBuffer> {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0xff, 0xd9]);
}

describe('GoogleDrivePhotoSourceLoader', () => {
  it('downloads exact source bytes and calculates SHA-256 after validating Drive metadata', async () => {
    const bytes = jpegBytes();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'drive-file-1',
            mimeType: 'image/jpeg',
            capabilities: { canDownload: true },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(bytes, { status: 200, headers: { 'content-type': 'image/jpeg' } }),
      );
    const loader = new GoogleDrivePhotoSourceLoader({
      secretResolver: new FixedSecretResolver(),
      accessTokenReference: { provider: 'test', key: 'drive' },
      fetchImpl,
    });

    const result = await loader.load({ driveFileId: 'drive-file-1' });

    expect(result).toEqual({
      bytes,
      contentType: 'image/jpeg',
      driveFileId: 'drive-file-1',
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('fails closed when Drive metadata does not permit download', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'drive-file-1',
          mimeType: 'image/jpeg',
          capabilities: { canDownload: false },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const loader = new GoogleDrivePhotoSourceLoader({
      secretResolver: new FixedSecretResolver(),
      accessTokenReference: { provider: 'test', key: 'drive' },
      fetchImpl,
    });

    await expect(loader.load({ driveFileId: 'drive-file-1' })).rejects.toThrow(
      'PHOTO_SOURCE_DRIVE_METADATA_REJECTED',
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fails closed when downloaded bytes do not match the declared image type', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'drive-file-1',
            mimeType: 'image/jpeg',
            capabilities: { canDownload: true },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 }));
    const loader = new GoogleDrivePhotoSourceLoader({
      secretResolver: new FixedSecretResolver(),
      accessTokenReference: { provider: 'test', key: 'drive' },
      fetchImpl,
    });

    await expect(loader.load({ driveFileId: 'drive-file-1' })).rejects.toThrow(
      'PHOTO_SOURCE_DRIVE_BYTES_INVALID',
    );
  });
});
