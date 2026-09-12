import { describe, expect, it, vi } from 'vitest';
import type { MetaApiClient } from '../src/providers/meta/meta-api-client.js';
import { MetaInstagramPublicationTransport } from '../src/providers/instagram/meta-instagram-publication-transport.js';

describe('MetaInstagramPublicationTransport story readback', () => {
  it('reads recent Stories from the dedicated /stories edge', async () => {
    const get = vi.fn(() =>
      Promise.resolve({
        data: [
          {
            id: 'story-1',
            media_type: 'IMAGE',
            timestamp: '2026-09-12T12:00:01Z',
            permalink: 'https://www.instagram.com/stories/example/1/',
          },
        ],
      }),
    );
    const client = { get } as unknown as MetaApiClient;
    const transport = new MetaInstagramPublicationTransport(client);

    const stories = await transport.listRecentPublishedStories('ig-account', 12);

    expect(get).toHaveBeenCalledWith('ig-account/stories', {
      fields: 'id,caption,media_type,permalink,timestamp',
      limit: '12',
    });
    expect(stories).toEqual([
      {
        mediaId: 'story-1',
        mediaType: 'IMAGE',
        timestamp: '2026-09-12T12:00:01Z',
        permalink: 'https://www.instagram.com/stories/example/1/',
      },
    ]);
  });
});
