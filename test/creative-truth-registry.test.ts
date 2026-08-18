import { describe, expect, it, vi } from 'vitest';
import { GoogleSheetsCreativeTruthRegistry } from '../src/providers/google-sheets/creative-truth-registry.js';
import type { SpreadsheetValuesClient } from '../src/providers/google-sheets/media-assets.js';

const CANONICAL_PLAN_DRIVE_ID = '1UR_LD8Gw4rlQkGsYh-VGW1ns8AzEx_m4fazpcCW-2wM';

function clientFor(ranges: Readonly<Record<string, readonly (readonly unknown[])[]>>) {
  const readRange = vi.fn(
    async (_spreadsheetId: string, range: string): Promise<readonly (readonly unknown[])[]> =>
      ranges[range] ?? [],
  );
  const appendRow = vi.fn(
    async (
      _spreadsheetId: string,
      _range: string,
      _values: readonly unknown[],
    ): Promise<void> => undefined,
  );
  return {
    client: { readRange, appendRow } satisfies SpreadsheetValuesClient,
    readRange,
    appendRow,
  };
}

function canonicalPolicyRow(overrides: Partial<Record<number, unknown>> = {}): readonly unknown[] {
  const row: unknown[] = [
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
    CANONICAL_PLAN_DRIVE_ID,
    '2026-08-18T00:00:00-03:00',
    true,
    'FAIL_CLOSED_UNTIL_SHOT_LEVEL_PROVENANCE',
    'VIDEO_ENHANCEMENT_PROVENANCE_UNSUPPORTED',
    'UNSUPPORTED_V1',
  ];
  for (const [key, value] of Object.entries(overrides)) row[Number(key)] = value;
  return row;
}

describe('GoogleSheetsCreativeTruthRegistry', () => {
  it('accepts only the complete canonical policy row', async () => {
    const { client, readRange } = clientFor({
      'POLICY!A2:R20': [canonicalPolicyRow()],
    });
    const registry = new GoogleSheetsCreativeTruthRegistry(client, { spreadsheetId: 'sheet' });

    await expect(registry.assertCanonicalPolicy()).resolves.toBeUndefined();
    expect(readRange).toHaveBeenCalledWith('sheet', 'POLICY!A2:R20');
  });

  it('rejects policy drift across identity, modes, gates, canonical plan and provenance controls', async () => {
    const driftedRows = [
      canonicalPolicyRow({ 2: 'SUSPENDED' }),
      canonicalPolicyRow({ 3: 'OTHER_BRAND' }),
      canonicalPolicyRow({ 4: 'REAL_COMPOSITE' }),
      canonicalPolicyRow({ 4: 'REAL_COMPOSITE|REAL_PLUS_ENHANCEMENT|UNSAFE_EXTRA_MODE' }),
      canonicalPolicyRow({ 5: 'UNCONTROLLED_GENERATION' }),
      canonicalPolicyRow({ 6: false }),
      canonicalPolicyRow({ 7: false }),
      canonicalPolicyRow({ 8: false }),
      canonicalPolicyRow({ 9: false }),
      canonicalPolicyRow({ 10: false }),
      canonicalPolicyRow({ 11: false }),
      canonicalPolicyRow({ 12: 'wrong-plan-drive-id' }),
      canonicalPolicyRow({ 14: false }),
      canonicalPolicyRow({ 15: 'ENABLED_WITHOUT_PROVENANCE' }),
      canonicalPolicyRow({ 16: '' }),
      canonicalPolicyRow({ 17: 'ENABLED_UNCONTROLLED' }),
    ];

    for (const row of driftedRows) {
      const { client } = clientFor({ 'POLICY!A2:R20': [row] });
      const registry = new GoogleSheetsCreativeTruthRegistry(client, { spreadsheetId: 'sheet' });
      await expect(registry.assertCanonicalPolicy()).rejects.toThrow(
        'TOCA_CREATIVE_TRUTH_POLICY_NOT_ACTIVE',
      );
    }
  });

  it('reads official hash-pinned brand assets and marketing-ready venue lineage', async () => {
    const { client } = clientFor({
      'BRAND_ASSETS!A2:N1000': [
        [
          'BRAND-MORRO-WHITE-V1',
          'MORRO_DIGITAL',
          'WHITE',
          'drive-logo',
          'MORRO_DIGITAL_LOGO_BRANCO.png',
          'image/png',
          'SHA256_PINNED',
          '8a97fcd3e5c91dea4b71e26e4b99bf8dcc5d242d07f6bac298767c45ee2b600e',
          'VERIFIED_2026-08-17',
          'ACTIVE_APPROVED',
          'ALL',
          'DARK',
          false,
          'official',
        ],
      ],
      'VENUE_VISUALS!A2:P2000': [
        [
          'VENUE-SUN-0244',
          'SUN-0244',
          'source-drive',
          'MM-SUN-0244-V1',
          'master-drive',
          'a'.repeat(64),
          'b'.repeat(64),
          'SUNSET',
          'ambiente_toca',
          'experiencia_premium_lifestyle',
          true,
          true,
          true,
          'DECK|AMBIENTE|ILUMINACAO',
          'ACTIVE_APPROVED',
          '',
        ],
      ],
    });
    const registry = new GoogleSheetsCreativeTruthRegistry(client, { spreadsheetId: 'sheet' });

    const logo = await registry.getBrandAsset('MORRO_DIGITAL', 'WHITE');
    expect(logo?.driveFileId).toBe('drive-logo');
    expect(logo?.integrityMode).toBe('SHA256_PINNED');
    expect(logo?.sha256).toBe(
      '8a97fcd3e5c91dea4b71e26e4b99bf8dcc5d242d07f6bac298767c45ee2b600e',
    );
    expect(logo?.aiReconstructionAllowed).toBe(false);

    const venue = await registry.getVenueAsset('VENUE-SUN-0244');
    expect(venue?.venueVerified).toBe(true);
    expect(venue?.marketingReady).toBe(true);
    expect(venue?.masterAssetId).toBe('MM-SUN-0244-V1');
    expect(venue?.protectedElements).toEqual(['DECK', 'AMBIENTE', 'ILUMINACAO']);
  });

  it('reads VIDEO_SHOTS with exact master lineage and rights status', async () => {
    const { client } = clientFor({
      'VIDEO_SHOTS!A2:Q2000': [
        [
          'SHOT-SUN-001',
          'SUN-VIDEO-001',
          'source-video-drive',
          'MM-SUN-VIDEO-001-V1',
          'master-video-drive',
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
          'verified real take',
        ],
      ],
    });
    const registry = new GoogleSheetsCreativeTruthRegistry(client, { spreadsheetId: 'sheet' });

    const shot = await registry.getVideoShot('SHOT-SUN-001');
    expect(shot).toMatchObject({
      shotId: 'SHOT-SUN-001',
      sourceAssetId: 'SUN-VIDEO-001',
      masterAssetId: 'MM-SUN-VIDEO-001-V1',
      masterDriveFileId: 'master-video-drive',
      operation: 'SUNSET',
      durationMs: 6000,
      venueVerified: true,
      marketingReady: true,
      rightsStatus: 'OWNED',
      status: 'ACTIVE_APPROVED',
    });

    const shots = await registry.listVideoShots('SUNSET');
    expect(shots).toHaveLength(1);
  });

  it('appends gate evidence with policy and exact output hash', async () => {
    const { client, appendRow } = clientFor({});
    const registry = new GoogleSheetsCreativeTruthRegistry(client, { spreadsheetId: 'sheet' });
    await registry.appendGateLog({
      gateEventId: 'gate-1',
      contentItemId: 'content-1',
      creativeId: 'creative-1',
      gate: {
        gate: 'VENUE_FIDELITY',
        status: 'PASSED',
        failureCodes: [],
        evidence: { venueAssetId: 'VENUE-SUN-0244' },
      },
      standardId: 'SUNSET_FEED_V1',
      creativeMode: 'REAL_COMPOSITE',
      sourceAssetIds: ['SUN-0244'],
      brandAssetIds: ['BRAND-TOCA-WHITE-V1'],
      outputSha256: 'c'.repeat(64),
      createdAt: '2026-08-17T22:00:00-03:00',
    });

    expect(appendRow).toHaveBeenCalledTimes(1);
    const values = appendRow.mock.calls[0]?.[2] ?? [];
    expect(values).toContain('TOCA_CREATIVE_TRUTH_POLICY_V1');
    expect(values).toContain('c'.repeat(64));
  });
});
