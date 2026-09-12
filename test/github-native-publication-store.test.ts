import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { InstagramPublishRequest } from '../src/providers/instagram/instagram-contracts.js';
import { FilePublicationExecutionStore } from '../src/github-native-publication/file-publication-store.js';

const directories: string[] = [];

async function makeStore() {
  const directory = await mkdtemp(join(tmpdir(), 'toca-publication-state-'));
  directories.push(directory);
  return new FilePublicationExecutionStore(directory);
}

function request(overrides: Partial<InstagramPublishRequest> = {}): InstagramPublishRequest {
  return {
    account: { pageId: 'page', instagramAccountId: 'ig' },
    mediaType: 'IMAGE',
    mediaUrls: ['https://example.com/asset.jpg'],
    correlationId: 'corr-1',
    idempotencyKey: 'idemp-1',
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe('FilePublicationExecutionStore', () => {
  it('reserves one durable record per idempotency key', async () => {
    const store = await makeStore();
    const first = await store.reserve(request(), '2026-09-12T12:00:00.000Z');
    const second = await store.reserve(request(), '2026-09-12T12:01:00.000Z');

    expect(second.publicationId).toBe(first.publicationId);
    expect(second.state).toBe('DRAFT');
    expect(second.updatedAt).toBe(first.updatedAt);
  });

  it('fails closed if a reused idempotency key changes correlation identity', async () => {
    const store = await makeStore();
    await store.reserve(request(), '2026-09-12T12:00:00.000Z');

    await expect(
      store.reserve(request({ correlationId: 'corr-other' }), '2026-09-12T12:01:00.000Z'),
    ).rejects.toThrow('GITHUB_NATIVE_PUBLICATION_CORRELATION_MISMATCH');
  });
});
