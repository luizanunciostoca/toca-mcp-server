import type { NormalizedRect, SunsetStoryImageProfile } from './sunset-story-image-profile.js';
import type { SunsetStoryCropPlan } from './sunset-story-crop-planner.js';
import type { SunsetStoryIntent, SunsetStoryTemplateId } from './sunset-story-template-registry.js';
import type {
  SunsetStoryCanonicalAssetElement,
  SunsetStoryCanonicalShapeElement,
  SunsetStoryCanonicalTemplateContract,
  SunsetStoryCanonicalTextElement,
  SunsetStoryPixelRect,
} from './sunset-story-template-contract.js';

export interface SunsetStoryRenderTextElement extends SunsetStoryCanonicalTextElement {
  readonly fontScale: number;
}

export interface SunsetStoryRenderAssetElement extends SunsetStoryCanonicalAssetElement {
  readonly opticalScale: number;
}

export interface SunsetStoryLocalDarkening {
  readonly region: SunsetStoryPixelRect;
  readonly opacity: number;
  readonly featherPx: number;
}

export interface SunsetStoryRenderPlan {
  readonly schemaVersion: '1.0.0';
  readonly templateId: SunsetStoryTemplateId;
  readonly canvas: {
    readonly width: 1080;
    readonly height: 1920;
  };
  readonly sourcePhoto: {
    readonly sourceWidth: number;
    readonly sourceHeight: number;
    readonly cropWindow: NormalizedRect;
  };
  readonly texts: readonly SunsetStoryRenderTextElement[];
  readonly shapes: readonly SunsetStoryCanonicalShapeElement[];
  readonly assets: readonly SunsetStoryRenderAssetElement[];
  readonly localDarkening: readonly SunsetStoryLocalDarkening[];
  readonly provenance: {
    readonly planner: 'AI_ASSISTED';
    readonly referenceSha256: string;
    readonly contractSchemaVersion: string;
  };
}

export interface SunsetStoryAiRenderPlannerRequest {
  readonly templateId: SunsetStoryTemplateId;
  readonly intent: SunsetStoryIntent;
  readonly imageProfile: SunsetStoryImageProfile;
  readonly cropPlan: SunsetStoryCropPlan;
  readonly canonicalContract: SunsetStoryCanonicalTemplateContract;
  readonly referenceImageBytes?: Uint8Array;
}

export interface SunsetStoryAiRenderPlannerPort {
  plan(request: SunsetStoryAiRenderPlannerRequest): Promise<SunsetStoryRenderPlan>;
}

const MAX_REGION_DRIFT_PX = 2;
const MIN_FONT_SCALE = 0.9;
const MAX_FONT_SCALE = 1.08;
const MIN_ASSET_SCALE = 0.92;
const MAX_ASSET_SCALE = 1.08;
const MAX_LOCAL_DARKENING = 0.4;

function assertFinite(value: number, code: string): void {
  if (!Number.isFinite(value)) throw new Error(code);
}

function assertUnitRect(rect: NormalizedRect): void {
  for (const [key, value] of Object.entries(rect)) {
    assertFinite(value, `SUNSET_RENDER_CROP_${key.toUpperCase()}_INVALID`);
  }
  if (
    rect.x < 0 ||
    rect.y < 0 ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.x + rect.width > 1 ||
    rect.y + rect.height > 1
  ) {
    throw new Error('SUNSET_RENDER_CROP_OUT_OF_BOUNDS');
  }
}

function assertPixelRect(rect: SunsetStoryPixelRect): void {
  if (
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.x < 0 ||
    rect.y < 0 ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.x + rect.width > 1080 ||
    rect.y + rect.height > 1920
  ) {
    throw new Error('SUNSET_RENDER_REGION_OUT_OF_BOUNDS');
  }
}

function rectMatches(left: SunsetStoryPixelRect, right: SunsetStoryPixelRect): boolean {
  return (
    Math.abs(left.x - right.x) <= MAX_REGION_DRIFT_PX &&
    Math.abs(left.y - right.y) <= MAX_REGION_DRIFT_PX &&
    Math.abs(left.width - right.width) <= MAX_REGION_DRIFT_PX &&
    Math.abs(left.height - right.height) <= MAX_REGION_DRIFT_PX
  );
}

function cropMatches(left: NormalizedRect, right: NormalizedRect): boolean {
  const tolerance = 0.000001;
  return (
    Math.abs(left.x - right.x) <= tolerance &&
    Math.abs(left.y - right.y) <= tolerance &&
    Math.abs(left.width - right.width) <= tolerance &&
    Math.abs(left.height - right.height) <= tolerance
  );
}

function editorOnlyLeak(plan: SunsetStoryRenderPlan, contract: SunsetStoryCanonicalTemplateContract): boolean {
  if (contract.editorOnlyStrings.length === 0) return false;
  const renderedText = plan.texts.map((item) => item.text).join('\n').toLocaleLowerCase('pt-BR');
  return contract.editorOnlyStrings.some((item) => {
    const normalized = item.trim().toLocaleLowerCase('pt-BR');
    return normalized.length >= 4 && renderedText.includes(normalized);
  });
}

function mapById<T extends { readonly id: string }>(items: readonly T[]): ReadonlyMap<string, T> {
  const result = new Map<string, T>();
  for (const item of items) {
    if (result.has(item.id)) throw new Error(`SUNSET_RENDER_DUPLICATE_ELEMENT:${item.id}`);
    result.set(item.id, item);
  }
  return result;
}

function validateTexts(
  proposed: readonly SunsetStoryRenderTextElement[],
  canonical: readonly SunsetStoryCanonicalTextElement[],
): void {
  const proposedById = mapById(proposed);
  if (proposedById.size !== canonical.length) throw new Error('SUNSET_RENDER_TEXT_COUNT_MISMATCH');
  for (const expected of canonical) {
    const actual = proposedById.get(expected.id);
    if (!actual) throw new Error(`SUNSET_RENDER_TEXT_MISSING:${expected.id}`);
    if (actual.text !== expected.text) throw new Error(`SUNSET_RENDER_COPY_DRIFT:${expected.id}`);
    if (!rectMatches(actual.region, expected.region)) {
      throw new Error(`SUNSET_RENDER_TEXT_REGION_DRIFT:${expected.id}`);
    }
    if (actual.fontRole !== expected.fontRole) throw new Error(`SUNSET_RENDER_FONT_ROLE_DRIFT:${expected.id}`);
    if (actual.color !== expected.color) throw new Error(`SUNSET_RENDER_TEXT_COLOR_DRIFT:${expected.id}`);
    if (actual.alignment !== expected.alignment) {
      throw new Error(`SUNSET_RENDER_ALIGNMENT_DRIFT:${expected.id}`);
    }
    if (!Number.isFinite(actual.fontScale) || actual.fontScale < MIN_FONT_SCALE || actual.fontScale > MAX_FONT_SCALE) {
      throw new Error(`SUNSET_RENDER_FONT_SCALE_INVALID:${expected.id}`);
    }
  }
}

function validateShapes(
  proposed: readonly SunsetStoryCanonicalShapeElement[],
  canonical: readonly SunsetStoryCanonicalShapeElement[],
): void {
  const proposedById = mapById(proposed);
  if (proposedById.size !== canonical.length) throw new Error('SUNSET_RENDER_SHAPE_COUNT_MISMATCH');
  for (const expected of canonical) {
    const actual = proposedById.get(expected.id);
    if (!actual) throw new Error(`SUNSET_RENDER_SHAPE_MISSING:${expected.id}`);
    if (!rectMatches(actual.region, expected.region)) {
      throw new Error(`SUNSET_RENDER_SHAPE_REGION_DRIFT:${expected.id}`);
    }
    if (actual.fill !== expected.fill || actual.stroke !== expected.stroke) {
      throw new Error(`SUNSET_RENDER_SHAPE_STYLE_DRIFT:${expected.id}`);
    }
    if (actual.strokeWidthPx !== expected.strokeWidthPx) {
      throw new Error(`SUNSET_RENDER_SHAPE_STROKE_DRIFT:${expected.id}`);
    }
  }
}

function validateAssets(
  proposed: readonly SunsetStoryRenderAssetElement[],
  canonical: readonly SunsetStoryCanonicalAssetElement[],
): void {
  const proposedById = mapById(proposed);
  if (proposedById.size !== canonical.length) throw new Error('SUNSET_RENDER_ASSET_COUNT_MISMATCH');
  for (const expected of canonical) {
    const actual = proposedById.get(expected.id);
    if (!actual) throw new Error(`SUNSET_RENDER_ASSET_MISSING:${expected.id}`);
    if (actual.assetId !== expected.assetId) throw new Error(`SUNSET_RENDER_ASSET_ID_DRIFT:${expected.id}`);
    if (!rectMatches(actual.region, expected.region)) {
      throw new Error(`SUNSET_RENDER_ASSET_REGION_DRIFT:${expected.id}`);
    }
    if (actual.colorMode !== expected.colorMode) {
      throw new Error(`SUNSET_RENDER_ASSET_COLOR_MODE_DRIFT:${expected.id}`);
    }
    if (
      !Number.isFinite(actual.opticalScale) ||
      actual.opticalScale < MIN_ASSET_SCALE ||
      actual.opticalScale > MAX_ASSET_SCALE
    ) {
      throw new Error(`SUNSET_RENDER_ASSET_SCALE_INVALID:${expected.id}`);
    }
  }
}

function validateDarkening(items: readonly SunsetStoryLocalDarkening[]): void {
  if (items.length > 8) throw new Error('SUNSET_RENDER_TOO_MANY_DARKENING_REGIONS');
  for (const item of items) {
    assertPixelRect(item.region);
    if (!Number.isFinite(item.opacity) || item.opacity < 0 || item.opacity > MAX_LOCAL_DARKENING) {
      throw new Error('SUNSET_RENDER_DARKENING_OPACITY_INVALID');
    }
    if (!Number.isFinite(item.featherPx) || item.featherPx < 0 || item.featherPx > 240) {
      throw new Error('SUNSET_RENDER_DARKENING_FEATHER_INVALID');
    }
  }
}

export function buildCanonicalSunsetStoryRenderPlan(
  contract: SunsetStoryCanonicalTemplateContract,
  profile: SunsetStoryImageProfile,
  cropPlan: SunsetStoryCropPlan,
): SunsetStoryRenderPlan {
  return {
    schemaVersion: '1.0.0',
    templateId: contract.templateId,
    canvas: contract.canvas,
    sourcePhoto: {
      sourceWidth: profile.width,
      sourceHeight: profile.height,
      cropWindow: cropPlan.cropWindow,
    },
    texts: contract.texts.map((item) => ({ ...item, fontScale: 1 })),
    shapes: contract.shapes,
    assets: contract.assets.map((item) => ({ ...item, opticalScale: 1 })),
    localDarkening: [],
    provenance: {
      planner: 'AI_ASSISTED',
      referenceSha256: contract.referenceSha256,
      contractSchemaVersion: contract.schemaVersion,
    },
  };
}

export function validateSunsetStoryAiRenderPlan(
  plan: SunsetStoryRenderPlan,
  contract: SunsetStoryCanonicalTemplateContract,
  profile: SunsetStoryImageProfile,
  cropPlan: SunsetStoryCropPlan,
): SunsetStoryRenderPlan {
  if (plan.schemaVersion !== '1.0.0') throw new Error('SUNSET_RENDER_PLAN_SCHEMA_INVALID');
  if (plan.templateId !== contract.templateId) throw new Error('SUNSET_RENDER_TEMPLATE_DRIFT');
  if (plan.canvas.width !== 1080 || plan.canvas.height !== 1920) {
    throw new Error('SUNSET_RENDER_CANVAS_DRIFT');
  }
  if (plan.sourcePhoto.sourceWidth !== profile.width || plan.sourcePhoto.sourceHeight !== profile.height) {
    throw new Error('SUNSET_RENDER_SOURCE_DIMENSIONS_DRIFT');
  }
  assertUnitRect(plan.sourcePhoto.cropWindow);
  if (!cropMatches(plan.sourcePhoto.cropWindow, cropPlan.cropWindow)) {
    throw new Error('SUNSET_RENDER_CROP_DRIFT');
  }
  if (
    plan.provenance.referenceSha256 !== contract.referenceSha256 ||
    plan.provenance.contractSchemaVersion !== contract.schemaVersion ||
    plan.provenance.planner !== 'AI_ASSISTED'
  ) {
    throw new Error('SUNSET_RENDER_PROVENANCE_DRIFT');
  }

  validateTexts(plan.texts, contract.texts);
  validateShapes(plan.shapes, contract.shapes);
  validateAssets(plan.assets, contract.assets);
  validateDarkening(plan.localDarkening);
  if (editorOnlyLeak(plan, contract)) throw new Error('SUNSET_RENDER_EDITOR_GUIDANCE_LEAK');

  return plan;
}
