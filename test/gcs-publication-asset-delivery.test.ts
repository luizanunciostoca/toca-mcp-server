import { describe, expect, it } from 'vitest';
import { GcsPublicationAssetDelivery } from '../src/providers/gcp/gcs-publication-asset-delivery.js';

function response(body: BodyInit | null, init: ResponseInit): Response {
  return new Response(body, init);
}

describe('GcsPublicationAssetDelivery', () => {
  it('creates a short-lived signed URL for an existing private image', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, ...(init ? { init } : {}) });

      if (url.endsWith('/token')) {
        return response(JSON.stringify({ access_token: 'runtime-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/email')) {
        return response('runtime@toca-mcp-production.iam.gserviceaccount.com', { status: 200 });
      }
      if (url.includes(':signBlob')) {
        return response(
          JSON.stringify({ signedBlob: Buffer.from('signature').toString('base64') }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      if (url.startsWith('https://storage.googleapis.com/')) {
        return response('x', { status: 206, headers: { 'content-type': 'image/jpeg' } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    };

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

  it('rejects object names outside the publication namespace', async () => {
    const delivery = new GcsPublicationAssetDelivery({
      projectId: 'toca-mcp-production',
      bucketName: 'toca-mcp-publication-assets',
      fetchImpl: async () => {
        throw new Error('fetch must not run');
      },
    });

    await expect(delivery.createDeliveryUrl('../secret.jpg')).rejects.toThrow(
      'PUBLICATION_ASSET_OBJECT_NAME_INVALID',
    );
  });
});
