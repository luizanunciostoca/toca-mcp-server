import { describe, expect, it, vi } from 'vitest';
import {
  deriveInstagramOneOffIdempotencyKey,
  type InstagramPublishRequest,
} from '../src/providers/instagram/instagram-contracts.js';
import { hashInstagramPublicationApprovalPayload } from '../src/worker/instagram-publication-boundary.js';
import { runControlledInstagramPublication } from '../src/worker/instagram-controlled-publication.js';

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
      handler: { execute },
      maxAttempts: 3,
      pollIntervalMs: 1,
      sleep,
      now: () => '2026-08-12T18:00:00.000Z',
    });

    expect(execute).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does not retry deterministic or uncertain publication failures', async () => {
    const execute = vi
      .fn()
      .mockRejectedValue(new Error('INSTAGRAM_PUBLICATION_MANUAL_RECONCILIATION_REQUIRED'));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      runControlledInstagramPublication({
        payload,
        handler: { execute },
        maxAttempts: 5,
        pollIntervalMs: 1,
        sleep,
      }),
    ).rejects.toThrow('INSTAGRAM_PUBLICATION_MANUAL_RECONCILIATION_REQUIRED');

    expect(execute).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('fails closed when processing never finishes within the bounded attempts', async () => {
    const execute = vi
      .fn()
      .mockRejectedValue(new Error('INSTAGRAM_PUBLICATION_PROCESSING_PENDING'));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      runControlledInstagramPublication({
        payload,
        handler: { execute },
        maxAttempts: 2,
        pollIntervalMs: 1,
        sleep,
      }),
    ).rejects.toThrow('INSTAGRAM_PUBLICATION_PROCESSING_TIMEOUT');

    expect(execute).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});

const oneOff: NonNullable<InstagramPublishRequest['oneOff']> = {
  mode: 'ONE_OFF',
  authorizationRef: 'approval:controlled-instagram',
  authorizationId: 'controlled-approval-1',
  commandEnvelopeSha256: 'a'.repeat(64),
  validFrom: '2026-08-12T17:00:00.000Z',
  validUntil: '2026-08-12T19:00:00.000Z',
  maxPublications: 1,
};
const oneOffPayload = {
  ...payload,
  oneOff,
  idempotencyKey: deriveInstagramOneOffIdempotencyKey(oneOff),
};

describe('Controlled one-off Instagram publication runner', () => {
  it('executes a valid one-off exactly once with its complete approval-bound descriptor', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);
    await runControlledInstagramPublication({
      payload: oneOffPayload,
      handler: { execute },
      maxAttempts: 5,
      sleep,
      now: () => '2026-08-12T18:00:00.000Z',
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(
      oneOffPayload,
      expect.objectContaining({
        payload: oneOffPayload,
        id: `controlled-instagram-publication:${hashInstagramPublicationApprovalPayload(oneOffPayload)}`,
        attempts: 1,
      }),
    );
    expect(sleep).not.toHaveBeenCalled();
  });

  it('never retries PROCESSING_PENDING for an already consumed one-off', async () => {
    const execute = vi
      .fn()
      .mockRejectedValue(new Error('INSTAGRAM_PUBLICATION_PROCESSING_PENDING'));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(
      runControlledInstagramPublication({
        payload: oneOffPayload,
        handler: { execute },
        maxAttempts: 5,
        pollIntervalMs: 1,
        sleep,
      }),
    ).rejects.toThrow('INSTAGRAM_PUBLICATION_ONE_OFF_CONSUMED_RECONCILIATION_REQUIRED');
    expect(execute).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it.each([
    'INSTAGRAM_PUBLICATION_ONE_OFF_CONSUMPTION_UNKNOWN',
    'INSTAGRAM_PUBLICATION_ONE_OFF_PROVIDER_TIMEOUT_RECONCILIATION_REQUIRED',
    'INSTAGRAM_PUBLICATION_ONE_OFF_CONSUMED_RECONCILIATION_REQUIRED',
    'INSTAGRAM_PUBLICATION_ONE_OFF_PROCESSING_TIMEOUT_RECONCILIATION_REQUIRED',
    'INSTAGRAM_PUBLICATION_UPDATE_CONFLICT',
    'INSTAGRAM_PUBLICATION_ONE_OFF_AUTHORIZATION_EXPIRED',
  ])('does not reenter execution after %s', async (message) => {
    const error = new Error(message);
    const execute = vi.fn().mockRejectedValue(error);
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(
      runControlledInstagramPublication({
        payload: oneOffPayload,
        handler: { execute },
        maxAttempts: 5,
        sleep,
      }),
    ).rejects.toBe(error);
    expect(execute).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it.each([
    { ...oneOffPayload, idempotencyKey: 'new-caller-selected-key' },
    { ...oneOffPayload, oneOff: { ...oneOff, maxPublications: 2 } },
    { ...oneOffPayload, oneOff: { ...oneOff, resume: true } },
    { ...oneOffPayload, oneOff: { ...oneOff, validUntil: oneOff.validFrom } },
  ])('validates one-off semantics before calling an arbitrary handler', async (invalid) => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(
      runControlledInstagramPublication({ payload: invalid, handler: { execute }, sleep }),
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe('Controlled one-off outer-attempt limits', () => {
  it.each([0, -1, 1, 20, 1_000])(
    'still executes exactly once with outer maxAttempts=%s',
    async (maxAttempts) => {
      const execute = vi.fn().mockResolvedValue(undefined);
      const sleep = vi.fn().mockResolvedValue(undefined);
      await runControlledInstagramPublication({
        payload: oneOffPayload,
        handler: { execute },
        maxAttempts,
        sleep,
      });
      expect(execute).toHaveBeenCalledOnce();
      expect(sleep).not.toHaveBeenCalled();
    },
  );
});
