import { createHash } from 'node:crypto';
import * as z from 'zod/v4';

export const assetFormatSchema = z.enum(['FEED', 'STORIES', 'REEL_COVER', 'AD']);
export const assetLineageKindSchema = z.enum([
  'SOURCE',
  'DERIVATIVE',
  'MASTER_CANDIDATE',
  'MASTER',
]);
export const assetMasterStateSchema = z.enum(['NOT_MASTER', 'CANDIDATE', 'APPROVED_MASTER']);
export const assetRightsStatusSchema = z.enum([
  'UNKNOWN',
  'CLEARED',
  'RESTRICTED',
  'EXPIRED',
  'BLOCKED',
]);
export const assetTimeOfDaySchema = z.enum([
  'UNKNOWN',
  'DAWN',
  'DAY',
  'GOLDEN_HOUR',
  'SUNSET',
  'NIGHT',
]);
export const assetCrowdLevelSchema = z.enum([
  'UNKNOWN',
  'EMPTY',
  'LOW',
  'MEDIUM',
  'HIGH',
  'PACKED',
]);
export const assetMarketingReadinessSchema = z.enum(['NOT_READY', 'REVIEW_REQUIRED', 'READY']);
export const creativeTruthVerdictSchema = z.enum(['UNKNOWN', 'VERIFIED', 'REJECTED']);

export const assetFormatFitnessSchema = z.object({
  FEED: z.number().min(0).max(100),
  STORIES: z.number().min(0).max(100),
  REEL_COVER: z.number().min(0).max(100),
  AD: z.number().min(0).max(100),
});

export const creativeTruthReadbackSchema = z.object({
  venueFidelity: creativeTruthVerdictSchema,
  brandIntegrity: creativeTruthVerdictSchema,
  finalAssetEligibility: creativeTruthVerdictSchema,
  evidenceRef: z.string().trim().min(1).nullable(),
  readAt: z.string().trim().min(1).nullable(),
});

export const assetRestrictionSchema = z.object({
  code: z.string().trim().min(1),
  blocking: z.boolean(),
  appliesToFormats: z.array(assetFormatSchema),
  appliesToChannels: z.array(z.string().trim().min(1)),
  expiresAt: z.string().trim().min(1).nullable(),
  notes: z.string().trim().min(1).nullable(),
});

export const assetIntelligenceRecordSchema = z.object({
  assetId: z.string().trim().min(1),
  tenantId: z.string().trim().min(1),
  workspaceId: z.string().trim().min(1),
  organizationId: z.string().trim().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  perceptualHash: z.string().regex(/^[01]{64}$/),
  sourceAssetId: z.string().trim().min(1).nullable(),
  masterAssetId: z.string().trim().min(1).nullable(),
  lineageKind: assetLineageKindSchema,
  masterState: assetMasterStateSchema,
  masterApprovalEvidenceId: z.string().trim().min(1).nullable(),
  rightsStatus: assetRightsStatusSchema,
  rightsExpiresAt: z.string().trim().min(1).nullable(),
  rightsScope: z.array(z.string().trim().min(1)),
  photographer: z.string().trim().min(1).nullable(),
  owner: z.string().trim().min(1).nullable(),
  venueId: z.string().trim().min(1).nullable(),
  area: z.string().trim().min(1).nullable(),
  timeOfDay: assetTimeOfDaySchema,
  crowdLevel: assetCrowdLevelSchema,
  qualityScore: z.number().min(0).max(100),
  formatFitness: assetFormatFitnessSchema,
  eventContext: z.array(z.string().trim().min(1)),
  restrictions: z.array(assetRestrictionSchema),
  marketingReadiness: assetMarketingReadinessSchema,
  creativeTruth: creativeTruthReadbackSchema,
  createdAt: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1),
});

export const assetUsageRecordSchema = z.object({
  usageId: z.string().trim().min(1),
  assetId: z.string().trim().min(1),
  contentItemId: z.string().trim().min(1),
  channel: z.string().trim().min(1),
  format: assetFormatSchema,
  usedAt: z.string().trim().min(1),
  idempotencyKey: z.string().trim().min(1),
});

export const assetPerformanceRecordSchema = z.object({
  performanceId: z.string().trim().min(1),
  assetId: z.string().trim().min(1),
  channel: z.string().trim().min(1),
  observedAt: z.string().trim().min(1),
  performanceScore: z.number().min(0).max(100),
  impressions: z.number().int().nonnegative(),
  reach: z.number().int().nonnegative(),
  engagements: z.number().int().nonnegative(),
  clicks: z.number().int().nonnegative(),
  conversions: z.number().int().nonnegative(),
});

export const assetCandidateSnapshotSchema = assetIntelligenceRecordSchema.extend({
  usageCount: z.number().int().nonnegative(),
  usesLast14Days: z.number().int().nonnegative(),
  lastUsedAt: z.string().trim().min(1).nullable(),
  recentPerformanceScore: z.number().min(0).max(100).nullable(),
  previousPerformanceScore: z.number().min(0).max(100).nullable(),
});

export type AssetFormat = z.infer<typeof assetFormatSchema>;
export type AssetIntelligenceRecord = z.infer<typeof assetIntelligenceRecordSchema>;
export type AssetUsageRecord = z.infer<typeof assetUsageRecordSchema>;
export type AssetPerformanceRecord = z.infer<typeof assetPerformanceRecordSchema>;
export type AssetCandidateSnapshot = z.infer<typeof assetCandidateSnapshotSchema>;

export interface RightsEligibility {
  readonly eligible: boolean;
  readonly reason:
    'RIGHTS_CLEARED' | 'RIGHTS_UNKNOWN' | 'RIGHTS_RESTRICTED' | 'RIGHTS_EXPIRED' | 'RIGHTS_BLOCKED';
}

export interface FatigueAssessment {
  readonly score: number;
  readonly fatigued: boolean;
  readonly usagePressure: number;
  readonly performanceDecay: number;
}

export function sha256Hex(input: Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

export function computeDHash64(lumaRows: readonly (readonly number[])[]): string {
  if (lumaRows.length !== 8) throw new Error('ASSET_PHASH_REQUIRES_8_ROWS');
  const bits: string[] = [];
  for (const row of lumaRows) {
    if (row.length !== 9) throw new Error('ASSET_PHASH_REQUIRES_9_COLUMNS');
    for (const value of row) {
      if (!Number.isFinite(value) || value < 0 || value > 255) {
        throw new Error('ASSET_PHASH_LUMA_OUT_OF_RANGE');
      }
    }
    for (let column = 0; column < 8; column += 1) {
      const left = row[column];
      const right = row[column + 1];
      if (left === undefined || right === undefined) throw new Error('ASSET_PHASH_GRID_INVALID');
      bits.push(left > right ? '1' : '0');
    }
  }
  return bits.join('');
}

export function perceptualHashDistance(left: string, right: string): number {
  if (!/^[01]{64}$/.test(left) || !/^[01]{64}$/.test(right)) {
    throw new Error('ASSET_PHASH_INVALID');
  }
  let distance = 0;
  for (let index = 0; index < 64; index += 1) {
    if (left[index] !== right[index]) distance += 1;
  }
  return distance;
}

export function assertAssetIntelligenceRecord(
  input: AssetIntelligenceRecord,
): AssetIntelligenceRecord {
  const record = assetIntelligenceRecordSchema.parse(input);
  if (record.sourceAssetId === record.assetId || record.masterAssetId === record.assetId) {
    throw new Error('ASSET_LINEAGE_SELF_REFERENCE');
  }
  if (record.lineageKind === 'DERIVATIVE' && record.sourceAssetId === null) {
    throw new Error('ASSET_DERIVATIVE_SOURCE_REQUIRED');
  }
  if (record.lineageKind === 'MASTER' && record.masterState !== 'APPROVED_MASTER') {
    throw new Error('ASSET_MASTER_APPROVAL_REQUIRED');
  }
  if (record.masterState === 'APPROVED_MASTER' && record.masterApprovalEvidenceId === null) {
    throw new Error('ASSET_MASTER_APPROVAL_EVIDENCE_REQUIRED');
  }
  if (
    record.creativeTruth.finalAssetEligibility === 'VERIFIED' &&
    record.creativeTruth.evidenceRef === null
  ) {
    throw new Error('ASSET_CREATIVE_TRUTH_EVIDENCE_REQUIRED');
  }
  return record;
}

export function resolveRightsEligibility(
  asset: Pick<AssetIntelligenceRecord, 'rightsStatus' | 'rightsExpiresAt'>,
  now: Date,
): RightsEligibility {
  if (asset.rightsStatus === 'UNKNOWN') return { eligible: false, reason: 'RIGHTS_UNKNOWN' };
  if (asset.rightsStatus === 'RESTRICTED') return { eligible: false, reason: 'RIGHTS_RESTRICTED' };
  if (asset.rightsStatus === 'EXPIRED') return { eligible: false, reason: 'RIGHTS_EXPIRED' };
  if (asset.rightsStatus === 'BLOCKED') return { eligible: false, reason: 'RIGHTS_BLOCKED' };
  if (asset.rightsExpiresAt !== null) {
    const expiry = Date.parse(asset.rightsExpiresAt);
    if (!Number.isFinite(expiry) || expiry <= now.getTime()) {
      return { eligible: false, reason: 'RIGHTS_EXPIRED' };
    }
  }
  return { eligible: true, reason: 'RIGHTS_CLEARED' };
}

export function hasBlockingRestriction(
  asset: Pick<AssetIntelligenceRecord, 'restrictions'>,
  format: AssetFormat,
  channel: string,
  now: Date,
): boolean {
  return asset.restrictions.some((restriction) => {
    if (!restriction.blocking) return false;
    if (restriction.expiresAt !== null) {
      const expiry = Date.parse(restriction.expiresAt);
      if (Number.isFinite(expiry) && expiry <= now.getTime()) return false;
    }
    const formatApplies =
      restriction.appliesToFormats.length === 0 || restriction.appliesToFormats.includes(format);
    const channelApplies =
      restriction.appliesToChannels.length === 0 || restriction.appliesToChannels.includes(channel);
    return formatApplies && channelApplies;
  });
}

export function creativeTruthAllowsMarketing(
  asset: Pick<AssetIntelligenceRecord, 'creativeTruth'>,
): boolean {
  return (
    asset.creativeTruth.venueFidelity === 'VERIFIED' &&
    asset.creativeTruth.brandIntegrity === 'VERIFIED' &&
    asset.creativeTruth.finalAssetEligibility === 'VERIFIED' &&
    asset.creativeTruth.evidenceRef !== null
  );
}

export function detectFatigue(asset: AssetCandidateSnapshot, threshold = 60): FatigueAssessment {
  const usagePressure = Math.min(60, asset.usesLast14Days * 15);
  const recent = asset.recentPerformanceScore;
  const previous = asset.previousPerformanceScore;
  const performanceDecay =
    recent === null || previous === null || previous <= 0
      ? 0
      : Math.min(40, Math.max(0, ((previous - recent) / previous) * 100) * 0.4);
  const score = Math.round((usagePressure + performanceDecay) * 100) / 100;
  return {
    score,
    fatigued: score >= threshold,
    usagePressure,
    performanceDecay: Math.round(performanceDecay * 100) / 100,
  };
}
