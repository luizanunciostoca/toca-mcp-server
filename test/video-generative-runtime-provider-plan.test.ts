import { describe, expect, it } from 'vitest';
import { resolveSceneContinuationProviderIds } from '../src/mcp/video-generative-runtime.js';

describe('resolveSceneContinuationProviderIds', () => {
  it('resolves explicit ordered provider plans', () => {
    expect(
      resolveSceneContinuationProviderIds({
        VIDEO_SCENE_CONTINUATION_PROVIDER_ORDER: 'GOOGLE_VERTEX_VEO,OPENAI_VIDEO_API',
      }),
    ).toEqual(['GOOGLE_VERTEX_VEO', 'OPENAI_VIDEO_API']);
  });

  it('supports the legacy primary plus fallback shape', () => {
    expect(
      resolveSceneContinuationProviderIds({
        VIDEO_SCENE_CONTINUATION_PROVIDER: 'GOOGLE_VERTEX_VEO',
        VIDEO_SCENE_CONTINUATION_FALLBACK_PROVIDER: 'OPENAI_VIDEO_API',
      }),
    ).toEqual(['GOOGLE_VERTEX_VEO', 'OPENAI_VIDEO_API']);
  });

  it('keeps the historical single-provider default', () => {
    expect(resolveSceneContinuationProviderIds({})).toEqual(['OPENAI_VIDEO_API']);
  });

  it('deduplicates explicit ordered provider plans while preserving order', () => {
    expect(
      resolveSceneContinuationProviderIds({
        VIDEO_SCENE_CONTINUATION_PROVIDER_ORDER:
          'GOOGLE_VERTEX_VEO,GOOGLE_VERTEX_VEO,OPENAI_VIDEO_API',
      }),
    ).toEqual(['GOOGLE_VERTEX_VEO', 'OPENAI_VIDEO_API']);
  });

  it('rejects a duplicate legacy fallback', () => {
    expect(() =>
      resolveSceneContinuationProviderIds({
        VIDEO_SCENE_CONTINUATION_PROVIDER: 'GOOGLE_VERTEX_VEO',
        VIDEO_SCENE_CONTINUATION_FALLBACK_PROVIDER: 'GOOGLE_VERTEX_VEO',
      }),
    ).toThrow('VIDEO_PROVIDER_FAILOVER_PLAN_DUPLICATE');
  });

  it('rejects unsupported providers', () => {
    expect(() =>
      resolveSceneContinuationProviderIds({
        VIDEO_SCENE_CONTINUATION_PROVIDER_ORDER: 'GOOGLE_VERTEX_VEO,RUNWAY',
      }),
    ).toThrow('VIDEO_SCENE_CONTINUATION_PROVIDER_UNSUPPORTED');
  });
});
