import { describe, expect, it, vi } from 'vitest';
import { GoogleSheetsPhotoToVideoContentWriteback } from '../src/providers/google-sheets/photo-to-video-content-writeback.js';
import type {
  SpreadsheetValuesBatchWriter,
  SpreadsheetValuesClient,
} from '../src/providers/google-sheets/media-assets.js';

const artifactRef =
  'gcs://toca-bucket/instagram/photo-motion-review-v1/photo-video-1234567890abcdef12345678-aaaaaaaaaaaaaaaa.mp4';
const headers = [
  'content_item_id',
  'video_product_id',
  'video_route_type',
  'video_standard_id',
  'video_candidate_sha256',
  'video_provider_job_id',
  'video_candidate_artifact_ref',
  'video_final_asset_sha256',
  'video_final_artifact_ref',
  'video_review_status',
  'video_output_evidence_id',
];

function client(row: readonly unknown[]) {
  const updateRanges = vi.fn(
    async (
      _spreadsheetId: string,
      _updates: readonly {
        readonly range: string;
        readonly values: readonly (readonly unknown[])[];
      }[],
    ) => {
      void _spreadsheetId;
      void _updates;
      await Promise.resolve();
      return undefined;
    },
  );
  const value: SpreadsheetValuesClient & SpreadsheetValuesBatchWriter = {
    readRange: async () => {
      await Promise.resolve();
      return [headers, row];
    },
    appendRow: async () => {
      await Promise.resolve();
      return undefined;
    },
    updateRanges,
  };
  return { value, updateRanges };
}

describe('GoogleSheetsPhotoToVideoContentWriteback', () => {
  it('writes candidate identity and durable artifact without granting publication state', async () => {
    const fake = client(['CONTENT-1', '', '', '', '', '', '', '', '', '', '']);
    const writeback = new GoogleSheetsPhotoToVideoContentWriteback(fake.value, 'content-sheet');
    await writeback.writeCandidate({
      contentItemId: 'CONTENT-1',
      productId: 'SUNSET',
      routeType: 'GENERATIVE_SCENE_CONTINUATION_VIDEO',
      standardId: 'SUNSET_REEL_SCENE_CONTINUATION_V1',
      candidateSha256: 'a'.repeat(64),
      candidateArtifactRef: artifactRef,
      providerJobId: 'video_123',
    });
    expect(fake.updateRanges).toHaveBeenCalledTimes(1);
    const updates = fake.updateRanges.mock.calls[0]?.[1] ?? [];
    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ values: [['GENERATED_REVIEW_REQUIRED']] }),
        expect.objectContaining({ values: [['video_123']] }),
        expect.objectContaining({ values: [[artifactRef]] }),
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
      artifactRef,
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
        candidateArtifactRef: artifactRef,
      }),
    ).rejects.toThrow('VIDEO_DIFFERENT_CANDIDATE_ALREADY_RECORDED');
    expect(fake.updateRanges).not.toHaveBeenCalled();
  });

  it('requires final writeback to match the recorded candidate and artifact exactly', async () => {
    const fake = client([
      'CONTENT-1',
      'SUNSET',
      'REAL_PHOTO_TO_MOTION_VIDEO',
      'SUNSET_REEL_PHOTO_MOTION_V1',
      'a'.repeat(64),
      '',
      artifactRef,
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
        finalArtifactRef: artifactRef,
        outputEvidenceId: 'VIDEO-1',
      }),
    ).rejects.toThrow('VIDEO_CONTENT_CANDIDATE_BINDING_CHANGED');
    expect(fake.updateRanges).not.toHaveBeenCalled();
  });
});
