import { describe, expect, it, vi } from 'vitest';
import { GoogleSheetsCreativeTruthRegistry } from '../src/providers/google-sheets/creative-truth-registry.js';
import type { SpreadsheetValuesClient } from '../src/providers/google-sheets/media-assets.js';

function clientFor(ranges: Readonly<Record<string, readonly (readonly unknown[])[]>>) {
  const readRange = vi.fn(
    async (_spreadsheetId: string, range: string): Promise<readonly (readonly unknown[])[]> =>
      ranges[range] ?? [],
  );
  const appendRow = vi.fn(async (): Promise<void> => undefined);
  return { readRange, client: { readRange, appendRow } satisfies SpreadsheetValuesClient };
}

function policyRow(): readonly unknown[] {
  return [
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
  ];
}

describe('GoogleSheetsCreativeTruthRegistry canonical identity ambiguity', () => {
  it('rejects duplicate canonical policy identities', async () => {
    const { client } = clientFor({ 'POLICY!A2:R20': [policyRow(), policyRow()] });
    const registry = new GoogleSheetsCreativeTruthRegistry(client, { spreadsheetId: 'sheet' });
    await expect(registry.assertCanonicalPolicy()).rejects.toThrow(
      'TOCA_CREATIVE_TRUTH_POLICY_NOT_ACTIVE',
    );
  });

  it('returns no brand when brand plus variant identity is ambiguous', async () => {
    const row = ['A', 'TOCA_DO_MORCEGO', 'WHITE'];
    const { client } = clientFor({ 'BRAND_ASSETS!A2:N1000': [row, ['B', ...row.slice(1)]] });
    const registry = new GoogleSheetsCreativeTruthRegistry(client, { spreadsheetId: 'sheet' });
    await expect(registry.getBrandAsset('TOCA_DO_MORCEGO', 'WHITE')).resolves.toBeUndefined();
  });

  it('returns no creative standard when standard identity is ambiguous', async () => {
    const row = ['SUNSET_FEED_V1'];
    const { client } = clientFor({ 'CREATIVE_STANDARDS!A2:N1000': [row, row] });
    const registry = new GoogleSheetsCreativeTruthRegistry(client, { spreadsheetId: 'sheet' });
    await expect(registry.getCreativeStandard('SUNSET_FEED_V1')).resolves.toBeUndefined();
  });

  it('returns no venue when venue asset identity is ambiguous', async () => {
    const row = ['VENUE-SUN-1'];
    const { client } = clientFor({ 'VENUE_VISUALS!A2:P2000': [row, row] });
    const registry = new GoogleSheetsCreativeTruthRegistry(client, { spreadsheetId: 'sheet' });
    await expect(registry.getVenueAsset('VENUE-SUN-1')).resolves.toBeUndefined();
  });

  it('returns no video shot when shot identity is ambiguous', async () => {
    const row = ['SHOT-SUN-1'];
    const { client } = clientFor({ 'VIDEO_SHOTS!A2:Q2000': [row, row] });
    const registry = new GoogleSheetsCreativeTruthRegistry(client, { spreadsheetId: 'sheet' });
    await expect(registry.getVideoShot('SHOT-SUN-1')).resolves.toBeUndefined();
  });
});
