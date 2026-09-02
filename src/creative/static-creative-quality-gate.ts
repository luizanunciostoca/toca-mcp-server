import * as z from 'zod/v4';
import { ExecutionError } from '../core/errors.js';

export const TOCA_STATIC_CREATIVE_QUALITY_POLICY_ID =
  'TOCA_STATIC_CREATIVE_QUALITY_POLICY_V1' as const;
export const TOCA_STATIC_CREATIVE_QUALITY_POLICY_VERSION = '1.0' as const;
export const STATIC_CREATIVE_MAX_UPSCALE_RATIO = 1.5 as const;

export const staticCreativeFormatSchema = z.enum(['STORY_9_16', 'FEED_4_5', 'FEED_1_1']);
export type StaticCreativeFormat = z.infer<typeof staticCreativeFormatSchema>;

export const STATIC_CREATIVE_FORMAT_PROFILES = {
  STORY_9_16: {
    width: 1080,
    height: 1920,
    safeArea: { leftPx: 72, rightPx: 72, topPx: 250, bottomPx: 250 },
  },
  FEED_4_5: {
    width: 1080,
    height: 1350,
    safeArea: { leftPx: 64, rightPx: 64, topPx: 80, bottomPx: 80 },
  },
  FEED_1_1: {
    width: 1080,
    height: 1080,
    safeArea: { leftPx: 64, rightPx: 64, topPx: 64, bottomPx: 64 },
  },
} as const satisfies Record<
  StaticCreativeFormat,
  {
    readonly width: number;
    readonly height: number;
    readonly safeArea: {
      readonly leftPx: number;
      readonly rightPx: number;
      readonly topPx: number;
      readonly bottomPx: number;
    };
  }
>;

export const staticCreativeGateStatusSchema = z.enum(['PASS', 'FAIL', 'NOT_APPLICABLE']);
export type StaticCreativeGateStatus = z.infer<typeof staticCreativeGateStatusSchema>;

export const staticCreativeSourceRoleSchema = z.enum([
  'ORIGINAL_MASTER',
  'REFERENCE_TEMPLATE',
  'DERIVED_RASTER',
]);
export type StaticCreativeSourceRole = z.infer<typeof staticCreativeSourceRoleSchema>;

export const staticCreativeQualityEvidenceSchema = z.object({
  evidenceId: z.string().min(1),
  assetId: z.string().min(1),
  outputSha256: z.string().regex(/^[a-f0-9]{64}$/),
  policyId: z.literal(TOCA_STATIC_CREATIVE_QUALITY_POLICY_ID),
  policyVersion: z.literal(TOCA_STATIC_CREATIVE_QUALITY_POLICY_VERSION),
  format: staticCreativeFormatSchema,
  overallStatus: z.enum(['PASS', 'FAIL']),
  sourceRole: staticCreativeSourceRoleSchema,
  sourceLineageStatus: staticCreativeGateStatusSchema,
  exactSourceMasterBinding: z.boolean(),
  sourceMasterSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  sourceResolutionStatus: staticCreativeGateStatusSchema,
  effectiveUpscaleRatio: z.number().finite().positive(),
  safeAreaStatus: staticCreativeGateStatusSchema,
  typographyStatus: staticCreativeGateStatusSchema,
  rightsStatus: staticCreativeGateStatusSchema,
  brandIntegrityStatus: staticCreativeGateStatusSchema,
  venueFidelityStatus: staticCreativeGateStatusSchema,
  copyQaStatus: staticCreativeGateStatusSchema,
  informationQaStatus: staticCreativeGateStatusSchema,
  visualArtifactStatus: staticCreativeGateStatusSchema,
  failureCodes: z.array(z.string().min(1)),
});

export type StaticCreativeQualityEvidence = z.infer<typeof staticCreativeQualityEvidenceSchema>;

export type StaticCreativeLayoutRole =
  | 'HEADLINE'
  | 'SUPPORT'
  | 'CTA'
  | 'BRAND'
  | 'FOOTER'
  | 'DECORATION';

export interface StaticCreativeLayoutElement {
  readonly id: string;
  readonly role: StaticCreativeLayoutRole;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type StaticCreativeOverlayStyle =
  | 'NONE'
  | 'SOFT_GRADIENT'
  | 'LOCAL_CONTRAST'
  | 'LOCAL_PANEL'
  | 'HARD_FULL_WIDTH_PANEL';

export interface StaticCreativeQualityCandidate {
  readonly evidenceId: string;
  readonly assetId: string;
  readonly outputSha256: string;
  readonly format: StaticCreativeFormat;
  readonly sourceRole: StaticCreativeSourceRole;
  readonly sourceMasterSha256?: string;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly outputWidth: number;
  readonly outputHeight: number;
  readonly layoutElements: readonly StaticCreativeLayoutElement[];
  readonly overlayStyle: StaticCreativeOverlayStyle;
  readonly typographyCanonicalPinned: boolean;
  readonly typographyRequired: boolean;
  readonly rightsStatus: StaticCreativeGateStatus;
  readonly brandIntegrityStatus: StaticCreativeGateStatus;
  readonly venueFidelityStatus: StaticCreativeGateStatus;
  readonly copyQaStatus: StaticCreativeGateStatus;
  readonly informationQaStatus: StaticCreativeGateStatus;
}

export function evaluateStaticCreativeQuality(
  candidate: StaticCreativeQualityCandidate,
): StaticCreativeQualityEvidence {
  validateCandidate(candidate);

  const failureCodes: string[] = [];
  const exactSourceMasterBinding =
    candidate.sourceRole === 'ORIGINAL_MASTER' && Boolean(candidate.sourceMasterSha256);
  const sourceLineageStatus: StaticCreativeGateStatus = exactSourceMasterBinding ? 'PASS' : 'FAIL';
  if (sourceLineageStatus !== 'PASS') failureCodes.push('STATIC_CREATIVE_SOURCE_MASTER_REQUIRED');

  const effectiveUpscaleRatio = Math.max(
    candidate.outputWidth / candidate.sourceWidth,
    candidate.outputHeight / candidate.sourceHeight,
  );
  const sourceResolutionStatus: StaticCreativeGateStatus =
    effectiveUpscaleRatio <= STATIC_CREATIVE_MAX_UPSCALE_RATIO ? 'PASS' : 'FAIL';
  if (sourceResolutionStatus !== 'PASS') failureCodes.push('STATIC_CREATIVE_SOURCE_RESOLUTION_TOO_LOW');

  const safeAreaStatus = validateSafeArea(candidate);
  if (safeAreaStatus !== 'PASS') failureCodes.push('STATIC_CREATIVE_SAFE_AREA_VIOLATION');

  const typographyStatus: StaticCreativeGateStatus = candidate.typographyRequired
    ? candidate.typographyCanonicalPinned
      ? 'PASS'
      : 'FAIL'
    : 'NOT_APPLICABLE';
  if (typographyStatus === 'FAIL') failureCodes.push('STATIC_CREATIVE_CANONICAL_FONT_PIN_REQUIRED');

  const visualArtifactStatus: StaticCreativeGateStatus =
    candidate.overlayStyle === 'HARD_FULL_WIDTH_PANEL' ? 'FAIL' : 'PASS';
  if (visualArtifactStatus !== 'PASS') failureCodes.push('STATIC_CREATIVE_HARD_PANEL_FORBIDDEN');

  requirePassOrNotApplicable(candidate.rightsStatus, 'STATIC_CREATIVE_RIGHTS_NOT_READY', failureCodes);
  requirePassOrNotApplicable(
    candidate.brandIntegrityStatus,
    'STATIC_CREATIVE_BRAND_INTEGRITY_NOT_READY',
    failureCodes,
  );
  requirePassOrNotApplicable(
    candidate.venueFidelityStatus,
    'STATIC_CREATIVE_VENUE_FIDELITY_NOT_READY',
    failureCodes,
  );
  requirePassOrNotApplicable(candidate.copyQaStatus, 'STATIC_CREATIVE_COPY_QA_NOT_READY', failureCodes);
  requirePassOrNotApplicable(
    candidate.informationQaStatus,
    'STATIC_CREATIVE_INFORMATION_QA_NOT_READY',
    failureCodes,
  );

  return staticCreativeQualityEvidenceSchema.parse({
    evidenceId: candidate.evidenceId,
    assetId: candidate.assetId,
    outputSha256: candidate.outputSha256.toLowerCase(),
    policyId: TOCA_STATIC_CREATIVE_QUALITY_POLICY_ID,
    policyVersion: TOCA_STATIC_CREATIVE_QUALITY_POLICY_VERSION,
    format: candidate.format,
    overallStatus: failureCodes.length === 0 ? 'PASS' : 'FAIL',
    sourceRole: candidate.sourceRole,
    sourceLineageStatus,
    exactSourceMasterBinding,
    ...(candidate.sourceMasterSha256
      ? { sourceMasterSha256: candidate.sourceMasterSha256.toLowerCase() }
      : {}),
    sourceResolutionStatus,
    effectiveUpscaleRatio,
    safeAreaStatus,
    typographyStatus,
    rightsStatus: candidate.rightsStatus,
    brandIntegrityStatus: candidate.brandIntegrityStatus,
    venueFidelityStatus: candidate.venueFidelityStatus,
    copyQaStatus: candidate.copyQaStatus,
    informationQaStatus: candidate.informationQaStatus,
    visualArtifactStatus,
    failureCodes,
  });
}

export function assertStaticCreativePublicationReady(
  evidence: StaticCreativeQualityEvidence,
  expected: { readonly assetId: string; readonly outputSha256: string },
): void {
  const parsed = staticCreativeQualityEvidenceSchema.parse(evidence);
  if (parsed.assetId !== expected.assetId) deny('STATIC_CREATIVE_QUALITY_ASSET_ID_MISMATCH');
  if (parsed.outputSha256 !== expected.outputSha256.toLowerCase()) {
    deny('STATIC_CREATIVE_QUALITY_OUTPUT_SHA256_MISMATCH');
  }
  if (parsed.overallStatus !== 'PASS') {
    deny(`STATIC_CREATIVE_QUALITY_NOT_READY:${parsed.failureCodes.join(',') || 'UNKNOWN'}`);
  }
  if (!parsed.exactSourceMasterBinding || parsed.sourceLineageStatus !== 'PASS') {
    deny('STATIC_CREATIVE_QUALITY_EXACT_MASTER_BINDING_REQUIRED');
  }
  for (const [name, status] of Object.entries({
    sourceResolutionStatus: parsed.sourceResolutionStatus,
    safeAreaStatus: parsed.safeAreaStatus,
    typographyStatus: parsed.typographyStatus,
    rightsStatus: parsed.rightsStatus,
    brandIntegrityStatus: parsed.brandIntegrityStatus,
    venueFidelityStatus: parsed.venueFidelityStatus,
    copyQaStatus: parsed.copyQaStatus,
    informationQaStatus: parsed.informationQaStatus,
    visualArtifactStatus: parsed.visualArtifactStatus,
  })) {
    if (status === 'FAIL') deny(`STATIC_CREATIVE_QUALITY_GATE_FAILED:${name}`);
  }
}

function validateSafeArea(candidate: StaticCreativeQualityCandidate): StaticCreativeGateStatus {
  const profile = STATIC_CREATIVE_FORMAT_PROFILES[candidate.format];
  if (candidate.outputWidth !== profile.width || candidate.outputHeight !== profile.height) {
    return 'FAIL';
  }

  const safe = profile.safeArea;
  const right = candidate.outputWidth - safe.rightPx;
  const bottom = candidate.outputHeight - safe.bottomPx;
  const protectedRoles = new Set<StaticCreativeLayoutRole>([
    'HEADLINE',
    'SUPPORT',
    'CTA',
    'BRAND',
    'FOOTER',
  ]);

  for (const element of candidate.layoutElements) {
    if (!protectedRoles.has(element.role)) continue;
    if (
      element.x < safe.leftPx ||
      element.y < safe.topPx ||
      element.x + element.width > right ||
      element.y + element.height > bottom
    ) {
      return 'FAIL';
    }
  }
  return 'PASS';
}

function validateCandidate(candidate: StaticCreativeQualityCandidate): void {
  if (!candidate.evidenceId.trim() || !candidate.assetId.trim()) {
    deny('STATIC_CREATIVE_QUALITY_ID_REQUIRED');
  }
  if (!/^[a-f0-9]{64}$/i.test(candidate.outputSha256)) {
    deny('STATIC_CREATIVE_QUALITY_OUTPUT_SHA256_INVALID');
  }
  if (candidate.sourceMasterSha256 && !/^[a-f0-9]{64}$/i.test(candidate.sourceMasterSha256)) {
    deny('STATIC_CREATIVE_QUALITY_SOURCE_SHA256_INVALID');
  }
  for (const value of [
    candidate.sourceWidth,
    candidate.sourceHeight,
    candidate.outputWidth,
    candidate.outputHeight,
  ]) {
    if (!Number.isInteger(value) || value <= 0) deny('STATIC_CREATIVE_QUALITY_DIMENSIONS_INVALID');
  }
  for (const element of candidate.layoutElements) {
    if (
      !element.id.trim() ||
      ![element.x, element.y, element.width, element.height].every(
        (value) => Number.isFinite(value) && value >= 0,
      ) ||
      element.width <= 0 ||
      element.height <= 0
    ) {
      deny('STATIC_CREATIVE_QUALITY_LAYOUT_INVALID');
    }
  }
}

function requirePassOrNotApplicable(
  status: StaticCreativeGateStatus,
  failureCode: string,
  failureCodes: string[],
): void {
  if (status === 'FAIL') failureCodes.push(failureCode);
}

function deny(message: string): never {
  throw new ExecutionError('QUALITY_GATE_FAILED', message, false);
}
