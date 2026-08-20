import type pg from 'pg';
import type {
  MetaAdsGeoAudienceHistoryQuery,
  MetaAdsGeoAudienceHistoryStore,
  MetaAdsGeoAudienceSample,
} from '../providers/meta-ads/meta-ads-demand-intelligence.js';

interface GeoAudienceRow {
  readonly tenant_id: string;
  readonly ad_account_id: string;
  readonly geo_key: string;
  readonly lower_bound: string | number;
  readonly upper_bound: string | number;
  readonly midpoint: string | number;
  readonly estimate_ready: boolean;
  readonly optimization_goal: string;
  readonly targeting_spec: unknown;
  readonly observed_at: Date | string;
}

export class PostgresMetaAdsGeoAudienceStore implements MetaAdsGeoAudienceHistoryStore {
  constructor(private readonly pool: pg.Pool) {}

  async append(sample: MetaAdsGeoAudienceSample): Promise<void> {
    await this.pool.query(
      `insert into meta_ads_geo_audience_samples (
         tenant_id, ad_account_id, geo_key, lower_bound, upper_bound, midpoint,
         estimate_ready, optimization_goal, targeting_spec, observed_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::timestamptz)
       on conflict (tenant_id, ad_account_id, geo_key, observed_at) do nothing`,
      [
        sample.tenantId,
        sample.adAccountId,
        sample.geoKey,
        sample.lowerBound,
        sample.upperBound,
        sample.midpoint,
        sample.estimateReady,
        sample.optimizationGoal,
        JSON.stringify(sample.targetingSpec),
        sample.observedAt,
      ],
    );
  }

  async listSince(
    query: MetaAdsGeoAudienceHistoryQuery,
  ): Promise<readonly MetaAdsGeoAudienceSample[]> {
    const limit = normalizeLimit(query.limit ?? 1000);
    const result = await this.pool.query<GeoAudienceRow>(
      `select tenant_id, ad_account_id, geo_key, lower_bound, upper_bound, midpoint,
              estimate_ready, optimization_goal, targeting_spec, observed_at
       from meta_ads_geo_audience_samples
       where tenant_id = $1
         and ad_account_id = $2
         and geo_key = $3
         and observed_at >= $4::timestamptz
       order by observed_at asc
       limit $5`,
      [query.tenantId, query.adAccountId, query.geoKey, query.since, limit],
    );
    return result.rows.map(fromRow);
  }
}

function fromRow(row: GeoAudienceRow): MetaAdsGeoAudienceSample {
  return {
    tenantId: row.tenant_id,
    adAccountId: row.ad_account_id,
    geoKey: row.geo_key,
    lowerBound: finiteNumber(row.lower_bound, 'META_ADS_GEO_HISTORY_LOWER_BOUND_INVALID'),
    upperBound: finiteNumber(row.upper_bound, 'META_ADS_GEO_HISTORY_UPPER_BOUND_INVALID'),
    midpoint: finiteNumber(row.midpoint, 'META_ADS_GEO_HISTORY_MIDPOINT_INVALID'),
    estimateReady: row.estimate_ready,
    optimizationGoal: row.optimization_goal,
    targetingSpec: objectRecord(row.targeting_spec),
    observedAt: normalizeTimestamp(row.observed_at),
  };
}

function normalizeLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('META_ADS_GEO_HISTORY_LIMIT_INVALID');
  }
  return Math.min(value, 5000);
}

function finiteNumber(value: string | number, code: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(code);
  return parsed;
}

function objectRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('META_ADS_GEO_HISTORY_TARGETING_INVALID');
  }
  return value as Readonly<Record<string, unknown>>;
}

function normalizeTimestamp(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error('META_ADS_GEO_HISTORY_TIMESTAMP_INVALID');
  }
  return parsed.toISOString();
}
