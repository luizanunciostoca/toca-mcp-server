import type { WorkflowBlueprint, WorkflowStepBlueprint } from '../workflow/workflow-contracts.js';
import {
  requireEvidence,
  requireText,
  validateAccessibility,
  validateRights,
  type AccessibilityCheck,
  type ContentItemFormat,
  type ContentValidationStatus,
  type RightsCheck,
} from './content-item.js';

export const VIDEO_OUTPUT_TYPES = ['REEL', 'STORY'] as const;
export type VideoOutputType = (typeof VIDEO_OUTPUT_TYPES)[number];

export interface VideoBrief {
  readonly briefId: string;
  readonly contentItemId: string;
  readonly versionId: string;
  readonly objective: string;
  readonly outputType: VideoOutputType;
  readonly durationMs: number;
  readonly width: number;
  readonly height: number;
  readonly language: string;
  readonly sourceAssetIds: readonly string[];
  readonly masterAssetIds: readonly string[];
  readonly eventId: string | null;
  readonly brandRefs: readonly string[];
  readonly factRefs: readonly string[];
  readonly rightsRefs: readonly string[];
  readonly evidence: readonly string[];
}

export interface StoryboardScene {
  readonly sceneId: string;
  readonly order: number;
  readonly purpose: string;
  readonly visualIntent: string;
  readonly durationMs: number;
  readonly sourceAssetId: string | null;
  readonly onScreenText: string | null;
}

export interface ScriptSegment {
  readonly segmentId: string;
  readonly order: number;
  readonly spokenText: string;
  readonly onScreenText: string | null;
  readonly durationMs: number;
  readonly factRefs: readonly string[];
}

export interface SelectedVideoAsset {
  readonly assetId: string;
  readonly sourceAssetId: string;
  readonly masterAssetId: string | null;
  readonly masterAvailable: boolean;
  readonly rightsStatus: ContentValidationStatus;
  readonly fitnessScore: number;
  readonly selectionRationale: string;
}

export interface VideoClip {
  readonly clipId: string;
  readonly assetId: string;
  readonly sourceAssetId: string;
  readonly timelineStartMs: number;
  readonly timelineEndMs: number;
  readonly sourceInMs: number;
  readonly sourceOutMs: number;
}

export interface VideoOverlay {
  readonly overlayId: string;
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface VideoTimeline {
  readonly timelineId: string;
  readonly contentItemId: string;
  readonly versionId: string;
  readonly durationMs: number;
  readonly width: number;
  readonly height: number;
  readonly clips: readonly VideoClip[];
  readonly overlays: readonly VideoOverlay[];
  readonly evidence: readonly string[];
}

export interface SubtitleCue {
  readonly cueId: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
  readonly speaker: string | null;
}

export interface SubtitleTrack {
  readonly trackId: string;
  readonly language: string;
  readonly cues: readonly SubtitleCue[];
  readonly evidence: readonly string[];
}

export interface AudioNormalizationResult {
  readonly targetLufs: number;
  readonly measuredLufs: number;
  readonly truePeakDbtp: number;
  readonly clippingDetected: boolean;
  readonly normalizedArtifactRef: string;
  readonly evidence: readonly string[];
}

export interface MusicRightsInput {
  readonly musicAssetId: string;
  readonly rights: RightsCheck;
  readonly territory: string;
  readonly intendedUse: string;
}

export interface SafeAreaPolicy {
  readonly topPx: number;
  readonly rightPx: number;
  readonly bottomPx: number;
  readonly leftPx: number;
}

export interface SafeAreaValidationResult {
  readonly status: ContentValidationStatus;
  readonly violations: readonly string[];
}

export interface DurationPolicy {
  readonly minimumMs: number;
  readonly maximumMs: number;
}

export interface VideoGateResult {
  readonly gate: string;
  readonly status: ContentValidationStatus;
  readonly issues: readonly string[];
  readonly evidence: readonly string[];
}

export interface VideoQualityResult {
  readonly status: ContentValidationStatus;
  readonly hardFailures: readonly string[];
  readonly reviewItems: readonly string[];
  readonly gates: readonly VideoGateResult[];
}

export interface VideoExportManifest {
  readonly exportId: string;
  readonly outputType: VideoOutputType;
  readonly contentItemId: string;
  readonly versionId: string;
  readonly lineageRootVersionId: string;
  readonly sourceAssetIds: readonly string[];
  readonly derivedAssetId: string;
  readonly artifactRef: string;
  readonly width: number;
  readonly height: number;
  readonly durationMs: number;
  readonly approvalRef: string;
  readonly quality: VideoQualityResult;
  readonly evidence: readonly string[];
}

export function validateVideoBrief(brief: VideoBrief): void {
  requireText(brief.briefId, 'VIDEO_BRIEF_ID_REQUIRED');
  requireText(brief.contentItemId, 'VIDEO_CONTENT_ITEM_ID_REQUIRED');
  requireText(brief.versionId, 'VIDEO_VERSION_ID_REQUIRED');
  requireText(brief.objective, 'VIDEO_OBJECTIVE_REQUIRED');
  requireText(brief.language, 'VIDEO_LANGUAGE_REQUIRED');
  requireEvidence(brief.evidence);
  if (!VIDEO_OUTPUT_TYPES.includes(brief.outputType)) throw new Error('VIDEO_OUTPUT_TYPE_INVALID');
  if (!Number.isInteger(brief.durationMs) || brief.durationMs <= 0)
    throw new Error('VIDEO_DURATION_INVALID');
  if (!Number.isInteger(brief.width) || !Number.isInteger(brief.height) || brief.width <= 0 || brief.height <= 0)
    throw new Error('VIDEO_DIMENSIONS_INVALID');
  if (brief.width >= brief.height) throw new Error('VIDEO_VERTICAL_FORMAT_REQUIRED');
  if (brief.sourceAssetIds.length === 0) throw new Error('VIDEO_SOURCE_ASSET_REQUIRED');
  for (const assetId of brief.sourceAssetIds) requireText(assetId, 'VIDEO_SOURCE_ASSET_INVALID');
  for (const assetId of brief.masterAssetIds) requireText(assetId, 'VIDEO_MASTER_ASSET_INVALID');
  for (const ref of brief.brandRefs) requireText(ref, 'VIDEO_BRAND_REF_INVALID');
  for (const ref of brief.factRefs) requireText(ref, 'VIDEO_FACT_REF_INVALID');
  for (const ref of brief.rightsRefs) requireText(ref, 'VIDEO_RIGHTS_REF_INVALID');
}

export function validateStoryboard(scenes: readonly StoryboardScene[], targetDurationMs: number): void {
  if (scenes.length === 0) throw new Error('VIDEO_STORYBOARD_EMPTY');
  const orders = new Set<number>();
  let total = 0;
  for (const scene of scenes) {
    requireText(scene.sceneId, 'VIDEO_SCENE_ID_REQUIRED');
    requireText(scene.purpose, 'VIDEO_SCENE_PURPOSE_REQUIRED');
    requireText(scene.visualIntent, 'VIDEO_SCENE_VISUAL_INTENT_REQUIRED');
    if (!Number.isInteger(scene.order) || scene.order < 1 || orders.has(scene.order))
      throw new Error('VIDEO_SCENE_ORDER_INVALID');
    orders.add(scene.order);
    if (!Number.isInteger(scene.durationMs) || scene.durationMs <= 0)
      throw new Error('VIDEO_SCENE_DURATION_INVALID');
    if (scene.sourceAssetId !== null)
      requireText(scene.sourceAssetId, 'VIDEO_SCENE_SOURCE_ASSET_INVALID');
    total += scene.durationMs;
  }
  if (total !== targetDurationMs) throw new Error('VIDEO_STORYBOARD_DURATION_MISMATCH');
}

export function validateScript(segments: readonly ScriptSegment[], targetDurationMs: number): void {
  if (segments.length === 0) throw new Error('VIDEO_SCRIPT_EMPTY');
  const orders = new Set<number>();
  let total = 0;
  for (const segment of segments) {
    requireText(segment.segmentId, 'VIDEO_SCRIPT_SEGMENT_ID_REQUIRED');
    requireText(segment.spokenText, 'VIDEO_SCRIPT_TEXT_REQUIRED');
    if (!Number.isInteger(segment.order) || segment.order < 1 || orders.has(segment.order))
      throw new Error('VIDEO_SCRIPT_ORDER_INVALID');
    orders.add(segment.order);
    if (!Number.isInteger(segment.durationMs) || segment.durationMs <= 0)
      throw new Error('VIDEO_SCRIPT_DURATION_INVALID');
    for (const ref of segment.factRefs) requireText(ref, 'VIDEO_SCRIPT_FACT_REF_INVALID');
    total += segment.durationMs;
  }
  if (total > targetDurationMs) throw new Error('VIDEO_SCRIPT_EXCEEDS_DURATION');
}

export function validateSelectedVideoAssets(assets: readonly SelectedVideoAsset[]): void {
  if (assets.length === 0) throw new Error('VIDEO_ASSET_SELECTION_EMPTY');
  for (const asset of assets) {
    requireText(asset.assetId, 'VIDEO_ASSET_ID_REQUIRED');
    requireText(asset.sourceAssetId, 'VIDEO_SOURCE_ASSET_ID_REQUIRED');
    requireText(asset.selectionRationale, 'VIDEO_ASSET_SELECTION_RATIONALE_REQUIRED');
    if (asset.masterAvailable && asset.masterAssetId === null)
      throw new Error('VIDEO_MARKETING_MASTER_REQUIRED');
    if (asset.masterAssetId !== null)
      requireText(asset.masterAssetId, 'VIDEO_MASTER_ASSET_ID_INVALID');
    if (!Number.isFinite(asset.fitnessScore) || asset.fitnessScore < 0 || asset.fitnessScore > 100)
      throw new Error('VIDEO_ASSET_FITNESS_SCORE_INVALID');
    if (asset.rightsStatus !== 'PASS') throw new Error('VIDEO_ASSET_RIGHTS_NOT_CLEARED');
  }
}

export function validateTimeline(timeline: VideoTimeline): void {
  requireText(timeline.timelineId, 'VIDEO_TIMELINE_ID_REQUIRED');
  requireText(timeline.contentItemId, 'VIDEO_TIMELINE_CONTENT_ITEM_REQUIRED');
  requireText(timeline.versionId, 'VIDEO_TIMELINE_VERSION_REQUIRED');
  requireEvidence(timeline.evidence);
  if (!Number.isInteger(timeline.durationMs) || timeline.durationMs <= 0)
    throw new Error('VIDEO_TIMELINE_DURATION_INVALID');
  if (!Number.isInteger(timeline.width) || !Number.isInteger(timeline.height) || timeline.width <= 0 || timeline.height <= 0)
    throw new Error('VIDEO_TIMELINE_DIMENSIONS_INVALID');
  if (timeline.clips.length === 0) throw new Error('VIDEO_TIMELINE_CLIP_REQUIRED');
  for (const clip of timeline.clips) {
    requireText(clip.clipId, 'VIDEO_CLIP_ID_REQUIRED');
    requireText(clip.assetId, 'VIDEO_CLIP_ASSET_ID_REQUIRED');
    requireText(clip.sourceAssetId, 'VIDEO_CLIP_SOURCE_ASSET_ID_REQUIRED');
    if (clip.timelineStartMs < 0 || clip.timelineEndMs <= clip.timelineStartMs)
      throw new Error('VIDEO_CLIP_TIMELINE_RANGE_INVALID');
    if (clip.sourceInMs < 0 || clip.sourceOutMs <= clip.sourceInMs)
      throw new Error('VIDEO_CLIP_SOURCE_RANGE_INVALID');
    if (clip.timelineEndMs > timeline.durationMs) throw new Error('VIDEO_CLIP_EXCEEDS_TIMELINE');
  }
  for (const overlay of timeline.overlays) {
    requireText(overlay.overlayId, 'VIDEO_OVERLAY_ID_REQUIRED');
    requireText(overlay.text, 'VIDEO_OVERLAY_TEXT_REQUIRED');
    if (overlay.startMs < 0 || overlay.endMs <= overlay.startMs || overlay.endMs > timeline.durationMs)
      throw new Error('VIDEO_OVERLAY_RANGE_INVALID');
    if (overlay.width <= 0 || overlay.height <= 0) throw new Error('VIDEO_OVERLAY_DIMENSIONS_INVALID');
  }
}

export function validateSubtitleTrack(track: SubtitleTrack, durationMs: number): void {
  requireText(track.trackId, 'VIDEO_SUBTITLE_TRACK_ID_REQUIRED');
  requireText(track.language, 'VIDEO_SUBTITLE_LANGUAGE_REQUIRED');
  requireEvidence(track.evidence);
  let previousEnd = 0;
  for (const cue of track.cues) {
    requireText(cue.cueId, 'VIDEO_SUBTITLE_CUE_ID_REQUIRED');
    requireText(cue.text, 'VIDEO_SUBTITLE_TEXT_REQUIRED');
    if (cue.startMs < previousEnd || cue.endMs <= cue.startMs || cue.endMs > durationMs)
      throw new Error('VIDEO_SUBTITLE_RANGE_INVALID');
    previousEnd = cue.endMs;
  }
}

export function validateAudioNormalization(result: AudioNormalizationResult): ContentValidationStatus {
  requireText(result.normalizedArtifactRef, 'VIDEO_AUDIO_ARTIFACT_REF_REQUIRED');
  requireEvidence(result.evidence);
  if (![result.targetLufs, result.measuredLufs, result.truePeakDbtp].every(Number.isFinite))
    throw new Error('VIDEO_AUDIO_MEASUREMENT_INVALID');
  if (result.clippingDetected) return 'FAIL';
  return Math.abs(result.measuredLufs - result.targetLufs) <= 1 ? 'PASS' : 'REVIEW_REQUIRED';
}

export function validateMusicRights(input: MusicRightsInput, now?: string): ContentValidationStatus {
  requireText(input.musicAssetId, 'VIDEO_MUSIC_ASSET_ID_REQUIRED');
  requireText(input.territory, 'VIDEO_MUSIC_TERRITORY_REQUIRED');
  requireText(input.intendedUse, 'VIDEO_MUSIC_INTENDED_USE_REQUIRED');
  if (input.rights.assetId !== input.musicAssetId) throw new Error('VIDEO_MUSIC_RIGHTS_ASSET_MISMATCH');
  return validateRights([input.rights], now);
}

export function validateSafeArea(
  timeline: VideoTimeline,
  policy: SafeAreaPolicy,
): SafeAreaValidationResult {
  validateTimeline(timeline);
  const values = [policy.topPx, policy.rightPx, policy.bottomPx, policy.leftPx];
  if (!values.every((value) => Number.isInteger(value) && value >= 0))
    throw new Error('VIDEO_SAFE_AREA_POLICY_INVALID');
  const left = policy.leftPx;
  const top = policy.topPx;
  const right = timeline.width - policy.rightPx;
  const bottom = timeline.height - policy.bottomPx;
  if (right <= left || bottom <= top) throw new Error('VIDEO_SAFE_AREA_POLICY_EXCEEDS_FRAME');
  const violations: string[] = [];
  for (const overlay of timeline.overlays) {
    if (
      overlay.x < left ||
      overlay.y < top ||
      overlay.x + overlay.width > right ||
      overlay.y + overlay.height > bottom
    ) {
      violations.push(overlay.overlayId);
    }
  }
  return { status: violations.length === 0 ? 'PASS' : 'FAIL', violations };
}

export function validateDuration(durationMs: number, policy: DurationPolicy): ContentValidationStatus {
  if (!Number.isInteger(durationMs) || durationMs <= 0) throw new Error('VIDEO_DURATION_INVALID');
  if (
    !Number.isInteger(policy.minimumMs) ||
    !Number.isInteger(policy.maximumMs) ||
    policy.minimumMs < 0 ||
    policy.maximumMs < policy.minimumMs
  ) {
    throw new Error('VIDEO_DURATION_POLICY_INVALID');
  }
  return durationMs >= policy.minimumMs && durationMs <= policy.maximumMs ? 'PASS' : 'FAIL';
}

export function validateVideoAccessibility(check: AccessibilityCheck): ContentValidationStatus {
  return validateAccessibility(check);
}

export function validateVideoQuality(gates: readonly VideoGateResult[]): VideoQualityResult {
  if (gates.length === 0) throw new Error('VIDEO_QUALITY_GATES_REQUIRED');
  const hardFailures: string[] = [];
  const reviewItems: string[] = [];
  for (const gate of gates) {
    requireText(gate.gate, 'VIDEO_QUALITY_GATE_NAME_REQUIRED');
    requireEvidence(gate.evidence);
    if (gate.status === 'FAIL') hardFailures.push(gate.gate, ...gate.issues);
    if (gate.status === 'REVIEW_REQUIRED') reviewItems.push(gate.gate, ...gate.issues);
  }
  return {
    status: hardFailures.length > 0 ? 'FAIL' : reviewItems.length > 0 ? 'REVIEW_REQUIRED' : 'PASS',
    hardFailures,
    reviewItems,
    gates,
  };
}

export function validateExportManifest(manifest: VideoExportManifest): void {
  requireText(manifest.exportId, 'VIDEO_EXPORT_ID_REQUIRED');
  requireText(manifest.contentItemId, 'VIDEO_EXPORT_CONTENT_ITEM_REQUIRED');
  requireText(manifest.versionId, 'VIDEO_EXPORT_VERSION_REQUIRED');
  requireText(manifest.lineageRootVersionId, 'VIDEO_EXPORT_LINEAGE_ROOT_REQUIRED');
  requireText(manifest.derivedAssetId, 'VIDEO_EXPORT_DERIVED_ASSET_REQUIRED');
  requireText(manifest.artifactRef, 'VIDEO_EXPORT_ARTIFACT_REF_REQUIRED');
  requireText(manifest.approvalRef, 'VIDEO_EXPORT_APPROVAL_REF_REQUIRED');
  requireEvidence(manifest.evidence);
  if (manifest.sourceAssetIds.length === 0) throw new Error('VIDEO_EXPORT_SOURCE_ASSET_REQUIRED');
  if (manifest.quality.status !== 'PASS') throw new Error('VIDEO_EXPORT_QUALITY_NOT_PASSED');
  if (manifest.width <= 0 || manifest.height <= 0 || manifest.durationMs <= 0)
    throw new Error('VIDEO_EXPORT_MEDIA_METADATA_INVALID');
}

export interface VideoWorkflowInput {
  readonly workflowId: string;
  readonly definitionVersion: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly requesterPrincipalId: string;
  readonly contentItemId: string;
  readonly versionId: string;
  readonly outputType: VideoOutputType;
  readonly sourceFormat: ContentItemFormat;
}

export function buildVideoProductionWorkflowBlueprint(input: VideoWorkflowInput): WorkflowBlueprint {
  requireText(input.contentItemId, 'VIDEO_WORKFLOW_CONTENT_ITEM_REQUIRED');
  requireText(input.versionId, 'VIDEO_WORKFLOW_VERSION_REQUIRED');
  const steps: WorkflowStepBlueprint[] = [
    step('brief', 'Create video brief', 'video.brief.create'),
    step('storyboard', 'Generate storyboard', 'video.storyboard.generate', ['brief']),
    step('script', 'Generate script', 'video.script.generate', ['brief']),
    step('assets', 'Select lineage-safe assets', 'video.asset.select', ['storyboard']),
    step('timeline', 'Compose timeline manifest', 'video.timeline.compose', ['assets', 'script']),
    step('subtitles', 'Generate subtitle track', 'video.subtitle.generate', ['timeline']),
    step('captions', 'Embed caption manifest', 'video.caption.embed', ['subtitles']),
    step('audio', 'Normalize audio manifest', 'video.audio.normalize', ['timeline']),
    step('music-rights', 'Validate music rights', 'video.music_rights.validate', ['timeline']),
    step('safe-area', 'Validate safe area', 'video.safe_area.validate', ['timeline']),
    step('duration', 'Validate duration', 'video.duration.validate', ['timeline']),
    step('facts', 'Validate facts', 'content_item.fact.validate', ['script']),
    step('rights', 'Validate content rights', 'content_item.rights.validate', ['assets']),
    step('accessibility', 'Validate accessibility', 'content_item.accessibility.validate', [
      'captions',
      'audio',
    ]),
    step('thumbnail', 'Generate thumbnail manifest', 'video.thumbnail.generate', ['timeline']),
    step(
      'quality',
      'Validate final video quality',
      'video.quality.validate',
      ['music-rights', 'safe-area', 'duration', 'facts', 'rights', 'accessibility', 'thumbnail'],
    ),
    step('approval', 'Verify existing approval', 'approval.verify', ['quality']),
    step(
      'export',
      input.outputType === 'REEL' ? 'Export Reel artifact' : 'Export Story artifact',
      input.outputType === 'REEL' ? 'video.export.reel' : 'video.export.story',
      ['approval'],
    ),
  ];

  return {
    workflowId: input.workflowId,
    routeId: 'R20',
    definitionId: 'video-short-form-production',
    definitionVersion: input.definitionVersion,
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    organizationId: input.organizationId,
    requesterPrincipalId: input.requesterPrincipalId,
    input: {
      contentItemId: input.contentItemId,
      versionId: input.versionId,
      outputType: input.outputType,
      sourceFormat: input.sourceFormat,
    },
    steps,
  };
}

function step(
  stepId: string,
  name: string,
  capabilityId: string,
  dependsOn: readonly string[] = [],
): WorkflowStepBlueprint {
  return { stepId, name, capabilityId, maxAttempts: 1, dependsOn };
}
