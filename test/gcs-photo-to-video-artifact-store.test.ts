import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { GcsPhotoToVideoArtifactStore } from '../src/providers/gcp/gcs-photo-to-video-artifact-store.js';

const videoBytes = Uint8Array.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]);
const videoSha256 = createHash('sha256').update(videoBytes).digest('hex');
const corruptBytes = Uint8Array.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 9, 9, 9, 9]);

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.toString() : input.url;
}

function fakeGcpFetch(options?: { corruptSecondFullRead?: boolean }) {
  let uploaded = false;
  let fullReads = 0;
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    await Promise.resolve();
    const url = requestUrl(input);
    if (url.endsWith('/computeMetadata/v1/instance/service-accounts/default/token')) {
      return Response.json({ access_token: 'gcp-token' });
    }
    if (url.endsWith('/computeMetadata/v1/instance/service-accounts/default/email')) {
      return new Response('toca-runtime@test-project.iam.gserviceaccount.com', { status: 200 });
    }
    if (url.includes('iamcredentials.googleapis.com/') && url.endsWith(':signBlob')) {
      return Response.json({ signedBlob: Buffer.from('signature').toString('base64') });
    }
    if (url.startsWith('https://storage.googleapis.com/upload/storage/v1/b/toca-bucket/o')) {
      uploaded = true;
      return Response.json({ name: 'stored' });
    }
    if (url.startsWith('https://storage.googleapis.com/toca-bucket/instagram/')) {
      const headers = new Headers(init?.headers);
      if (headers.get('Range')) {
        if (!uploaded) return new Response(null, { status: 404 });
        return new Response(Uint8Array.from([videoBytes[0]!]).buffer, {
          status: 206,
          headers: { 'content-type': 'video/mp4' },
        });
      }
      fullReads += 1;
      const bytes = options?.corruptSecondFullRead && fullReads >= 2 ? corruptBytes : videoBytes;
      return new Response(Uint8Array.from(bytes).buffer, {
        status: 200,
        headers: { 'content-type': 'video/mp4' },
      });
    }
    throw new Error(`unexpected request: ${url}`);
  });
  return { fetchImpl: fetchImpl as typeof fetch, spy: fetchImpl };
}

describe('GcsPhotoToVideoArtifactStore', () => {
  it('stages exact candidate bytes then performs full-SHA durable readback', async () => {
    const gcp = fakeGcpFetch();
    const store = new GcsPhotoToVideoArtifactStore({
      projectId: 'test-project',
      bucketName: 'toca-bucket',
      fetchImpl: gcp.fetchImpl,
    });

    const result = await store.store({
      contentItemId: 'CONTENT-1',
      routeType: 'REAL_PHOTO_TO_MOTION_VIDEO',
      bytes: videoBytes,
      expectedSha256: videoSha256,
    });

    expect(result.artifactRef).toBe(`gcs://toca-bucket/${result.objectName}`);
    expect(result.objectName).toMatch(/^instagram\/photo-motion-review-v1\//);
    expect(result.sha256).toBe(videoSha256);
    expect(result.sizeBytes).toBe(videoBytes.byteLength);
    expect(result.contentType).toBe('video/mp4');
    expect(
      gcp.spy.mock.calls.some(
        ([input, init]) =>
          requestUrl(input).startsWith(
            'https://storage.googleapis.com/upload/storage/v1/b/toca-bucket/o',
          ) && init?.method === 'POST',
      ),
    ).toBe(true);
  });

  it('fails closed when a later full artifact read no longer matches the finalized SHA', async () => {
    const gcp = fakeGcpFetch({ corruptSecondFullRead: true });
    const store = new GcsPhotoToVideoArtifactStore({
      projectId: 'test-project',
      bucketName: 'toca-bucket',
      fetchImpl: gcp.fetchImpl,
    });

    await expect(
      store.store({
        contentItemId: 'CONTENT-1',
        routeType: 'REAL_PHOTO_TO_MOTION_VIDEO',
        bytes: videoBytes,
        expectedSha256: videoSha256,
      }),
    ).rejects.toThrow('PHOTO_TO_VIDEO_ARTIFACT_READBACK_HASH_MISMATCH');
  });

  it('rejects artifact refs outside the configured bucket before any provider access', async () => {
    const gcp = fakeGcpFetch();
    const store = new GcsPhotoToVideoArtifactStore({
      projectId: 'test-project',
      bucketName: 'toca-bucket',
      fetchImpl: gcp.fetchImpl,
    });

    await expect(
      store.loadExact('gcs://other-bucket/instagram/photo-motion-review-v1/file.mp4', videoSha256),
    ).rejects.toThrow('PHOTO_TO_VIDEO_ARTIFACT_REF_BUCKET_MISMATCH');
    expect(gcp.spy).not.toHaveBeenCalled();
  });
});
