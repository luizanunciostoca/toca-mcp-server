import type {
  SunsetStoryPreviewEvaluation,
  SunsetStoryPreviewEvaluatorPort,
} from './sunset-story-template-selection-service.js';
import type { SunsetStoryOverlayResolverPort } from './sunset-story-overlay.js';
import { ExecutionError } from '../core/errors.js';
import { LocalImagemagickSunsetStoryRenderer } from '../providers/local/local-imagemagick-sunset-story-renderer.js';

export class DeterministicSunsetStoryPreviewEvaluator implements SunsetStoryPreviewEvaluatorPort {
  constructor(
    private readonly overlays: SunsetStoryOverlayResolverPort,
    private readonly renderer: LocalImagemagickSunsetStoryRenderer,
  ) {}

  async evaluate(
    request: Parameters<SunsetStoryPreviewEvaluatorPort['evaluate']>[0],
  ): Promise<SunsetStoryPreviewEvaluation> {
    try {
      const overlay = await this.overlays.resolve(request.candidate.templateId);
      await this.renderer.renderPreview({
        imageBytes: request.imageBytes,
        profile: request.profile,
        candidate: request.candidate,
        overlay,
      });
      return {
        templateId: request.candidate.templateId,
        qualityScore: previewQualityScore(request.candidate.components),
        blockingReasons: [],
      };
    } catch (error) {
      const reason =
        error instanceof ExecutionError
          ? `PREVIEW_RENDER_BLOCKED:${error.code}:${error.message}`
          : `PREVIEW_RENDER_BLOCKED:UNKNOWN:${error instanceof Error ? error.message : String(error)}`;
      return {
        templateId: request.candidate.templateId,
        qualityScore: 0,
        blockingReasons: [reason],
      };
    }
  }
}

function previewQualityScore(components: {
  readonly collisionClearance: number;
  readonly contrastReadability: number;
  readonly cropQuality: number;
}): number {
  const score =
    components.collisionClearance * 0.45 +
    components.contrastReadability * 0.3 +
    components.cropQuality * 0.25;
  return Math.round(Math.min(100, Math.max(0, score)) * 100) / 100;
}
