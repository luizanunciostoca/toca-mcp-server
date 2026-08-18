import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GcsPublicationAssetDelivery } from '../src/providers/gcp/gcs-publication-asset-delivery.js';

function response(body: BodyInit | null, init: ResponseInit): Response {
  return new Response(body, init);
}

function requestUrl(input: RequestInfo | URL): string {
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  return input;
}

function runtimeFetch(
  fullObjectBytes: Uint8Array = Uint8Array.from([1, 2, 3, 4]),
): { readonly fetchImpl: typeof fetch; readonly calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const url = requestUrl(input);
    calls.push({ url, ...(init ? { init } : {}) });

    if (url.endsWith('/token')) {
      return Promise.resolve(
        response(JSON.stringify({ access_token: 'runtime-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    if (url.endsWith('/email')) {
      return Promise.resolve(
        response('runtime@toca-mcp-production.iam.gserviceaccount.com', { status: 200 }),
      );
    }
    if (url.includes(':signBlob')) {
      return Promise.resolve(
        response(JSON.stringify({ signedBlob: Buffer.from('signature').toString('base64') }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    if (url.startsWith('https://storage.googleapis.com/')) {
      const range = new Headers(init?.headers).get('Range');
      if (range) {
        return Promise.resolve(
          response('x', { status: 206, headers: { 'content-type': 'image/jpeg' } }),
        );
      }
      return Promise.resolve(
        response(fullObjectBytes, { status: 200, headers: { 'content-type': 'image/jpeg' } }),
      );
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  };
  return { fetchImpl, calls };
}

describe('GcsPublicationAssetDelivery', () => {
  it('creates a short-lived signed URL for an existing private image', async () => {
    const { fetchImpl, calls } = runtimeFetch();
    const delivery = new GcsPublicationAssetDelivery({
      projectId: 'toca-mcp-production',
      bucketName: 'toca-mcp-publication-assets',
      signedUrlTtlSeconds: 900,
      now: () => new Date('2026-08-13T21:00:00.000Z'),
      fetchImpl,
    });

    const url = await delivery.createDeliveryUrl(
      'instagram/corr-1/MM-SUN-0001-V1-aabbccddeeff0011.jpg',
    );

    expect(url).toContain('/toca-mcp-publication-assets/instagram/corr-1/');
    expect(url).toContain('X-Goog-Expires=900');
    expect(url).toContain('X-Goog-Signature=');
    expect(calls.some((call) => call.url.includes(':signBlob'))).toBe(true);
  });

  it('returns a delivery URL only after the complete object matches the approved SHA-256', async () => {
    const bytes = Uint8Array.from([11, 22, 33, 44, 55]);
    const expectedSha256 = createHash('sha256').update(bytes).digest('hex');
    const { fetchImpl, calls } = runtimeFetch(bytes);
    const delivery = new GcsPublicationAssetDelivery({
      projectId: 'toca-mcp-production',
      bucketName: 'toca-mcp-publication-assets',
      fetchImpl,
    });

    const url = await delivery.createVerifiedDeliveryUrl(
      'instagram/corr-1/MM-SUN-0001-V1-aabbccddeeff0011.jpg',
      expectedSha256,
    );

    expect(url).toContain('X-Goog-Signature=');
    const objectGets = calls.filter((call) => call.url.startsWith('https://storage.googleapis.com/'));
    expect(objectGets).toHaveLength(2);
    expect(new Headers(objectGets[0]?.init?.headers).get('Range')).toBe('bytes=0-0');
    expect(new Headers(objectGets[1]?.init?.headers).get('Range')).toBeNull();
  });

  it('fails closed when the private object bytes differ from the approved creative hash', async () => {
    const { fetchImpl } = runtimeFetch(Uint8Array.from([9, 9, 9]));
    const delivery = new GcsPublicationAssetDelivery({
      projectId: 'toca-mcp-production',
      bucketName: 'toca-mcp-publication-assets',
      fetchImpl,
    });

    await expect(
      delivery.createVerifiedDeliveryUrl(
        'instagram/corr-1/MM-SUN-0001-V1-aabbccddeeff0011.jpg',
        createHash('sha256').update(Uint8Array.from([1, 2, 3])).digest('hex'),
      ),
    ).rejects.toThrow('PUBLICATION_ASSET_SHA256_MISMATCH');
  });

  it('rejects object names outside the publication namespace', async () => {
    const delivery = new GcsPublicationAssetDelivery({
      projectId: 'toca-mcp-production',
      bucketName: 'toca-mcp-publication-assets',
      fetchImpl: () => Promise.reject(new Error('fetch must not run')),
    });

    await expect(delivery.createDeliveryUrl('../secret.jpg')).rejects.toThrow(
      'PUBLICATION_ASSET_OBJECT_NAME_INVALID',
    );
  });
});
