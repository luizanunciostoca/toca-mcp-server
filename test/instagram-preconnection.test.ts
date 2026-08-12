import { describe, expect, it } from 'vitest';
import {
  buildInstagramContainerPlan,
  buildInstagramPublishCall,
} from '../src/providers/instagram/instagram-publish-builder.js';
import {
  reconcilePublicationState,
  transitionPublication,
} from '../src/providers/instagram/publication-state.js';

const account = { pageId: 'page-test', instagramAccountId: 'ig-test' };

describe('Instagram preconnection publishing support', () => {
  it('builds image container then media_publish call without executing them', () => {
    const plan = buildInstagramContainerPlan({
      account,
      mediaType: 'IMAGE',
      mediaUrls: ['https://cdn.example.test/image.jpg'],
      caption: 'Caption',
      correlationId: 'corr-1',
      idempotencyKey: 'pub-1',
    });
    expect(plan).toEqual({
      path: 'ig-test/media',
      body: { image_url: 'https://cdn.example.test/image.jpg', caption: 'Caption' },
    });
    expect(buildInstagramPublishCall('ig-test', 'container-test')).toEqual({
      path: 'ig-test/media_publish',
      body: { creation_id: 'container-test' },
    });
  });

  it('keeps carousel child creation explicit before parent publication', () => {
    const plan = buildInstagramContainerPlan({
      account,
      mediaType: 'CAROUSEL',
      mediaUrls: ['https://cdn.example.test/a.jpg', 'https://cdn.example.test/b.jpg'],
      correlationId: 'corr-2',
      idempotencyKey: 'pub-2',
    });
    expect(plan.children).toHaveLength(2);
    expect(plan.body.media_type).toBe('CAROUSEL');
  });

  it('blocks impossible publication state transitions', () => {
    expect(() =>
      transitionPublication(
        {
          publicationId: 'pub-1',
          correlationId: 'corr-1',
          idempotencyKey: 'key-1',
          state: 'PUBLISHED',
          updatedAt: '2026-08-09T00:00:00Z',
        },
        'PUBLISHING',
        '2026-08-09T00:01:00Z',
      ),
    ).toThrow('Invalid publication transition');
  });

  it('detects when provider publication is ahead of local state', () => {
    expect(reconcilePublicationState('PROCESSING', 'PUBLISHED')).toEqual({
      status: 'LOCAL_STALE',
      local: 'PROCESSING',
      provider: 'PUBLISHED',
    });
  });
});
