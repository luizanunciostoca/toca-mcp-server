import { describe, expect, it } from 'vitest';
import type { InstagramPublishRequest } from '../src/providers/instagram/instagram-contracts.js';
import { assertCreativeTruthBinding } from '../src/providers/instagram/instagram-publication-executor.js';

const approvedUrl = 'https://example.com/creative.jpg';
const request: InstagramPublishRequest = {
  account: { pageId: 'page-1', instagramAccountId: 'ig-1' },
  mediaType: 'IMAGE',
  mediaUrls: [approvedUrl],
  caption: 'Sunset',
  correlationId: 'corr-1',
  idempotencyKey: 'idem-1',
};

function binding(url = approvedUrl) {
  return {
    policyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1' as const,
    standardId: 'SUNSET_FEED_V1',
    creativeId: 'CREATIVE-1',
    outputSha256: 'a'.repeat(64),
    brandIntegrityStatus: 'PASSED' as const,
    venueFidelityStatus: 'PASSED' as const,
    qualityGateStatus: 'PASSED' as const,
    assetLocators: [{ kind: 'MEDIA_URL' as const, value: url }],
    exactAssetBinding: true as const,
  };
}

describe('Instagram Creative Truth publication binding', () => {
  it('rejects publication without an approved exact-asset binding', () => {
    expect(() => assertCreativeTruthBinding(request)).toThrow('CREATIVE_TRUTH_BINDING_REQUIRED');
  });

  it('accepts publication only when all three gates passed and the exact URL is bound', () => {
    expect(() =>
      assertCreativeTruthBinding({
        ...request,
        creativeTruthBinding: binding(),
      }),
    ).not.toThrow();
  });

  it('rejects URL substitution after approval', () => {
    expect(() =>
      assertCreativeTruthBinding({
        ...request,
        mediaUrls: ['https://example.com/substituted.jpg'],
        creativeTruthBinding: binding(),
      }),
    ).toThrow('CREATIVE_TRUTH_ASSET_LOCATOR_MISMATCH');
  });
});
