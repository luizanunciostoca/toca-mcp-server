import { describe, expect, it } from 'vitest';
import type { InstagramPublishRequest } from '../src/providers/instagram/instagram-contracts.js';
import type {
  InstagramPublicationTransport,
  PublicationExecutionStore,
  PublishedMediaEvidence,
} from '../src/providers/instagram/instagram-publication-executor.js';
import { InstagramPublicationReconciler } from '../src/providers/instagram/instagram-publication-reconciler.js';
import type { PublicationRecord } from '../src/providers/instagram/publication-state.js';

const request: InstagramPublishRequest = {
  account: { pageId: 'page-1', instagramAccountId: 'ig-1' },
  mediaType: 'IMAGE',
  mediaUrls: ['https://example.com/image.jpg'],
  caption: 'Caption\n',
  correlationId: 'corr-1',
  idempotencyKey: 'idem-1',
};

class MemoryStore implements PublicationExecutionStore {
  record: PublicationRecord = {
    publicationId: request.correlationId,
    correlationId: request.correlationId,
    idempotencyKey: request.idempotencyKey,
    state: 'DRAFT',
    updatedAt: '2026-08-14T00:29:00.000Z',
  };

  reserve(): Promise<PublicationRecord> {
    return Promise.resolve(this.record);
  }

  save(record: PublicationRecord): Promise<void> {
    this.record = record;
    return Promise.resolve();
  }
}

class FakeTransport implements InstagramPublicationTransport {
  media: PublishedMediaEvidence[] = [];
  publishCalls = 0;

  createContainer(): Promise<{ readonly containerId: string }> {
    throw new Error('unexpected create');
  }

  getContainerStatus(): Promise<'IN_PROGRESS' | 'FINISHED' | 'ERROR'> {
    throw new Error('unexpected status');
  }

  publishContainer(): Promise<{ readonly mediaId: string }> {
    this.publishCalls += 1;
    throw new Error('unexpected publish');
  }

  listRecentPublishedMedia(): Promise<readonly PublishedMediaEvidence[]> {
    return Promise.resolve(this.media);
  }
}

describe('InstagramPublicationReconciler', () => {
  it('promotes a unique provider match to PUBLISHED without issuing a write', async () => {
    const store = new MemoryStore();
    const transport = new FakeTransport();
    transport.media = [
      {
        mediaId: 'media-1',
        caption: 'Caption',
        mediaType: 'IMAGE',
        permalink: 'https://instagram.example/p/1',
        timestamp: '2026-08-14T00:30:20.000Z',
      },
    ];
    const reconciler = new InstagramPublicationReconciler(
      store,
      transport,
      () => '2026-08-14T00:31:00.000Z',
    );

    const result = await reconciler.reconcile(request, {
      scheduledFor: '2026-08-14T00:30:00.000Z',
      mediaType: 'IMAGE',
      caption: 'Caption\n',
    });

    expect(result?.completed).toBe(true);
    expect(store.record.state).toBe('PUBLISHED');
    expect(store.record.externalMediaId).toBe('media-1');
    expect(store.record.permalink).toBe('https://instagram.example/p/1');
    expect(store.record.reconciliationSource).toBe('PROVIDER_LOOKUP');
    expect(transport.publishCalls).toBe(0);
  });

  it('allows a fresh draft with no provider match to continue to normal execution', async () => {
    const store = new MemoryStore();
    const transport = new FakeTransport();
    const reconciler = new InstagramPublicationReconciler(
      store,
      transport,
      () => '2026-08-14T00:31:00.000Z',
    );

    await expect(
      reconciler.reconcile(request, {
        scheduledFor: '2026-08-14T00:30:00.000Z',
        mediaType: 'IMAGE',
        caption: 'Caption',
      }),
    ).resolves.toBeUndefined();
    expect(store.record.state).toBe('DRAFT');
  });

  it('fails closed when an overdue draft has no provider evidence', async () => {
    const store = new MemoryStore();
    const transport = new FakeTransport();
    const reconciler = new InstagramPublicationReconciler(
      store,
      transport,
      () => '2026-08-14T00:50:00.000Z',
    );

    await expect(
      reconciler.reconcile(request, {
        scheduledFor: '2026-08-14T00:30:00.000Z',
        mediaType: 'IMAGE',
        caption: 'Caption',
      }),
    ).rejects.toThrow('INSTAGRAM_PUBLICATION_OVERDUE_RECONCILIATION_REQUIRED');
    expect(transport.publishCalls).toBe(0);
  });

  it('fails closed when provider evidence is ambiguous', async () => {
    const store = new MemoryStore();
    const transport = new FakeTransport();
    transport.media = [
      { mediaId: 'media-1', caption: 'Caption', mediaType: 'IMAGE', timestamp: '2026-08-14T00:30:00.000Z' },
      { mediaId: 'media-2', caption: 'Caption', mediaType: 'IMAGE', timestamp: '2026-08-14T00:31:00.000Z' },
    ];
    const reconciler = new InstagramPublicationReconciler(
      store,
      transport,
      () => '2026-08-14T00:32:00.000Z',
    );

    await expect(
      reconciler.reconcile(request, {
        scheduledFor: '2026-08-14T00:30:00.000Z',
        mediaType: 'IMAGE',
        caption: 'Caption',
      }),
    ).rejects.toThrow('INSTAGRAM_PUBLICATION_RECONCILIATION_AMBIGUOUS');
    expect(transport.publishCalls).toBe(0);
  });
});
