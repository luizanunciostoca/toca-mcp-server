import { describe, expect, it, vi } from 'vitest';
import { ExecutionError } from '../src/core/errors.js';
import { FailoverSceneContinuationVideoProvider } from '../src/providers/video/failover-scene-continuation-video-provider.js';
import type {
  SceneContinuationVideoRequest,
  SceneContinuationVideoResult,
} from '../src/providers/openai/openai-scene-continuation-video-provider.js';

const request = {} as SceneContinuationVideoRequest;

function result(provider: 'GOOGLE_VERTEX_VEO' | 'OPENAI_VIDEO_API'): SceneContinuationVideoResult {
  return {
    outputBytes: Uint8Array.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70]),
    outputContentType: 'video/mp4',
    outputSha256: 'a'.repeat(64),
    provider,
    providerJobId: `${provider}-job`,
    providerModel: `${provider}-model`,
    requiresPostGenerationHumanReview: true,
    requiresSceneContinuationFidelityGate: true,
  };
}

describe('FailoverSceneContinuationVideoProvider', () => {
  it('returns the primary result without touching the fallback', async () => {
    const primary = { generate: vi.fn().mockResolvedValue(result('GOOGLE_VERTEX_VEO')) };
    const fallback = { generate: vi.fn().mockResolvedValue(result('OPENAI_VIDEO_API')) };
    const provider = new FailoverSceneContinuationVideoProvider([
      { id: 'GOOGLE_VERTEX_VEO', provider: primary },
      { id: 'OPENAI_VIDEO_API', provider: fallback },
    ]);

    const output = await provider.generate(request);

    expect(output.provider).toBe('GOOGLE_VERTEX_VEO');
    expect(output.providerAttemptChain).toEqual(['GOOGLE_VERTEX_VEO']);
    expect(output.providerFallbackUsed).toBe(false);
    expect(fallback.generate).not.toHaveBeenCalled();
  });

  it('fails over only after retryable provider unavailability', async () => {
    const primary = {
      generate: vi
        .fn()
        .mockRejectedValue(new ExecutionError('PROVIDER_UNAVAILABLE', 'VERTEX_TIMEOUT', true)),
    };
    const fallback = { generate: vi.fn().mockResolvedValue(result('OPENAI_VIDEO_API')) };
    const provider = new FailoverSceneContinuationVideoProvider([
      { id: 'GOOGLE_VERTEX_VEO', provider: primary },
      { id: 'OPENAI_VIDEO_API', provider: fallback },
    ]);

    const output = await provider.generate(request);

    expect(output.provider).toBe('OPENAI_VIDEO_API');
    expect(output.providerAttemptChain).toEqual(['GOOGLE_VERTEX_VEO', 'OPENAI_VIDEO_API']);
    expect(output.providerFallbackUsed).toBe(true);
    expect(fallback.generate).toHaveBeenCalledTimes(1);
  });

  it('does not bypass policy, approval or non-retryable provider failures', async () => {
    const primary = {
      generate: vi
        .fn()
        .mockRejectedValue(new ExecutionError('APPROVAL_REQUIRED', 'APPROVAL_MISSING', false)),
    };
    const fallback = { generate: vi.fn().mockResolvedValue(result('OPENAI_VIDEO_API')) };
    const provider = new FailoverSceneContinuationVideoProvider([
      { id: 'GOOGLE_VERTEX_VEO', provider: primary },
      { id: 'OPENAI_VIDEO_API', provider: fallback },
    ]);

    await expect(provider.generate(request)).rejects.toMatchObject({
      code: 'APPROVAL_REQUIRED',
      message: 'APPROVAL_MISSING',
    });
    expect(fallback.generate).not.toHaveBeenCalled();
  });

  it('fails closed when a provider returns the wrong provider identity', async () => {
    const primary = { generate: vi.fn().mockResolvedValue(result('OPENAI_VIDEO_API')) };
    const fallback = { generate: vi.fn().mockResolvedValue(result('OPENAI_VIDEO_API')) };
    const provider = new FailoverSceneContinuationVideoProvider([
      { id: 'GOOGLE_VERTEX_VEO', provider: primary },
      { id: 'OPENAI_VIDEO_API', provider: fallback },
    ]);

    await expect(provider.generate(request)).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    });
    expect(fallback.generate).not.toHaveBeenCalled();
  });
});
