import { describe, expect, it } from 'vitest';
import { PostgresMetaAdsGeoAudienceStore } from '../src/persistence/postgres-meta-ads-geo-audience-store.js';
import { createPostgresPool } from '../src/persistence/postgres.js';
import type { MetaAdsGeoAudienceSample } from '../src/providers/meta-ads/meta-ads-demand-intelligence.js';

const DATABASE_URL = process.env.DATABASE_URL;
const postgresDescribe = DATABASE_URL ? describe : describe.skip;

function databaseUrl(): string {
  if (!DATABASE_URL) throw new Error('DEMAND_INTELLIGENCE_DATABASE_URL_REQUIRED');
  return DATABASE_URL;
}

postgresDescribe('Meta Ads Demand Intelligence PostgreSQL E2E', () => {
  it('persists hourly MAU bounds, readiness and confidence with idempotent readback', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const tenantId = `demand-e2e-${suffix}`;
    const adAccountId = `account-${suffix}`;
    const geoKey = 'morro-de-sao-paulo-15km';
    const pool = createPostgresPool({ connectionString: databaseUrl(), max: 2 });
    const store = new PostgresMetaAdsGeoAudienceStore(pool);

    const ready: MetaAdsGeoAudienceSample = {
      tenantId,
      adAccountId,
      geoKey,
      lowerBound: 12_000,
      upperBound: 16_000,
      midpoint: 14_000,
      estimateReady: true,
      optimizationGoal: 'REACH',
      targetingSpec: {
        geo_locations: {
          custom_locations: [
            {
              latitude: -13.3833,
              longitude: -38.9167,
              radius: 15,
              distance_unit: 'kilometer',
            },
          ],
        },
      },
      observedAt: '2026-08-20T04:37:12.000Z',
      hourBucket: '2026-08-20T04:00:00.000Z',
      qualityConfidence: 0.8,
    };
    const notReady: MetaAdsGeoAudienceSample = {
      ...ready,
      lowerBound: 0,
      upperBound: 0,
      midpoint: 0,
      estimateReady: false,
      observedAt: '2026-08-20T05:04:00.000Z',
      hourBucket: '2026-08-20T05:00:00.000Z',
      qualityConfidence: 0,
    };

    try {
      await store.append(ready);
      await store.append(ready);
      await store.append(notReady);

      const readback = await store.listSince({
        tenantId,
        adAccountId,
        geoKey,
        since: '2026-08-20T04:00:00.000Z',
        limit: 10,
      });

      expect(readback).toHaveLength(2);
      expect(readback[0]).toEqual(ready);
      expect(readback[1]).toEqual(notReady);

      const persisted = await pool.query<{
        observed_at: Date;
        hour_bucket: Date;
        estimate_ready: boolean;
        quality_confidence: string;
      }>(
        `select observed_at, hour_bucket, estimate_ready, quality_confidence
         from meta_ads_geo_audience_samples
         where tenant_id = $1 and ad_account_id = $2 and geo_key = $3
         order by observed_at asc`,
        [tenantId, adAccountId, geoKey],
      );
      expect(persisted.rows).toHaveLength(2);
      expect(persisted.rows[0]?.hour_bucket.toISOString()).toBe('2026-08-20T04:00:00.000Z');
      expect(Number(persisted.rows[0]?.quality_confidence)).toBe(0.8);
      expect(persisted.rows[1]?.estimate_ready).toBe(false);
      expect(Number(persisted.rows[1]?.quality_confidence)).toBe(0);
    } finally {
      await pool.query(
        `delete from meta_ads_geo_audience_samples
         where tenant_id = $1 and ad_account_id = $2 and geo_key = $3`,
        [tenantId, adAccountId, geoKey],
      );
      await pool.end();
    }
  });
});
