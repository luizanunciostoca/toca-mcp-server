import { describe, expect, it } from 'vitest';
import { createPostgresPool } from '../src/persistence/postgres.js';
import { PostgresAssetIntelligenceStore } from '../src/persistence/postgres-asset-intelligence-store.js';

const DATABASE_URL = process.env.DATABASE_URL;
const postgresDescribe = DATABASE_URL ? describe : describe.skip;

function databaseUrl(): string {
  if (!DATABASE_URL) throw new Error('ASSET_INTELLIGENCE_DATABASE_URL_REQUIRED');
  return DATABASE_URL;
}

postgresDescribe('Asset Intelligence PostgreSQL E2E', () => {
  it('persists dedupe, lineage metadata, usage and performance across restart', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const assetId = `asset-e2e-${suffix}`;
    const sha256 = '3'.repeat(64);
    const perceptualHash = `${'0'.repeat(63)}1`;
    const scope = {
      tenantId: `tenant-${suffix}`,
      workspaceId: `workspace-${suffix}`,
      organizationId: `org-${suffix}`,
    };

    const pool1 = createPostgresPool({ connectionString: databaseUrl(), max: 3 });
    const store1 = new PostgresAssetIntelligenceStore(pool1);
    await store1.saveAsset({
      assetId,
      ...scope,
      sha256,
      perceptualHash,
      sourceAssetId: null,
      masterAssetId: null,
      lineageKind: 'SOURCE',
      masterState: 'NOT_MASTER',
      masterApprovalEvidenceId: null,
      rightsStatus: 'CLEARED',
      rightsExpiresAt: '2026-12-31T23:59:59.000Z',
      rightsScope: ['ORGANIC'],
      photographer: 'E2E photographer',
      owner: 'E2E owner',
      venueId: 'venue-e2e',
      area: 'deck-e2e',
      timeOfDay: 'SUNSET',
      crowdLevel: 'MEDIUM',
      qualityScore: 90,
      formatFitness: { FEED: 95, STORIES: 90, REEL_COVER: 80, AD: 85 },
      eventContext: ['SUNSET'],
      restrictions: [],
      marketingReadiness: 'READY',
      creativeTruth: {
        venueFidelity: 'VERIFIED',
        brandIntegrity: 'VERIFIED',
        finalAssetEligibility: 'VERIFIED',
        evidenceRef: `creative-truth:e2e:${suffix}`,
        readAt: '2026-08-20T04:00:00.000Z',
      },
      createdAt: '2026-08-20T04:00:00.000Z',
      updatedAt: '2026-08-20T04:00:00.000Z',
    });
    await store1.attachSource({
      assetId,
      provider: 'GOOGLE_DRIVE',
      sourceRef: `drive-file-${suffix}`,
      sourceKind: 'ORIGINAL_UPLOAD',
      isPrimary: true,
      observedAt: '2026-08-20T04:01:00.000Z',
    });
    await store1.recordUsage({
      usageId: `usage-${suffix}`,
      assetId,
      contentItemId: `content-${suffix}`,
      channel: 'INSTAGRAM',
      format: 'FEED',
      usedAt: '2026-08-19T18:00:00.000Z',
      idempotencyKey: `usage-idem-${suffix}`,
    });
    await store1.recordUsage({
      usageId: `usage-duplicate-${suffix}`,
      assetId,
      contentItemId: `content-${suffix}`,
      channel: 'INSTAGRAM',
      format: 'FEED',
      usedAt: '2026-08-19T18:00:00.000Z',
      idempotencyKey: `usage-idem-${suffix}`,
    });
    await store1.recordPerformance({
      performanceId: `performance-${suffix}`,
      assetId,
      channel: 'INSTAGRAM',
      observedAt: '2026-08-19T20:00:00.000Z',
      performanceScore: 88,
      impressions: 1000,
      reach: 800,
      engagements: 120,
      clicks: 30,
      conversions: 4,
    });
    await pool1.end();

    const pool2 = createPostgresPool({ connectionString: databaseUrl(), max: 3 });
    const store2 = new PostgresAssetIntelligenceStore(pool2);
    const duplicates = await store2.findDuplicates(scope, sha256, perceptualHash, 4);
    expect(duplicates[0]).toMatchObject({ assetId, exact: true, perceptualDistance: 0 });

    const candidates = await store2.listCandidates(scope, new Date('2026-08-20T05:00:00.000Z'));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      assetId,
      usageCount: 1,
      usesLast14Days: 1,
      recentPerformanceScore: 88,
    });
    await pool2.end();
  });
});
