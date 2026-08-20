import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { OpenAiSceneContinuationVideoProvider } from '../src/providers/openai/openai-scene-continuation-video-provider.js';

const sourceBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
const videoBytes = Uint8Array.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]);

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.toString() : input.url;
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

describe('OpenAiSceneContinuationVideoProvider', () => {
  it('uploads the exact source as input_reference, polls, and downloads exact MP4 bytes', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      await Promise.resolve();
      const url = requestUrl(input);
      if (url === 'https://api.openai.com/v1/videos' && init?.method === 'POST') {
        expect(init.body).toBeInstanceOf(FormData);
        const form = init.body as FormData;
        expect(form.get('model')).toBe('sora-2');
        expect(form.get('seconds')).toBe('8');
        expect(form.get('size')).toBe('720x1280');
        expect(form.get('input_reference')).toBeInstanceOf(Blob);
        const prompt = form.get('prompt');
        if (typeof prompt !== 'string') throw new Error('expected prompt string');
        expect(prompt).toContain('Do not reveal or invent unseen architecture');
        return Response.json({ id: 'video_123', status: 'queued', model: 'sora-2' });
      }
      if (url === 'https://api.openai.com/v1/videos/video_123') {
        return Response.json({ id: 'video_123', status: 'completed', model: 'sora-2' });
      }
      if (url === 'https://api.openai.com/v1/videos/video_123/content') {
        return new Response(Uint8Array.from(videoBytes).buffer, {
          status: 200,
          headers: { 'content-type': 'video/mp4' },
        });
      }
      throw new Error(`unexpected request ${url}`);
    });
    const provider = new OpenAiSceneContinuationVideoProvider({
      secretResolver: {
        resolve: async () => {
          await Promise.resolve();
          return 'sk-test';
        },
      },
      apiKeyReference: { provider: 'env', key: 'OPENAI_API_KEY' },
      fetchImpl: fetchImpl,
      sleep: async () => {
        await Promise.resolve();
        return undefined;
      },
      maxPolls: 2,
      now: () => new Date('2026-08-18T07:00:00.000Z'),
    });
    const result = await provider.generate(request());
    expect(result.providerJobId).toBe('video_123');
    expect(result.providerModel).toBe('sora-2');
    expect(result.requiresSceneContinuationFidelityGate).toBe(true);
    expect(result.outputSha256).toBe(createHash('sha256').update(videoBytes).digest('hex'));
  });

  it('rejects a source hash not covered by the explicit approval before provider access', async () => {
    const fetchImpl = vi.fn();
    const provider = new OpenAiSceneContinuationVideoProvider({
      secretResolver: {
        resolve: async () => {
          await Promise.resolve();
          return 'sk-test';
        },
      },
      apiKeyReference: { provider: 'env', key: 'OPENAI_API_KEY' },
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
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a caller source asset identity not covered by the approval', async () => {
    const fetchImpl = vi.fn();
    const provider = new OpenAiSceneContinuationVideoProvider({
      secretResolver: {
        resolve: async () => {
          await Promise.resolve();
          return 'sk-test';
        },
      },
      apiKeyReference: { provider: 'env', key: 'OPENAI_API_KEY' },
      fetchImpl: fetchImpl as typeof fetch,
      now: () => new Date('2026-08-18T07:00:00.000Z'),
    });
    await expect(provider.generate({ ...request(), sourceAssetId: 'SUN-OTHER' })).rejects.toThrow(
      'VIDEO_SCENE_CONTINUATION_REQUEST_NOT_APPROVED',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed before secret/provider access when the trusted clock is invalid', async () => {
    const fetchImpl = vi.fn();
    const secretResolver = {
      resolve: vi.fn(async () => {
        await Promise.resolve();
        return 'sk-test';
      }),
    };
    const provider = new OpenAiSceneContinuationVideoProvider({
      secretResolver,
      apiKeyReference: { provider: 'env', key: 'OPENAI_API_KEY' },
      fetchImpl: fetchImpl as typeof fetch,
      now: () => new Date(Number.NaN),
    });
    await expect(provider.generate(request())).rejects.toThrow(
      'OPENAI_VIDEO_TRUSTED_CLOCK_INVALID',
    );
    expect(secretResolver.resolve).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
