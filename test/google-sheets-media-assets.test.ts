import { describe, expect, it } from 'vitest';
import type { SpreadsheetValuesClient } from '../src/providers/google-sheets/media-assets.js';
import { GoogleSheetsMediaAssetAdapter } from '../src/providers/google-sheets/media-assets.js';

class FakeSheetsClient implements SpreadsheetValuesClient {
  readonly reads = new Map<string, readonly (readonly unknown[])[]>();
  readonly appends: Array<{ range: string; values: readonly unknown[] }> = [];

  readRange(_spreadsheetId: string, range: string) {
    return Promise.resolve(this.reads.get(range) ?? []);
  }

  appendRow(_spreadsheetId: string, range: string, values: readonly unknown[]) {
    this.appends.push({ range, values });
    return Promise.resolve();
  }
}

describe('GoogleSheetsMediaAssetAdapter', () => {
  it('returns ranked selectable assets from ASSET_SELECTOR when the snapshot context matches', async () => {
    const client = new FakeSheetsClient();
    client.reads.set('ASSET_SELECTOR!A2:B3', [
      ['FORMATO', 'STORIES'],
      ['TEMA / PALAVRA-CHAVE', 'casal'],
    ]);
    client.reads.set('ASSET_SELECTOR!A12:V440', [
      [
        'SUN-0354',
        'drive-354',
        'VC-COUPLE-SUNSET-ROMANCE-01',
        '',
        '',
        '',
        100,
        100,
        100,
        78,
        94,
        100,
        0,
        '',
        '',
        '',
        100,
        100,
        96.82,
        'TOP_PICK',
        '',
        1,
      ],
      [
        'SUN-0347',
        'drive-347',
        'VC-COUPLE-SUNSET-KISS-01',
        '',
        '',
        '',
        100,
        100,
        100,
        82,
        88,
        100,
        0,
        '',
        '',
        '',
        100,
        100,
        96.76,
        'TOP_PICK',
        '',
        2,
      ],
      [
        'SUN-0098',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        0,
        '',
        '',
        '',
        40,
        100,
        0,
        'LOW_PRIORITY',
        '',
        330,
      ],
    ]);

    const adapter = new GoogleSheetsMediaAssetAdapter(client, {
      spreadsheetId: 'sheet-1',
    });
    const result = await adapter.rank({
      contentItemId: 'CONTENT-001',
      format: 'STORIES',
      theme: 'casal',
      limit: 2,
    });

    expect(result.assets.map((asset) => asset.assetId)).toEqual(['SUN-0354', 'SUN-0347']);
    expect(result.assets[0]?.score).toBe(96.82);
    expect(result.source).toBe('TOCA_OS_ASSET_SELECTOR');
  });

  it('fails closed when request context does not match the shared selector snapshot', async () => {
    const client = new FakeSheetsClient();
    client.reads.set('ASSET_SELECTOR!A2:B3', [
      ['FORMATO', 'FEED'],
      ['TEMA / PALAVRA-CHAVE', 'sunset'],
    ]);
    const adapter = new GoogleSheetsMediaAssetAdapter(client, {
      spreadsheetId: 'sheet-1',
    });

    await expect(
      adapter.rank({
        contentItemId: 'CONTENT-002',
        format: 'STORIES',
        theme: 'casal',
        limit: 5,
      }),
    ).rejects.toThrow(/context mismatch/);
  });

  it('accepts pt-BR decimal strings from Sheets', async () => {
    const client = new FakeSheetsClient();
    client.reads.set('ASSET_SELECTOR!A2:B3', [
      ['FORMATO', 'FEED'],
      ['TEMA / PALAVRA-CHAVE', ''],
    ]);
    client.reads.set('ASSET_SELECTOR!A12:V440', [
      [
        'SUN-0009',
        'drive-9',
        'VC-BRAND-SYMBOL-SUNSET-01',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '92,68',
        '',
        '',
        '1',
      ],
    ]);

    const adapter = new GoogleSheetsMediaAssetAdapter(client, {
      spreadsheetId: 'sheet-1',
    });
    const result = await adapter.rank({
      contentItemId: 'CONTENT-003',
      format: 'FEED',
      limit: 5,
    });

    expect(result.assets[0]?.score).toBe(92.68);
  });

  it('records usage once using a deterministic idempotency key', async () => {
    const client = new FakeSheetsClient();
    client.reads.set('ASSET_USAGE_LOG!A2:I2000', []);
    const adapter = new GoogleSheetsMediaAssetAdapter(client, {
      spreadsheetId: 'sheet-1',
    });

    await adapter.recordUsage({
      contentItemId: 'CONTENT-004',
      assetId: 'SUN-0347',
      usedAt: '2026-08-10T19:00:00-03:00',
      format: 'STORIES',
      channel: 'instagram',
      action: 'PUBLISHED',
      source: 'TOCA_MCP_SERVER',
    });

    expect(client.appends).toHaveLength(1);
    expect(client.appends[0]?.values[0]).toBe('CONTENT-004:SUN-0347:PUBLISHED');
  });

  it('does not append duplicate usage records', async () => {
    const client = new FakeSheetsClient();
    client.reads.set('ASSET_USAGE_LOG!A2:I2000', [
      ['CONTENT-005:SUN-0354:PUBLISHED', 'CONTENT-005', 'SUN-0354'],
    ]);
    const adapter = new GoogleSheetsMediaAssetAdapter(client, {
      spreadsheetId: 'sheet-1',
    });

    await adapter.recordUsage({
      contentItemId: 'CONTENT-005',
      assetId: 'SUN-0354',
      usedAt: '2026-08-10T19:30:00-03:00',
      format: 'FEED',
      action: 'PUBLISHED',
      source: 'TOCA_MCP_SERVER',
    });

    expect(client.appends).toHaveLength(0);
  });
});
