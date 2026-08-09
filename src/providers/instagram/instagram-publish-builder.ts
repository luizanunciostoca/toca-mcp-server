import type { InstagramPublishRequest } from './instagram-contracts.js';

export interface InstagramContainerCreate {
  readonly path: string;
  readonly body: Readonly<Record<string, string>>;
  readonly children?: readonly InstagramContainerCreate[];
}

function optionalCaption(caption?: string): Readonly<Record<string, string>> {
  return caption ? { caption } : {};
}

export function buildInstagramContainerPlan(request: InstagramPublishRequest): InstagramContainerCreate {
  const path = `${request.account.instagramAccountId}/media`;
  if (request.mediaUrls.length === 0) throw new Error('At least one media URL is required');

  switch (request.mediaType) {
    case 'IMAGE':
      if (request.mediaUrls.length !== 1) throw new Error('IMAGE requires exactly one media URL');
      return { path, body: { image_url: request.mediaUrls[0]!, ...optionalCaption(request.caption) } };
    case 'REEL':
      if (request.mediaUrls.length !== 1) throw new Error('REEL requires exactly one media URL');
      return {
        path,
        body: { media_type: 'REELS', video_url: request.mediaUrls[0]!, ...optionalCaption(request.caption) },
      };
    case 'STORY':
      if (request.mediaUrls.length !== 1) throw new Error('STORY requires exactly one media URL');
      return {
        path,
        body: { media_type: 'STORIES', video_url: request.mediaUrls[0]! },
      };
    case 'CAROUSEL': {
      if (request.mediaUrls.length < 2) throw new Error('CAROUSEL requires at least two media URLs');
      const children = request.mediaUrls.map((url) => ({
        path,
        body: { image_url: url, is_carousel_item: 'true' },
      }));
      return {
        path,
        body: { media_type: 'CAROUSEL', children: '__RESOLVE_CHILD_IDS__', ...optionalCaption(request.caption) },
        children,
      };
    }
  }
}

export function buildInstagramPublishCall(
  instagramAccountId: string,
  creationId: string,
): { readonly path: string; readonly body: Readonly<Record<string, string>> } {
  return {
    path: `${instagramAccountId}/media_publish`,
    body: { creation_id: creationId },
  };
}
