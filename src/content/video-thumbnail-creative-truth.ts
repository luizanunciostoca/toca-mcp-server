import { deterministicRenderManifestSchema } from '../contracts/creative-truth.js';
import { assertCreativeReadyForPublication } from '../creative/creative-truth.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

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

  if (ready.contentItemId !== normalizedContentItemId) {
    throw new Error('R29_VIDEO_THUMBNAIL_CREATIVE_TRUTH_CONTENT_MISMATCH');
  }
  if (ready.outputSha256.toLowerCase() !== normalizedOutputSha256) {
    throw new Error('R29_VIDEO_THUMBNAIL_CREATIVE_TRUTH_HASH_MISMATCH');
  }
}
