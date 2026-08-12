import { describe, expect, it } from 'vitest';
import {
  mediaAssetSelectionRequestSchema,
  mediaAssetSelectionResultSchema,
  mediaAssetUsageRecordSchema,
} from '../src/contracts/media-assets.js';

describe('media asset selection contracts', () => {
  it('accepts a bounded ranking request', () => {
    expect(
      mediaAssetSelectionRequestSchema.parse({
        contentItemId: 'CONTENT-001',
        format: 'STORIES',
        theme: 'casal',
      }),
    ).toEqual({
      contentItemId: 'CONTENT-001',
      format: 'STORIES',
      theme: 'casal',
      limit: 5,
    });
  });

  it('rejects invalid formats and limits', () => {
    expect(() =>
      mediaAssetSelectionRequestSchema.parse({
        contentItemId: 'CONTENT-002',
        format: 'CAROUSEL',
        limit: 50,
      }),
    ).toThrow();
  });

  it('validates ranked SUNSET assets', () => {
    expect(
      mediaAssetSelectionResultSchema.parse({
        contentItemId: 'CONTENT-003',
        format: 'FEED',
        source: 'TOCA_OS_ASSET_SELECTOR',
        assets: [
          {
            assetId: 'SUN-0354',
            driveFileId: 'drive-file-id',
            cluster: 'VC-COUPLE-SUNSET-ROMANCE-01',
            score: 96.82,
            rank: 1,
          },
        ],
      }).assets[0]?.assetId,
    ).toBe('SUN-0354');
  });

  it('rejects malformed asset ids', () => {
    expect(() =>
      mediaAssetSelectionResultSchema.parse({
        contentItemId: 'CONTENT-004',
        format: 'FEED',
        source: 'TOCA_OS_ASSET_SELECTOR',
        assets: [
          {
            assetId: 'IMG-1',
            driveFileId: 'drive-file-id',
            cluster: 'cluster',
            score: 90,
            rank: 1,
          },
        ],
      }),
    ).toThrow();
  });

  it('validates a deterministic usage record', () => {
    expect(
      mediaAssetUsageRecordSchema.parse({
        contentItemId: 'CONTENT-005',
        assetId: 'SUN-0347',
        usedAt: '2026-08-10T19:00:00-03:00',
        format: 'STORIES',
        channel: 'instagram',
        action: 'PUBLISHED',
        source: 'TOCA_MCP_SERVER',
      }).action,
    ).toBe('PUBLISHED');
  });
});
