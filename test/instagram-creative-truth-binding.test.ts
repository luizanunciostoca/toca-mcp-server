import { describe, expect, it } from 'vitest';
import type { InstagramPublishRequest } from '../src/providers/instagram/instagram-contracts.js';
import { assertCreativeTruthBinding } from '../src/providers/instagram/instagram-publication-executor.js';

const approvedSha256 = 'a'.repeat(64);
const request: InstagramPublishRequest = {
  account: { pageId: 'page-1', instagramAccountId: 'ig-1' },
  mediaType: 'IMAGE',
  mediaUrls: ['https://example.com/creative.jpg'],
  caption: 'Sunset',
  correlationId: 'corr-1',
  idempotencyKey: 'idem-1',
};

const binding = {
  policyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1' as const,
  standardId: 'SUNSET_FEED_V1',
  creativeId: 'CREATIVE-1',
  outputSha256: approvedSha256,
  brandIntegrityStatus: 'PASSED' as const,
  venueFidelityStatus: 'PASSED' as const,
  qualityGateStatus: 'PASSED' as const,
  exactAssetBinding: true as const,
};

describe('Instagram Creative Truth publication binding', () => {
  it('rejects publication without an approved exact-asset binding', () => {
    expect(() => assertCreativeTruthBinding(request)).toThrow('CREATIVE_TRUTH_BINDING_REQUIRED');
  });

  it('rejects publication when no staged-byte SHA-256 accompanies the binding', () => {
    expect(() =>
      assertCreativeTruthBinding({
        ...request,
        creativeTruthBinding: binding,
      }),
    ).toThrow('CREATIVE_TRUTH_PUBLICATION_ASSET_HASH_REQUIRED');
  });

  it('rejects publication when staged bytes differ from the approved output hash', () => {
    expect(() =>
      assertCreativeTruthBinding({
        ...request,
        creativeTruthBinding: binding,
        publicationAssetSha256: 'b'.repeat(64),
      }),
    ).toThrow('FAILED_PUBLICATION_ASSET_HASH_MISMATCH');
  });

  it('accepts publication only when all gates passed and the staged bytes match the approved hash', () => {
    expect(() =>
      assertCreativeTruthBinding({
        ...request,
        creativeTruthBinding: binding,
        publicationAssetSha256: approvedSha256,
      }),
    ).not.toThrow();
  });
});
