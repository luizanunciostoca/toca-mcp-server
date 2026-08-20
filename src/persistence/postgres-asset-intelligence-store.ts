import type pg from 'pg';
import { z } from 'zod/v4';
import {
  assertAssetIntelligenceRecord,
  assetCandidateSnapshotSchema,
  assetPerformanceRecordSchema,
  assetRestrictionSchema,
  assetUsageRecordSchema,
  type AssetCandidateSnapshot,
  type AssetIntelligenceRecord,
  type AssetPerformanceRecord,
  type AssetUsageRecord,
} from '../assets/asset-intelligence.js';

const stringArraySchema = z.array(z.string());
const restrictionArraySchema = z.array(assetRestrictionSchema);

export interface AssetScope {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
}

export interface AssetSourceRecord {
  readonly assetId: string;
  readonly provider: string;
  readonly sourceRef: string;
  readonly sourceKind: string;
  readonly isPrimary: boolean;
  readonly observedAt: string;
}

export interface AssetDuplicateMatch {
  readonly assetId: string;
  readonly sha256: string;
  readonly perceptualHash: string;
  readonly exact: boolean;
  readonly perceptualDistance: number;
}

interface AssetRow {
  readonly asset_id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly sha256: string;
  readonly perceptual_hash: string;
  readonly source_asset_id: string | null;
  readonly master_asset_id: string | null;
  readonly lineage_kind: AssetIntelligenceRecord['lineageKind'];
  readonly master_state: AssetIntelligenceRecord['masterState'];
  readonly master_approval_evidence_id: string | null;
  readonly rights_status: AssetIntelligenceRecord['rightsStatus'];
  readonly rights_expires_at: Date | string | null;
  readonly rights_scope: unknown;
  readonly photographer: string | null;
  readonly owner_name: string | null;
  readonly venue_id: string | null;
  readonly area: string | null;
  readonly time_of_day: AssetIntelligenceRecord['timeOfDay'];
  readonly crowd_level: AssetIntelligenceRecord['crowdLevel'];
  readonly quality_score: number | string;
  readonly feed_fitness: number | string;
  readonly stories_fitness: number | string;
  readonly reel_cover_fitness: number | string;
  readonly ad_fitness: number | string;
  readonly event_context: unknown;
  readonly restrictions: unknown;
  readonly marketing_readiness: AssetIntelligenceRecord['marketingReadiness'];
  readonly creative_truth_venue_fidelity: AssetIntelligenceRecord['creativeTruth']['venueFidelity'];
  readonly creative_truth_brand_integrity: AssetIntelligenceRecord['creativeTruth']['brandIntegrity'];
  readonly creative_truth_final_eligibility: AssetIntelligenceRecord['creativeTruth']['finalAssetEligibility'];
  readonly creative_truth_evidence_ref: string | null;
  readonly creative_truth_read_at: Date | string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface CandidateRow extends AssetRow {
  readonly usage_count: number | string;
  readonly uses_last_14_days: number | string;
  readonly last_used_at: Date | string | null;
  readonly recent_performance_score: number | string | null;
  readonly previous_performance_score: number | string | null;
}

interface DuplicateRow {
  readonly asset_id: string;
  readonly sha256: string;
  readonly perceptual_hash: string;
  readonly perceptual_distance: number | string;
}

interface SourceRow {
  readonly asset_id: string;
}

function iso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('ASSET_TIMESTAMP_INVALID');
  return date.toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

function numberValue(value: number | string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error('ASSET_NUMERIC_READBACK_INVALID');
  return parsed;
}

function nullableNumber(value: number | string | null): number | null {
  return value === null ? null : numberValue(value);
}

function fromRow(row: AssetRow): AssetIntelligenceRecord {
  return assertAssetIntelligenceRecord({
    assetId: row.asset_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    sha256: row.sha256,
    perceptualHash: row.perceptual_hash,
    sourceAssetId: row.source_asset_id,
    masterAssetId: row.master_asset_id,
    lineageKind: row.lineage_kind,
    masterState: row.master_state,
    masterApprovalEvidenceId: row.master_approval_evidence_id,
    rightsStatus: row.rights_status,
    rightsExpiresAt: nullableIso(row.rights_expires_at),
    rightsScope: stringArraySchema.parse(row.rights_scope),
    photographer: row.photographer,
    owner: row.owner_name,
    venueId: row.venue_id,
    area: row.area,
    timeOfDay: row.time_of_day,
    crowdLevel: row.crowd_level,
    qualityScore: numberValue(row.quality_score),
    formatFitness: {
      FEED: numberValue(row.feed_fitness),
      STORIES: numberValue(row.stories_fitness),
      REEL_COVER: numberValue(row.reel_cover_fitness),
      AD: numberValue(row.ad_fitness),
    },
    eventContext: stringArraySchema.parse(row.event_context),
    restrictions: restrictionArraySchema.parse(row.restrictions),
    marketingReadiness: row.marketing_readiness,
    creativeTruth: {
      venueFidelity: row.creative_truth_venue_fidelity,
      brandIntegrity: row.creative_truth_brand_integrity,
      finalAssetEligibility: row.creative_truth_final_eligibility,
      evidenceRef: row.creative_truth_evidence_ref,
      readAt: nullableIso(row.creative_truth_read_at),
    },
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function candidateFromRow(row: CandidateRow): AssetCandidateSnapshot {
  return assetCandidateSnapshotSchema.parse({
    ...fromRow(row),
    usageCount: numberValue(row.usage_count),
    usesLast14Days: numberValue(row.uses_last_14_days),
    lastUsedAt: nullableIso(row.last_used_at),
    recentPerformanceScore: nullableNumber(row.recent_performance_score),
    previousPerformanceScore: nullableNumber(row.previous_performance_score),
  });
}

export class PostgresAssetIntelligenceStore {
  constructor(private readonly pool: pg.Pool) {}

  async saveAsset(input: AssetIntelligenceRecord): Promise<AssetIntelligenceRecord> {
    const asset = assertAssetIntelligenceRecord(input);
    const result = await this.pool.query<AssetRow>(
      `insert into asset_intelligence_assets (
         asset_id, tenant_id, workspace_id, organization_id, sha256, perceptual_hash,
         source_asset_id, master_asset_id, lineage_kind, master_state, master_approval_evidence_id,
         rights_status, rights_expires_at, rights_scope, photographer, owner_name,
         venue_id, area, time_of_day, crowd_level, quality_score,
         feed_fitness, stories_fitness, reel_cover_fitness, ad_fitness,
         event_context, restrictions, marketing_readiness,
         creative_truth_venue_fidelity, creative_truth_brand_integrity,
         creative_truth_final_eligibility, creative_truth_evidence_ref, creative_truth_read_at,
         created_at, updated_at
       ) values (
         $1, $2, $3, $4, $5, $6::bit(64), $7, $8, $9, $10, $11,
         $12, $13::timestamptz, $14::jsonb, $15, $16, $17, $18, $19, $20, $21,
         $22, $23, $24, $25, $26::jsonb, $27::jsonb, $28, $29, $30, $31, $32,
         $33::timestamptz, $34::timestamptz, $35::timestamptz
       )
       on conflict (asset_id) do update set
         sha256 = excluded.sha256,
         perceptual_hash = excluded.perceptual_hash,
         source_asset_id = excluded.source_asset_id,
         master_asset_id = excluded.master_asset_id,
         lineage_kind = excluded.lineage_kind,
         master_state = excluded.master_state,
         master_approval_evidence_id = excluded.master_approval_evidence_id,
         rights_status = excluded.rights_status,
         rights_expires_at = excluded.rights_expires_at,
         rights_scope = excluded.rights_scope,
         photographer = excluded.photographer,
         owner_name = excluded.owner_name,
         venue_id = excluded.venue_id,
         area = excluded.area,
         time_of_day = excluded.time_of_day,
         crowd_level = excluded.crowd_level,
         quality_score = excluded.quality_score,
         feed_fitness = excluded.feed_fitness,
         stories_fitness = excluded.stories_fitness,
         reel_cover_fitness = excluded.reel_cover_fitness,
         ad_fitness = excluded.ad_fitness,
         event_context = excluded.event_context,
         restrictions = excluded.restrictions,
         marketing_readiness = excluded.marketing_readiness,
         creative_truth_venue_fidelity = excluded.creative_truth_venue_fidelity,
         creative_truth_brand_integrity = excluded.creative_truth_brand_integrity,
         creative_truth_final_eligibility = excluded.creative_truth_final_eligibility,
         creative_truth_evidence_ref = excluded.creative_truth_evidence_ref,
         creative_truth_read_at = excluded.creative_truth_read_at,
         updated_at = excluded.updated_at
       where asset_intelligence_assets.tenant_id = excluded.tenant_id
         and asset_intelligence_assets.workspace_id = excluded.workspace_id
         and asset_intelligence_assets.organization_id = excluded.organization_id
       returning *`,
      [
        asset.assetId,
        asset.tenantId,
        asset.workspaceId,
        asset.organizationId,
        asset.sha256,
        asset.perceptualHash,
        asset.sourceAssetId,
        asset.masterAssetId,
        asset.lineageKind,
        asset.masterState,
        asset.masterApprovalEvidenceId,
        asset.rightsStatus,
        asset.rightsExpiresAt,
        JSON.stringify(asset.rightsScope),
        asset.photographer,
        asset.owner,
        asset.venueId,
        asset.area,
        asset.timeOfDay,
        asset.crowdLevel,
        asset.qualityScore,
        asset.formatFitness.FEED,
        asset.formatFitness.STORIES,
        asset.formatFitness.REEL_COVER,
        asset.formatFitness.AD,
        JSON.stringify(asset.eventContext),
        JSON.stringify(asset.restrictions),
        asset.marketingReadiness,
        asset.creativeTruth.venueFidelity,
        asset.creativeTruth.brandIntegrity,
        asset.creativeTruth.finalAssetEligibility,
        asset.creativeTruth.evidenceRef,
        asset.creativeTruth.readAt,
        asset.createdAt,
        asset.updatedAt,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('ASSET_SCOPE_MISMATCH');
    return fromRow(row);
  }

  async attachSource(input: AssetSourceRecord): Promise<void> {
    const inserted = await this.pool.query<SourceRow>(
      `insert into asset_intelligence_sources (
         asset_id, provider, source_ref, source_kind, is_primary, observed_at
       ) values ($1, $2, $3, $4, $5, $6::timestamptz)
       on conflict (provider, source_ref) do nothing
       returning asset_id`,
      [
        input.assetId,
        input.provider,
        input.sourceRef,
        input.sourceKind,
        input.isPrimary,
        input.observedAt,
      ],
    );
    if (inserted.rows[0]) return;
    const existing = await this.pool.query<SourceRow>(
      `select asset_id from asset_intelligence_sources where provider = $1 and source_ref = $2`,
      [input.provider, input.sourceRef],
    );
    if (existing.rows[0]?.asset_id !== input.assetId) throw new Error('ASSET_SOURCE_ALREADY_BOUND');
  }

  async recordUsage(input: AssetUsageRecord): Promise<void> {
    const usage = assetUsageRecordSchema.parse(input);
    await this.pool.query(
      `insert into asset_intelligence_usage (
         usage_id, asset_id, content_item_id, channel, format, used_at, idempotency_key
       ) values ($1, $2, $3, $4, $5, $6::timestamptz, $7)
       on conflict (idempotency_key) do nothing`,
      [
        usage.usageId,
        usage.assetId,
        usage.contentItemId,
        usage.channel,
        usage.format,
        usage.usedAt,
        usage.idempotencyKey,
      ],
    );
  }

  async recordPerformance(input: AssetPerformanceRecord): Promise<void> {
    const performance = assetPerformanceRecordSchema.parse(input);
    await this.pool.query(
      `insert into asset_intelligence_performance (
         performance_id, asset_id, channel, observed_at, performance_score,
         impressions, reach, engagements, clicks, conversions
       ) values ($1, $2, $3, $4::timestamptz, $5, $6, $7, $8, $9, $10)
       on conflict (performance_id) do nothing`,
      [
        performance.performanceId,
        performance.assetId,
        performance.channel,
        performance.observedAt,
        performance.performanceScore,
        performance.impressions,
        performance.reach,
        performance.engagements,
        performance.clicks,
        performance.conversions,
      ],
    );
  }

  async findDuplicates(
    scope: AssetScope,
    sha256: string,
    perceptualHash: string,
    maxPerceptualDistance = 8,
  ): Promise<AssetDuplicateMatch[]> {
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('ASSET_SHA256_INVALID');
    if (!/^[01]{64}$/.test(perceptualHash)) throw new Error('ASSET_PHASH_INVALID');
    if (
      !Number.isInteger(maxPerceptualDistance) ||
      maxPerceptualDistance < 0 ||
      maxPerceptualDistance > 64
    ) {
      throw new Error('ASSET_PHASH_DISTANCE_INVALID');
    }
    const result = await this.pool.query<DuplicateRow>(
      `select
         asset_id,
         sha256,
         perceptual_hash::text as perceptual_hash,
         bit_count(perceptual_hash # $5::bit(64)) as perceptual_distance
       from asset_intelligence_assets
       where tenant_id = $1 and workspace_id = $2 and organization_id = $3
         and (sha256 = $4 or bit_count(perceptual_hash # $5::bit(64)) <= $6)
       order by (sha256 = $4) desc, perceptual_distance asc, asset_id asc`,
      [
        scope.tenantId,
        scope.workspaceId,
        scope.organizationId,
        sha256,
        perceptualHash,
        maxPerceptualDistance,
      ],
    );
    return result.rows.map((row) => ({
      assetId: row.asset_id,
      sha256: row.sha256,
      perceptualHash: row.perceptual_hash,
      exact: row.sha256 === sha256,
      perceptualDistance: numberValue(row.perceptual_distance),
    }));
  }

  async listCandidates(scope: AssetScope, now: Date): Promise<AssetCandidateSnapshot[]> {
    const result = await this.pool.query<CandidateRow>(
      `with usage_agg as (
         select
           asset_id,
           count(*)::int as usage_count,
           count(*) filter (where used_at >= $4::timestamptz - interval '14 days')::int as uses_last_14_days,
           max(used_at) as last_used_at
         from asset_intelligence_usage
         group by asset_id
       ), performance_agg as (
         select
           asset_id,
           avg(performance_score) filter (
             where observed_at >= $4::timestamptz - interval '30 days'
           ) as recent_performance_score,
           avg(performance_score) filter (
             where observed_at < $4::timestamptz - interval '30 days'
               and observed_at >= $4::timestamptz - interval '60 days'
           ) as previous_performance_score
         from asset_intelligence_performance
         group by asset_id
       )
       select
         a.*,
         coalesce(u.usage_count, 0)::int as usage_count,
         coalesce(u.uses_last_14_days, 0)::int as uses_last_14_days,
         u.last_used_at,
         p.recent_performance_score,
         p.previous_performance_score
       from asset_intelligence_assets a
       left join usage_agg u on u.asset_id = a.asset_id
       left join performance_agg p on p.asset_id = a.asset_id
       where a.tenant_id = $1 and a.workspace_id = $2 and a.organization_id = $3
       order by a.asset_id asc`,
      [scope.tenantId, scope.workspaceId, scope.organizationId, now.toISOString()],
    );
    return result.rows.map(candidateFromRow);
  }
}
