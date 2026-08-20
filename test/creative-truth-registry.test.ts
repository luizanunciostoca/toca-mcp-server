import { describe, expect, it, vi } from 'vitest';
import { GoogleSheetsCreativeTruthRegistry } from '../src/providers/google-sheets/creative-truth-registry.js';
import type { SpreadsheetValuesClient } from '../src/providers/google-sheets/media-assets.js';

function clientFor(ranges: Readonly<Record<string, readonly (readonly unknown[])[]>>) {
  const readRange = vi.fn(
    (spreadsheetId: string, range: string): Promise<readonly (readonly unknown[])[]> => {
      void spreadsheetId;
      return Promise.resolve(ranges[range] ?? []);
    },
  );
  const appendRow = vi.fn(
    (spreadsheetId: string, range: string, values: readonly unknown[]): Promise<void> => {
      void spreadsheetId;
      void range;
      void values;
      return Promise.resolve();
    },
  );
  return {
    client: { readRange, appendRow } satisfies SpreadsheetValuesClient,
    readRange,
    appendRow,
  };
}

describe('GoogleSheetsCreativeTruthRegistry', () => {
  it('reads official brand assets and marketing-ready venue lineage', async () => {
    const { client } = clientFor({
      'BRAND_ASSETS!A2:N1000': [
        [
          'BRAND-MORRO-WHITE-V1',
          'MORRO_DIGITAL',
          'WHITE',
          'drive-logo',
          'MORRO_DIGITAL_LOGO_BRANCO.png',
          'image/png',
          'DRIVE_FILE_ID_PINNED',
          '',
          'PENDING_CAPTURE',
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
          'VENUE_VERIFIED_MARKETING_READY',
          '',
        ],
      ],
    });
    const registry = new GoogleSheetsCreativeTruthRegistry(client, { spreadsheetId: 'sheet' });

    const logo = await registry.getBrandAsset('MORRO_DIGITAL', 'WHITE');
    expect(logo?.driveFileId).toBe('drive-logo');
    expect(logo?.aiReconstructionAllowed).toBe(false);

    const venue = await registry.getVenueAsset('VENUE-SUN-0244');
    expect(venue?.venueVerified).toBe(true);
    expect(venue?.marketingReady).toBe(true);
    expect(venue?.masterAssetId).toBe('MM-SUN-0244-V1');
    expect(venue?.status).toBe('VENUE_VERIFIED_MARKETING_READY');
    expect(venue?.protectedElements).toEqual(['DECK', 'AMBIENTE', 'ILUMINACAO']);
  });

  it('validates policy v1.3, operation-scoped references and video-shot provenance', async () => {
    const { client } = clientFor({
      'POLICY!A2:AK20': [
        [
          'TOCA_CREATIVE_TRUTH_POLICY_V1',
          '1.3',
          'ACTIVE_CANONICAL',
          '',
          '',
          '',
          true,
          true,
          true,
          true,
          true,
          true,
          '',
          '',
          '',
          '',
          '',
          '',
          'OPERATION_SCOPED_ONLY_V1',
          'TOCA_VENUE_REFERENCE_SET_V1',
          'DEPRECATED',
          'TOCA_VENUE_REFERENCE_SET_SUNSET_V1',
          'TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1',
          'FORBIDDEN',
          'REQUIRED',
          'DENY',
          'UNSUPPORTED_V1',
        ],
      ],
      'VENUE_REFERENCE_SET!A2:K1000': [
        [
          'TOCA_VENUE_REFERENCE_SET_SUNSET_V1',
          'REF-SUN-001',
          'SUN-0244',
          'source-drive',
          'VENUE_REFERENCE',
          'spatial truth',
          true,
          true,
          'DECK|HORIZONTE',
          'ACTIVE',
          'SUNSET',
        ],
      ],
      'VIDEO_SHOTS!A2:Q2000': [
        [
          'SHOT-SUN-001',
          'SUN-VIDEO-001',
          'source-video-drive',
          '',
          '',
          'c'.repeat(64),
          '',
          'SUNSET',
          'deck_ocean_view',
          'ESTABLISHING',
          '6000',
          'VERTICAL',
          true,
          false,
          'UNVERIFIED',
          'VENUE_VERIFIED_SOURCE',
          'source shot pending marketing master',
        ],
      ],
    });
    const registry = new GoogleSheetsCreativeTruthRegistry(client, { spreadsheetId: 'sheet' });

    await expect(registry.assertCanonicalPolicy()).resolves.toBeUndefined();

    const references = await registry.getReferenceSet('TOCA_VENUE_REFERENCE_SET_SUNSET_V1');
    expect(references).toHaveLength(1);
    expect(references[0]?.operationScope).toBe('SUNSET');
    expect(references[0]?.venueVerified).toBe(true);

    const shots = await registry.listVideoShots('SUNSET');
    expect(shots).toHaveLength(1);
    expect(shots[0]?.shotId).toBe('SHOT-SUN-001');
    expect(shots[0]?.status).toBe('VENUE_VERIFIED_SOURCE');
    expect(shots[0]?.sourceSha256).toBe('c'.repeat(64));
    expect(shots[0]?.marketingReady).toBe(false);
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
