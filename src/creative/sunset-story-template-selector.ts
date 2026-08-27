import type { SunsetStoryImageProfile, SunsetStoryZone } from './sunset-story-image-profile.js';
import { planSunsetStoryCrop, type SunsetStoryCropPlan } from './sunset-story-crop-planner.js';
import {
  SUNSET_STORY_TEMPLATE_REGISTRY,
  type SunsetStoryIntent,
  type SunsetStoryTemplateId,
  type SunsetStoryTemplateProfile,
} from './sunset-story-template-registry.js';

export const SUNSET_TEMPLATE_SELECTION_WEIGHTS = {
  subjectPreservation: 0.3,
  textSpaceCompatibility: 0.2,
  collisionClearance: 0.2,
  semanticCompatibility: 0.1,
  contrastReadability: 0.1,
  cropQuality: 0.05,
  antiRepeat: 0.05,
} as const;

export const SUNSET_TEMPLATE_SELECTION_THRESHOLDS = {
  autoSelectScore: 85,
  reviewScore: 70,
  minimumWinningMargin: 5,
  minimumCropFitness: 35,
  minimumSubjectCoverage: 0.78,
} as const;

export interface SunsetStorySelectionHistoryItem {
  readonly templateId: SunsetStoryTemplateId;
  readonly selectedAt: string;
  readonly approved: boolean;
}

export interface SunsetStoryScoreComponents {
  readonly subjectPreservation: number;
  readonly textSpaceCompatibility: number;
  readonly collisionClearance: number;
  readonly semanticCompatibility: number;
  readonly contrastReadability: number;
  readonly cropQuality: number;
  readonly antiRepeat: number;
}

export interface SunsetStoryTemplateCandidate {
  readonly templateId: SunsetStoryTemplateId;
  readonly templateClass: SunsetStoryTemplateProfile['templateClass'];
  readonly score: number;
  readonly hardRejected: boolean;
  readonly rejectionReasons: readonly string[];
  readonly components: SunsetStoryScoreComponents;
  readonly cropPlan: SunsetStoryCropPlan;
}

export type SunsetStorySelectionMode = 'AUTO_SELECT' | 'REVIEW_REQUIRED' | 'NO_SAFE_TEMPLATE';

export interface SunsetStoryTemplateSelection {
  readonly mode: SunsetStorySelectionMode;
  readonly selectedTemplateId: SunsetStoryTemplateId | null;
  readonly confidence: number;
  readonly winningMargin: number;
  readonly candidates: readonly SunsetStoryTemplateCandidate[];
}

export interface SunsetStoryTemplateSelectionRequest {
  readonly profile: SunsetStoryImageProfile;
  readonly intent: SunsetStoryIntent;
  readonly history?: readonly SunsetStorySelectionHistoryItem[];
}

function clampScore(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function textSpaceScore(
  template: SunsetStoryTemplateProfile,
  profile: SunsetStoryImageProfile,
): number {
  if (template.preferredTextSpaceZones.length === 0) return 100;
  if (profile.negativeSpaceZones.length === 0) return 60;
  const matches = template.preferredTextSpaceZones.filter((zone) =>
    profile.negativeSpaceZones.includes(zone),
  ).length;
  return 45 + (matches / template.preferredTextSpaceZones.length) * 55;
}

function semanticScore(
  template: SunsetStoryTemplateProfile,
  profile: SunsetStoryImageProfile,
  intent: SunsetStoryIntent,
): number {
  let score = 30;
  if (template.preferredScenes.includes(profile.sceneClass)) score += 35;
  const subjectKind = profile.primarySubject?.kind;
  if (subjectKind && template.preferredSubjectKinds.includes(subjectKind)) score += 20;
  if (!subjectKind && template.templateClass === 'SUNSET_VIEW_SCENERY') score += 20;
  if (template.intents.includes(intent)) score += 15;
  return clampScore(score);
}

function zoneLuma(
  regionLuma: SunsetStoryImageProfile['regionLuma'],
  zones: readonly SunsetStoryZone[],
): readonly number[] {
  const values: number[] = [];
  for (const zone of zones) {
    const value = regionLuma[zone];
    if (value !== undefined) values.push(value);
  }
  return values;
}

function contrastScore(
  template: SunsetStoryTemplateProfile,
  profile: SunsetStoryImageProfile,
): number {
  const values = zoneLuma(profile.regionLuma, template.preferredTextSpaceZones);
  if (values.length === 0) return 70;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (average <= 0.35) return 100;
  if (average <= 0.5) return 88;
  if (average <= 0.65) return 72;
  if (average <= 0.8) return 52;
  return 35;
}

function antiRepeatScore(
  templateId: SunsetStoryTemplateId,
  history: readonly SunsetStorySelectionHistoryItem[],
): number {
  if (history.length === 0) return 100;
  const ordered = [...history].sort(
    (left, right) => Date.parse(right.selectedAt) - Date.parse(left.selectedAt),
  );
  let penalty = 0;
  if (ordered[0]?.templateId === templateId) penalty += 30;
  const recentThree = ordered.slice(0, 3).filter((item) => item.templateId === templateId).length;
  penalty += Math.min(25, recentThree * 8);
  return clampScore(100 - penalty);
}

function weightedScore(components: SunsetStoryScoreComponents): number {
  const value =
    components.subjectPreservation * SUNSET_TEMPLATE_SELECTION_WEIGHTS.subjectPreservation +
    components.textSpaceCompatibility * SUNSET_TEMPLATE_SELECTION_WEIGHTS.textSpaceCompatibility +
    components.collisionClearance * SUNSET_TEMPLATE_SELECTION_WEIGHTS.collisionClearance +
    components.semanticCompatibility * SUNSET_TEMPLATE_SELECTION_WEIGHTS.semanticCompatibility +
    components.contrastReadability * SUNSET_TEMPLATE_SELECTION_WEIGHTS.contrastReadability +
    components.cropQuality * SUNSET_TEMPLATE_SELECTION_WEIGHTS.cropQuality +
    components.antiRepeat * SUNSET_TEMPLATE_SELECTION_WEIGHTS.antiRepeat;
  return roundScore(value);
}

function scoreTemplate(
  template: SunsetStoryTemplateProfile,
  request: SunsetStoryTemplateSelectionRequest,
): SunsetStoryTemplateCandidate {
  const history = request.history ?? [];
  const cropPlan = planSunsetStoryCrop(request.profile, template);
  const rejectionReasons: string[] = [];
  if (request.profile.crop9x16Fitness < SUNSET_TEMPLATE_SELECTION_THRESHOLDS.minimumCropFitness) {
    rejectionReasons.push('CROP_9X16_FITNESS_TOO_LOW');
  }
  if (
    request.profile.primarySubject &&
    cropPlan.subjectCoverage < SUNSET_TEMPLATE_SELECTION_THRESHOLDS.minimumSubjectCoverage
  ) {
    rejectionReasons.push('PRIMARY_SUBJECT_NOT_PRESERVED');
  }
  if (cropPlan.protectedOverlap > template.maxPrimarySubjectOverlap) {
    rejectionReasons.push('PRIMARY_SUBJECT_COLLIDES_WITH_PROTECTED_LAYOUT');
  }

  const components: SunsetStoryScoreComponents = {
    subjectPreservation: cropPlan.subjectCoverage * 100,
    textSpaceCompatibility: textSpaceScore(template, request.profile),
    collisionClearance: (1 - cropPlan.protectedOverlap) * 100,
    semanticCompatibility: semanticScore(template, request.profile, request.intent),
    contrastReadability: contrastScore(template, request.profile),
    cropQuality:
      request.profile.crop9x16Fitness * 0.6 + Math.min(100, cropPlan.planScore) * 0.4,
    antiRepeat: antiRepeatScore(template.templateId, history),
  };
  const hardRejected = rejectionReasons.length > 0;

  return {
    templateId: template.templateId,
    templateClass: template.templateClass,
    score: hardRejected ? 0 : weightedScore(components),
    hardRejected,
    rejectionReasons,
    components,
    cropPlan,
  };
}

export function rankSunsetStoryTemplates(
  request: SunsetStoryTemplateSelectionRequest,
): readonly SunsetStoryTemplateCandidate[] {
  return SUNSET_STORY_TEMPLATE_REGISTRY.map((template) => scoreTemplate(template, request)).sort(
    (left, right) => {
      if (left.hardRejected !== right.hardRejected) return left.hardRejected ? 1 : -1;
      if (right.score !== left.score) return right.score - left.score;
      return left.templateId.localeCompare(right.templateId);
    },
  );
}

export function decideSunsetStoryTemplate(
  candidates: readonly SunsetStoryTemplateCandidate[],
): SunsetStoryTemplateSelection {
  const eligible = candidates.filter((candidate) => !candidate.hardRejected);
  const winner = eligible[0];
  if (!winner || winner.score < SUNSET_TEMPLATE_SELECTION_THRESHOLDS.reviewScore) {
    return {
      mode: 'NO_SAFE_TEMPLATE',
      selectedTemplateId: null,
      confidence: 0,
      winningMargin: 0,
      candidates,
    };
  }

  const runnerUp = eligible[1];
  const winningMargin = roundScore(winner.score - (runnerUp?.score ?? 0));
  const autoSelect =
    winner.score >= SUNSET_TEMPLATE_SELECTION_THRESHOLDS.autoSelectScore &&
    winningMargin >= SUNSET_TEMPLATE_SELECTION_THRESHOLDS.minimumWinningMargin;

  return {
    mode: autoSelect ? 'AUTO_SELECT' : 'REVIEW_REQUIRED',
    selectedTemplateId: winner.templateId,
    confidence: Math.round((winner.score / 100) * 1000) / 1000,
    winningMargin,
    candidates,
  };
}

export function selectSunsetStoryTemplate(
  request: SunsetStoryTemplateSelectionRequest,
): SunsetStoryTemplateSelection {
  return decideSunsetStoryTemplate(rankSunsetStoryTemplates(request));
}
