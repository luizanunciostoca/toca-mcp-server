import { describe, expect, it } from 'vitest';
import type { InstagramPublishRequest } from '../src/providers/instagram/instagram-contracts.js';
import { assertCreativeTruthBinding } from '../src/providers/instagram/instagram-publication-executor.js';

const request: InstagramPublishRequest = {
  account: { pageId: 'page-1', instagramAccountId: 'ig-1' },
  mediaType: 'IMAGE',
  mediaUrls: ['https://example.com/creative.jpg'],
  caption: 'Sunset',
  correlationId: 'corr-1',
  idempotencyKey: 'idem-1',
};

describe('Instagram Creative Truth publication binding', () => {
  it('rejects publication without an approved exact-asset binding', () => {
    expect(() => assertCreativeTruthBinding(request)).toThrow('CREATIVE_TRUTH_BINDING_REQUIRED');
  });

  it('accepts publication only when all three gates passed and output hash is bound', () => {
    expect(() =>
      assertCreativeTruthBinding({
        ...request,
        creativeTruthBinding: {
          policyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
          standardId: 'SUNSET_FEED_V1',
          creativeId: 'CREATIVE-1',
          outputSha256: 'a'.repeat(64),
          brandIntegrityStatus: 'PASSED',
          venueFidelityStatus: 'PASSED',
          qualityGateStatus: 'PASSED',
          exactAssetBinding: true,
        },
      }),
    ).not.toThrow();
  });
});
