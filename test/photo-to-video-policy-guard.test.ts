import { describe, expect, it, vi } from 'vitest';
import { GoogleSheetsPhotoToVideoParentPolicyGuard } from '../src/providers/google-sheets/photo-to-video-policy-guard.js';
import type { SpreadsheetValuesClient } from '../src/providers/google-sheets/media-assets.js';

const headers = [
  'policy_id',
  'status',
  'brand_scope',
  'official_logo_only',
  'venue_fidelity_gate',
  'brand_integrity_gate',
  'quality_gate',
  'fail_closed',
  'video_generative_exception',
  'full_synthetic_venue_video',
  'photo_to_video_policy_id',
  'video_photo_motion',
];

const canonicalRow = [
  'TOCA_CREATIVE_TRUTH_POLICY_V1',
  'ACTIVE_CANONICAL',
  'TOCA_DO_MORCEGO',
  true,
  true,
  true,
  true,
  true,
  'SOURCE_ANCHORED_SCENE_CONTINUATION_GOVERNED_V1',
  'UNSUPPORTED_V1',
  'TOCA_PHOTO_TO_VIDEO_POLICY_V1',
  'ACTIVE_V1',
];

function client(rows: readonly (readonly unknown[])[]) {
  const readRange = vi.fn(async () => {
    await Promise.resolve();
    return rows;
  });
  const value: SpreadsheetValuesClient = {
    readRange,
    appendRow: async () => {
      await Promise.resolve();
      return undefined;
    },
  };
  return { value, readRange };
}

describe('GoogleSheetsPhotoToVideoParentPolicyGuard', () => {
  it('accepts both governed routes only under the exact canonical parent policy row', async () => {
    const fake = client([headers, canonicalRow]);
    const guard = new GoogleSheetsPhotoToVideoParentPolicyGuard(fake.value, 'creative-truth');

    await guard.assertCanonical('REAL_PHOTO_TO_MOTION_VIDEO');
    await guard.assertCanonical('GENERATIVE_SCENE_CONTINUATION_VIDEO');

    expect(fake.readRange).toHaveBeenCalledTimes(2);
    expect(fake.readRange).toHaveBeenCalledWith('creative-truth', 'POLICY!A1:AC20');
  });

  it('fails closed when scene continuation is no longer enabled by the parent policy', async () => {
    const disabled = [...canonicalRow];
    disabled[8] = 'UNSUPPORTED_V1';
    const fake = client([headers, disabled]);
    const guard = new GoogleSheetsPhotoToVideoParentPolicyGuard(fake.value, 'creative-truth');

    await expect(guard.assertCanonical('GENERATIVE_SCENE_CONTINUATION_VIDEO')).rejects.toThrow(
      'PHOTO_TO_VIDEO_PARENT_POLICY_ROUTE_DISABLED',
    );
  });

  it('fails closed when the child photo-to-video policy binding drifts', async () => {
    const drifted = [...canonicalRow];
    drifted[10] = 'OTHER_VIDEO_POLICY';
    const fake = client([headers, drifted]);
    const guard = new GoogleSheetsPhotoToVideoParentPolicyGuard(fake.value, 'creative-truth');

    await expect(guard.assertCanonical('REAL_PHOTO_TO_MOTION_VIDEO')).rejects.toThrow(
      'PHOTO_TO_VIDEO_PARENT_POLICY_DRIFT',
    );
  });

  it('fails closed on ambiguous active canonical parent policy rows', async () => {
    const fake = client([headers, canonicalRow, canonicalRow]);
    const guard = new GoogleSheetsPhotoToVideoParentPolicyGuard(fake.value, 'creative-truth');

    await expect(guard.assertCanonical('REAL_PHOTO_TO_MOTION_VIDEO')).rejects.toThrow(
      'PHOTO_TO_VIDEO_PARENT_POLICY_NOT_RESOLVED',
    );
  });

  it('fails closed when required parent policy schema columns are missing', async () => {
    const fake = client([
      headers.filter((header) => header !== 'photo_to_video_policy_id'),
      canonicalRow.slice(0, -2).concat(canonicalRow[11]!),
    ]);
    const guard = new GoogleSheetsPhotoToVideoParentPolicyGuard(fake.value, 'creative-truth');

    await expect(guard.assertCanonical('REAL_PHOTO_TO_MOTION_VIDEO')).rejects.toThrow(
      'PHOTO_TO_VIDEO_PARENT_POLICY_SCHEMA_INVALID:photo_to_video_policy_id',
    );
  });
});
