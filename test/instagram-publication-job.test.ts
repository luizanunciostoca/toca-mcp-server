import { describe, expect, it } from 'vitest';
import type { InstagramPublishRequest } from '../src/providers/instagram/instagram-contracts.js';
import {
  InstagramPublicationExecutor,
  type InstagramPublicationTransport,
  type PublicationExecutionStore,
} from '../src/providers/instagram/instagram-publication-executor.js';
import type { PublicationRecord } from '../src/providers/instagram/publication-state.js';
import { InMemoryScheduler } from '../src/scheduler/in-memory-scheduler.js';
import {
  INSTAGRAM_PUBLICATION_JOB,
  InstagramPublicationJobHandler,
  InstagramPublicationJobScheduler,
} from '../src/worker/instagram-publication-job.js';

const request: InstagramPublishRequest = {
  account: { pageId: 'page-1', instagramAccountId: 'ig-1' },
  mediaType: 'IMAGE',
  mediaUrls: ['https://example.com/image.jpg'],
  correlationId: 'corr-job-1',
  idempotencyKey: 'idem-job-1',
};

class MemoryStore implements PublicationExecutionStore {
  record: PublicationRecord | undefined;

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
    return Promise.resolve();
  }
}

class Transport implements InstagramPublicationTransport {
  status: 'IN_PROGRESS' | 'FINISHED' | 'ERROR' = 'IN_PROGRESS';

  createContainer(): Promise<{ readonly containerId: string }> {
    return Promise.resolve({ containerId: 'container-1' });
  }

  getContainerStatus(): Promise<'IN_PROGRESS' | 'FINISHED' | 'ERROR'> {
    return Promise.resolve(this.status);
  }

  publishContainer(): Promise<{ readonly mediaId: string }> {
    return Promise.resolve({ mediaId: 'media-1' });
  }
}

describe('Instagram publication scheduler bridge', () => {
  it('schedules an internal idempotent job without exposing an MCP write tool', async () => {
    const scheduler = new InMemoryScheduler();
    const bridge = new InstagramPublicationJobScheduler(scheduler, () => 'job-1');

    const first = await bridge.schedule(request, '2026-08-12T14:00:00.000Z', 'America/Bahia');
    const second = await bridge.schedule(request, '2026-08-12T14:05:00.000Z', 'America/Bahia');

    expect(first.id).toBe('job-1');
    expect(second.id).toBe('job-1');
    expect(first.toolName).toBe(INSTAGRAM_PUBLICATION_JOB);
    expect(first.idempotencyKey).toBe('internal:instagram:publication:idem-job-1');
  });

  it('supports internal reschedule, status, list and cancel without crossing job domains', async () => {
    const scheduler = new InMemoryScheduler();
    const bridge = new InstagramPublicationJobScheduler(scheduler, () => 'publication-job');
    await bridge.schedule(request, '2026-08-12T14:00:00.000Z', 'America/Bahia');

    await expect(
      bridge.reschedule('publication-job', '2026-08-12T15:00:00.000Z', 'America/Bahia'),
    ).resolves.toMatchObject({
      runAt: '2026-08-12T15:00:00.000Z',
      status: 'SCHEDULED',
    });
    await expect(bridge.status('publication-job')).resolves.toMatchObject({
      toolName: INSTAGRAM_PUBLICATION_JOB,
      runAt: '2026-08-12T15:00:00.000Z',
    });
    await expect(bridge.listScheduled()).resolves.toHaveLength(1);
    await expect(bridge.cancel('publication-job')).resolves.toMatchObject({ status: 'CANCELED' });
    await expect(bridge.listScheduled()).resolves.toEqual([]);

    await scheduler.schedule({
      id: 'other-job',
      toolName: 'internal.other.execute',
      payload: {},
      runAt: '2026-08-12T16:00:00.000Z',
      timezone: 'America/Bahia',
      idempotencyKey: 'other-idempotency',
    });
    await expect(bridge.cancel('other-job')).rejects.toThrow('INSTAGRAM_PUBLICATION_JOB_MISMATCH');
    await expect(scheduler.get('other-job')).resolves.toMatchObject({ status: 'SCHEDULED' });
  });

  it('signals worker retry while processing and succeeds when the container is finished', async () => {
    const store = new MemoryStore();
    const transport = new Transport();
    const executor = new InstagramPublicationExecutor(store, transport);
    const handler = new InstagramPublicationJobHandler(executor);

    await expect(handler.execute(request)).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_PROCESSING_PENDING',
    );
    expect(store.record?.state).toBe('PROCESSING');

    transport.status = 'FINISHED';
    await expect(handler.execute(request)).resolves.toBeUndefined();
    expect(store.record?.state).toBe('PUBLISHED');
  });

  it('rejects malformed payloads before the executor can perform side effects', async () => {
    const store = new MemoryStore();
    const executor = new InstagramPublicationExecutor(store, new Transport());
    const handler = new InstagramPublicationJobHandler(executor);

    await expect(handler.execute({ ...request, mediaUrls: [] })).rejects.toThrow();
    expect(store.record).toBeUndefined();
  });
});
