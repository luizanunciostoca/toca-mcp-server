import { describe, expect, it } from 'vitest';
import { queryAssetIntelligence } from '../src/assets/asset-intelligence-query.js';
import type { AssetCandidateSnapshot } from '../src/assets/asset-intelligence.js';

const NOW = new Date('2026-08-20T05:00:00.000Z');

function asset(overrides: Partial<AssetCandidateSnapshot> = {}): AssetCandidateSnapshot {
  return {
    assetId: 'asset-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    organizationId: 'org-1',
    sha256: 'a'.repeat(64),
    perceptualHash: '0'.repeat(64),
    sourceAssetId: null,
    masterAssetId: null,
    lineageKind: 'SOURCE',
    masterState: 'NOT_MASTER',
    masterApprovalEvidenceId: null,
    rightsStatus: 'CLEARED',
    rightsExpiresAt: '2026-12-31T23:59:59.000Z',
    rightsScope: ['ORGANIC'],
    photographer: null,
    owner: null,
    venueId: 'toca-do-morcego',
    area: 'sunset-deck',
    timeOfDay: 'SUNSET',
    crowdLevel: 'MEDIUM',
    qualityScore: 92,
    formatFitness: { FEED: 95, STORIES: 90, REEL_COVER: 86, AD: 93 },
    eventContext: ['SUNSET'],
    restrictions: [],
    marketingReadiness: 'READY',
    creativeTruth: {
      venueFidelity: 'VERIFIED',
      brandIntegrity: 'VERIFIED',
      finalAssetEligibility: 'VERIFIED',
      evidenceRef: 'creative-truth:asset-1:v1',
      readAt: '2026-08-20T04:30:00.000Z',
    },
    createdAt: '2026-08-20T04:00:00.000Z',
    updatedAt: '2026-08-20T04:30:00.000Z',
    usageCount: 1,
    usesLast14Days: 1,
    lastUsedAt: '2026-08-01T18:00:00.000Z',
    recentPerformanceScore: 82,
    previousPerformanceScore: 84,
    ...overrides,
  };
}

function query(mode: Parameters<typeof queryAssetIntelligence>[0]['mode']) {
  return {
    mode,
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    organizationId: 'org-1',
    format: 'FEED' as const,
    channel: 'INSTAGRAM',
    venueId: null,
    eventContext: null,
    unusedSince: '2026-08-10T00:00:00.000Z',
    minQualityScore: 70,
    minFormatFitness: 70,
    fatigueThreshold: 60,
    limit: 10,
  };
}

describe('Marketing Autopilot Asset Intelligence queries', () => {
  it('finds only eligible assets after rights, Creative Truth, readiness and fatigue checks', () => {
    const eligible = asset({ assetId: 'eligible', sha256: 'b'.repeat(64) });
    const rejected = asset({
      assetId: 'creative-rejected',
      sha256: 'c'.repeat(64),
      creativeTruth: {
        venueFidelity: 'VERIFIED',
        brandIntegrity: 'REJECTED',
        finalAssetEligibility: 'REJECTED',
        evidenceRef: 'creative-truth:rejected',
        readAt: '2026-08-20T04:30:00.000Z',
      },
    });
    const expired = asset({
      assetId: 'rights-expired',
      sha256: 'd'.repeat(64),
      rightsExpiresAt: '2026-08-19T00:00:00.000Z',
    });
    const fatigued = asset({ assetId: 'fatigued', sha256: 'e'.repeat(64), usesLast14Days: 5 });

    const result = queryAssetIntelligence(
      query('FIND_ELIGIBLE'),
      [rejected, expired, fatigued, eligible],
      NOW,
    );
    expect(result.candidates.map((candidate) => candidate.assetId)).toEqual(['eligible']);
  });

  it('supports venue verified, unused and top performing content supply', () => {
    const neverUsed = asset({
      assetId: 'never-used',
      sha256: 'f'.repeat(64),
      usageCount: 0,
      usesLast14Days: 0,
      lastUsedAt: null,
      recentPerformanceScore: 60,
    });
    const top = asset({
      assetId: 'top',
      sha256: '1'.repeat(64),
      lastUsedAt: '2026-08-15T00:00:00.000Z',
      recentPerformanceScore: 99,
    });

    expect(
      queryAssetIntelligence(query('FIND_VENUE_VERIFIED'), [neverUsed, top], NOW).candidates,
    ).toHaveLength(2);
    expect(
      queryAssetIntelligence(query('FIND_UNUSED'), [top, neverUsed], NOW).candidates.map(
        (candidate) => candidate.assetId,
      ),
    ).toEqual(['never-used']);
    expect(
      queryAssetIntelligence(query('FIND_TOP_PERFORMING'), [neverUsed, top], NOW).candidates[0]
        ?.assetId,
    ).toBe('top');
  });

  it('keeps rights resolution distinct from Creative Truth final eligibility', () => {
    const unknownTruth = asset({
      assetId: 'unknown-truth',
      sha256: '2'.repeat(64),
      creativeTruth: {
        venueFidelity: 'UNKNOWN',
        brandIntegrity: 'UNKNOWN',
        finalAssetEligibility: 'UNKNOWN',
        evidenceRef: null,
        readAt: null,
      },
    });
    expect(
      queryAssetIntelligence(query('RESOLVE_RIGHTS'), [unknownTruth], NOW).candidates[0],
    ).toMatchObject({
      assetId: 'unknown-truth',
      rightsEligible: true,
      creativeTruthEligible: false,
      marketingReady: false,
    });
  });
});
