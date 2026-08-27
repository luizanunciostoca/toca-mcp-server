import type { SunsetStoryImageProfile } from './sunset-story-image-profile.js';
import {
  type SunsetStoryAiRenderPlannerPort,
  type SunsetStoryRenderPlan,
  validateSunsetStoryAiRenderPlan,
} from './sunset-story-render-plan.js';
import type { SunsetStorySelectionHistoryItem } from './sunset-story-template-selector.js';
import type {
  SunsetStoryTemplateSelectionService,
  SunsetStoryTemplateSelectionServiceResult,
} from './sunset-story-template-selection-service.js';
import type { SunsetStoryIntent, SunsetStoryTemplateId } from './sunset-story-template-registry.js';
import {
  loadSunsetStoryTemplateContract,
  type SunsetStoryCanonicalTemplateContract,
} from './sunset-story-template-contract.js';
import type {
  SunsetStoryDynamicSvgRenderer,
  SunsetStorySvgRenderResult,
} from './sunset-story-svg-renderer.js';

export interface SunsetStoryTemplateContractLoaderPort {
  load(templateId: SunsetStoryTemplateId): Promise<SunsetStoryCanonicalTemplateContract>;
}

export class RepositorySunsetStoryTemplateContractLoader implements SunsetStoryTemplateContractLoaderPort {
  constructor(private readonly repositoryRoot = process.cwd()) {}

  async load(templateId: SunsetStoryTemplateId): Promise<SunsetStoryCanonicalTemplateContract> {
    return loadSunsetStoryTemplateContract(templateId, this.repositoryRoot);
  }
}

export interface SunsetStoryVisualQaResult {
  readonly layoutSimilarity: number;
  readonly typographySimilarity: number;
  readonly brandIntegrity: number;
  readonly blockingReasons: readonly string[];
}

export interface SunsetStoryVisualQaPort {
  evaluate(request: {
    readonly templateId: SunsetStoryTemplateId;
    readonly referenceSha256: string;
    readonly referenceImageBytes: Uint8Array;
    readonly renderedBytes: Uint8Array;
    readonly renderedMimeType: 'image/svg+xml';
  }): Promise<SunsetStoryVisualQaResult>;
}

export interface SunsetStoryDynamicReplicationRequest {
  readonly assetId: string;
  readonly imageBytes: Uint8Array;
  readonly imageMimeType: 'image/jpeg' | 'image/png';
  readonly intent: SunsetStoryIntent;
  readonly history?: readonly SunsetStorySelectionHistoryItem[];
  readonly referenceImageBytes?: Uint8Array;
}

export interface SunsetStoryDynamicReplicationResult {
  readonly selection: SunsetStoryTemplateSelectionServiceResult;
  readonly templateId: SunsetStoryTemplateId;
  readonly profile: SunsetStoryImageProfile;
  readonly plan: SunsetStoryRenderPlan;
  readonly preview: SunsetStorySvgRenderResult;
  readonly visualQa: SunsetStoryVisualQaResult | null;
  readonly visualQaStatus: 'PASS' | 'FAIL' | 'PENDING';
  readonly storyReady: false;
  readonly publicationEligible: false;
}

const MIN_LAYOUT_SIMILARITY = 0.92;
const MIN_TYPOGRAPHY_SIMILARITY = 0.9;
const MIN_BRAND_INTEGRITY = 1;

function assertSimilarity(value: number, code: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(code);
}

function visualQaStatus(result: SunsetStoryVisualQaResult): 'PASS' | 'FAIL' {
  assertSimilarity(result.layoutSimilarity, 'SUNSET_VISUAL_QA_LAYOUT_SCORE_INVALID');
  assertSimilarity(result.typographySimilarity, 'SUNSET_VISUAL_QA_TYPOGRAPHY_SCORE_INVALID');
  assertSimilarity(result.brandIntegrity, 'SUNSET_VISUAL_QA_BRAND_SCORE_INVALID');
  if (result.blockingReasons.length > 0) return 'FAIL';
  if (result.layoutSimilarity < MIN_LAYOUT_SIMILARITY) return 'FAIL';
  if (result.typographySimilarity < MIN_TYPOGRAPHY_SIMILARITY) return 'FAIL';
  if (result.brandIntegrity < MIN_BRAND_INTEGRITY) return 'FAIL';
  return 'PASS';
}

export class SunsetStoryDynamicReplicationService {
  constructor(
    private readonly selector: SunsetStoryTemplateSelectionService,
    private readonly contractLoader: SunsetStoryTemplateContractLoaderPort,
    private readonly aiPlanner: SunsetStoryAiRenderPlannerPort,
    private readonly renderer: SunsetStoryDynamicSvgRenderer,
    private readonly visualQa: SunsetStoryVisualQaPort | null = null,
  ) {}

  async replicate(
    request: SunsetStoryDynamicReplicationRequest,
  ): Promise<SunsetStoryDynamicReplicationResult> {
    const selection = await this.selector.select({
      assetId: request.assetId,
      imageBytes: request.imageBytes,
      intent: request.intent,
      ...(request.history ? { history: request.history } : {}),
    });
    const templateId = selection.selection.selectedTemplateId;
    if (!templateId) throw new Error('SUNSET_DYNAMIC_REPLICATION_NO_SAFE_TEMPLATE');

    const candidate = selection.selection.candidates.find((item) => item.templateId === templateId);
    if (!candidate || candidate.hardRejected) {
      throw new Error('SUNSET_DYNAMIC_REPLICATION_SELECTED_CANDIDATE_INVALID');
    }

    const contract = await this.contractLoader.load(templateId);
    const proposal = await this.aiPlanner.plan({
      templateId,
      intent: request.intent,
      imageProfile: selection.profile,
      cropPlan: candidate.cropPlan,
      canonicalContract: contract,
      ...(request.referenceImageBytes ? { referenceImageBytes: request.referenceImageBytes } : {}),
    });
    const plan = validateSunsetStoryAiRenderPlan(
      proposal,
      contract,
      selection.profile,
      candidate.cropPlan,
    );
    const preview = await this.renderer.render({
      imageBytes: request.imageBytes,
      imageMimeType: request.imageMimeType,
      plan,
    });

    let qaResult: SunsetStoryVisualQaResult | null = null;
    let qaStatus: 'PASS' | 'FAIL' | 'PENDING' = 'PENDING';
    if (this.visualQa && request.referenceImageBytes) {
      qaResult = await this.visualQa.evaluate({
        templateId,
        referenceSha256: contract.referenceSha256,
        referenceImageBytes: request.referenceImageBytes,
        renderedBytes: preview.bytes,
        renderedMimeType: preview.mimeType,
      });
      qaStatus = visualQaStatus(qaResult);
    }

    return {
      selection,
      templateId,
      profile: selection.profile,
      plan,
      preview,
      visualQa: qaResult,
      visualQaStatus: qaStatus,
      storyReady: false,
      publicationEligible: false,
    };
  }
}
