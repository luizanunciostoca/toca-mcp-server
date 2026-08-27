import type { SunsetStoryTemplateId } from './sunset-story-template-registry.js';

export type SunsetStoryTypographyRole =
  | 'EDITORIAL_DIDONE_HEADLINE'
  | 'GEOMETRIC_SANS_DISPLAY_HEAVY'
  | 'GEOMETRIC_SANS_SUPPORT'
  | 'CLEAN_SANS_TIME'
  | 'CLEAN_SANS_CTA'
  | 'CLEAN_SANS_HASHTAG';

export interface SunsetStoryTypographyAssignment {
  readonly fontRole: SunsetStoryTypographyRole;
  readonly fontWeight: 400 | 500 | 600 | 700 | 800 | 900;
  readonly letterSpacingEm: number;
  readonly sourceManualDocumentId: string;
}

const MANUAL_DOCUMENT_IDS: Readonly<Record<SunsetStoryTemplateId, string>> = {
  SUNSET_TEMPLATE_MASTER_V1: '1TIyMvn4w_WANPjD7jICSWjsUBtoU7nA6oTc3GjJJ8FY',
  SUNSET_TEMPLATE_MASTER_V2: '1eAPaQywMVWkNOSZbBtzCUy5dkO_mzZJaIafrIV1_67U',
  SUNSET_TEMPLATE_MASTER_V3: '1ykBBMROCVwZZifQn067QFAuLhQ15lMKnuarplWdFI4c',
  SUNSET_TEMPLATE_MASTER_V4: '1MAYim7kFREF1F5x5xnqelPZB8eKX9TRAOstYIPJHNKM',
  SUNSET_TEMPLATE_MASTER_V5: '11U_zPmQIEApQQYEzOJjrAp-q82rYLG9SeELyYXaRK4M',
  SUNSET_TEMPLATE_MASTER_V6: '1lFkBQZuyMBtQ-sdXuQiPJHhLIZXJPKzpU8d56zJkCCs',
  SUNSET_TEMPLATE_MASTER_V7: '1nQZa6yNoJCTCGYXkORCdhgZBMNypSS8l7n3JsdCVuKg',
  SUNSET_TEMPLATE_MASTER_V8: '1UohaVZnzvzbQAa-50wZf_CG6U0jngmo6eMp5zKSNXKI',
  SUNSET_TEMPLATE_MASTER_V9: '1seSp3GmQ4alvbzPK35FXkLyLvq1W7XQ7y2LAt6SJctE',
};

const DIDONE: Omit<SunsetStoryTypographyAssignment, 'sourceManualDocumentId'> = {
  fontRole: 'EDITORIAL_DIDONE_HEADLINE',
  fontWeight: 400,
  letterSpacingEm: -0.02,
};

const HEAVY_SANS: Omit<SunsetStoryTypographyAssignment, 'sourceManualDocumentId'> = {
  fontRole: 'GEOMETRIC_SANS_DISPLAY_HEAVY',
  fontWeight: 900,
  letterSpacingEm: -0.03,
};

const SUPPORT_SANS: Omit<SunsetStoryTypographyAssignment, 'sourceManualDocumentId'> = {
  fontRole: 'GEOMETRIC_SANS_SUPPORT',
  fontWeight: 600,
  letterSpacingEm: 0,
};

const UTILITY_SANS: Omit<SunsetStoryTypographyAssignment, 'sourceManualDocumentId'> = {
  fontRole: 'CLEAN_SANS_CTA',
  fontWeight: 500,
  letterSpacingEm: 0,
};

function withManual(
  templateId: SunsetStoryTemplateId,
  assignment: Omit<SunsetStoryTypographyAssignment, 'sourceManualDocumentId'>,
): SunsetStoryTypographyAssignment {
  return { ...assignment, sourceManualDocumentId: MANUAL_DOCUMENT_IDS[templateId] };
}

function supportLineNumber(elementId: string): number | null {
  const match = /(?:SUPPORTSTRIPS|SUPPORT)[._](\d+)/i.exec(elementId);
  if (!match?.[1]) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function isDisplayHeadlineId(templateId: SunsetStoryTemplateId, id: string): boolean {
  if (id.includes('HEADLINE') || id.includes('SUBHEADLINE')) return true;
  return templateId === 'SUNSET_TEMPLATE_MASTER_V2' && id.includes('DISPLAYLINE');
}

export function resolveSunsetStoryManualTypography(
  templateId: SunsetStoryTemplateId,
  elementId: string,
): SunsetStoryTypographyAssignment {
  const id = elementId.toUpperCase();

  if (isDisplayHeadlineId(templateId, id)) {
    if (templateId === 'SUNSET_TEMPLATE_MASTER_V2' || templateId === 'SUNSET_TEMPLATE_MASTER_V3') {
      return withManual(templateId, {
        ...HEAVY_SANS,
        fontWeight: templateId === 'SUNSET_TEMPLATE_MASTER_V3' ? 800 : 900,
      });
    }
    return withManual(templateId, DIDONE);
  }

  if (id.includes('SUPPORT')) {
    if (templateId === 'SUNSET_TEMPLATE_MASTER_V6') {
      const line = supportLineNumber(id);
      const weight = line === 2 ? 500 : 700;
      return withManual(templateId, { ...SUPPORT_SANS, fontWeight: weight });
    }
    return withManual(templateId, SUPPORT_SANS);
  }

  if (id.includes('TIME') || id.includes('HORARIO') || id.includes('HORÁRIO')) {
    return withManual(templateId, {
      fontRole: 'CLEAN_SANS_TIME',
      fontWeight: 500,
      letterSpacingEm: 0,
    });
  }

  if (id.includes('HASHTAG')) {
    return withManual(templateId, {
      fontRole: 'CLEAN_SANS_HASHTAG',
      fontWeight: 500,
      letterSpacingEm: 0,
    });
  }

  if (id.includes('CTA')) return withManual(templateId, UTILITY_SANS);

  return withManual(templateId, UTILITY_SANS);
}

export function sunsetStoryTypographyManualDocumentId(templateId: SunsetStoryTemplateId): string {
  return MANUAL_DOCUMENT_IDS[templateId];
}
