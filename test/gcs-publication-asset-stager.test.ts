import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  buildPublicationAssetObjectName,
  buildPublicGcsObjectUrl,
  GcsPublicationAssetStager,
  validatePublicImageUrl,
} from '../src/providers/gcp/gcs-publication-asset-stager.js';

const FIXTURE_SHA256 = '32461d5bd1773012acef0ba15636752949bd7c2ce50f9172159d9f56cf0dd9af';

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

describe('GCS publication asset staging', () => {
  it('builds deterministic content-addressed object names', () => {
    expect(
      buildPublicationAssetObjectName(
        {
          assetId: 'SUN-0012',
          correlationId: 'sunset-first-2026-08-12-a1',
          contentType: 'image/jpeg',
        },
        FIXTURE_SHA256,
      ),
    ).toBe('instagram/sunset-first-2026-08-12-a1/SUN-0012-32461d5bd1773012.jpg');
  });

  it('rejects unsafe object path segments', () => {
    expect(() =>
      buildPublicationAssetObjectName(
        {
          assetId: '../SUN-0012',
          correlationId: 'safe',
          contentType: 'image/jpeg',
        },
        FIXTURE_SHA256,
      ),
    ).toThrow('PUBLICATION_ASSET_ASSETID_INVALID');
  });

  it('encodes public object urls safely', () => {
    expect(buildPublicGcsObjectUrl('toca-publication-assets', 'instagram/a/SUN-0012.jpg')).toBe(
      'https://storage.googleapis.com/toca-publication-assets/instagram/a/SUN-0012.jpg',
    );
  });

  it('requires a publicly fetchable image content type', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('<html></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );

    await expect(validatePublicImageUrl('https://example.com/file', fetchImpl)).rejects.toThrow(
      'PUBLICATION_ASSET_PUBLIC_CONTENT_TYPE_INVALID:text/html',
    );
  });

  it('uploads with runtime identity and validates the public image before returning', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'toca-publication-'));
    const sourcePath = join(directory, 'SUN-0012.jpg');
    await writeFile(sourcePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'runtime-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: 'object' }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(new Uint8Array([0xff]), {
          status: 206,
          headers: { 'content-type': 'image/jpeg' },
        }),
      );

    const stager = new GcsPublicationAssetStager({
      projectId: 'toca-mcp-production',
      bucketName: 'toca-publication-assets',
      fetchImpl,
    });

    const result = await stager.stage({
      assetId: 'SUN-0012',
      correlationId: 'sunset-first-2026-08-12-a1',
      sourcePath,
      contentType: 'image/jpeg',
    });

    expect(result).toEqual({
      objectName: 'instagram/sunset-first-2026-08-12-a1/SUN-0012-32461d5bd1773012.jpg',
      publicUrl:
        'https://storage.googleapis.com/toca-publication-assets/instagram/sunset-first-2026-08-12-a1/SUN-0012-32461d5bd1773012.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 4,
      sha256: FIXTURE_SHA256,
    });

    const existenceRequest = fetchImpl.mock.calls[0];
    expect(existenceRequest).toBeDefined();
    expect(requestUrl(existenceRequest![0])).toBe(result.publicUrl);

    const tokenRequest = fetchImpl.mock.calls[1];
    expect(tokenRequest).toBeDefined();
    expect(requestUrl(tokenRequest![0])).toContain('metadata.google.internal');
    expect(tokenRequest![1]).toMatchObject({ headers: { 'Metadata-Flavor': 'Google' } });

    const uploadRequest = fetchImpl.mock.calls[2];
    expect(uploadRequest).toBeDefined();
    expect(requestUrl(uploadRequest![0])).toContain(
      'upload/storage/v1/b/toca-publication-assets/o',
    );
    expect(uploadRequest![1]?.method).toBe('POST');
    const uploadHeaders = new Headers(uploadRequest![1]?.headers);
    expect(uploadHeaders.get('Authorization')).toBe('Bearer runtime-token');
    expect(uploadHeaders.get('Content-Type')).toBe('image/jpeg');

    const validationRequest = fetchImpl.mock.calls[3];
    expect(validationRequest).toBeDefined();
    expect(requestUrl(validationRequest![0])).toBe(result.publicUrl);
    expect(validationRequest![1]).toMatchObject({
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
    });
  });

  it('reuses an already staged immutable object without requesting a token or uploading again', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'toca-publication-'));
    const sourcePath = join(directory, 'SUN-0012.jpg');
    await writeFile(sourcePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Uint8Array([0xff]), {
        status: 206,
        headers: { 'content-type': 'image/jpeg' },
      }),
    );

    const stager = new GcsPublicationAssetStager({
      projectId: 'toca-mcp-production',
      bucketName: 'toca-publication-assets',
      fetchImpl,
    });

    const result = await stager.stage({
      assetId: 'SUN-0012',
      correlationId: 'sunset-first-2026-08-12-a1',
      sourcePath,
      contentType: 'image/jpeg',
    });

    expect(result.sha256).toBe(FIXTURE_SHA256);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
