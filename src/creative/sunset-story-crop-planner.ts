import type {
  NormalizedRect,
  SunsetStoryImageProfile,
  SunsetStoryZone,
} from './sunset-story-image-profile.js';
import type { SunsetStoryTemplateProfile } from './sunset-story-template-registry.js';

export interface SunsetStoryCropPlan {
  readonly cropWindow: NormalizedRect;
  readonly transformedPrimarySubject: NormalizedRect | null;
  readonly subjectCoverage: number;
  readonly protectedOverlap: number;
  readonly placementScore: number;
  readonly planScore: number;
}

const TARGET_ASPECT_RATIO = 9 / 16;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function rectArea(rect: NormalizedRect): number {
  return rect.width * rect.height;
}

function intersect(left: NormalizedRect, right: NormalizedRect): NormalizedRect | null {
  const x1 = Math.max(left.x, right.x);
  const y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.width, right.x + right.width);
  const y2 = Math.min(left.y + left.height, right.y + right.height);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function zoneCenter(zone: SunsetStoryZone): readonly [number, number] {
  const map: Record<SunsetStoryZone, readonly [number, number]> = {
    TOP_LEFT: [1 / 6, 1 / 6],
    TOP_CENTER: [0.5, 1 / 6],
    TOP_RIGHT: [5 / 6, 1 / 6],
    CENTER_LEFT: [1 / 6, 0.5],
    CENTER: [0.5, 0.5],
    CENTER_RIGHT: [5 / 6, 0.5],
    BOTTOM_LEFT: [1 / 6, 5 / 6],
    BOTTOM_CENTER: [0.5, 5 / 6],
    BOTTOM_RIGHT: [5 / 6, 5 / 6],
  };
  return map[zone];
}

function resolveCropSize(profile: SunsetStoryImageProfile): readonly [number, number] {
  if (profile.sourceAspectRatio >= TARGET_ASPECT_RATIO) {
    return [TARGET_ASPECT_RATIO / profile.sourceAspectRatio, 1];
  }
  return [1, profile.sourceAspectRatio / TARGET_ASPECT_RATIO];
}

function transformRect(rect: NormalizedRect, crop: NormalizedRect): NormalizedRect {
  return {
    x: (rect.x - crop.x) / crop.width,
    y: (rect.y - crop.y) / crop.height,
    width: rect.width / crop.width,
    height: rect.height / crop.height,
  };
}

function clippedToCanvas(rect: NormalizedRect): NormalizedRect | null {
  return intersect(rect, { x: 0, y: 0, width: 1, height: 1 });
}

function protectedOverlapRatio(
  transformedSubject: NormalizedRect,
  protectedRegions: readonly NormalizedRect[],
): number {
  const clippedSubject = clippedToCanvas(transformedSubject);
  if (!clippedSubject) return 1;
  const subjectArea = rectArea(clippedSubject);
  if (subjectArea <= 0) return 1;
  const overlap = protectedRegions.reduce((sum, region) => {
    const collision = intersect(clippedSubject, region);
    return sum + (collision ? rectArea(collision) : 0);
  }, 0);
  return clamp(overlap / subjectArea, 0, 1);
}

function subjectCoverageRatio(subject: NormalizedRect, crop: NormalizedRect): number {
  const visible = intersect(subject, crop);
  if (!visible) return 0;
  return clamp(rectArea(visible) / rectArea(subject), 0, 1);
}

function placementScore(
  transformedSubject: NormalizedRect,
  target: readonly [number, number],
): number {
  const subjectCenterX = transformedSubject.x + transformedSubject.width / 2;
  const subjectCenterY = transformedSubject.y + transformedSubject.height / 2;
  const distance = Math.hypot(subjectCenterX - target[0], subjectCenterY - target[1]);
  return clamp(1 - distance / Math.SQRT2, 0, 1);
}

function buildCandidate(
  profile: SunsetStoryImageProfile,
  template: SunsetStoryTemplateProfile,
  targetZone: SunsetStoryZone,
): SunsetStoryCropPlan {
  const [cropWidth, cropHeight] = resolveCropSize(profile);
  const subject = profile.primarySubject;
  if (!subject) {
    const cropWindow = {
      x: (1 - cropWidth) / 2,
      y: (1 - cropHeight) / 2,
      width: cropWidth,
      height: cropHeight,
    };
    return {
      cropWindow,
      transformedPrimarySubject: null,
      subjectCoverage: 1,
      protectedOverlap: 0,
      placementScore: 1,
      planScore: 100,
    };
  }

  const [targetX, targetY] = zoneCenter(targetZone);
  const subjectCenterX = subject.box.x + subject.box.width / 2;
  const subjectCenterY = subject.box.y + subject.box.height / 2;
  const cropWindow = {
    x: clamp(subjectCenterX - targetX * cropWidth, 0, 1 - cropWidth),
    y: clamp(subjectCenterY - targetY * cropHeight, 0, 1 - cropHeight),
    width: cropWidth,
    height: cropHeight,
  };
  const transformedPrimarySubject = transformRect(subject.box, cropWindow);
  const subjectCoverage = subjectCoverageRatio(subject.box, cropWindow);
  const protectedOverlap = protectedOverlapRatio(
    transformedPrimarySubject,
    template.protectedRegions,
  );
  const subjectPlacementScore = placementScore(transformedPrimarySubject, [targetX, targetY]);
  const planScore =
    subjectCoverage * 55 +
    (1 - protectedOverlap) * 30 +
    subjectPlacementScore * 15;

  return {
    cropWindow,
    transformedPrimarySubject,
    subjectCoverage,
    protectedOverlap,
    placementScore: subjectPlacementScore,
    planScore: Math.round(planScore * 100) / 100,
  };
}

export function planSunsetStoryCrop(
  profile: SunsetStoryImageProfile,
  template: SunsetStoryTemplateProfile,
): SunsetStoryCropPlan {
  const targetZones =
    template.preferredSubjectZones.length > 0
      ? template.preferredSubjectZones
      : (['CENTER'] as const);
  const candidates = targetZones.map((zone) => buildCandidate(profile, template, zone));
  const best = candidates.sort((left, right) => right.planScore - left.planScore)[0];
  if (!best) throw new Error('SUNSET_CROP_PLAN_UNAVAILABLE');
  return best;
}
