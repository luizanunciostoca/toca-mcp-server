import { describe, expect, it, vi } from 'vitest';
import { GoogleSheetsPhotoToVideoContentWriteback } from '../src/providers/google-sheets/photo-to-video-content-writeback.js';
import type {
  SpreadsheetValuesBatchWriter,
  SpreadsheetValuesClient,
} from '../src/providers/google-sheets/media-assets.js';

const headers = [
  'content_item_id',
  'video_product_id',
  'video_route_type',
  'video_standard_id',
  'video_candidate_sha256',
  'video_provider_job_id',
  'video_final_asset_sha256',
  'video_review_status',
  'video_output_evidence_id',
];

function client(row: readonly unknown[]) {
  const updateRanges = vi.fn(async () => undefined);
  const value: SpreadsheetValuesClient & SpreadsheetValuesBatchWriter = {
    readRange: async () => [headers, row],
    appendRow: async () => undefined,
    updateRanges,
  };
  return { value, updateRanges };
}

describe('GoogleSheetsPhotoToVideoContentWriteback', () => {
  it('writes candidate identity without granting publication state', async () => {
    const fake = client(['CONTENT-1', '', '', '', '', '', '', '', '']);
    const writeback = new GoogleSheetsPhotoToVideoContentWriteback(fake.value, 'content-sheet');
    await writeback.writeCandidate({
      contentItemId: 'CONTENT-1',
      productId: 'SUNSET',
      routeType: 'GENERATIVE_SCENE_CONTINUATION_VIDEO',
      standardId: 'SUNSET_REEL_SCENE_CONTINUATION_V1',
      candidateSha256: 'a'.repeat(64),
      providerJobId: 'video_123',
    });
    expect(fake.updateRanges).toHaveBeenCalledTimes(1);
    const updates = fake.updateRanges.mock.calls[0]?.[1] ?? [];
    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ values: [['GENERATED_REVIEW_REQUIRED']] }),
        expect.objectContaining({ values: [['video_123']] }),
      ]),
    );
  });

  it('rejects a different candidate instead of silently replacing review state', async () => {
    const fake = client([
      'CONTENT-1',
      'SUNSET',
      'REAL_PHOTO_TO_MOTION_VIDEO',
      'SUNSET_REEL_PHOTO_MOTION_V1',
      'a'.repeat(64),
      '',
      '',
      'GENERATED_REVIEW_REQUIRED',
      '',
    ]);
    const writeback = new GoogleSheetsPhotoToVideoContentWriteback(fake.value, 'content-sheet');
    await expect(
      writeback.writeCandidate({
        contentItemId: 'CONTENT-1',
        productId: 'SUNSET',
        routeType: 'REAL_PHOTO_TO_MOTION_VIDEO',
        standardId: 'SUNSET_REEL_PHOTO_MOTION_V1',
        candidateSha256: 'b'.repeat(64),
      }),
    ).rejects.toThrow('VIDEO_DIFFERENT_CANDIDATE_ALREADY_RECORDED');
    expect(fake.updateRanges).not.toHaveBeenCalled();
  });

  it('requires final writeback to match the recorded candidate exactly', async () => {
    const fake = client([
      'CONTENT-1',
      'SUNSET',
      'REAL_PHOTO_TO_MOTION_VIDEO',
      'SUNSET_REEL_PHOTO_MOTION_V1',
      'a'.repeat(64),
      '',
      '',
      'GENERATED_REVIEW_REQUIRED',
      '',
    ]);
    const writeback = new GoogleSheetsPhotoToVideoContentWriteback(fake.value, 'content-sheet');
    await expect(
      writeback.writeFinal({
        contentItemId: 'CONTENT-1',
        routeType: 'REAL_PHOTO_TO_MOTION_VIDEO',
        standardId: 'SUNSET_REEL_PHOTO_MOTION_V1',
        candidateSha256: 'b'.repeat(64),
        finalAssetSha256: 'b'.repeat(64),
        outputEvidenceId: 'VIDEO-1',
      }),
    ).rejects.toThrow('VIDEO_CONTENT_CANDIDATE_BINDING_CHANGED');
    expect(fake.updateRanges).not.toHaveBeenCalled();
  });
});
