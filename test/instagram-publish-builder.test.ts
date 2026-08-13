import { describe, expect, it } from 'vitest';
import { buildInstagramContainerPlan } from '../src/providers/instagram/instagram-publish-builder.js';

const account = { pageId: 'page-1', instagramAccountId: 'ig-1' };

describe('Instagram publish builder stories', () => {
  it('uses image_url for image stories, including signed URLs with query parameters', () => {
    const url =
      'https://storage.googleapis.com/private-bucket/path/story-image.jpg?X-Goog-Signature=abc123';
    expect(
      buildInstagramContainerPlan({
        account,
        mediaType: 'STORY',
        mediaUrls: [url],
        correlationId: 'corr-1',
        idempotencyKey: 'idem-1',
      }),
    ).toEqual({
      path: 'ig-1/media',
      body: { media_type: 'STORIES', image_url: url },
    });
  });

  it('keeps video_url for video stories', () => {
    const url = 'https://cdn.example.com/story.mp4';
    expect(
      buildInstagramContainerPlan({
        account,
        mediaType: 'STORY',
        mediaUrls: [url],
        correlationId: 'corr-2',
        idempotencyKey: 'idem-2',
      }),
    ).toEqual({
      path: 'ig-1/media',
      body: { media_type: 'STORIES', video_url: url },
    });
  });
});
