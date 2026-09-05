import type { NormalizedRect, SunsetStoryImageProfile } from './sunset-story-image-profile.js';
import type { SunsetStoryCropPlan } from './sunset-story-crop-planner.js';
import type { SunsetStoryRenderPlan } from './sunset-story-render-plan.js';
import type { SunsetStoryPixelRect } from './sunset-story-template-contract.js';

const SIDE_MARGIN_MINIMUM_PX = 64;
const CRITICAL_TEXT_TOP_PX = 180;
const CRITICAL_TEXT_BOTTOM_PX = 1580;
const MAX_PROTECTED_FEATURE_OVERLAP = 0.02;

function area(rect: NormalizedRect): number {
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

function toNormalized(rect: SunsetStoryPixelRect): NormalizedRect {
  return {
    x: rect.x / 1080,
    y: rect.y / 1920,
    width: rect.width / 1080,
    height: rect.height / 1920,
  };
}

function transformToCrop(rect: NormalizedRect, crop: NormalizedRect): NormalizedRect {
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

function overlapRatio(subject: NormalizedRect, overlay: NormalizedRect): number {
  const clipped = clippedToCanvas(subject);
  if (!clipped) return 1;
  const subjectArea = area(clipped);
  if (subjectArea <= 0) return 1;
  const collision = intersect(clipped, overlay);
  return collision ? Math.min(1, area(collision) / subjectArea) : 0;
}

function isCriticalText(id: string): boolean {
  const upper = id.toUpperCase();
  return upper.includes('HEADLINE') || upper === 'CTA' || upper.includes('.CTA');
}

function validateTextSafeAreas(plan: SunsetStoryRenderPlan): void {
  for (const text of plan.texts) {
    const { region } = text;
    if (
      region.x < SIDE_MARGIN_MINIMUM_PX ||
      region.x + region.width > 1080 - SIDE_MARGIN_MINIMUM_PX
    ) {
      throw new Error(`SUNSET_RENDER_CRITICAL_TEXT_OUTSIDE_SAFE_AREA:${text.id}`);
    }
    if (
      isCriticalText(text.id) &&
      (region.y < CRITICAL_TEXT_TOP_PX || region.y + region.height > CRITICAL_TEXT_BOTTOM_PX)
    ) {
      throw new Error(`SUNSET_RENDER_CRITICAL_TEXT_OUTSIDE_SAFE_AREA:${text.id}`);
    }
  }
}

function validateProtectedFeatureOverlap(
  plan: SunsetStoryRenderPlan,
  profile: SunsetStoryImageProfile,
  cropPlan: SunsetStoryCropPlan,
): void {
  const overlays = [
    ...plan.texts.map((item) => item.region),
    ...plan.shapes.map((item) => item.region),
    ...plan.assets.map((item) => item.region),
  ].map(toNormalized);

  for (const feature of profile.protectedFeatures) {
    const transformed = transformToCrop(feature.box, cropPlan.cropWindow);
    let maximumOverlap = 0;
    for (const overlay of overlays) {
      maximumOverlap = Math.max(maximumOverlap, overlapRatio(transformed, overlay));
    }
    if (maximumOverlap > MAX_PROTECTED_FEATURE_OVERLAP) {
      throw new Error(`SUNSET_RENDER_PROTECTED_FEATURE_OVERLAP:${feature.kind}`);
    }
  }
}

export function validateSunsetStoryOutputSafety(
  plan: SunsetStoryRenderPlan,
  profile: SunsetStoryImageProfile,
  cropPlan: SunsetStoryCropPlan,
): void {
  validateTextSafeAreas(plan);
  validateProtectedFeatureOverlap(plan, profile, cropPlan);
}
