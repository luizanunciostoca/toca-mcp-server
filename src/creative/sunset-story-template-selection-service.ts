import {
  buildSunsetStoryImageProfile,
  type SunsetStoryImageObservation,
  type SunsetStoryImageProfile,
} from './sunset-story-image-profile.js';
import {
  decideSunsetStoryTemplate,
  rankSunsetStoryTemplates,
  type SunsetStorySelectionHistoryItem,
  type SunsetStoryTemplateCandidate,
  type SunsetStoryTemplateSelection,
} from './sunset-story-template-selector.js';
import type { SunsetStoryIntent, SunsetStoryTemplateId } from './sunset-story-template-registry.js';

export interface SunsetStoryImageAnalyzerRequest {
  readonly assetId: string;
  readonly imageBytes: Uint8Array;
}

export interface SunsetStoryImageAnalyzerPort {
  analyze(request: SunsetStoryImageAnalyzerRequest): Promise<SunsetStoryImageObservation>;
}

export interface SunsetStoryPreviewEvaluation {
  readonly templateId: SunsetStoryTemplateId;
  readonly qualityScore: number;
  readonly blockingReasons: readonly string[];
}

export interface SunsetStoryPreviewEvaluatorPort {
  evaluate(request: {
    readonly assetId: string;
    readonly imageBytes: Uint8Array;
    readonly profile: SunsetStoryImageProfile;
    readonly candidate: SunsetStoryTemplateCandidate;
  }): Promise<SunsetStoryPreviewEvaluation>;
}

export interface SunsetStoryTemplateSelectionServiceRequest {
  readonly assetId: string;
  readonly imageBytes: Uint8Array;
  readonly intent: SunsetStoryIntent;
  readonly history?: readonly SunsetStorySelectionHistoryItem[];
}

export interface SunsetStoryTemplateSelectionServiceResult {
  readonly profile: SunsetStoryImageProfile;
  readonly selection: SunsetStoryTemplateSelection;
  readonly previewEvaluations: readonly SunsetStoryPreviewEvaluation[];
}

function clampScore(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error('SUNSET_PREVIEW_QUALITY_SCORE_INVALID');
  }
  return value;
}

function applyPreviewEvaluation(
  candidate: SunsetStoryTemplateCandidate,
  evaluation: SunsetStoryPreviewEvaluation,
): SunsetStoryTemplateCandidate {
  if (evaluation.templateId !== candidate.templateId) {
    throw new Error('SUNSET_PREVIEW_TEMPLATE_MISMATCH');
  }
  const blockingReasons = [...evaluation.blockingReasons];
  if (blockingReasons.length > 0) {
    return {
      ...candidate,
      score: 0,
      hardRejected: true,
      rejectionReasons: [...candidate.rejectionReasons, ...blockingReasons],
    };
  }
  const qualityScore = clampScore(evaluation.qualityScore);
  return {
    ...candidate,
    score: Math.round((candidate.score * 0.85 + qualityScore * 0.15) * 100) / 100,
  };
}

export class SunsetStoryTemplateSelectionService {
  constructor(
    private readonly imageAnalyzer: SunsetStoryImageAnalyzerPort,
    private readonly previewEvaluator: SunsetStoryPreviewEvaluatorPort | null = null,
  ) {}

  async select(
    request: SunsetStoryTemplateSelectionServiceRequest,
  ): Promise<SunsetStoryTemplateSelectionServiceResult> {
    const observation = await this.imageAnalyzer.analyze({
      assetId: request.assetId,
      imageBytes: request.imageBytes,
    });
    const profile = buildSunsetStoryImageProfile(observation);
    const ranked = rankSunsetStoryTemplates({
      profile,
      intent: request.intent,
      ...(request.history ? { history: request.history } : {}),
    });
    const previewEvaluator = this.previewEvaluator;

    if (!previewEvaluator) {
      return {
        profile,
        selection: decideSunsetStoryTemplate(ranked),
        previewEvaluations: [],
      };
    }

    const topCandidates = ranked.filter((candidate) => !candidate.hardRejected).slice(0, 3);
    const previewEvaluations = await Promise.all(
      topCandidates.map((candidate) =>
        previewEvaluator.evaluate({
          assetId: request.assetId,
          imageBytes: request.imageBytes,
          profile,
          candidate,
        }),
      ),
    );
    const evaluationsByTemplate = new Map(
      previewEvaluations.map((evaluation) => [evaluation.templateId, evaluation]),
    );
    const previewRanked = topCandidates
      .map((candidate) => {
        const evaluation = evaluationsByTemplate.get(candidate.templateId);
        return evaluation ? applyPreviewEvaluation(candidate, evaluation) : candidate;
      })
      .sort((left, right) => {
        if (left.hardRejected !== right.hardRejected) return left.hardRejected ? 1 : -1;
        if (right.score !== left.score) return right.score - left.score;
        return left.templateId.localeCompare(right.templateId);
      });

    return {
      profile,
      selection: decideSunsetStoryTemplate(previewRanked),
      previewEvaluations,
    };
  }
}
