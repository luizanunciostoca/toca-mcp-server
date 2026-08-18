import { describe, expect, it } from 'vitest';
import { CreativeTruthResolver } from '../src/creative/creative-truth-resolver.js';
import { GoogleSheetsCreativeTruthRegistry } from '../src/providers/google-sheets/creative-truth-registry.js';
import type { SpreadsheetValuesClient } from '../src/providers/google-sheets/media-assets.js';

function registryFor(videoRows: readonly (readonly unknown[])[]) {
  const client: SpreadsheetValuesClient = {
    readRange: (_spreadsheetId, range) => {
      if (range === 'POLICY!A2:R20') {
        return Promise.resolve([
          [
            'TOCA_CREATIVE_TRUTH_POLICY_V1',
            '1.0',
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
            'UNSUPPORTED_V1',
          ],
        ]);
      }
      if (range === 'VIDEO_SHOTS!A2:Q2000') return Promise.resolve(videoRows);
      return Promise.resolve([]);
    },
    appendRow: () => Promise.resolve(),
  };
  return new GoogleSheetsCreativeTruthRegistry(client, { spreadsheetId: 'sheet' });
}

function row(overrides: Partial<Record<number, unknown>> = {}): readonly unknown[] {
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

describe('CreativeTruthResolver video shots', () => {
  it('resolves only canonical, approved, venue-verified shots with master lineage and rights', async () => {
    const resolver = new CreativeTruthResolver(registryFor([row()]));

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
    const resolver = new CreativeTruthResolver(registryFor([row({ 12: false })]));

    await expect(
      resolver.resolveVideoShots({ operation: 'SUNSET', shotIds: ['SHOT-SUN-001'] }),
    ).rejects.toThrow('FAILED_NO_VENUE_VERIFIED_ASSET');
  });

  it('fails closed when rights are not explicitly cleared', async () => {
    const resolver = new CreativeTruthResolver(registryFor([row({ 14: 'PENDING' })]));

    await expect(
      resolver.resolveVideoShots({ operation: 'SUNSET', shotIds: ['SHOT-SUN-001'] }),
    ).rejects.toThrow('VIDEO_SHOT_RIGHTS_NOT_CLEARED');
  });

  it('rejects duplicated shot IDs to keep edit lineage deterministic', async () => {
    const resolver = new CreativeTruthResolver(registryFor([row()]));

    await expect(
      resolver.resolveVideoShots({
        operation: 'SUNSET',
        shotIds: ['SHOT-SUN-001', 'SHOT-SUN-001'],
      }),
    ).rejects.toThrow('VIDEO_SHOT_RESOLUTION_INVALID');
  });
});
