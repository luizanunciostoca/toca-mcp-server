import { describe, expect, it } from 'vitest';
import {
  InstagramHistoryProvider,
  type MetaReadClient,
} from '../src/providers/instagram/instagram-history-provider.js';

class FakeMetaReadClient implements MetaReadClient {
  readonly calls: Array<{ path: string; query: Readonly<Record<string, string>> }> = [];

  constructor(private readonly responses: unknown[]) {}

  get(path: string, query: Readonly<Record<string, string>> = {}): Promise<unknown> {
    this.calls.push({ path, query });
    const providerResponse: unknown = this.responses.shift();
    if (providerResponse === undefined) {
      return Promise.reject(new Error('No fake response configured'));
    }
    return Promise.resolve(providerResponse);
  }
}

describe('InstagramHistoryProvider', () => {
  it('lists media with request-scoped pagination and time bounds', async () => {
    const client = new FakeMetaReadClient([
      {
        data: [
          {
            id: 'media-1',
            media_type: 'IMAGE',
            permalink: 'https://www.instagram.com/p/example/',
            timestamp: '2026-08-01T20:00:00+0000',
            like_count: 12,
            comments_count: 3,
          },
        ],
        paging: { cursors: { after: 'cursor-1' } },
      },
    ]);
    const provider = new InstagramHistoryProvider(client, 'ig-account');

    const result = await provider.listMedia({
      limit: 25,
      after: 'after-0',
      since: '2026-07-01',
      until: '2026-08-10',
    });

    expect(result.data[0]?.id).toBe('media-1');
    expect(client.calls).toEqual([
      {
        path: 'ig-account/media',
        query: expect.objectContaining({
          limit: '25',
          after: 'after-0',
          since: '2026-07-01',
          until: '2026-08-10',
        }),
      },
    ]);
  });

  it('passes requested media metrics without embedding editorial logic', async () => {
    const client = new FakeMetaReadClient([
      {
        data: [{ name: 'reach', period: 'lifetime', values: [{ value: 100 }] }],
      },
    ]);
    const provider = new InstagramHistoryProvider(client, 'ig-account');

    await provider.getMediaInsights({ mediaId: 'media-1', metrics: ['reach', 'saved'] });

    expect(client.calls[0]).toEqual({
      path: 'media-1/insights',
      query: { metric: 'reach,saved' },
    });
  });

  it('passes account metrics and measurement window to Meta', async () => {
    const client = new FakeMetaReadClient([
      {
        data: [{ name: 'reach', period: 'day', values: [{ value: 200 }] }],
      },
    ]);
    const provider = new InstagramHistoryProvider(client, 'ig-account');

    await provider.getAccountInsights({
      metrics: ['reach'],
      period: 'day',
      since: '2026-08-01',
      until: '2026-08-10',
      metricType: 'time_series',
    });

    expect(client.calls[0]).toEqual({
      path: 'ig-account/insights',
      query: {
        metric: 'reach',
        period: 'day',
        since: '2026-08-01',
        until: '2026-08-10',
        metric_type: 'time_series',
      },
    });
  });

  it('fails closed on malformed provider responses', async () => {
    const client = new FakeMetaReadClient([{ unexpected: true }]);
    const provider = new InstagramHistoryProvider(client, 'ig-account');

    await expect(provider.listMedia({ limit: 10 })).rejects.toThrow(
      'INSTAGRAM_MEDIA_LIST_RESPONSE_INVALID',
    );
  });
});
