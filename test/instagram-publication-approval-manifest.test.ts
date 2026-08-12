import { describe, expect, it } from 'vitest';
import { createInstagramPublicationApprovalManifest } from '../src/worker/instagram-publication-approval-manifest.js';
import { hashInstagramPublicationApprovalPayload } from '../src/worker/instagram-publication-boundary.js';

const request = {
  account: { pageId: 'page-1', instagramAccountId: 'ig-1' },
  mediaType: 'IMAGE',
  mediaUrls: ['https://example.com/image.jpg'],
  caption: 'Controlled publication',
  correlationId: 'corr-1',
  idempotencyKey: 'idem-1',
};

describe('Instagram publication approval manifest', () => {
  it('normalizes the request and calculates the same SHA-256 used by the approval gate', () => {
    const manifest = createInstagramPublicationApprovalManifest(request);

    expect(manifest.request).toEqual(request);
    expect(manifest.requestSha256).toBe(hashInstagramPublicationApprovalPayload(manifest.request));
  });

  it('rejects an invalid request before producing an approval hash', () => {
    expect(() =>
      createInstagramPublicationApprovalManifest({
        ...request,
        mediaUrls: ['not-a-url'],
      }),
    ).toThrow();
  });
});
