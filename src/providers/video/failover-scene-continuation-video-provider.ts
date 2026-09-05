import { ExecutionError } from '../../core/errors.js';
import type {
  SceneContinuationVideoRequest,
  SceneContinuationVideoResult,
} from '../openai/openai-scene-continuation-video-provider.js';

export type SceneContinuationProviderId = 'OPENAI_VIDEO_API' | 'GOOGLE_VERTEX_VEO';

export interface SceneContinuationVideoProviderLike {
  generate(request: SceneContinuationVideoRequest): Promise<SceneContinuationVideoResult>;
}

export interface FailoverSceneContinuationProviderEntry {
  readonly id: SceneContinuationProviderId;
  readonly provider: SceneContinuationVideoProviderLike;
}

export class FailoverSceneContinuationVideoProvider implements SceneContinuationVideoProviderLike {
  constructor(private readonly providers: readonly FailoverSceneContinuationProviderEntry[]) {
    if (providers.length === 0) throw new Error('VIDEO_PROVIDER_FAILOVER_PLAN_EMPTY');
    if (new Set(providers.map((entry) => entry.id)).size !== providers.length) {
      throw new Error('VIDEO_PROVIDER_FAILOVER_PLAN_DUPLICATE');
    }
  }

  async generate(request: SceneContinuationVideoRequest): Promise<SceneContinuationVideoResult> {
    const attemptChain: SceneContinuationProviderId[] = [];
    let lastRetryableError: ExecutionError | undefined;

    for (let index = 0; index < this.providers.length; index += 1) {
      const entry = this.providers[index]!;
      attemptChain.push(entry.id);
      try {
        const result = await entry.provider.generate(request);
        if (result.provider !== entry.id) {
          throw new ExecutionError(
            'STATE_CONFLICT',
            `VIDEO_PROVIDER_IDENTITY_MISMATCH:${entry.id}:${result.provider}`,
            false,
          );
        }
        return {
          ...result,
          providerAttemptChain: attemptChain,
          providerFallbackUsed: attemptChain.length > 1,
        };
      } catch (error) {
        if (!shouldFailOver(error) || index + 1 >= this.providers.length) throw error;
        lastRetryableError = error;
      }
    }

    throw lastRetryableError ?? new Error('VIDEO_PROVIDER_FAILOVER_EXHAUSTED');
  }
}

function shouldFailOver(error: unknown): error is ExecutionError {
  return (
    error instanceof ExecutionError &&
    error.retryable &&
    (error.code === 'PROVIDER_UNAVAILABLE' || error.code === 'PROVIDER_RATE_LIMITED')
  );
}
