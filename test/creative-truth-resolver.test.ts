import { describe, expect, it } from 'vitest';
import { CreativeTruthResolver } from '../src/creative/creative-truth-resolver.js';
import { GoogleSheetsCreativeTruthRegistry } from '../src/providers/google-sheets/creative-truth-registry.js';
import type { SpreadsheetValuesClient } from '../src/providers/google-sheets/media-assets.js';

function registryFor(
  videoRows: readonly (readonly unknown[])[] = [],
  venueRows: readonly (readonly unknown[])[] = [],
) {
  const client: SpreadsheetValuesClient = {
    readRange: (_spreadsheetId, range) => {
      if (range === 'POLICY!A2:AK20') {
        return Promise.resolve([
          [
            'TOCA_CREATIVE_TRUTH_POLICY_V1',
            '1.3',
            'ACTIVE_CANONICAL',
            'TOCA_DO_MORCEGO',
            'REAL_COMPOSITE|REAL_PLUS_ENHANCEMENT',
            'GENERATIVE_EXCEPTION',
            true,
            true,
            true,
            true,
            true,
            true,
            '1UR_LD8Gw4rlQkGsYh-VGW1ns8AzEx_m4fazpcCW-2wM',
            '2026-08-18T00:00:00-03:00',
            true,
            'FAIL_CLOSED_UNTIL_SHOT_LEVEL_PROVENANCE',
            'VIDEO_ENHANCEMENT_PROVENANCE_UNSUPPORTED',
            'SOURCE_ANCHORED_SCENE_CONTINUATION_GOVERNED_V1',
            'OPERATION_SCOPED_ONLY_V1',
            'TOCA_VENUE_REFERENCE_SET_V1',
            'DEPRECATED',
            'TOCA_VENUE_REFERENCE_SET_SUNSET_V1',
            'TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1',
            'FORBIDDEN',
            'REQUIRED',
            'DENY',
            'UNSUPPORTED_V1',
            'TOCA_PHOTO_TO_VIDEO_POLICY_V1',
            'ACTIVE_V1',
            'DENY',
            'NON_FINAL_BACKGROUND_CANDIDATE_ONLY',
            true,
            'DENY',
            'DENY',
            'FAIL_CLOSED_NO_FINAL_ASSET',
            'ENFORCED',
            'FAILED_DIRECT_GENERATIVE_FINALIZATION',
          ],
        ]);
      }
      if (range === 'CREATIVE_STANDARDS!A2:N1000') {
        return Promise.resolve([
          [
            'SUNSET_FEED_V1',
            '1.0',
            'TOCA_DO_MORCEGO',
            'SUNSET',
            'INSTAGRAM',
            'SINGLE_IMAGE',
            'TOCA_CREATIVE_TRUTH_POLICY_V1',
            'canonical-drive-standard',
            'control/creative-standards/sunset-feed-standard.v1.json',
            'ACTIVE_CANONICAL',
            true,
            true,
            true,
            'canonical test standard',
          ],
        ]);
      }
      if (range === 'VENUE_VISUALS!A2:P2000') return Promise.resolve(venueRows);
      if (range === 'VIDEO_SHOTS!A2:Q2000') return Promise.resolve(videoRows);
      return Promise.resolve([]);
    },
    appendRow: () => Promise.resolve(),
  };
  return new GoogleSheetsCreativeTruthRegistry(client, { spreadsheetId: 'sheet' });
}

function videoRow(overrides: Partial<Record<number, unknown>> = {}): readonly unknown[] {
  const values: unknown[] = [
    'SHOT-SUN-001',
    'SUN-VIDEO-001',
    'source-drive',
    'MM-SUN-VIDEO-001-V1',
    'master-drive',
    'a'.repeat(64),
    'b'.repeat(64),
    'SUNSET',
    'deck_ocean_view',
    'experience',
    '6000',
    '9:16',
    true,
    true,
    'OWNED',
    'ACTIVE_APPROVED',
    'verified take',
  ];
  for (const [index, value] of Object.entries(overrides)) values[Number(index)] = value;
  return values;
}

function venueRow(overrides: Partial<Record<number, unknown>> = {}): readonly unknown[] {
  const values: unknown[] = [
    'VENUE-SUN-001',
    'SUN-001',
    'source-drive',
    'MM-SUN-001-V2',
    'master-drive',
    'a'.repeat(64),
    'b'.repeat(64),
    'SUNSET',
    'deck_ocean_view',
    'sunset',
    true,
    true,
    false,
    'DECK|HORIZON|SEA',
    'ACTIVE_APPROVED',
    'canonical v2 marketing master',
  ];
  for (const [index, value] of Object.entries(overrides)) values[Number(index)] = value;
  return values;
}

describe('CreativeTruthResolver generic static boundary', () => {
  it('refuses GENERATIVE_EXCEPTION so legacy global-set reads cannot bypass operation-scoped generation', async () => {
    const resolver = new CreativeTruthResolver(registryFor());

    await expect(
      resolver.resolve({
        contentItemId: 'CONTENT-SUN-1',
        standardId: 'SUNSET_FEED_V1',
        operation: 'SUNSET',
        requestedMode: 'GENERATIVE_EXCEPTION',
        requiredBrands: [],
      }),
    ).rejects.toThrow('GENERATIVE_EXCEPTION_REQUIRES_OPERATION_SCOPED_PIPELINE');
  });

  it('accepts an ACTIVE_APPROVED venue only when the master is explicitly MARKETING_READY', async () => {
    const resolver = new CreativeTruthResolver(registryFor([], [venueRow()]));

    const result = await resolver.resolve({
      contentItemId: 'CONTENT-SUN-READY',
      standardId: 'SUNSET_FEED_V1',
      operation: 'SUNSET',
      requestedMode: 'REAL_COMPOSITE',
      requiredBrands: [],
    });

    expect(result.venueAsset).toMatchObject({
      venueAssetId: 'VENUE-SUN-001',
      venueVerified: true,
      marketingReady: true,
      status: 'ACTIVE_APPROVED',
    });
  });

  it('does not auto-select a legacy venue whose master is no longer MARKETING_READY', async () => {
    const resolver = new CreativeTruthResolver(
      registryFor([], [
        venueRow({
          11: false,
          14: 'VENUE_VERIFIED_LEGACY_MASTER_REVALIDATION_REQUIRED',
        }),
      ]),
    );

    await expect(
      resolver.resolve({
        contentItemId: 'CONTENT-SUN-LEGACY-AUTO',
        standardId: 'SUNSET_FEED_V1',
        operation: 'SUNSET',
        requestedMode: 'REAL_COMPOSITE',
        requiredBrands: [],
      }),
    ).rejects.toThrow('FAILED_NO_VENUE_VERIFIED_ASSET');
  });

  it('blocks an explicitly requested legacy venue until a v2 master is promoted', async () => {
    const resolver = new CreativeTruthResolver(
      registryFor([], [
        venueRow({
          11: false,
          14: 'VENUE_VERIFIED_LEGACY_MASTER_REVALIDATION_REQUIRED',
        }),
      ]),
    );

    await expect(
      resolver.resolve({
        contentItemId: 'CONTENT-SUN-LEGACY-EXPLICIT',
        standardId: 'SUNSET_FEED_V1',
        operation: 'SUNSET',
        requestedMode: 'REAL_COMPOSITE',
        venueAssetId: 'VENUE-SUN-001',
        requiredBrands: [],
      }),
    ).rejects.toThrow('FAILED_LINEAGE_MISSING');
  });
});

describe('CreativeTruthResolver video shots', () => {
  it('resolves only canonical, approved, venue-verified shots with master lineage and rights', async () => {
    const resolver = new CreativeTruthResolver(registryFor([videoRow()]));

    const result = await resolver.resolveVideoShots({
      operation: 'SUNSET',
      shotIds: ['SHOT-SUN-001'],
    });

    expect(result.policyId).toBe('TOCA_CREATIVE_TRUTH_POLICY_V1');
    expect(result.operation).toBe('SUNSET');
    expect(result.shots).toHaveLength(1);
    expect(result.shots[0]).toMatchObject({
      shotId: 'SHOT-SUN-001',
      masterAssetId: 'MM-SUN-VIDEO-001-V1',
      masterDriveFileId: 'master-drive',
      venueVerified: true,
      marketingReady: true,
      rightsStatus: 'OWNED',
      status: 'ACTIVE_APPROVED',
    });
  });

  it('fails closed when a requested shot is not approved or venue verified', async () => {
    const resolver = new CreativeTruthResolver(registryFor([videoRow({ 12: false })]));

    await expect(
      resolver.resolveVideoShots({ operation: 'SUNSET', shotIds: ['SHOT-SUN-001'] }),
    ).rejects.toThrow('FAILED_NO_VENUE_VERIFIED_ASSET');
  });

  it('fails closed when rights are not explicitly cleared', async () => {
    const resolver = new CreativeTruthResolver(registryFor([videoRow({ 14: 'PENDING' })]));

    await expect(
      resolver.resolveVideoShots({ operation: 'SUNSET', shotIds: ['SHOT-SUN-001'] }),
    ).rejects.toThrow('VIDEO_SHOT_RIGHTS_NOT_CLEARED');
  });

  it('rejects duplicated shot IDs to keep edit lineage deterministic', async () => {
    const resolver = new CreativeTruthResolver(registryFor([videoRow()]));

    await expect(
      resolver.resolveVideoShots({
        operation: 'SUNSET',
        shotIds: ['SHOT-SUN-001', 'SHOT-SUN-001'],
      }),
    ).rejects.toThrow('VIDEO_SHOT_RESOLUTION_INVALID');
  });
});
