import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { VertexVeoSceneContinuationVideoProvider } from '../src/providers/gcp/vertex-veo-scene-continuation-video-provider.js';

const sourceBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
const videoBytes = Uint8Array.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]);

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.toString() : input.url;
}

function jsonBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== 'string') throw new Error('expected JSON string body');
  return JSON.parse(body) as unknown;
}

function request() {
  return {
    contentItemId: 'CONTENT-1',
    sourceAssetId: 'SUN-0244',
    operation: 'SUNSET',
    productId: 'SUNSET',
    inheritedVisualStandardId: 'SUNSET_FEED_V1',
    source: {
      bytes: sourceBytes,
      contentType: 'image/jpeg' as const,
      driveFileId: 'drive-source',
      sha256: sourceSha256,
    },
    approval: {
      exceptionId: 'VEX-1',
      contentItemId: 'CONTENT-1',
      productId: 'SUNSET',
      operation: 'SUNSET',
      sourceAssetId: 'SUN-0244',
      sourceSha256,
      requestedBy: 'LUIZ',
      approvedBy: 'LUIZ',
      approvalRef: 'APP-1',
      allowSceneContinuation: true as const,
      allowEnvironmentExpansion: false,
      allowArchitecturalInvention: false as const,
      allowAiLogoGeneration: false as const,
      peopleConsentConfirmed: true,
      status: 'APPROVED' as const,
      createdAt: '2026-08-18T06:00:00.000Z',
    },
    prompt: 'Give the real sunset scene subtle natural motion and a slow cinematic push.',
    seconds: 8 as const,
    size: '720x1280' as const,
  };
}

describe('VertexVeoSceneContinuationVideoProvider', () => {
  it('submits the exact source, polls the long-running operation, and downloads exact MP4 bytes', async () => {
    const modelEndpoint =
      'https://us-central1-aiplatform.googleapis.com/v1/projects/toca-mcp-production/locations/us-central1/publishers/google/models/veo-3.1-generate-001';
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      await Promise.resolve();
      const url = requestUrl(input);
      if (url === `${modelEndpoint}:predictLongRunning`) {
        expect(init?.method).toBe('POST');
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer cloud-token' });
        const body = jsonBody(init?.body) as {
          instances: Array<{
            prompt: string;
            image: { bytesBase64Encoded: string; mimeType: string };
          }>;
          parameters: Record<string, unknown>;
        };
        expect(body.instances).toHaveLength(1);
        expect(body.instances[0]?.image.bytesBase64Encoded).toBe(
          Buffer.from(sourceBytes).toString('base64'),
        );
        expect(body.instances[0]?.image.mimeType).toBe('image/jpeg');
        expect(body.instances[0]?.prompt).toContain('Do not reveal or invent unseen architecture');
        expect(body.parameters).toMatchObject({
          aspectRatio: '9:16',
          durationSeconds: 8,
          sampleCount: 1,
          resizeMode: 'crop',
          resolution: '720p',
          personGeneration: 'allow_adult',
        });
        expect(String(body.parameters.storageUri)).toContain(
          'gs://toca-mcp-publication-assets/video-generative/veo/CONTENT-1/',
        );
        return Response.json({
          name: 'projects/toca-mcp-production/locations/us-central1/operations/veo-123',
        });
      }
      if (url === `${modelEndpoint}:fetchPredictOperation`) {
        expect(jsonBody(init?.body)).toEqual({
          operationName: 'projects/toca-mcp-production/locations/us-central1/operations/veo-123',
        });
        return Response.json({
          done: true,
          response: {
            generatedVideos: [
              {
                video: {
                  uri: 'gs://toca-mcp-publication-assets/video-generative/veo/CONTENT-1/output.mp4',
                  mimeType: 'video/mp4',
                },
              },
            ],
          },
        });
      }
      if (
        url ===
        'https://storage.googleapis.com/storage/v1/b/toca-mcp-publication-assets/o/video-generative%2Fveo%2FCONTENT-1%2Foutput.mp4?alt=media'
      ) {
        return new Response(Uint8Array.from(videoBytes).buffer, {
          status: 200,
          headers: { 'content-type': 'video/mp4' },
        });
      }
      throw new Error(`unexpected request ${url}`);
    });
    const provider = new VertexVeoSceneContinuationVideoProvider({
      projectId: 'toca-mcp-production',
      artifactBucket: 'toca-mcp-publication-assets',
      accessTokenResolver: {
        resolve: async () => {
          await Promise.resolve();
          return 'cloud-token';
        },
      },
      accessTokenReference: { provider: 'gcp-metadata-oauth', key: 'cloud-platform' },
      fetchImpl,
      sleep: async () => {
        await Promise.resolve();
      },
      maxPolls: 2,
      now: () => new Date('2026-08-18T07:00:00.000Z'),
    });

    const result = await provider.generate(request());
    expect(result.provider).toBe('GOOGLE_VERTEX_VEO');
    expect(result.providerJobId).toBe(
      'projects/toca-mcp-production/locations/us-central1/operations/veo-123',
    );
    expect(result.providerModel).toBe('veo-3.1-generate-001');
    expect(result.requiresSceneContinuationFidelityGate).toBe(true);
    expect(result.outputSha256).toBe(createHash('sha256').update(videoBytes).digest('hex'));
  });

  it('rejects an approval/source mismatch before token or provider access', async () => {
    const fetchImpl = vi.fn();
    const accessTokenResolver = { resolve: vi.fn(() => Promise.resolve('cloud-token')) };
    const provider = new VertexVeoSceneContinuationVideoProvider({
      projectId: 'toca-mcp-production',
      artifactBucket: 'toca-mcp-publication-assets',
      accessTokenResolver,
      accessTokenReference: { provider: 'gcp-metadata-oauth', key: 'cloud-platform' },
      fetchImpl: fetchImpl as typeof fetch,
      now: () => new Date('2026-08-18T07:00:00.000Z'),
    });
    const invalid = request();

    await expect(
      provider.generate({
        ...invalid,
        approval: { ...invalid.approval, sourceSha256: 'a'.repeat(64) },
      }),
    ).rejects.toThrow('VIDEO_SCENE_CONTINUATION_REQUEST_NOT_APPROVED');
    expect(accessTokenResolver.resolve).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed when the canonical requested size cannot be represented exactly', async () => {
    const accessTokenResolver = { resolve: vi.fn(() => Promise.resolve('cloud-token')) };
    const fetchImpl = vi.fn();
    const provider = new VertexVeoSceneContinuationVideoProvider({
      projectId: 'toca-mcp-production',
      artifactBucket: 'toca-mcp-publication-assets',
      accessTokenResolver,
      accessTokenReference: { provider: 'gcp-metadata-oauth', key: 'cloud-platform' },
      fetchImpl: fetchImpl as typeof fetch,
      now: () => new Date('2026-08-18T07:00:00.000Z'),
    });

    await expect(provider.generate({ ...request(), size: '1024x1792' })).rejects.toThrow(
      'VERTEX_VEO_SIZE_UNSUPPORTED:1024x1792',
    );
    expect(accessTokenResolver.resolve).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
