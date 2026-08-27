import { describe, expect, it } from 'vitest';
import { resolvePublishNowCreativeTruthRequestFields } from '../src/worker/instagram-publish-now-creative-truth.js';

const sha256 = 'a'.repeat(64);
const binding = {
  policyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1' as const,
  standardId: 'SUNSET_FEED_PHOTO_V1',
  creativeId: 'CR-MKT-20260827-SUNSET-FEED-1500-PHOTO-V2',
  outputSha256: sha256,
  brandIntegrityStatus: 'PASSED' as const,
  venueFidelityStatus: 'PASSED' as const,
  qualityGateStatus: 'PASSED' as const,
  exactAssetBinding: true as const,
};

const command = {
  action: 'PUBLISH_NOW',
  correlationId: 'corr-v4',
  idempotencyKey: 'idem-v4',
  expectedAssetSha256: sha256,
  creativeTruthBinding: binding,
};

const runtime = {
  correlationId: 'corr-v4',
  idempotencyKey: 'idem-v4',
  stagedAssetSha256: sha256,
};

describe('publish-now Creative Truth binding', () => {
  it('leaves non-matching legacy preparation requests unchanged', () => {
    expect(
      resolvePublishNowCreativeTruthRequestFields(command, {
        ...runtime,
        correlationId: 'different-correlation',
      }),
    ).toBeUndefined();
  });

  it('fails closed when the matching publish-now command has no valid binding', () => {
    const invalid = { ...command, creativeTruthBinding: undefined };
    expect(() => resolvePublishNowCreativeTruthRequestFields(invalid, runtime)).toThrow(
      'INSTAGRAM_PUBLISH_NOW_CREATIVE_TRUTH_BINDING_INVALID',
    );
  });

  it('fails closed when staged bytes differ from the approved Creative Truth output', () => {
    expect(() =>
      resolvePublishNowCreativeTruthRequestFields(command, {
        ...runtime,
        stagedAssetSha256: 'b'.repeat(64),
      }),
    ).toThrow('INSTAGRAM_PUBLISH_NOW_STAGED_ASSET_HASH_MISMATCH');
  });

  it('binds the exact staged bytes into the provider request', () => {
    expect(resolvePublishNowCreativeTruthRequestFields(command, runtime)).toEqual({
      creativeTruthBinding: binding,
      publicationAssetSha256: sha256,
    });
  });
});
