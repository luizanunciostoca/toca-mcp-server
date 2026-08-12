import { describe, expect, it } from 'vitest';
import type { MetaApiClient } from '../src/providers/meta/meta-api-client.js';
import type { InstagramPublishRequest } from '../src/providers/instagram/instagram-contracts.js';
import {
  InstagramPublicationExecutor,
  type InstagramPublicationTransport,
  type PublicationExecutionStore,
} from '../src/providers/instagram/instagram-publication-executor.js';
import { MetaInstagramPublicationTransport } from '../src/providers/instagram/meta-instagram-publication-transport.js';
import type { PublicationRecord } from '../src/providers/instagram/publication-state.js';

const request: InstagramPublishRequest = {
  account: { pageId: 'page-1', instagramAccountId: 'ig-1' },
  mediaType: 'IMAGE',
  mediaUrls: ['https://example.com/image.jpg'],
  caption: 'Caption',
  correlationId: 'corr-pub-1',
  idempotencyKey: 'idem-pub-1',
};

class MemoryPublicationStore implements PublicationExecutionStore {
  record: PublicationRecord | undefined;
  readonly saves: PublicationRecord[] = [];

  reserve(input: InstagramPublishRequest, nowIso: string): Promise<PublicationRecord> {
    this.record ??= {
      publicationId: input.correlationId,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
      state: 'DRAFT',
      updatedAt: nowIso,
    };
    return Promise.resolve(this.record);
  }

  save(record: PublicationRecord): Promise<void> {
    this.record = record;
    this.saves.push(record);
    return Promise.resolve();
  }
}

class FakePublicationTransport implements InstagramPublicationTransport {
  createCalls = 0;
  statusCalls = 0;
  publishCalls = 0;
  status: 'IN_PROGRESS' | 'FINISHED' | 'ERROR' = 'IN_PROGRESS';
  publishError: Error | undefined;

  createContainer(): Promise<{ readonly containerId: string }> {
    this.createCalls += 1;
    return Promise.resolve({ containerId: 'container-1' });
  }

  getContainerStatus(): Promise<'IN_PROGRESS' | 'FINISHED' | 'ERROR'> {
    this.statusCalls += 1;
    return Promise.resolve(this.status);
  }

  publishContainer(): Promise<{ readonly mediaId: string }> {
    this.publishCalls += 1;
    return this.publishError
      ? Promise.reject(this.publishError)
      : Promise.resolve({ mediaId: 'media-1' });
  }
}

describe('InstagramPublicationExecutor', () => {
  it('reserves before side effects and resumes processing without duplicate container creation', async () => {
    const store = new MemoryPublicationStore();
    const transport = new FakePublicationTransport();
    const executor = new InstagramPublicationExecutor(
      store,
      transport,
      () => '2026-08-12T13:00:00.000Z',
    );

    const first = await executor.execute(request);
    expect(first.completed).toBe(false);
    expect(first.publication.state).toBe('PROCESSING');
    expect(transport.createCalls).toBe(1);
    expect(transport.publishCalls).toBe(0);

    transport.status = 'FINISHED';
    const second = await executor.execute(request);
    expect(second.completed).toBe(true);
    expect(second.publication.state).toBe('PUBLISHED');
    expect(second.publication.externalMediaId).toBe('media-1');
    expect(transport.createCalls).toBe(1);
    expect(transport.publishCalls).toBe(1);

    const third = await executor.execute(request);
    expect(third.completed).toBe(true);
    expect(transport.createCalls).toBe(1);
    expect(transport.publishCalls).toBe(1);
  });

  it('persists a deterministic failed state when provider processing fails', async () => {
    const store = new MemoryPublicationStore();
    const transport = new FakePublicationTransport();
    transport.status = 'ERROR';
    const executor = new InstagramPublicationExecutor(store, transport);

    await expect(executor.execute(request)).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_CONTAINER_PROCESSING_FAILED',
    );
    expect(store.record?.state).toBe('FAILED');
    expect(store.record?.lastError).toBe('INSTAGRAM_PUBLICATION_CONTAINER_PROCESSING_FAILED');
    expect(transport.publishCalls).toBe(0);
  });

  it('fails closed after an ambiguous publish failure and never posts again automatically', async () => {
    const store = new MemoryPublicationStore();
    const transport = new FakePublicationTransport();
    transport.status = 'FINISHED';
    transport.publishError = new Error('connection reset after send');
    const executor = new InstagramPublicationExecutor(store, transport);

    await expect(executor.execute(request)).rejects.toThrow('connection reset after send');
    expect(store.record?.state).toBe('FAILED');
    expect(store.record?.lastError).toBe('PUBLISH_UNCERTAIN:connection reset after send');
    expect(transport.createCalls).toBe(1);
    expect(transport.publishCalls).toBe(1);

    transport.publishError = undefined;
    await expect(executor.execute(request)).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_MANUAL_RECONCILIATION_REQUIRED',
    );
    expect(transport.createCalls).toBe(1);
    expect(transport.publishCalls).toBe(1);
  });

  it('does not issue media_publish when a previous run persisted PUBLISHING', async () => {
    const store = new MemoryPublicationStore();
    store.record = {
      publicationId: request.correlationId,
      correlationId: request.correlationId,
      idempotencyKey: request.idempotencyKey,
      state: 'PUBLISHING',
      externalContainerId: 'container-existing',
      updatedAt: '2026-08-12T13:00:00.000Z',
    };
    const transport = new FakePublicationTransport();
    const executor = new InstagramPublicationExecutor(store, transport);

    await expect(executor.execute(request)).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_MANUAL_RECONCILIATION_REQUIRED',
    );
    expect(transport.publishCalls).toBe(0);
  });
});

describe('MetaInstagramPublicationTransport', () => {
  it('creates carousel children before the parent and publishes only the resolved parent container', async () => {
    const posts: Array<{ path: string; body: Readonly<Record<string, string>> }> = [];
    let id = 0;
    const client = {
      post: (path: string, body: Readonly<Record<string, string>>) => {
        posts.push({ path, body });
        id += 1;
        return Promise.resolve({ id: `id-${id}` });
      },
      get: () => Promise.resolve({ status_code: 'FINISHED' }),
    } as unknown as MetaApiClient;
    const transport = new MetaInstagramPublicationTransport(client);
    const carousel: InstagramPublishRequest = {
      ...request,
      mediaType: 'CAROUSEL',
      mediaUrls: ['https://example.com/1.jpg', 'https://example.com/2.jpg'],
    };

    const created = await transport.createContainer(carousel);
    expect(created.containerId).toBe('id-3');
    expect(posts).toHaveLength(3);
    expect(posts[2]?.body.children).toBe('id-1,id-2');

    await expect(transport.getContainerStatus(created.containerId)).resolves.toBe('FINISHED');
    await expect(transport.publishContainer('ig-1', created.containerId)).resolves.toEqual({
      mediaId: 'id-4',
    });
    expect(posts[3]).toEqual({ path: 'ig-1/media_publish', body: { creation_id: 'id-3' } });
  });
});
