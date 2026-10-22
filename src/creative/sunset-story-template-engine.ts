import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  CreativeTruthFailureCode,
  CreativeTruthGateResult,
} from '../contracts/creative-truth.js';

export const SUNSET_REFERENCE_TEMPLATE_LIBRARY_ID = 'SUNSET_REFERENCE_TEMPLATE_LIBRARY' as const;
export const SUNSET_REFERENCE_TEMPLATE_LIBRARY_VERSION = '1.0' as const;
export const SUNSET_CANVAS = '1080x1920' as const;
export const SUNSET_TEMPLATE_LIBRARY_MIRROR_PATH =
  'control/creative-standards/sunset-story-reference-template-library.v1.json' as const;

export type SunsetTemplateFamily =
  | 'INFO_HOURS_ORANGE'
  | 'HERO_SERIF_DARK'
  | 'ORANGE_LOWER_THIRD'
  | 'LIGHT_FIELD_ORANGE_HEADLINE'
  | 'FULLBLEED_CTA_TOP'
  | 'SILHOUETTE_LOWER_HEADLINE'
  | 'SUPPORT_STRIPS_LOWER'
  | 'ASYMMETRIC_SUPPORT_STRIPS'
  | 'DRINK_ORANGE_LOWER_THIRD'
  | 'INFO_HOURS_TOP_LOGO'
  | 'INFO_ORANGE_BLUE_ACCENT';

export type SunsetTemplateId =
  | 'SUNSET_REF_01_ORANGE_INFO_HOURS'
  | 'SUNSET_REF_02_HERO_DARK_FOOTER'
  | 'SUNSET_REF_03_ORANGE_LOWER_THIRD'
  | 'SUNSET_REF_04_LIGHT_ORANGE_HEADLINE'
  | 'SUNSET_REF_05_CTA_ABOVE_HERO'
  | 'SUNSET_REF_06_SILHOUETTE_LOWER_HEADLINE'
  | 'SUNSET_REF_07_WHITE_STRIPS_LOWER'
  | 'SUNSET_REF_08_ASYMMETRIC_SUPPORT'
  | 'SUNSET_REF_09_DRINK_ORANGE_BLOCK'
  | 'SUNSET_REF_10_INFO_TOP_LOGO'
  | 'SUNSET_REF_11_INFO_ORANGE_BLUE';

export type SunsetElementKind =
  | 'HEADLINE'
  | 'SUPPORT_STRIP'
  | 'CTA_OUTLINE'
  | 'TIME_BADGE'
  | 'TOCA_TOP_SIGNATURE'
  | 'ORANGE_LOWER_THIRD'
  | 'FOUR_LOGO_FOOTER'
  | 'REDUCED_FOOTER';

export type SunsetFontRole =
  'HEADLINE_SERIF' | 'HEADLINE_FUNCTIONAL_SANS' | 'SUPPORT_SANS' | 'TIME_SANS' | 'CTA_SANS';

export type SunsetTextColor = 'BLACK' | 'WHITE' | 'ORANGE' | 'DARK_BROWN';
export type SunsetFooterMode = 'FOUR_LOGOS_WHITE' | 'THREE_LOGOS_WHITE_WITH_TOCA_TOP';
export type SunsetBackgroundTreatment =
  'NONE' | 'LOCAL_DARKENING' | 'ORANGE_LOWER_THIRD' | 'ORANGE_WITH_BLUE_ACCENT';

export interface SunsetRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SunsetSafeRegion extends SunsetRect {
  readonly regionId: string;
  readonly meanLuminance: number;
  readonly textColor: SunsetTextColor;
}

export interface SunsetProtectedRegion extends SunsetRect {
  readonly regionId: string;
}

export interface SunsetStoryElement {
  readonly kind: SunsetElementKind;
  readonly regionId: string;
  readonly text?: string;
  readonly fontRole?: SunsetFontRole;
  readonly textColor?: SunsetTextColor;
  readonly fontSizePx?: number;
}

export interface SunsetStoryTemplatePlan {
  readonly templateId: SunsetTemplateId;
  readonly canvas: typeof SUNSET_CANVAS;
  readonly sourceAssetId: string;
  readonly analysisId: string;
  readonly analysisStatus: 'PASS' | 'FAIL';
  readonly referenceReviewStatus: 'PENDING' | 'PASS' | 'FAIL';
  readonly safeRegions: readonly SunsetSafeRegion[];
  readonly protectedRegions: readonly SunsetProtectedRegion[];
  readonly elements: readonly SunsetStoryElement[];
  readonly footerMode: SunsetFooterMode;
  readonly backgroundTreatment: SunsetBackgroundTreatment;
}

export interface SunsetStoryTemplateDescriptor {
  readonly templateId: SunsetTemplateId;
  readonly referenceFile: string;
  readonly family: SunsetTemplateFamily;
  readonly referencePurpose: string;
  readonly requiredElements: readonly SunsetElementKind[];
  readonly allowedElements: readonly SunsetElementKind[];
  readonly allowedFontRoles: readonly SunsetFontRole[];
  readonly footerMode: SunsetFooterMode;
  readonly backgroundTreatment: SunsetBackgroundTreatment;
  readonly headlineCase: 'TITLE_CASE' | 'FUNCTIONAL_UPPERCASE_ALLOWED';
}

const descriptors: readonly SunsetStoryTemplateDescriptor[] = [
  {
    templateId: 'SUNSET_REF_01_ORANGE_INFO_HOURS',
    referenceFile: '66698419-A7D5-4DD9-A042-A656D61F7552.png',
    family: 'INFO_HOURS_ORANGE',
    referencePurpose: 'Informar Sunset e horário com impacto de campanha.',
    requiredElements: ['TIME_BADGE', 'HEADLINE', 'CTA_OUTLINE', 'FOUR_LOGO_FOOTER'],
    allowedElements: [
      'TIME_BADGE',
      'HEADLINE',
      'SUPPORT_STRIP',
      'CTA_OUTLINE',
      'ORANGE_LOWER_THIRD',
      'FOUR_LOGO_FOOTER',
    ],
    allowedFontRoles: [
      'HEADLINE_SERIF',
      'HEADLINE_FUNCTIONAL_SANS',
      'SUPPORT_SANS',
      'TIME_SANS',
      'CTA_SANS',
    ],
    footerMode: 'FOUR_LOGOS_WHITE',
    backgroundTreatment: 'ORANGE_LOWER_THIRD',
    headlineCase: 'FUNCTIONAL_UPPERCASE_ALLOWED',
  },
  {
    templateId: 'SUNSET_REF_02_HERO_DARK_FOOTER',
    referenceFile: '79841366-D602-4109-8398-56B6DB4DE542.png',
    family: 'HERO_SERIF_DARK',
    referencePurpose: 'Hero emocional com fotografia dominante.',
    requiredElements: ['HEADLINE', 'CTA_OUTLINE', 'FOUR_LOGO_FOOTER'],
    allowedElements: ['HEADLINE', 'SUPPORT_STRIP', 'CTA_OUTLINE', 'FOUR_LOGO_FOOTER'],
    allowedFontRoles: ['HEADLINE_SERIF', 'SUPPORT_SANS', 'CTA_SANS', 'TIME_SANS'],
    footerMode: 'FOUR_LOGOS_WHITE',
    backgroundTreatment: 'LOCAL_DARKENING',
    headlineCase: 'TITLE_CASE',
  },
  {
    templateId: 'SUNSET_REF_03_ORANGE_LOWER_THIRD',
    referenceFile: 'CD01BC5A-F359-45E8-9A64-C7E461B33DAA.png',
    family: 'ORANGE_LOWER_THIRD',
    referencePurpose: 'Campanha de experiência com transição laranja.',
    requiredElements: ['HEADLINE', 'CTA_OUTLINE', 'ORANGE_LOWER_THIRD', 'FOUR_LOGO_FOOTER'],
    allowedElements: [
      'HEADLINE',
      'SUPPORT_STRIP',
      'CTA_OUTLINE',
      'ORANGE_LOWER_THIRD',
      'FOUR_LOGO_FOOTER',
    ],
    allowedFontRoles: ['HEADLINE_SERIF', 'SUPPORT_SANS', 'CTA_SANS'],
    footerMode: 'FOUR_LOGOS_WHITE',
    backgroundTreatment: 'ORANGE_LOWER_THIRD',
    headlineCase: 'TITLE_CASE',
  },
  {
    templateId: 'SUNSET_REF_04_LIGHT_ORANGE_HEADLINE',
    referenceFile: 'IMG_0350.png',
    family: 'LIGHT_FIELD_ORANGE_HEADLINE',
    referencePurpose: 'Campanha de alto impacto sobre campo claro.',
    requiredElements: ['HEADLINE', 'CTA_OUTLINE', 'FOUR_LOGO_FOOTER'],
    allowedElements: ['TIME_BADGE', 'HEADLINE', 'SUPPORT_STRIP', 'CTA_OUTLINE', 'FOUR_LOGO_FOOTER'],
    allowedFontRoles: ['HEADLINE_SERIF', 'SUPPORT_SANS', 'TIME_SANS', 'CTA_SANS'],
    footerMode: 'FOUR_LOGOS_WHITE',
    backgroundTreatment: 'NONE',
    headlineCase: 'TITLE_CASE',
  },
  {
    templateId: 'SUNSET_REF_05_CTA_ABOVE_HERO',
    referenceFile: 'IMG_0604.png',
    family: 'FULLBLEED_CTA_TOP',
    referencePurpose: 'Conversão leve com CTA antes da headline.',
    requiredElements: ['CTA_OUTLINE', 'HEADLINE', 'FOUR_LOGO_FOOTER'],
    allowedElements: ['TIME_BADGE', 'HEADLINE', 'SUPPORT_STRIP', 'CTA_OUTLINE', 'FOUR_LOGO_FOOTER'],
    allowedFontRoles: ['HEADLINE_SERIF', 'SUPPORT_SANS', 'TIME_SANS', 'CTA_SANS'],
    footerMode: 'FOUR_LOGOS_WHITE',
    backgroundTreatment: 'NONE',
    headlineCase: 'TITLE_CASE',
  },
  {
    templateId: 'SUNSET_REF_06_SILHOUETTE_LOWER_HEADLINE',
    referenceFile: 'IMG_0965.jpeg',
    family: 'SILHOUETTE_LOWER_HEADLINE',
    referencePurpose: 'Atmosfera com silhueta, strips e headline inferior.',
    requiredElements: ['SUPPORT_STRIP', 'CTA_OUTLINE', 'HEADLINE', 'FOUR_LOGO_FOOTER'],
    allowedElements: ['SUPPORT_STRIP', 'CTA_OUTLINE', 'HEADLINE', 'FOUR_LOGO_FOOTER'],
    allowedFontRoles: ['HEADLINE_SERIF', 'SUPPORT_SANS', 'CTA_SANS'],
    footerMode: 'FOUR_LOGOS_WHITE',
    backgroundTreatment: 'LOCAL_DARKENING',
    headlineCase: 'TITLE_CASE',
  },
  {
    templateId: 'SUNSET_REF_07_WHITE_STRIPS_LOWER',
    referenceFile: 'IMG_0890.jpeg',
    family: 'SUPPORT_STRIPS_LOWER',
    referencePurpose: 'Apoio editorial em strips independentes.',
    requiredElements: ['SUPPORT_STRIP', 'CTA_OUTLINE', 'HEADLINE', 'FOUR_LOGO_FOOTER'],
    allowedElements: ['SUPPORT_STRIP', 'CTA_OUTLINE', 'HEADLINE', 'FOUR_LOGO_FOOTER'],
    allowedFontRoles: ['HEADLINE_SERIF', 'SUPPORT_SANS', 'CTA_SANS'],
    footerMode: 'FOUR_LOGOS_WHITE',
    backgroundTreatment: 'NONE',
    headlineCase: 'TITLE_CASE',
  },
  {
    templateId: 'SUNSET_REF_08_ASYMMETRIC_SUPPORT',
    referenceFile: 'IMG_0837.jpeg',
    family: 'ASYMMETRIC_SUPPORT_STRIPS',
    referencePurpose: 'Lifestyle assimétrico com campo lateral negativo.',
    requiredElements: ['SUPPORT_STRIP', 'HEADLINE', 'CTA_OUTLINE', 'FOUR_LOGO_FOOTER'],
    allowedElements: ['TIME_BADGE', 'SUPPORT_STRIP', 'HEADLINE', 'CTA_OUTLINE', 'FOUR_LOGO_FOOTER'],
    allowedFontRoles: ['HEADLINE_SERIF', 'SUPPORT_SANS', 'TIME_SANS', 'CTA_SANS'],
    footerMode: 'FOUR_LOGOS_WHITE',
    backgroundTreatment: 'NONE',
    headlineCase: 'TITLE_CASE',
  },
  {
    templateId: 'SUNSET_REF_09_DRINK_ORANGE_BLOCK',
    referenceFile: 'IMG_3138.png',
    family: 'DRINK_ORANGE_LOWER_THIRD',
    referencePurpose: 'Drink/produto com bloco laranja forte.',
    requiredElements: ['HEADLINE', 'CTA_OUTLINE', 'ORANGE_LOWER_THIRD', 'FOUR_LOGO_FOOTER'],
    allowedElements: [
      'SUPPORT_STRIP',
      'HEADLINE',
      'CTA_OUTLINE',
      'ORANGE_LOWER_THIRD',
      'FOUR_LOGO_FOOTER',
    ],
    allowedFontRoles: ['HEADLINE_SERIF', 'SUPPORT_SANS', 'CTA_SANS'],
    footerMode: 'FOUR_LOGOS_WHITE',
    backgroundTreatment: 'ORANGE_LOWER_THIRD',
    headlineCase: 'TITLE_CASE',
  },
  {
    templateId: 'SUNSET_REF_10_INFO_TOP_LOGO',
    referenceFile: 'IMG_6170.png',
    family: 'INFO_HOURS_TOP_LOGO',
    referencePurpose: 'Informação funcional com Toca no topo.',
    requiredElements: ['TOCA_TOP_SIGNATURE', 'HEADLINE', 'TIME_BADGE', 'REDUCED_FOOTER'],
    allowedElements: [
      'TOCA_TOP_SIGNATURE',
      'HEADLINE',
      'TIME_BADGE',
      'SUPPORT_STRIP',
      'CTA_OUTLINE',
      'REDUCED_FOOTER',
    ],
    allowedFontRoles: [
      'HEADLINE_FUNCTIONAL_SANS',
      'HEADLINE_SERIF',
      'SUPPORT_SANS',
      'TIME_SANS',
      'CTA_SANS',
    ],
    footerMode: 'THREE_LOGOS_WHITE_WITH_TOCA_TOP',
    backgroundTreatment: 'NONE',
    headlineCase: 'FUNCTIONAL_UPPERCASE_ALLOWED',
  },
  {
    templateId: 'SUNSET_REF_11_INFO_ORANGE_BLUE',
    referenceFile: 'IMG_2216.png',
    family: 'INFO_ORANGE_BLUE_ACCENT',
    referencePurpose: 'Informação funcional com laranja e acento azul/cinza.',
    requiredElements: ['TOCA_TOP_SIGNATURE', 'HEADLINE', 'TIME_BADGE', 'REDUCED_FOOTER'],
    allowedElements: [
      'TOCA_TOP_SIGNATURE',
      'HEADLINE',
      'TIME_BADGE',
      'SUPPORT_STRIP',
      'CTA_OUTLINE',
      'ORANGE_LOWER_THIRD',
      'REDUCED_FOOTER',
    ],
    allowedFontRoles: [
      'HEADLINE_FUNCTIONAL_SANS',
      'HEADLINE_SERIF',
      'SUPPORT_SANS',
      'TIME_SANS',
      'CTA_SANS',
    ],
    footerMode: 'THREE_LOGOS_WHITE_WITH_TOCA_TOP',
    backgroundTreatment: 'ORANGE_WITH_BLUE_ACCENT',
    headlineCase: 'FUNCTIONAL_UPPERCASE_ALLOWED',
  },
];

const descriptorById = new Map(
  descriptors.map((descriptor) => [descriptor.templateId, descriptor]),
);

export function listSunsetStoryTemplates(): readonly SunsetStoryTemplateDescriptor[] {
  return descriptors;
}

export function getSunsetStoryTemplate(
  templateId: SunsetTemplateId,
): SunsetStoryTemplateDescriptor {
  const descriptor = descriptorById.get(templateId);
  if (!descriptor) throw new Error(`SUNSET_TEMPLATE_NOT_FOUND:${templateId}`);
  return descriptor;
}

export function expectedTextColor(meanLuminance: number): SunsetTextColor {
  if (!Number.isFinite(meanLuminance) || meanLuminance < 0 || meanLuminance > 255) {
    throw new Error('SUNSET_LUMINANCE_OUT_OF_RANGE');
  }
  return meanLuminance >= 145 ? 'BLACK' : 'WHITE';
}

export function evaluateSunsetStoryTemplateGate(
  plan: SunsetStoryTemplatePlan,
): CreativeTruthGateResult {
  const failures = new Set<CreativeTruthFailureCode>();
  if (!isTemplateLibraryMirrorInSync()) failures.add('FAILED_TEMPLATE_LIBRARY_MIRROR_MISMATCH');
  const descriptor = descriptorById.get(plan.templateId);
  if (!descriptor) {
    failures.add('FAILED_TEMPLATE_NOT_RESOLVED');
    return result(failures, {
      templateId: plan.templateId,
      libraryVersion: SUNSET_REFERENCE_TEMPLATE_LIBRARY_VERSION,
    });
  }
  if (plan.canvas !== SUNSET_CANVAS) failures.add('FAILED_TEMPLATE_GEOMETRY_INVALID');
  if (!plan.sourceAssetId.trim() || !plan.analysisId.trim() || plan.analysisStatus !== 'PASS') {
    failures.add('FAILED_TEMPLATE_ANALYSIS_MISSING');
  }
  if (plan.referenceReviewStatus === 'FAIL') failures.add('FAILED_TEMPLATE_REFERENCE_MISMATCH');
  if (plan.footerMode !== descriptor.footerMode) failures.add('FAILED_TEMPLATE_FOOTER_MISMATCH');
  if (plan.backgroundTreatment !== descriptor.backgroundTreatment) {
    failures.add('FAILED_TEMPLATE_BACKGROUND_MISMATCH');
  }

  const safeById = new Map(plan.safeRegions.map((region) => [region.regionId, region]));
  const protectedRegions = plan.protectedRegions;
  if (safeById.size !== plan.safeRegions.length || plan.safeRegions.length === 0) {
    failures.add('FAILED_TEMPLATE_SAFE_REGION_INVALID');
  }
  for (const region of plan.safeRegions) {
    if (!validRect(region) || region.meanLuminance < 0 || region.meanLuminance > 255) {
      failures.add('FAILED_TEMPLATE_SAFE_REGION_INVALID');
    }
    if (region.textColor !== expectedTextColor(region.meanLuminance)) {
      failures.add('FAILED_TEMPLATE_CONTRAST_MISMATCH');
    }
    if (protectedRegions.some((protectedRegion) => intersects(region, protectedRegion))) {
      failures.add('FAILED_TEMPLATE_ELEMENT_OVERLAP');
    }
  }
  for (const protectedRegion of protectedRegions) {
    if (!validRect(protectedRegion)) failures.add('FAILED_TEMPLATE_PROTECTED_REGION_INVALID');
  }

  const visibleElements = plan.elements.filter(
    (element) =>
      element.text?.trim() ||
      element.kind.includes('FOOTER') ||
      element.kind === 'TOCA_TOP_SIGNATURE' ||
      element.kind === 'ORANGE_LOWER_THIRD',
  );
  const kinds = new Set(visibleElements.map((element) => element.kind));
  for (const required of descriptor.requiredElements) {
    if (!kinds.has(required)) failures.add('FAILED_TEMPLATE_REQUIRED_ELEMENT_MISSING');
  }
  for (const element of visibleElements) {
    if (!descriptor.allowedElements.includes(element.kind)) {
      failures.add('FAILED_TEMPLATE_ELEMENT_NOT_ALLOWED');
      continue;
    }
    const region = safeById.get(element.regionId);
    if (!region) {
      failures.add('FAILED_TEMPLATE_SAFE_REGION_INVALID');
      continue;
    }
    if (protectedRegions.some((protectedRegion) => intersects(region, protectedRegion))) {
      failures.add('FAILED_TEMPLATE_ELEMENT_OVERLAP');
    }
    if (element.fontRole && !descriptor.allowedFontRoles.includes(element.fontRole)) {
      failures.add('FAILED_TEMPLATE_FONT_ROLE_MISMATCH');
    }
    if (element.text && element.text.trim() && element.kind !== 'TIME_BADGE') {
      if (!element.textColor || element.textColor !== region.textColor) {
        failures.add('FAILED_TEMPLATE_CONTRAST_MISMATCH');
      }
    }
    if (
      element.fontSizePx !== undefined &&
      (!Number.isFinite(element.fontSizePx) || element.fontSizePx <= 0)
    ) {
      failures.add('FAILED_TEMPLATE_GEOMETRY_INVALID');
    }
  }

  return result(failures, {
    templateId: descriptor.templateId,
    templateFamily: descriptor.family,
    referenceFile: descriptor.referenceFile,
    libraryId: SUNSET_REFERENCE_TEMPLATE_LIBRARY_ID,
    libraryVersion: SUNSET_REFERENCE_TEMPLATE_LIBRARY_VERSION,
    analysisId: plan.analysisId,
    analysisStatus: plan.analysisStatus,
    referenceReviewStatus: plan.referenceReviewStatus,
    requiredElements: descriptor.requiredElements,
    observedElements: [...kinds],
    safeRegionCount: plan.safeRegions.length,
    protectedRegionCount: plan.protectedRegions.length,
    footerMode: plan.footerMode,
    backgroundTreatment: plan.backgroundTreatment,
  });
}

function isTemplateLibraryMirrorInSync(): boolean {
  try {
    const mirror = JSON.parse(
      readFileSync(resolve(process.cwd(), SUNSET_TEMPLATE_LIBRARY_MIRROR_PATH), 'utf8'),
    ) as {
      library_id?: string;
      version?: string;
      templates?: Array<{ reference_template_id?: string }>;
    };
    const mirrorIds = new Set(
      (mirror.templates ?? []).map((template) => template.reference_template_id).filter(Boolean),
    );
    return (
      mirror.library_id === SUNSET_REFERENCE_TEMPLATE_LIBRARY_ID &&
      mirror.version === SUNSET_REFERENCE_TEMPLATE_LIBRARY_VERSION &&
      mirrorIds.size === descriptors.length &&
      descriptors.every((descriptor) => mirrorIds.has(descriptor.templateId))
    );
  } catch {
    return false;
  }
}

function result(
  failures: ReadonlySet<CreativeTruthFailureCode>,
  evidence: Readonly<Record<string, unknown>>,
): CreativeTruthGateResult {
  return {
    gate: 'TEMPLATE',
    status: failures.size === 0 ? 'PASSED' : 'FAILED',
    failureCodes: [...failures],
    evidence,
  };
}

function validRect(rect: SunsetRect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.x + rect.width <= 1080 &&
    rect.y + rect.height <= 1920
  );
}

function intersects(left: SunsetRect, right: SunsetRect): boolean {
  return !(
    left.x + left.width <= right.x ||
    right.x + right.width <= left.x ||
    left.y + left.height <= right.y ||
    right.y + right.height <= left.y
  );
}
