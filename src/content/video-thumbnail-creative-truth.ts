import { deterministicRenderManifestSchema } from '../contracts/creative-truth.js';
import { assertCreativeReadyForPublication } from '../creative/creative-truth.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const TOCA_THUMBNAIL_STANDARD_ID = 'TOCA_THUMBNAIL_V1';
const THUMBNAIL_CANVASES = new Set(['1080x1920', '1080x1350', '1080x1080']);
const CREATIVE_MODES = new Set([
  'REAL_COMPOSITE',
  'REAL_PLUS_ENHANCEMENT',
  'GENERATIVE_EXCEPTION',
]);
const FINAL_ARTIFACT_FIELDS = [
  'creative_truth_manifest',
  'output_sha256',
  'final_asset_sha256',
  'output_bytes',
] as const;

export function assertVideoThumbnailRenderIntent(
  contentItemId: string,
  payload: Readonly<Record<string, unknown>>,
): void {
  const normalizedContentItemId = contentItemId.trim();
  if (!normalizedContentItemId) {
    throw new Error('R29_VIDEO_THUMBNAIL_CONTENT_ITEM_REQUIRED');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('R29_VIDEO_THUMBNAIL_RENDER_INTENT_REQUIRED');
  }

  const standardId = requiredText(payload.standard_id, 'R29_VIDEO_THUMBNAIL_STANDARD_REQUIRED');
  if (standardId !== TOCA_THUMBNAIL_STANDARD_ID) {
    throw new Error('R29_VIDEO_THUMBNAIL_STANDARD_MISMATCH');
  }
  requiredText(payload.thumbnail_creative_id, 'R29_VIDEO_THUMBNAIL_CREATIVE_ID_REQUIRED');
  requiredText(payload.source_asset_id, 'R29_VIDEO_THUMBNAIL_SOURCE_ASSET_REQUIRED');

  const creativeMode = requiredText(
    payload.creative_mode,
    'R29_VIDEO_THUMBNAIL_CREATIVE_MODE_REQUIRED',
  );
  if (!CREATIVE_MODES.has(creativeMode)) {
    throw new Error('R29_VIDEO_THUMBNAIL_CREATIVE_MODE_INVALID');
  }

  const canvas = requiredText(payload.canvas, 'R29_VIDEO_THUMBNAIL_CANVAS_REQUIRED');
  if (!THUMBNAIL_CANVASES.has(canvas)) {
    throw new Error('R29_VIDEO_THUMBNAIL_CANVAS_INVALID');
  }

  if (payload.master_asset_id !== undefined) {
    requiredText(payload.master_asset_id, 'R29_VIDEO_THUMBNAIL_MASTER_ASSET_INVALID');
  }

  for (const field of FINAL_ARTIFACT_FIELDS) {
    if (payload[field] !== undefined) {
      throw new Error(`R29_VIDEO_THUMBNAIL_RENDER_INTENT_MUST_NOT_INCLUDE_FINAL_ARTIFACT:${field}`);
    }
  }
}

export function assertVideoThumbnailCreativeTruth(
  contentItemId: string,
  manifest: unknown,
  outputSha256: string,
): void {
  const normalizedContentItemId = contentItemId.trim();
  if (!normalizedContentItemId) {
    throw new Error('R29_VIDEO_THUMBNAIL_CONTENT_ITEM_REQUIRED');
  }

  const normalizedOutputSha256 = outputSha256.trim().toLowerCase();
  if (!SHA256_PATTERN.test(normalizedOutputSha256)) {
    throw new Error('R29_VIDEO_THUMBNAIL_OUTPUT_SHA256_INVALID');
  }

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('R29_VIDEO_THUMBNAIL_CREATIVE_TRUTH_MANIFEST_REQUIRED');
  }

  const parsed = deterministicRenderManifestSchema.parse(manifest);
  const ready = assertCreativeReadyForPublication(parsed);

  if (ready.standardId !== TOCA_THUMBNAIL_STANDARD_ID) {
    throw new Error('R29_VIDEO_THUMBNAIL_CREATIVE_TRUTH_STANDARD_MISMATCH');
  }
  if (ready.contentItemId !== normalizedContentItemId) {
    throw new Error('R29_VIDEO_THUMBNAIL_CREATIVE_TRUTH_CONTENT_MISMATCH');
  }
  if (ready.outputSha256.toLowerCase() !== normalizedOutputSha256) {
    throw new Error('R29_VIDEO_THUMBNAIL_CREATIVE_TRUTH_HASH_MISMATCH');
  }
}

function requiredText(value: unknown, errorCode: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(errorCode);
  return value.trim();
}
