import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  GcsPublicationAssetStager,
  buildPublicationAssetObjectName,
  validatePublicMediaUrl,
} from '../src/providers/gcp/gcs-publication-asset-stager.js';

const RUNTIME_EMAIL = 'toca-mcp-runtime@toca-mcp-production.iam.gserviceaccount.com';
const SHA = 'a'.repeat(64);

function requestUrl(input: RequestInfo | URL): string {
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  return input;
}

describe('GCS video publication asset staging', () => {
  it('builds deterministic MP4 object names for Reel output', () => {
    expect(
      buildPublicationAssetObjectName(
        {
          assetId: 'CREATIVE-REEL-001',
          correlationId: 'reel-001',
          contentType: 'video/mp4',
        },
        SHA,
      ),
    ).toBe('instagram/reel-001/CREATIVE-REEL-001-aaaaaaaaaaaaaaaa.mp4');
  });

  it('accepts externally fetchable MP4 media and rejects a MIME substitution', async () => {
    const videoFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Uint8Array([0]), {
        status: 206,
        headers: { 'content-type': 'video/mp4' },
      }),
    );
    await expect(
      validatePublicMediaUrl('https://example.com/reel.mp4', 'video/mp4', videoFetch),
    ).resolves.toBe('video/mp4');

    const imageFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Uint8Array([0xff]), {
        status: 206,
        headers: { 'content-type': 'image/jpeg' },
      }),
    );
    await expect(
      validatePublicMediaUrl('https://example.com/reel.mp4', 'video/mp4', imageFetch),
    ).rejects.toThrow('PUBLICATION_ASSET_PUBLIC_CONTENT_TYPE_MISMATCH:video/mp4:image/jpeg');
  });

  it('uploads a deterministic MP4 object using runtime identity and validates it before return', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'toca-reel-publication-'));
    const sourcePath = join(directory, 'reel.mp4');
    await writeFile(sourcePath, Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70]));

    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'runtime-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(RUNTIME_EMAIL, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ signedBlob: Buffer.from([1, 2, 3]).toString('base64') }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: 'object' }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(new Uint8Array([0]), {
          status: 206,
          headers: { 'content-type': 'video/mp4' },
        }),
      );

    const stager = new GcsPublicationAssetStager({
      projectId: 'toca-mcp-production',
      bucketName: 'toca-publication-assets',
      fetchImpl,
      now: () => new Date('2026-08-18T01:00:00.000Z'),
    });
    const result = await stager.stage({
      assetId: 'CREATIVE-REEL-001',
      correlationId: 'reel-001',
      sourcePath,
      contentType: 'video/mp4',
    });

    expect(result.objectName.endsWith('.mp4')).toBe(true);
    expect(result.contentType).toBe('video/mp4');
    const upload = fetchImpl.mock.calls.find((call) =>
      requestUrl(call[0]).includes('upload/storage/v1'),
    );
    expect(new Headers(upload?.[1]?.headers).get('Content-Type')).toBe('video/mp4');
  });
});
