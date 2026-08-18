import { describe, expect, it, vi } from 'vitest';
import type { VenueReference } from '../src/contracts/creative-truth.js';
import type { SecretResolver } from '../src/core/secrets.js';
import { GoogleDriveCreativeTruthReferenceLoader } from '../src/providers/google-drive/creative-truth-reference-loader.js';

const secretResolver: SecretResolver = {
  resolve: () => Promise.resolve('drive-token'),
};

const reference: VenueReference = {
  referenceSetId: 'TOCA_VENUE_REFERENCE_SET_V1',
  referenceId: 'REF-SUN-0001',
  assetId: 'SUN-0001',
  driveFileId: 'drive-file-1',
  referenceClass: 'DECK',
  purpose: 'GENERATIVE_VENUE_TRUTH',
  requiredForGenerativeException: true,
  venueVerified: true,
  protectedElements: ['DECK', 'RAILING'],
  status: 'ACTIVE',
};

describe('GoogleDriveCreativeTruthReferenceLoader', () => {
  it('downloads only a canonical downloadable image blob and preserves reference identity', async () => {
    const imageBytes = Uint8Array.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      expect(init?.headers).toEqual({ Authorization: 'Bearer drive-token' });
      if (url.searchParams.get('alt') === 'media') {
        return new Response(imageBytes, { status: 200, headers: { 'content-type': 'image/jpeg' } });
      }
      expect(url.searchParams.get('fields')).toBe(
        'id,name,mimeType,size,capabilities(canDownload)',
      );
      return new Response(
        JSON.stringify({
          id: 'drive-file-1',
          name: 'reference.jpg',
          mimeType: 'image/jpeg',
          size: String(imageBytes.byteLength),
          capabilities: { canDownload: true },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const loader = new GoogleDriveCreativeTruthReferenceLoader({
      secretResolver,
      accessTokenReference: { provider: 'env', key: 'DRIVE_TOKEN' },
      fetchImpl,
    });
    const result = await loader.load(reference);

    expect(result.registry).toEqual(reference);
    expect(result.contentType).toBe('image/jpeg');
    expect(result.imageBytes).toEqual(imageBytes);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('fails closed when Drive metadata says the reference cannot be downloaded', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'drive-file-1',
            mimeType: 'image/jpeg',
            capabilities: { canDownload: false },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    const loader = new GoogleDriveCreativeTruthReferenceLoader({
      secretResolver,
      accessTokenReference: { provider: 'env', key: 'DRIVE_TOKEN' },
      fetchImpl,
    });

    await expect(loader.load(reference)).rejects.toThrow(
      'GENERATIVE_REFERENCE_DRIVE_METADATA_REJECTED',
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('fails closed when downloaded bytes do not match the canonical MIME signature', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get('alt') === 'media') {
        return new Response(Uint8Array.from([1, 2, 3, 4]), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          id: 'drive-file-1',
          mimeType: 'image/jpeg',
          capabilities: { canDownload: true },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const loader = new GoogleDriveCreativeTruthReferenceLoader({
      secretResolver,
      accessTokenReference: { provider: 'env', key: 'DRIVE_TOKEN' },
      fetchImpl,
    });

    await expect(loader.load(reference)).rejects.toThrow(
      'GENERATIVE_REFERENCE_DRIVE_BYTES_INVALID',
    );
  });

  it('classifies forbidden Drive access as a source fetch block instead of retrying generation', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response('forbidden', { status: 403 })),
    );
    const loader = new GoogleDriveCreativeTruthReferenceLoader({
      secretResolver,
      accessTokenReference: { provider: 'env', key: 'DRIVE_TOKEN' },
      fetchImpl,
    });

    await expect(loader.load(reference)).rejects.toMatchObject({
      code: 'SOURCE_IMAGE_FETCH_BLOCK',
      retryable: false,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
