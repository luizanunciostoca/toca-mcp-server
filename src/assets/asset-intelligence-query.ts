import * as z from 'zod/v4';
import {
  assetCandidateSnapshotSchema,
  assetFormatSchema,
  creativeTruthAllowsMarketing,
  detectFatigue,
  hasBlockingRestriction,
  resolveRightsEligibility,
  type AssetCandidateSnapshot,
  type AssetFormat,
} from './asset-intelligence.js';

export const assetIntelligenceQueryModeSchema = z.enum([
  'FIND_ELIGIBLE',
  'FIND_VENUE_VERIFIED',
  'FIND_UNUSED',
  'FIND_TOP_PERFORMING',
  'DETECT_FATIGUE',
  'RESOLVE_RIGHTS',
]);

export const assetIntelligenceQuerySchema = z.object({
  mode: assetIntelligenceQueryModeSchema,
  tenantId: z.string().trim().min(1),
  workspaceId: z.string().trim().min(1),
  organizationId: z.string().trim().min(1),
  format: assetFormatSchema,
  channel: z.string().trim().min(1),
  venueId: z.string().trim().min(1).nullable(),
  eventContext: z.string().trim().min(1).nullable(),
  unusedSince: z.string().trim().min(1).nullable(),
  minQualityScore: z.number().min(0).max(100),
  minFormatFitness: z.number().min(0).max(100),
  fatigueThreshold: z.number().min(0).max(100),
  limit: z.number().int().min(1).max(100),
});

export const marketingAutopilotAssetCandidateSchema = z.object({
  assetId: z.string().trim().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  masterAssetId: z.string().trim().min(1).nullable(),
  venueId: z.string().trim().min(1).nullable(),
  area: z.string().trim().min(1).nullable(),
  qualityScore: z.number().min(0).max(100),
  formatFitness: z.number().min(0).max(100),
  rightsEligible: z.boolean(),
  creativeTruthEligible: z.boolean(),
  marketingReady: z.boolean(),
  usageCount: z.number().int().nonnegative(),
  lastUsedAt: z.string().trim().min(1).nullable(),
  performanceScore: z.number().min(0).max(100).nullable(),
  fatigueScore: z.number().min(0).max(100),
  fatigued: z.boolean(),
  creativeTruthEvidenceRef: z.string().trim().min(1).nullable(),
});

export const marketingAutopilotAssetQueryResultSchema = z.object({
  mode: assetIntelligenceQueryModeSchema,
  authority: z.literal('TOCA_OS_ASSET_INTELLIGENCE_WITH_CREATIVE_TRUTH_READBACK'),
  candidates: z.array(marketingAutopilotAssetCandidateSchema),
});

export type AssetIntelligenceQuery = z.infer<typeof assetIntelligenceQuerySchema>;
export type MarketingAutopilotAssetQueryResult = z.infer<
  typeof marketingAutopilotAssetQueryResultSchema
>;

type CandidateResult = z.infer<typeof marketingAutopilotAssetCandidateSchema>;

function formatFitness(asset: AssetCandidateSnapshot, format: AssetFormat): number {
  return asset.formatFitness[format];
}

function isInScope(asset: AssetCandidateSnapshot, query: AssetIntelligenceQuery): boolean {
  if (asset.tenantId !== query.tenantId) return false;
  if (asset.workspaceId !== query.workspaceId) return false;
  if (asset.organizationId !== query.organizationId) return false;
  if (query.venueId !== null && asset.venueId !== query.venueId) return false;
  if (query.eventContext !== null && !asset.eventContext.includes(query.eventContext)) return false;
  return true;
}

function toCandidate(
  asset: AssetCandidateSnapshot,
  query: AssetIntelligenceQuery,
  now: Date,
): CandidateResult {
  const rights = resolveRightsEligibility(asset, now);
  const creativeTruthEligible = creativeTruthAllowsMarketing(asset);
  const blockingRestriction = hasBlockingRestriction(asset, query.format, query.channel, now);
  const marketingReady =
    asset.marketingReadiness === 'READY' &&
    rights.eligible &&
    creativeTruthEligible &&
    !blockingRestriction &&
    asset.qualityScore >= query.minQualityScore &&
    formatFitness(asset, query.format) >= query.minFormatFitness;
  const fatigue = detectFatigue(asset, query.fatigueThreshold);

  return {
    assetId: asset.assetId,
    sha256: asset.sha256,
    masterAssetId: asset.masterAssetId,
    venueId: asset.venueId,
    area: asset.area,
    qualityScore: asset.qualityScore,
    formatFitness: formatFitness(asset, query.format),
    rightsEligible: rights.eligible,
    creativeTruthEligible,
    marketingReady,
    usageCount: asset.usageCount,
    lastUsedAt: asset.lastUsedAt,
    performanceScore: asset.recentPerformanceScore,
    fatigueScore: fatigue.score,
    fatigued: fatigue.fatigued,
    creativeTruthEvidenceRef: asset.creativeTruth.evidenceRef,
  };
}

function compareDefault(left: CandidateResult, right: CandidateResult): number {
  if (left.marketingReady !== right.marketingReady) return left.marketingReady ? -1 : 1;
  if (left.fatigued !== right.fatigued) return left.fatigued ? 1 : -1;
  if (left.qualityScore !== right.qualityScore) return right.qualityScore - left.qualityScore;
  if (left.formatFitness !== right.formatFitness) return right.formatFitness - left.formatFitness;
  return left.assetId.localeCompare(right.assetId);
}

function compareTopPerforming(left: CandidateResult, right: CandidateResult): number {
  const leftPerformance = left.performanceScore ?? -1;
  const rightPerformance = right.performanceScore ?? -1;
  if (leftPerformance !== rightPerformance) return rightPerformance - leftPerformance;
  return compareDefault(left, right);
}

export function queryAssetIntelligence(
  rawQuery: AssetIntelligenceQuery,
  rawCandidates: readonly AssetCandidateSnapshot[],
  now: Date,
): MarketingAutopilotAssetQueryResult {
  const query = assetIntelligenceQuerySchema.parse(rawQuery);
  const candidates = rawCandidates.map((candidate) => assetCandidateSnapshotSchema.parse(candidate));
  const unusedSinceMs = query.unusedSince === null ? null : Date.parse(query.unusedSince);
  if (query.unusedSince !== null && !Number.isFinite(unusedSinceMs)) {
    throw new Error('ASSET_UNUSED_SINCE_INVALID');
  }

  const projected = candidates.filter((asset) => isInScope(asset, query)).map((asset) => ({
    source: asset,
    result: toCandidate(asset, query, now),
  }));

  const filtered = projected.filter(({ source, result }) => {
    if (query.mode === 'FIND_ELIGIBLE') return result.marketingReady && !result.fatigued;
    if (query.mode === 'FIND_VENUE_VERIFIED') {
      return source.creativeTruth.venueFidelity === 'VERIFIED' && source.creativeTruth.evidenceRef !== null;
    }
    if (query.mode === 'FIND_UNUSED') {
      if (source.lastUsedAt === null) return true;
      if (unusedSinceMs === null) return false;
      const lastUsedMs = Date.parse(source.lastUsedAt);
      return Number.isFinite(lastUsedMs) && lastUsedMs < unusedSinceMs;
    }
    if (query.mode === 'FIND_TOP_PERFORMING') return result.performanceScore !== null;
    if (query.mode === 'DETECT_FATIGUE') return result.fatigued;
    return true;
  });

  filtered.sort((left, right) => {
    if (query.mode === 'FIND_TOP_PERFORMING') {
      return compareTopPerforming(left.result, right.result);
    }
    if (query.mode === 'DETECT_FATIGUE') {
      if (left.result.fatigueScore !== right.result.fatigueScore) {
        return right.result.fatigueScore - left.result.fatigueScore;
      }
    }
    if (query.mode === 'FIND_UNUSED') {
      if (left.source.lastUsedAt === null && right.source.lastUsedAt !== null) return -1;
      if (left.source.lastUsedAt !== null && right.source.lastUsedAt === null) return 1;
      if (left.source.lastUsedAt !== null && right.source.lastUsedAt !== null) {
        const leftTime = Date.parse(left.source.lastUsedAt);
        const rightTime = Date.parse(right.source.lastUsedAt);
        if (leftTime !== rightTime) return leftTime - rightTime;
      }
    }
    return compareDefault(left.result, right.result);
  });

  return {
    mode: query.mode,
    authority: 'TOCA_OS_ASSET_INTELLIGENCE_WITH_CREATIVE_TRUTH_READBACK',
    candidates: filtered.slice(0, query.limit).map(({ result }) => result),
  };
}
