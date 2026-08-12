import { describe, expect, it, vi } from 'vitest';
import { runControlledInstagramPublication } from '../src/worker/instagram-controlled-publication.js';
import type { JobHandler } from '../src/worker/worker.js';

const payload = {
  account: { pageId: 'page-1', instagramAccountId: 'ig-1' },
  mediaType: 'IMAGE',
  mediaUrls: ['https://example.com/image.jpg'],
  correlationId: 'corr-1',
  idempotencyKey: 'idem-1',
};

describe('Controlled Instagram publication runner', () => {
  it('retries only while container processing remains pending', async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error('INSTAGRAM_PUBLICATION_PROCESSING_PENDING'))
      .mockRejectedValueOnce(new Error('INSTAGRAM_PUBLICATION_PROCESSING_PENDING'))
      .mockResolvedValueOnce(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await runControlledInstagramPublication({
      payload,
      handler: { execute } as JobHandler,
      maxAttempts: 3,
      pollIntervalMs: 1,
      sleep,
      now: () => '2026-08-12T18:00:00.000Z',
    });

    expect(execute).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does not retry deterministic or uncertain publication failures', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('INSTAGRAM_PUBLICATION_MANUAL_RECONCILIATION_REQUIRED'));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      runControlledInstagramPublication({
        payload,
        handler: { execute } as JobHandler,
        maxAttempts: 5,
        pollIntervalMs: 1,
        sleep,
      }),
    ).rejects.toThrow('INSTAGRAM_PUBLICATION_MANUAL_RECONCILIATION_REQUIRED');

    expect(execute).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('fails closed when processing never finishes within the bounded attempts', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('INSTAGRAM_PUBLICATION_PROCESSING_PENDING'));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      runControlledInstagramPublication({
        payload,
        handler: { execute } as JobHandler,
        maxAttempts: 2,
        pollIntervalMs: 1,
        sleep,
      }),
    ).rejects.toThrow('INSTAGRAM_PUBLICATION_PROCESSING_TIMEOUT');

    expect(execute).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});
