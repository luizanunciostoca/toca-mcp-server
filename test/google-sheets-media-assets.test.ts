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

function rankingPolicyRows(): readonly (readonly unknown[])[] {
  return [
    ['POLICY_VERSION', 'RANK-1.0'],
    ['REQUIRED_ASSET_STATUS', 'VISUALLY_ANALYZED'],
    ['WEIGHT_FORMAT', '0,25'],
    ['WEIGHT_BRAND_ALIGNMENT', 0.18],
    ['WEIGHT_TECHNICAL_QUALITY', 0.16],
    ['WEIGHT_TEXT_SPACE', 0.12],
    ['WEIGHT_CROP_FLEXIBILITY', 0.09],
    ['WEIGHT_NOVELTY', 0.12],
    ['WEIGHT_THEME', 0.08],
    ['THEME_SCORE_EMPTY', 100],
    ['THEME_SCORE_MATCH', 100],
    ['THEME_SCORE_MISS', 40],
    ['USE_COUNT_PENALTY_PER_USE', 18],
    ['ANTI_REPEAT_FLOOR', 20],
    ['SIMILARITY_PENALTY_FACTOR', 0.35],
    ['RECENCY_DAYS_1', 7],
    ['RECENCY_FACTOR_1', 0.35],
    ['RECENCY_DAYS_2', 14],
    ['RECENCY_FACTOR_2', 0.6],
    ['RECENCY_DAYS_3', 30],
    ['RECENCY_FACTOR_3', 0.8],
    ['RECENCY_FACTOR_DEFAULT', 1],
    ['MAX_RESULT_LIMIT', 10],
  ];
}

interface AssetRowOptions {
  readonly assetId: string;
  readonly theme: string;
  readonly feed: number | string;
  readonly stories: number | string;
  readonly lastUsed?: string | number;
  readonly useCount?: number;
  readonly similarity?: number;
}

function assetRow(options: AssetRowOptions): readonly unknown[] {
  const row = Array<unknown>(30).fill('');
  row[0] = options.assetId;
  row[1] = `drive-${options.assetId}`;
  row[2] = `cluster-${options.assetId}`;
  row[5] = options.theme;
  row[6] = 'toca';
  row[7] = options.theme;
  row[10] = options.feed;
  row[11] = options.stories;
  row[12] = 90;
  row[13] = 90;
  row[17] = 100;
  row[18] = 100;
  row[19] = 100;
  row[20] = 100;
  row[21] = 100;
  row[22] = options.lastUsed ?? '';
  row[23] = options.useCount ?? 0;
  row[26] = 'VISUALLY_ANALYZED';
  row[27] = options.theme;
  row[29] = options.similarity ?? 0;
  return row;
}

function configuredClient(assetRows: readonly (readonly unknown[])[]) {
  const client = new FakeSheetsClient();
  client.reads.set('ASSET_RANKING_POLICY!A2:B100', rankingPolicyRows());
  client.reads.set('ASSET_INTELLIGENCE!A2:AD1000', assetRows);
  return client;
}

describe('GoogleSheetsMediaAssetAdapter', () => {
  it('ranks concurrent requests independently without shared selector state', async () => {
    const client = configuredClient([
      assetRow({ assetId: 'SUN-0001', theme: 'casal', feed: 60, stories: 100 }),
      assetRow({ assetId: 'SUN-0002', theme: 'sunset', feed: 100, stories: 60 }),
    ]);
    const adapter = new GoogleSheetsMediaAssetAdapter(
      client,
      { spreadsheetId: 'sheet-1' },
      () => new Date('2026-08-10T12:00:00Z'),
    );

    const [stories, feed] = await Promise.all([
      adapter.rank({
        contentItemId: 'CONTENT-STORIES',
        format: 'STORIES',
        theme: 'casal',
        limit: 1,
      }),
      adapter.rank({
        contentItemId: 'CONTENT-FEED',
        format: 'FEED',
        theme: 'sunset',
        limit: 1,
      }),
    ]);

    expect(stories.assets[0]?.assetId).toBe('SUN-0001');
    expect(feed.assets[0]?.assetId).toBe('SUN-0002');
  });

  it('accepts pt-BR numeric strings from policy and asset data', async () => {
    const client = configuredClient([
      assetRow({ assetId: 'SUN-0009', theme: 'marca', feed: '100,0', stories: '90,0' }),
    ]);
    const adapter = new GoogleSheetsMediaAssetAdapter(
      client,
      { spreadsheetId: 'sheet-1' },
      () => new Date('2026-08-10T12:00:00Z'),
    );

    const result = await adapter.rank({
      contentItemId: 'CONTENT-PTBR',
      format: 'FEED',
      theme: 'marca',
      limit: 5,
    });

    expect(result.assets[0]).toMatchObject({ assetId: 'SUN-0009', score: 100, rank: 1 });
  });

  it('penalizes recently used and visually similar assets', async () => {
    const client = configuredClient([
      assetRow({
        assetId: 'SUN-0010',
        theme: 'sunset',
        feed: 100,
        stories: 100,
        lastUsed: '2026-08-09T12:00:00Z',
        useCount: 1,
        similarity: 0.5,
      }),
      assetRow({ assetId: 'SUN-0011', theme: 'sunset', feed: 92, stories: 92 }),
    ]);
    const adapter = new GoogleSheetsMediaAssetAdapter(
      client,
      { spreadsheetId: 'sheet-1' },
      () => new Date('2026-08-10T12:00:00Z'),
    );

    const result = await adapter.rank({
      contentItemId: 'CONTENT-ANTI-REPEAT',
      format: 'FEED',
      theme: 'sunset',
      limit: 2,
    });

    expect(result.assets.map((asset) => asset.assetId)).toEqual(['SUN-0011', 'SUN-0010']);
    expect(result.assets[1]?.score).toBeLessThan(30);
  });

  it('records usage once using a deterministic idempotency key', async () => {
    const client = new FakeSheetsClient();
    client.reads.set('ASSET_USAGE_LOG!A2:I2000', []);
    const adapter = new GoogleSheetsMediaAssetAdapter(client, { spreadsheetId: 'sheet-1' });

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
    const adapter = new GoogleSheetsMediaAssetAdapter(client, { spreadsheetId: 'sheet-1' });

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
