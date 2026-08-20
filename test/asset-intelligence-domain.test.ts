import { describe, expect, it } from 'vitest';
import {
  assertAssetIntelligenceRecord,
  computeDHash64,
  detectFatigue,
  perceptualHashDistance,
  resolveRightsEligibility,
  sha256Hex,
  type AssetCandidateSnapshot,
  type AssetIntelligenceRecord,
} from '../src/assets/asset-intelligence.js';

const NOW = new Date('2026-08-20T05:00:00.000Z');

function candidate(overrides: Partial<AssetCandidateSnapshot> = {}): AssetCandidateSnapshot {
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
    rightsScope: ['ORGANIC', 'PAID_MEDIA'],
    photographer: 'Photographer',
    owner: 'Owner',
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

function record(overrides: Partial<AssetIntelligenceRecord> = {}): AssetIntelligenceRecord {
  const value = candidate();
  return {
    assetId: value.assetId,
    tenantId: value.tenantId,
    workspaceId: value.workspaceId,
    organizationId: value.organizationId,
    sha256: value.sha256,
    perceptualHash: value.perceptualHash,
    sourceAssetId: value.sourceAssetId,
    masterAssetId: value.masterAssetId,
    lineageKind: value.lineageKind,
    masterState: value.masterState,
    masterApprovalEvidenceId: value.masterApprovalEvidenceId,
    rightsStatus: value.rightsStatus,
    rightsExpiresAt: value.rightsExpiresAt,
    rightsScope: value.rightsScope,
    photographer: value.photographer,
    owner: value.owner,
    venueId: value.venueId,
    area: value.area,
    timeOfDay: value.timeOfDay,
    crowdLevel: value.crowdLevel,
    qualityScore: value.qualityScore,
    formatFitness: value.formatFitness,
    eventContext: value.eventContext,
    restrictions: value.restrictions,
    marketingReadiness: value.marketingReadiness,
    creativeTruth: value.creativeTruth,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...overrides,
  };
}

describe('Asset Intelligence domain', () => {
  it('computes cryptographic and perceptual hashes deterministically', () => {
    expect(sha256Hex(Buffer.from('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    const descending = Array.from({ length: 8 }, () => [9, 8, 7, 6, 5, 4, 3, 2, 1]);
    const ascending = Array.from({ length: 8 }, () => [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const left = computeDHash64(descending);
    const right = computeDHash64(ascending);
    expect(left).toBe('1'.repeat(64));
    expect(right).toBe('0'.repeat(64));
    expect(perceptualHashDistance(left, right)).toBe(64);
  });

  it('requires explicit evidence before an asset can be an approved master', () => {
    expect(() =>
      assertAssetIntelligenceRecord(
        record({
          lineageKind: 'MASTER',
          masterState: 'APPROVED_MASTER',
          masterApprovalEvidenceId: null,
        }),
      ),
    ).toThrow('ASSET_MASTER_APPROVAL_EVIDENCE_REQUIRED');
  });

  it('fails rights eligibility closed after expiry', () => {
    expect(
      resolveRightsEligibility(
        { rightsStatus: 'CLEARED', rightsExpiresAt: '2026-08-19T00:00:00.000Z' },
        NOW,
      ),
    ).toEqual({ eligible: false, reason: 'RIGHTS_EXPIRED' });
  });

  it('detects fatigue from reuse pressure and performance decay', () => {
    const result = detectFatigue(
      candidate({ usesLast14Days: 4, recentPerformanceScore: 50, previousPerformanceScore: 100 }),
      60,
    );
    expect(result).toMatchObject({
      fatigued: true,
      score: 80,
      usagePressure: 60,
      performanceDecay: 20,
    });
  });
});
