import { createHash } from 'node:crypto';
import {
  TOCA_PHOTO_TO_VIDEO_POLICY_ID,
  type PhotoToVideoOutputType,
  type PhotoToVideoRouteType,
  type PhotoToVideoSourceRights,
  type PhotoToVideoStandard,
  type ProductVideoPolicy,
  type SceneContinuationApproval,
} from '../contracts/photo-to-video.js';
import { TOCA_CREATIVE_TRUTH_POLICY_ID, type VenueAsset } from '../contracts/creative-truth.js';
import { ExecutionError } from '../core/errors.js';
import {
  buildVideoProductionWorkflowBlueprint,
  validateSubtitleTrack,
  type SelectedVideoAsset,
  type StoryboardScene,
  type SubtitleCue,
  type VideoWorkflowInput,
} from '../content/video.js';
import type { WorkflowBlueprint } from '../workflow/workflow-contracts.js';

const APPROVED_RIGHTS = new Set(['OWNED', 'LICENSED', 'CLEARED', 'RIGHTS_CLEARED']);
const RETRYABLE_RENDER_CAPABILITIES = new Set([
  'video.storyboard.generate',
  'video.script.generate',
  'video.asset.select',
  'video.timeline.compose',
  'video.subtitle.generate',
  'video.caption.embed',
  'video.audio.normalize',
  'video.thumbnail.generate',
  'video.export.reel',
  'video.export.story',
]);

export const VIDEO_AUTOMATION_RENDER_MAX_ATTEMPTS = 3 as const;

export interface VideoAutomationContentContext {
  readonly contentItemId: string;
  readonly productId: string;
  readonly operation: string;
  readonly outputType: PhotoToVideoOutputType;
  readonly inheritedVisualStandardId: string;
  readonly sourceAssetId: string;
}

export interface VideoAutomationCanonicalContext {
  readonly content: VideoAutomationContentContext;
  readonly productPolicy: ProductVideoPolicy;
  readonly standard: PhotoToVideoStandard;
  readonly venueAsset: VenueAsset;
  readonly rights: PhotoToVideoSourceRights;
  readonly approval?: SceneContinuationApproval;
}

export interface VideoAutomationCopy {
  readonly headline?: string;
  readonly cta?: string;
  readonly caption?: string;
  readonly subtitles?: readonly SubtitleCue[];
}

export interface VideoAutomationTemplateBinding {
  readonly templateId: string;
  readonly templateVersion: string;
  readonly inheritedVisualStandardId: string;
  readonly operation: string;
  readonly outputType: PhotoToVideoOutputType;
  readonly width: number;
  readonly height: number;
  readonly aspectRatio: string;
  readonly durationMs: number;
  readonly motionPreset: PhotoToVideoStandard['motionPreset'];
  readonly brandPosition: PhotoToVideoStandard['brandPosition'];
  readonly heroBrand: string;
  readonly heroBrandVariant: string;
  readonly typographyMode: 'HASH_BOUND_RASTER_OVERLAY_ONLY';
  readonly exactAssetBindingRequired: true;
}

export interface VideoAutomationRenderPolicy {
  readonly queue: 'EXISTING_WORKFLOW_STORE';
  readonly routeId: 'R20';
  readonly retryMode: 'WORKFLOW_STEP_MAX_ATTEMPTS';
  readonly maxAttempts: typeof VIDEO_AUTOMATION_RENDER_MAX_ATTEMPTS;
  readonly cacheMode: 'PERSISTED_ARTIFACT_IDEMPOTENCY_REUSE';
  readonly cacheKey: string;
}

export interface VideoAutomationPlan {
  readonly schemaVersion: 1;
  readonly parentPolicyId: typeof TOCA_CREATIVE_TRUTH_POLICY_ID;
  readonly policyId: typeof TOCA_PHOTO_TO_VIDEO_POLICY_ID;
  readonly contentItemId: string;
  readonly productId: string;
  readonly operation: string;
  readonly outputType: PhotoToVideoOutputType;
  readonly routeType: PhotoToVideoRouteType;
  readonly template: VideoAutomationTemplateBinding;
  readonly sourceLineage: {
    readonly sourceAssetId: string;
    readonly sourceDriveFileId: string;
    readonly sourceSha256?: string;
    readonly masterAssetId: string;
    readonly masterDriveFileId: string;
    readonly masterSha256: string;
    readonly rightsEvidenceRef: string;
    readonly rightsValidatedAt: string;
  };
  readonly storyboard: readonly StoryboardScene[];
  readonly shotSelection: readonly SelectedVideoAsset[];
  readonly copy: {
    readonly headline: string | null;
    readonly cta: string | null;
    readonly caption: string | null;
    readonly subtitles: readonly SubtitleCue[];
  };
  readonly overlayRoles: readonly ('HEADLINE' | 'CTA' | 'SUBTITLE')[];
  readonly render: VideoAutomationRenderPolicy;
  readonly qualityGates: readonly string[];
  readonly approvalRequired: true;
  readonly publicationAuthorized: false;
  readonly planSha256: string;
}

export interface BuildVideoAutomationPlanInput {
  readonly context: VideoAutomationCanonicalContext;
  readonly routeType: PhotoToVideoRouteType;
  readonly copy?: VideoAutomationCopy;
}

export function buildCanonicalVideoAutomationPlan(
  input: BuildVideoAutomationPlanInput,
): VideoAutomationPlan {
  assertCanonicalContext(input.context, input.routeType);
  const { content, productPolicy, rights, standard, venueAsset } = input.context;
  const [width, height] = standard.size.split('x').map(Number) as [number, number];
  const durationMs = standard.seconds * 1000;
  const copy = normalizeCopy(input.copy, durationMs);
  const storyboard: readonly StoryboardScene[] = [
    {
      sceneId: `${content.contentItemId}:scene:1`,
      order: 1,
      purpose:
        input.routeType === 'REAL_PHOTO_TO_MOTION_VIDEO'
          ? 'Animate the canonical marketing-ready photograph without semantic generation.'
          : 'Continue the canonical source-anchored scene under the explicit approved exception.',
      visualIntent:
        input.routeType === 'REAL_PHOTO_TO_MOTION_VIDEO'
          ? 'MOTION_FROM_PHOTO'
          : 'SCENE_CONTINUATION',
      durationMs,
      sourceAssetId: content.sourceAssetId,
      onScreenText: copy.headline,
    },
  ];
  const shotSelection: readonly SelectedVideoAsset[] = [
    {
      assetId: venueAsset.masterAssetId!,
      sourceAssetId: venueAsset.sourceAssetId,
      masterAssetId: venueAsset.masterAssetId!,
      masterAvailable: true,
      rightsStatus: 'PASS',
      fitnessScore: 100,
      selectionRationale: 'CANONICAL_MARKETING_READY_MASTER_EXACT_LINEAGE',
    },
  ];
  const overlayRoles = [
    ...(copy.headline ? (['HEADLINE'] as const) : []),
    ...(copy.cta ? (['CTA'] as const) : []),
    ...(copy.subtitles.length > 0 ? (['SUBTITLE'] as const) : []),
  ];
  const cacheSeed = {
    policyId: TOCA_PHOTO_TO_VIDEO_POLICY_ID,
    contentItemId: content.contentItemId,
    productId: content.productId,
    operation: content.operation,
    outputType: content.outputType,
    routeType: input.routeType,
    standardId: standard.standardId,
    standardVersion: standard.version,
    inheritedVisualStandardId: content.inheritedVisualStandardId,
    masterAssetId: venueAsset.masterAssetId!,
    masterSha256: venueAsset.masterSha256!.toLowerCase(),
    rightsEvidenceRef: rights.evidenceRef,
    heroBrand: productPolicy.heroBrand,
    heroBrandVariant: productPolicy.heroBrandVariant,
    brandPosition: standard.brandPosition,
    motionPreset: standard.motionPreset,
    size: standard.size,
    seconds: standard.seconds,
    copy,
  };
  const cacheKey = sha256(canonicalJson(cacheSeed));

  const planWithoutHash = {
    schemaVersion: 1 as const,
    parentPolicyId: TOCA_CREATIVE_TRUTH_POLICY_ID,
    policyId: TOCA_PHOTO_TO_VIDEO_POLICY_ID,
    contentItemId: content.contentItemId,
    productId: content.productId,
    operation: content.operation,
    outputType: content.outputType,
    routeType: input.routeType,
    template: {
      templateId: standard.standardId,
      templateVersion: standard.version,
      inheritedVisualStandardId: content.inheritedVisualStandardId,
      operation: content.operation,
      outputType: content.outputType,
      width,
      height,
      aspectRatio: simplifyRatio(width, height),
      durationMs,
      motionPreset: standard.motionPreset,
      brandPosition: standard.brandPosition,
      heroBrand: productPolicy.heroBrand,
      heroBrandVariant: productPolicy.heroBrandVariant,
      typographyMode: 'HASH_BOUND_RASTER_OVERLAY_ONLY' as const,
      exactAssetBindingRequired: true as const,
    },
    sourceLineage: {
      sourceAssetId: venueAsset.sourceAssetId,
      sourceDriveFileId: venueAsset.sourceDriveFileId,
      ...(venueAsset.sourceSha256 ? { sourceSha256: venueAsset.sourceSha256.toLowerCase() } : {}),
      masterAssetId: venueAsset.masterAssetId!,
      masterDriveFileId: venueAsset.masterDriveFileId!,
      masterSha256: venueAsset.masterSha256!.toLowerCase(),
      rightsEvidenceRef: rights.evidenceRef,
      rightsValidatedAt: rights.validatedAt,
    },
    storyboard,
    shotSelection,
    copy,
    overlayRoles,
    render: {
      queue: 'EXISTING_WORKFLOW_STORE' as const,
      routeId: 'R20' as const,
      retryMode: 'WORKFLOW_STEP_MAX_ATTEMPTS' as const,
      maxAttempts: VIDEO_AUTOMATION_RENDER_MAX_ATTEMPTS,
      cacheMode: 'PERSISTED_ARTIFACT_IDEMPOTENCY_REUSE' as const,
      cacheKey,
    },
    qualityGates: [
      'SOURCE_LINEAGE',
      'RIGHTS',
      'VENUE_FIDELITY',
      'BRAND_INTEGRITY',
      'SAFE_AREA',
      'DURATION',
      'ACCESSIBILITY',
      'QUALITY',
      ...(input.routeType === 'GENERATIVE_SCENE_CONTINUATION_VIDEO'
        ? ['SCENE_CONTINUATION_FIDELITY']
        : []),
      'APPROVAL',
    ],
    approvalRequired: true as const,
    publicationAuthorized: false as const,
  };

  return {
    ...planWithoutHash,
    planSha256: sha256(canonicalJson(planWithoutHash)),
  };
}

export function buildVideoAutomationWorkflowBlueprint(
  input: VideoWorkflowInput,
  plan: VideoAutomationPlan,
): WorkflowBlueprint {
  if (
    plan.contentItemId !== input.contentItemId ||
    plan.outputType !== input.outputType ||
    plan.render.routeId !== 'R20'
  ) {
    throw new ExecutionError(
      'SOURCE_IMAGE_BINDING_FAILURE',
      'VIDEO_AUTOMATION_WORKFLOW_BINDING_MISMATCH',
      false,
    );
  }
  const base = buildVideoProductionWorkflowBlueprint(input);
  return {
    ...base,
    input: {
      contentItemId: input.contentItemId,
      versionId: input.versionId,
      outputType: input.outputType,
      sourceFormat: input.sourceFormat,
      videoAutomationPlanSha256: plan.planSha256,
      renderCacheKey: plan.render.cacheKey,
      renderQueue: plan.render.queue,
      publicationAuthorized: false,
    },
    steps: base.steps.map((step) => ({
      ...step,
      maxAttempts:
        step.capabilityId && RETRYABLE_RENDER_CAPABILITIES.has(step.capabilityId)
          ? VIDEO_AUTOMATION_RENDER_MAX_ATTEMPTS
          : 1,
    })),
  };
}

function assertCanonicalContext(
  context: VideoAutomationCanonicalContext,
  routeType: PhotoToVideoRouteType,
): void {
  const { content, productPolicy, rights, standard, venueAsset } = context;
  if (
    standard.routeType !== routeType ||
    standard.productId !== content.productId ||
    standard.operation !== content.operation ||
    standard.outputType !== content.outputType ||
    standard.status !== 'ACTIVE_CANONICAL' ||
    !standard.inheritsContentVisualStandard ||
    !standard.exactAssetBindingRequired ||
    productPolicy.productId !== content.productId ||
    productPolicy.operation !== content.operation ||
    productPolicy.status !== 'ACTIVE'
  ) {
    deny('VIDEO_AUTOMATION_CANONICAL_TEMPLATE_MISMATCH');
  }
  if (
    venueAsset.sourceAssetId !== content.sourceAssetId ||
    venueAsset.operation !== content.operation ||
    venueAsset.status !== 'ACTIVE_APPROVED' ||
    !venueAsset.venueVerified ||
    !venueAsset.marketingReady ||
    !venueAsset.masterAssetId ||
    !venueAsset.masterDriveFileId ||
    !venueAsset.masterSha256
  ) {
    deny('VIDEO_AUTOMATION_MARKETING_READY_SOURCE_REQUIRED');
  }
  if (
    rights.sourceAssetId !== content.sourceAssetId ||
    rights.operation !== content.operation ||
    rights.status !== 'ACTIVE' ||
    !APPROVED_RIGHTS.has(rights.rightsStatus) ||
    !rights.evidenceRef.trim() ||
    !rights.validatedAt.trim()
  ) {
    deny('VIDEO_AUTOMATION_RIGHTS_NOT_CLEARED');
  }
  const requiredUse =
    routeType === 'REAL_PHOTO_TO_MOTION_VIDEO' ? 'PHOTO_TO_MOTION' : 'SCENE_CONTINUATION';
  if (!rights.approvedUses.includes(requiredUse)) {
    deny('VIDEO_AUTOMATION_SOURCE_USE_NOT_APPROVED');
  }
  if (
    !productPolicy.heroBrand.trim() ||
    !productPolicy.heroBrandVariant.trim() ||
    (routeType === 'REAL_PHOTO_TO_MOTION_VIDEO' && !productPolicy.photoMotionAllowed) ||
    (routeType === 'GENERATIVE_SCENE_CONTINUATION_VIDEO' && !productPolicy.sceneContinuationAllowed)
  ) {
    deny('VIDEO_AUTOMATION_PRODUCT_POLICY_BLOCKED');
  }

  if (routeType === 'GENERATIVE_SCENE_CONTINUATION_VIDEO') {
    const approval = context.approval;
    const masterSha = venueAsset.masterSha256.toLowerCase();
    if (
      !approval ||
      approval.contentItemId !== content.contentItemId ||
      approval.productId !== content.productId ||
      approval.operation !== content.operation ||
      approval.sourceAssetId !== content.sourceAssetId ||
      approval.sourceSha256.toLowerCase() !== masterSha ||
      approval.status !== 'APPROVED' ||
      !approval.allowSceneContinuation ||
      approval.allowArchitecturalInvention ||
      approval.allowAiLogoGeneration ||
      (rights.containsPeople &&
        (!approval.peopleConsentConfirmed || rights.likenessConsentStatus !== 'CONFIRMED'))
    ) {
      throw new ExecutionError(
        'APPROVAL_REQUIRED',
        'VIDEO_AUTOMATION_SCENE_CONTINUATION_APPROVAL_REQUIRED',
        false,
      );
    }
  }
}

function normalizeCopy(
  input: VideoAutomationCopy | undefined,
  durationMs: number,
): VideoAutomationPlan['copy'] {
  const headline = optionalText(input?.headline, 90, 'VIDEO_AUTOMATION_HEADLINE_TOO_LONG');
  const cta = optionalText(input?.cta, 60, 'VIDEO_AUTOMATION_CTA_TOO_LONG');
  const caption = optionalText(input?.caption, 2200, 'VIDEO_AUTOMATION_CAPTION_TOO_LONG');
  const subtitles = [...(input?.subtitles ?? [])];
  if (subtitles.length > 0) {
    validateSubtitleTrack(
      {
        trackId: 'video-automation-subtitles',
        language: 'pt-BR',
        cues: subtitles,
        evidence: ['video-automation:caller-subtitle-track'],
      },
      durationMs,
    );
  }
  return { headline, cta, caption, subtitles };
}

function optionalText(value: string | undefined, max: number, error: string): string | null {
  const normalized = value?.trim() ?? '';
  if (!normalized) return null;
  if (normalized.length > max) deny(error);
  return normalized;
}

function simplifyRatio(width: number, height: number): string {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    deny('VIDEO_AUTOMATION_DIMENSIONS_INVALID');
  }
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function gcd(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error('VIDEO_AUTOMATION_CANONICAL_JSON_INVALID');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  throw new Error(`VIDEO_AUTOMATION_CANONICAL_JSON_UNSUPPORTED:${typeof value}`);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function deny(message: string): never {
  throw new ExecutionError('POLICY_DENIED', message, false);
}
