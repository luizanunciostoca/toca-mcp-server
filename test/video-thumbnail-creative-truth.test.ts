import { describe, expect, it } from 'vitest';
import type { DeterministicRenderManifest } from '../src/contracts/creative-truth.js';
import { assertVideoThumbnailCreativeTruth } from '../src/content/video-thumbnail-creative-truth.js';

const outputSha256 = 'a'.repeat(64);

function manifest(
  overrides: Partial<DeterministicRenderManifest> = {},
): DeterministicRenderManifest {
  return {
    contentItemId: 'content-thumbnail-1',
    creativeId: 'creative-thumbnail-1',
    policyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
    standardId: 'TOCA_VIDEO_V1',
    creativeMode: 'REAL_COMPOSITE',
    sourceAssetIds: ['source-video-1'],
    masterAssetIds: ['master-video-1'],
    brandAssetIds: ['BRAND-TOCA-WHITE-V1'],
    outputSha256,
    outputDimensions: '1080x1920',
    exactAssetBinding: true,
    gates: [
      { gate: 'BRAND_INTEGRITY', status: 'PASSED', failureCodes: [], evidence: {} },
      { gate: 'VENUE_FIDELITY', status: 'PASSED', failureCodes: [], evidence: {} },
      { gate: 'QUALITY', status: 'PASSED', failureCodes: [], evidence: {} },
    ],
    createdAt: '2026-08-18T00:30:00-03:00',
    ...overrides,
  };
}

describe('video thumbnail Creative Truth binding', () => {
  it('accepts the exact final artifact only when all Creative Truth gates passed', () => {
    expect(() =>
      assertVideoThumbnailCreativeTruth('content-thumbnail-1', manifest(), outputSha256),
    ).not.toThrow();
  });

  it('fails closed when a required Creative Truth gate did not pass', () => {
    const failed = manifest({
      gates: [
        { gate: 'BRAND_INTEGRITY', status: 'PASSED', failureCodes: [], evidence: {} },
        {
          gate: 'VENUE_FIDELITY',
          status: 'FAILED',
          failureCodes: ['FAILED_ARCHITECTURE_DRIFT'],
          evidence: {},
        },
        { gate: 'QUALITY', status: 'PASSED', failureCodes: [], evidence: {} },
      ],
    });

    expect(() =>
      assertVideoThumbnailCreativeTruth('content-thumbnail-1', failed, outputSha256),
    ).toThrow('CREATIVE_TRUTH_PUBLICATION_BLOCKED');
  });

  it('rejects a manifest belonging to another content item', () => {
    expect(() =>
      assertVideoThumbnailCreativeTruth('content-thumbnail-2', manifest(), outputSha256),
    ).toThrow('R29_VIDEO_THUMBNAIL_CREATIVE_TRUTH_CONTENT_MISMATCH');
  });

  it('rejects an output hash that differs from the approved final creative', () => {
    expect(() =>
      assertVideoThumbnailCreativeTruth('content-thumbnail-1', manifest(), 'b'.repeat(64)),
    ).toThrow('R29_VIDEO_THUMBNAIL_CREATIVE_TRUTH_HASH_MISMATCH');
  });

  it('requires a structured Creative Truth manifest and a valid SHA-256', () => {
    expect(() =>
      assertVideoThumbnailCreativeTruth('content-thumbnail-1', undefined, outputSha256),
    ).toThrow('R29_VIDEO_THUMBNAIL_CREATIVE_TRUTH_MANIFEST_REQUIRED');
    expect(() =>
      assertVideoThumbnailCreativeTruth('content-thumbnail-1', manifest(), 'not-a-sha'),
    ).toThrow('R29_VIDEO_THUMBNAIL_OUTPUT_SHA256_INVALID');
  });
});
