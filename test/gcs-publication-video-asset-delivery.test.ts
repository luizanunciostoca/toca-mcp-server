import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GcsPublicationAssetDelivery } from '../src/providers/gcp/gcs-publication-asset-delivery.js';

function requestUrl(input: RequestInfo | URL): string {
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  return input;
}

function runtimeFetch(bytes: Uint8Array, servedContentType = 'video/mp4'): typeof fetch {
  return (input, init) => {
    const url = requestUrl(input);
    if (url.endsWith('/token')) {
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: 'runtime-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    if (url.endsWith('/email')) {
      return Promise.resolve(
        new Response('runtime@toca-mcp-production.iam.gserviceaccount.com', { status: 200 }),
      );
    }
    if (url.includes(':signBlob')) {
      return Promise.resolve(
        new Response(JSON.stringify({ signedBlob: Buffer.from('signature').toString('base64') }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    if (url.startsWith('https://storage.googleapis.com/')) {
      const range = new Headers(init?.headers).get('Range');
      return Promise.resolve(
        new Response(range ? bytes.slice(0, 1) : bytes, {
          status: range ? 206 : 200,
          headers: { 'content-type': servedContentType },
        }),
      );
    }
    return Promise.reject(new Error(`unexpected fetch:${url}`));
  };
}

describe('GCS Reel exact-asset delivery', () => {
  it('returns the signed Reel URL only when the full MP4 bytes match the approved hash', async () => {
    const bytes = Uint8Array.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 1, 2, 3, 4]);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const delivery = new GcsPublicationAssetDelivery({
      projectId: 'toca-mcp-production',
      bucketName: 'toca-publication-assets',
      fetchImpl: runtimeFetch(bytes),
    });

    await expect(
      delivery.createVerifiedDeliveryUrl(
        'instagram/reel-001/CREATIVE-REEL-001-aaaaaaaaaaaaaaaa.mp4',
        sha256,
        'video/mp4',
      ),
    ).resolves.toContain('X-Goog-Signature=');
  });

  it('rejects a Reel MIME substitution before provider publication', async () => {
    const bytes = Uint8Array.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70]);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const delivery = new GcsPublicationAssetDelivery({
      projectId: 'toca-mcp-production',
      bucketName: 'toca-publication-assets',
      fetchImpl: runtimeFetch(bytes, 'image/jpeg'),
    });

    await expect(
      delivery.createVerifiedDeliveryUrl(
        'instagram/reel-001/CREATIVE-REEL-001-aaaaaaaaaaaaaaaa.mp4',
        sha256,
        'video/mp4',
      ),
    ).rejects.toThrow('PUBLICATION_ASSET_PUBLIC_CONTENT_TYPE_MISMATCH:video/mp4:image/jpeg');
  });

  it('rejects Reel bytes that no longer match the approved final hash', async () => {
    const bytes = Uint8Array.from([9, 9, 9, 9]);
    const delivery = new GcsPublicationAssetDelivery({
      projectId: 'toca-mcp-production',
      bucketName: 'toca-publication-assets',
      fetchImpl: runtimeFetch(bytes),
    });

    await expect(
      delivery.createVerifiedDeliveryUrl(
        'instagram/reel-001/CREATIVE-REEL-001-aaaaaaaaaaaaaaaa.mp4',
        createHash('sha256').update(Uint8Array.from([1, 2, 3])).digest('hex'),
        'video/mp4',
      ),
    ).rejects.toThrow('PUBLICATION_ASSET_SHA256_MISMATCH');
  });
});
