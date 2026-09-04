import { describe, expect, it, vi } from 'vitest';
import { GoogleSheetsPhotoToVideoRegistry } from '../src/providers/google-sheets/photo-to-video-registry.js';
import type { SpreadsheetValuesClient } from '../src/providers/google-sheets/media-assets.js';

const CONTENT_ITEM_ID = 'TEST-SUNSET-VIDEO-001';
const SOURCE_ASSET_ID = 'SUN-TEST-001';

function rowsFor(status: string): Readonly<Record<string, readonly (readonly unknown[])[]>> {
  return {
    'CONTENT_ITEMS!A1:CF2000': [
      [
        'content_item_id',
        'operation',
        'format',
        'source_asset_id',
        'creative_standard_id',
        'video_product_id',
      ],
      [CONTENT_ITEM_ID, 'SUNSET', 'REEL', SOURCE_ASSET_ID, 'SUNSET_REEL_V1', 'SUNSET'],
    ],
    'PRODUCT_VISUAL_POLICIES!A1:I1000': [
      [
        'product_id',
        'operation',
        'display_name',
        'photo_motion_allowed',
        'scene_continuation_allowed',
        'hero_brand',
        'hero_brand_variant',
        'future_product_runtime_mode',
        'status',
      ],
      ['SUNSET', 'SUNSET', 'Sunset', true, false, 'TOCA_DO_MORCEGO', 'WHITE', 'REGISTRY_DRIVEN', 'ACTIVE'],
    ],
    'VIDEO_CREATIVE_STANDARDS!A1:N1000': [
      [
        'standard_id',
        'version',
        'product_id',
        'operation',
        'channel',
        'output_type',
        'route_type',
        'size',
        'seconds',
        'motion_preset',
        'brand_position',
        'inherits_content_visual_standard',
        'exact_asset_binding_required',
        'status',
      ],
      [
        'SUNSET_REAL_MOTION_REEL_V1',
        '1.0',
        'SUNSET',
        'SUNSET',
        'INSTAGRAM',
        'REEL',
        'REAL_PHOTO_TO_MOTION_VIDEO',
        '720x1280',
        8,
        'SLOW_PUSH_IN',
        'BOTTOM_CENTER',
        true,
        true,
        'ACTIVE_CANONICAL',
      ],
    ],
    'VIDEO_SOURCE_RIGHTS!A1:I2000': [
      [
        'source_asset_id',
        'operation',
        'rights_status',
        'contains_people',
        'likeness_consent_status',
        'approved_uses',
        'evidence_ref',
        'status',
        'validated_at',
      ],
      [
        SOURCE_ASSET_ID,
        'SUNSET',
        'OWNED',
        false,
        'NOT_APPLICABLE',
        'PHOTO_TO_MOTION',
        'TEST-EVIDENCE',
        'ACTIVE',
        '2026-09-04T10:00:00-03:00',
      ],
    ],
    'VENUE_VISUALS!A2:P2000': [
      [
        'VENUE-SUN-TEST-001',
        SOURCE_ASSET_ID,
        'source-drive-file',
        'MM-SUN-TEST-001-V1',
        'master-drive-file',
        'a'.repeat(64),
        'b'.repeat(64),
        'SUNSET',
        'sunset_deck',
        'venue',
        true,
        true,
        true,
        'DECK|LIGHTING',
        status,
        'test fixture',
      ],
    ],
  };
}

function clientFor(status: string): SpreadsheetValuesClient {
  const ranges = rowsFor(status);
  return {
    readRange: vi.fn((_spreadsheetId: string, range: string) => Promise.resolve(ranges[range] ?? [])),
    appendRow: vi.fn(() => Promise.resolve()),
  };
}

describe('photo-to-video marketing-ready venue status', () => {
  it('accepts the canonical VENUE_VERIFIED_MARKETING_READY status', async () => {
    const registry = new GoogleSheetsPhotoToVideoRegistry(
      clientFor('VENUE_VERIFIED_MARKETING_READY'),
      'creative-truth',
      'content-registry',
    );

    const resolved = await registry.resolve(CONTENT_ITEM_ID, 'REAL_PHOTO_TO_MOTION_VIDEO');

    expect(resolved.venueAsset.status).toBe('VENUE_VERIFIED_MARKETING_READY');
    expect(resolved.venueAsset.marketingReady).toBe(true);
    expect(resolved.venueAsset.masterSha256).toBe('b'.repeat(64));
  });

  it('keeps legacy master revalidation status fail-closed', async () => {
    const registry = new GoogleSheetsPhotoToVideoRegistry(
      clientFor('VENUE_VERIFIED_LEGACY_MASTER_REVALIDATION_REQUIRED'),
      'creative-truth',
      'content-registry',
    );

    await expect(
      registry.resolve(CONTENT_ITEM_ID, 'REAL_PHOTO_TO_MOTION_VIDEO'),
    ).rejects.toThrow('PHOTO_TO_VIDEO_MARKETING_READY_SOURCE_REQUIRED');
  });
});
