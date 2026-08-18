import { describe, expect, it, vi } from 'vitest';
import type { SecretResolver } from '../src/core/secrets.js';
import { GoogleSheetsRestClient, type FetchLike } from '../src/providers/google-sheets/client.js';

const secrets: SecretResolver = {
  resolve: async () => 'token-value',
};

describe('GoogleSheetsRestClient.updateRanges', () => {
  it('uses one RAW values batchUpdate request for all writeback cells', async () => {
    const fetcher: FetchLike = vi.fn(async () =>
      new Response(JSON.stringify({ totalUpdatedCells: 2 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = new GoogleSheetsRestClient(
      secrets,
      { tokenReference: { provider: 'env', key: 'GOOGLE_TOKEN' } },
      fetcher,
    );

    await client.updateRanges('sheet-id', [
      { range: 'CONTENT_ITEMS!BN2', values: [['CREATIVE_TRUTH_PASSED']] },
      { range: 'CONTENT_ITEMS!BW2', values: [['a'.repeat(64)]] },
    ]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [input, init] = vi.mocked(fetcher).mock.calls[0]!;
    expect(String(input)).toBe(
      'https://sheets.googleapis.com/v4/spreadsheets/sheet-id/values:batchUpdate',
    );
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      Authorization: 'Bearer token-value',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      valueInputOption: 'RAW',
      data: [
        {
          range: 'CONTENT_ITEMS!BN2',
          majorDimension: 'ROWS',
          values: [['CREATIVE_TRUTH_PASSED']],
        },
        {
          range: 'CONTENT_ITEMS!BW2',
          majorDimension: 'ROWS',
          values: [['a'.repeat(64)]],
        },
      ],
    });
  });

  it('performs no provider request for an empty update set', async () => {
    const fetcher: FetchLike = vi.fn(async () => new Response('{}', { status: 200 }));
    const client = new GoogleSheetsRestClient(
      secrets,
      { tokenReference: { provider: 'env', key: 'GOOGLE_TOKEN' } },
      fetcher,
    );

    await client.updateRanges('sheet-id', []);

    expect(fetcher).not.toHaveBeenCalled();
  });

  it('surfaces provider failures instead of claiming a successful write', async () => {
    const fetcher: FetchLike = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: 'permission denied' } }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = new GoogleSheetsRestClient(
      secrets,
      { tokenReference: { provider: 'env', key: 'GOOGLE_TOKEN' } },
      fetcher,
    );

    await expect(
      client.updateRanges('sheet-id', [{ range: 'CONTENT_ITEMS!BN2', values: [['PASS']] }]),
    ).rejects.toThrow('Google Sheets batch update ranges failed with HTTP 403: permission denied');
  });
});
