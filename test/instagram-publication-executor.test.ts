import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { PostgresPublicationExecutionStore } from '../src/persistence/postgres-publication-store.js';
import type { MetaApiClient } from '../src/providers/meta/meta-api-client.js';
import {
  deriveInstagramOneOffIdempotencyKey,
  type InstagramPublishRequest,
} from '../src/providers/instagram/instagram-contracts.js';
import {
  InstagramPublicationExecutor,
  type InstagramPublicationTransport,
  type PublicationExecutionStore,
} from '../src/providers/instagram/instagram-publication-executor.js';
import { MetaInstagramPublicationTransport } from '../src/providers/instagram/meta-instagram-publication-transport.js';
import type {
  PublicationState,
  PublicationRecord,
} from '../src/providers/instagram/publication-state.js';

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

const oneOff: NonNullable<InstagramPublishRequest['oneOff']> = {
  mode: 'ONE_OFF',
  authorizationRef: 'approval:single-instagram-post',
  authorizationId: 'owner-approval-1',
  commandEnvelopeSha256: 'a'.repeat(64),
  validFrom: '2026-08-12T12:00:00.000Z',
  validUntil: '2026-08-12T14:00:00.000Z',
  maxPublications: 1,
};
const oneOffRequest: InstagramPublishRequest = {
  ...request,
  oneOff,
  publicationAssetSha256: 'b'.repeat(64),
  idempotencyKey: deriveInstagramOneOffIdempotencyKey(oneOff),
};
const oneOffNow = '2026-08-12T13:00:00.000Z';

function consumedRecord(state: PublicationState): PublicationRecord {
  return {
    publicationId: oneOffRequest.correlationId,
    correlationId: oneOffRequest.correlationId,
    idempotencyKey: oneOffRequest.idempotencyKey,
    state,
    externalContainerId: 'container-existing',
    ...(state === 'PUBLISHED' ? { externalMediaId: 'media-existing' } : {}),
    ...(state === 'FAILED' ? { lastError: 'ordinary-deterministic-failure' } : {}),
    updatedAt: oneOffNow,
  };
}

class OneOffMemoryStore implements PublicationExecutionStore {
  record: PublicationRecord | undefined;
  readonly reserve = vi.fn().mockRejectedValue(new Error('ONE_OFF_MUST_NOT_RESERVE'));
  readonly save = vi.fn().mockRejectedValue(new Error('ONE_OFF_MUST_USE_ADVANCE_CAPABILITY'));
  consumeCalls = 0;
  readonly advanceAttempts: PublicationRecord[] = [];
  readonly advances: PublicationRecord[] = [];
  loseAcknowledgement = false;
  afterConsumption: (() => void) | undefined;
  beforeAdvance: ((next: PublicationRecord) => void) | undefined;
  afterAdvance: ((next: PublicationRecord) => void) | undefined;

  consumeOneOff(
    input: InstagramPublishRequest,
    nowIso: string,
  ): Promise<{
    readonly publication: PublicationRecord;
    readonly advance?: (next: PublicationRecord) => Promise<void>;
  }> {
    this.consumeCalls += 1;
    if (this.record) return Promise.resolve({ publication: this.record });
    this.record = {
      publicationId: input.correlationId,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
      state: 'CREATING_CONTAINER',
      updatedAt: nowIso,
    };
    this.afterConsumption?.();
    if (this.loseAcknowledgement) {
      return Promise.reject(new Error('INSTAGRAM_PUBLICATION_ONE_OFF_CONSUMPTION_UNKNOWN'));
    }
    return Promise.resolve({
      publication: this.record,
      advance: (next: PublicationRecord) => {
        this.advanceAttempts.push(next);
        try {
          this.beforeAdvance?.(next);
          this.record = next;
          this.advances.push(next);
          this.afterAdvance?.(next);
          return Promise.resolve();
        } catch (error) {
          return Promise.reject(error instanceof Error ? error : new Error('TEST_ADVANCE_FAILED'));
        }
      },
    });
  }
}

function oneOffExecutor(
  store: OneOffMemoryStore,
  transport: FakePublicationTransport,
  now: () => string = () => oneOffNow,
  maxAttempts = 3,
) {
  const sleep = vi.fn().mockResolvedValue(undefined);
  return {
    executor: new InstagramPublicationExecutor(store, transport, now, false, {
      maxAttempts,
      pollIntervalMs: 7,
      sleep,
    }),
    sleep,
  };
}

describe('InstagramPublicationExecutor one-off consumption', () => {
  it('consumes before creating and polls only within the winning invocation before one publish', async () => {
    const store = new OneOffMemoryStore();
    const transport = new FakePublicationTransport();
    const create = vi.spyOn(transport, 'createContainer').mockImplementation(() => {
      expect(store.record?.state).toBe('CREATING_CONTAINER');
      expect(store.consumeCalls).toBe(1);
      return Promise.resolve({ containerId: 'container-1' });
    });
    const status = vi
      .spyOn(transport, 'getContainerStatus')
      .mockResolvedValueOnce('IN_PROGRESS')
      .mockResolvedValueOnce('IN_PROGRESS')
      .mockResolvedValueOnce('FINISHED');
    const { executor, sleep } = oneOffExecutor(store, transport);
    const result = await executor.execute(oneOffRequest);
    expect(result).toMatchObject({
      completed: true,
      publication: { state: 'PUBLISHED', externalMediaId: 'media-1' },
    });
    expect(create).toHaveBeenCalledOnce();
    expect(status).toHaveBeenCalledTimes(3);
    expect(transport.publishCalls).toBe(1);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 7);
    expect(store.advances.map((record) => record.state)).toEqual([
      'PROCESSING',
      'PUBLISHING',
      'PUBLISHED',
    ]);
    expect(store.reserve).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();

    await expect(executor.execute(oneOffRequest)).resolves.toEqual(result);
    expect(create).toHaveBeenCalledOnce();
    expect(status).toHaveBeenCalledTimes(3);
    expect(transport.publishCalls).toBe(1);
    expect(store.advances).toHaveLength(3);
  });

  it.each<PublicationState>([
    'DRAFT',
    'SCHEDULED',
    'CREATING_CONTAINER',
    'PROCESSING',
    'PUBLISHING',
    'FAILED',
    'CANCELED',
  ])('treats existing %s as consumed without resuming any provider operation', async (state) => {
    const store = new OneOffMemoryStore();
    store.record = consumedRecord(state);
    const transport = new FakePublicationTransport();
    transport.status = 'FINISHED';
    const { executor, sleep } = oneOffExecutor(store, transport);
    await expect(executor.execute(oneOffRequest)).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_ONE_OFF_CONSUMED_RECONCILIATION_REQUIRED',
    );
    expect(transport.createCalls).toBe(0);
    expect(transport.statusCalls).toBe(0);
    expect(transport.publishCalls).toBe(0);
    expect(store.advanceAttempts).toEqual([]);
    expect(store.save).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('returns an existing PUBLISHED result without any provider or persistence mutation', async () => {
    const store = new OneOffMemoryStore();
    store.record = consumedRecord('PUBLISHED');
    const transport = new FakePublicationTransport();
    const { executor } = oneOffExecutor(store, transport);
    await expect(executor.execute(oneOffRequest)).resolves.toEqual({
      completed: true,
      publication: store.record,
    });
    expect(transport.createCalls + transport.statusCalls + transport.publishCalls).toBe(0);
    expect(store.advanceAttempts).toEqual([]);
    expect(store.save).not.toHaveBeenCalled();
  });

  it('never resumes an ambiguous FAILED publish on reentry', async () => {
    const store = new OneOffMemoryStore();
    store.record = { ...consumedRecord('FAILED'), lastError: 'PUBLISH_UNCERTAIN:lost response' };
    const transport = new FakePublicationTransport();
    const { executor } = oneOffExecutor(store, transport);
    await expect(executor.execute(oneOffRequest)).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_ONE_OFF_CONSUMED_RECONCILIATION_REQUIRED',
    );
    expect(transport.createCalls + transport.statusCalls + transport.publishCalls).toBe(0);
  });

  it('times out bounded polling without reopening the consumed authorization', async () => {
    const store = new OneOffMemoryStore();
    const transport = new FakePublicationTransport();
    const { executor, sleep } = oneOffExecutor(store, transport, () => oneOffNow, 2);
    await expect(executor.execute(oneOffRequest)).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_ONE_OFF_PROCESSING_TIMEOUT_RECONCILIATION_REQUIRED',
    );
    expect(transport.createCalls).toBe(1);
    expect(transport.statusCalls).toBe(2);
    expect(transport.publishCalls).toBe(0);
    expect(sleep).toHaveBeenCalledOnce();
    transport.status = 'FINISHED';
    await expect(executor.execute(oneOffRequest)).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_ONE_OFF_CONSUMED_RECONCILIATION_REQUIRED',
    );
    expect(transport.createCalls).toBe(1);
    expect(transport.statusCalls).toBe(2);
    expect(transport.publishCalls).toBe(0);
  });

  it('fails closed on lost consumption acknowledgement, then denies replay of the committed row', async () => {
    const store = new OneOffMemoryStore();
    store.loseAcknowledgement = true;
    const transport = new FakePublicationTransport();
    const { executor } = oneOffExecutor(store, transport);
    await expect(executor.execute(oneOffRequest)).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_ONE_OFF_CONSUMPTION_UNKNOWN',
    );
    expect(store.record?.state).toBe('CREATING_CONTAINER');
    store.loseAcknowledgement = false;
    await expect(executor.execute(oneOffRequest)).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_ONE_OFF_CONSUMED_RECONCILIATION_REQUIRED',
    );
    expect(transport.createCalls + transport.statusCalls + transport.publishCalls).toBe(0);
    expect(store.advanceAttempts).toEqual([]);
  });

  it.each<PublicationState>(['PROCESSING', 'PUBLISHING', 'PUBLISHED'])(
    'does not attempt a failure save after a CAS conflict while saving %s',
    async (conflictingState) => {
      const store = new OneOffMemoryStore();
      store.beforeAdvance = (next) => {
        if (next.state === conflictingState)
          throw new Error('INSTAGRAM_PUBLICATION_UPDATE_CONFLICT');
      };
      const transport = new FakePublicationTransport();
      transport.status = 'FINISHED';
      const { executor } = oneOffExecutor(store, transport);
      await expect(executor.execute(oneOffRequest)).rejects.toThrow(
        'INSTAGRAM_PUBLICATION_UPDATE_CONFLICT',
      );
      expect(store.advanceAttempts.at(-1)?.state).toBe(conflictingState);
      expect(store.advanceAttempts.some((record) => record.state === 'FAILED')).toBe(false);
      expect(store.save).not.toHaveBeenCalled();
      expect(transport.createCalls).toBe(1);
      expect(transport.publishCalls).toBe(conflictingState === 'PUBLISHED' ? 1 : 0);
      const calls = [transport.createCalls, transport.statusCalls, transport.publishCalls];
      await expect(executor.execute(oneOffRequest)).rejects.toThrow(
        'INSTAGRAM_PUBLICATION_ONE_OFF_CONSUMED_RECONCILIATION_REQUIRED',
      );
      expect([transport.createCalls, transport.statusCalls, transport.publishCalls]).toEqual(calls);
    },
  );

  it('consumes an ordinary provider-processing failure permanently', async () => {
    const store = new OneOffMemoryStore();
    const transport = new FakePublicationTransport();
    transport.status = 'ERROR';
    const { executor } = oneOffExecutor(store, transport);
    await expect(executor.execute(oneOffRequest)).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_CONTAINER_PROCESSING_FAILED',
    );
    expect(store.record).toMatchObject({
      state: 'FAILED',
      lastError: 'INSTAGRAM_PUBLICATION_CONTAINER_PROCESSING_FAILED',
    });
    transport.status = 'FINISHED';
    await expect(executor.execute(oneOffRequest)).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_ONE_OFF_CONSUMED_RECONCILIATION_REQUIRED',
    );
    expect(transport.createCalls).toBe(1);
    expect(transport.statusCalls).toBe(1);
    expect(transport.publishCalls).toBe(0);
  });

  it('consumes a create failure without granting a second create on reentry', async () => {
    const store = new OneOffMemoryStore();
    const transport = new FakePublicationTransport();
    const create = vi
      .spyOn(transport, 'createContainer')
      .mockRejectedValue(new Error('create response lost'));
    const { executor } = oneOffExecutor(store, transport);
    await expect(executor.execute(oneOffRequest)).rejects.toThrow('create response lost');
    await expect(executor.execute(oneOffRequest)).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_ONE_OFF_CONSUMED_RECONCILIATION_REQUIRED',
    );
    expect(create).toHaveBeenCalledOnce();
    expect(transport.publishCalls).toBe(0);
  });

  it('does not repeat a media_publish after its response is lost', async () => {
    const store = new OneOffMemoryStore();
    const transport = new FakePublicationTransport();
    transport.status = 'FINISHED';
    transport.publishError = new Error('publish response lost');
    const { executor } = oneOffExecutor(store, transport);
    await expect(executor.execute(oneOffRequest)).rejects.toThrow('publish response lost');
    transport.publishError = undefined;
    await expect(executor.execute(oneOffRequest)).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_ONE_OFF_CONSUMED_RECONCILIATION_REQUIRED',
    );
    expect(transport.createCalls).toBe(1);
    expect(transport.publishCalls).toBe(1);
  });

  it('allows no second winning invocation while the first is paused at create', async () => {
    const store = new OneOffMemoryStore();
    const transport = new FakePublicationTransport();
    transport.status = 'FINISHED';
    let finishCreate: ((created: { containerId: string }) => void) | undefined;
    let signalCreateStarted: (() => void) | undefined;
    const createStarted = new Promise<void>((resolve) => {
      signalCreateStarted = resolve;
    });
    const create = vi.spyOn(transport, 'createContainer').mockImplementation(() => {
      signalCreateStarted?.();
      return new Promise((resolve) => {
        finishCreate = resolve;
      });
    });
    const { executor } = oneOffExecutor(store, transport);
    const winner = executor.execute(oneOffRequest);
    await createStarted;
    await expect(executor.execute(oneOffRequest)).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_ONE_OFF_CONSUMED_RECONCILIATION_REQUIRED',
    );
    finishCreate?.({ containerId: 'container-1' });
    await expect(winner).resolves.toMatchObject({ completed: true });
    expect(create).toHaveBeenCalledOnce();
    expect(transport.publishCalls).toBe(1);
  });
});

describe('InstagramPublicationExecutor one-off validity checks', () => {
  it.each([
    ['2026-08-12T11:59:59.999Z', 'INSTAGRAM_PUBLICATION_ONE_OFF_AUTHORIZATION_NOT_YET_VALID'],
    ['2026-08-12T14:00:00.000Z', 'INSTAGRAM_PUBLICATION_ONE_OFF_AUTHORIZATION_EXPIRED'],
    ['2026-08-12T14:00:00.001Z', 'INSTAGRAM_PUBLICATION_ONE_OFF_AUTHORIZATION_EXPIRED'],
  ])('performs no provider operation at %s', async (now, error) => {
    const store = new OneOffMemoryStore();
    const transport = new FakePublicationTransport();
    const { executor } = oneOffExecutor(store, transport, () => now);
    await expect(executor.execute(oneOffRequest)).rejects.toThrow(error);
    expect(transport.createCalls + transport.statusCalls + transport.publishCalls).toBe(0);
  });

  it('accepts the exact inclusive valid-from boundary', async () => {
    const store = new OneOffMemoryStore();
    const transport = new FakePublicationTransport();
    transport.status = 'FINISHED';
    const { executor } = oneOffExecutor(store, transport, () => oneOff.validFrom);
    await expect(executor.execute(oneOffRequest)).resolves.toMatchObject({ completed: true });
    expect(transport.createCalls).toBe(1);
    expect(transport.publishCalls).toBe(1);
  });

  it('rechecks validity after consumption before creating the container', async () => {
    let now = oneOffNow;
    const store = new OneOffMemoryStore();
    store.afterConsumption = () => {
      now = oneOff.validUntil;
    };
    const transport = new FakePublicationTransport();
    const { executor } = oneOffExecutor(store, transport, () => now);
    await expect(executor.execute(oneOffRequest)).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_ONE_OFF_AUTHORIZATION_EXPIRED',
    );
    expect(transport.createCalls + transport.statusCalls + transport.publishCalls).toBe(0);
  });

  it.each(['create response', 'status response', 'publishing persistence'])(
    'does not publish if the authorization expires after %s',
    async (boundary) => {
      let now = oneOffNow;
      const store = new OneOffMemoryStore();
      const transport = new FakePublicationTransport();
      transport.status = 'FINISHED';
      if (boundary === 'create response') {
        vi.spyOn(transport, 'createContainer').mockImplementation(() => {
          now = oneOff.validUntil;
          return Promise.resolve({ containerId: 'container-1' });
        });
      }
      if (boundary === 'status response') {
        vi.spyOn(transport, 'getContainerStatus').mockImplementation(() => {
          now = oneOff.validUntil;
          return Promise.resolve('FINISHED');
        });
      }
      if (boundary === 'publishing persistence') {
        store.afterAdvance = (next) => {
          if (next.state === 'PUBLISHING') now = oneOff.validUntil;
        };
      }
      const { executor } = oneOffExecutor(store, transport, () => now);
      await expect(executor.execute(oneOffRequest)).rejects.toThrow(
        'INSTAGRAM_PUBLICATION_ONE_OFF_AUTHORIZATION_EXPIRED',
      );
      expect(transport.publishCalls).toBe(0);
    },
  );

  it('does not publish after expiry while waiting for processing', async () => {
    let now = oneOffNow;
    const store = new OneOffMemoryStore();
    const transport = new FakePublicationTransport();
    const sleep = vi.fn().mockImplementation(() => {
      now = oneOff.validUntil;
      transport.status = 'FINISHED';
      return Promise.resolve();
    });
    const executor = new InstagramPublicationExecutor(store, transport, () => now, false, {
      maxAttempts: 3,
      pollIntervalMs: 7,
      sleep,
    });
    await expect(executor.execute(oneOffRequest)).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_ONE_OFF_AUTHORIZATION_EXPIRED',
    );
    expect(sleep).toHaveBeenCalledOnce();
    expect(transport.createCalls).toBe(1);
    expect(transport.publishCalls).toBe(0);
  });
});

function oneOffDatabaseRow(state: PublicationState = 'CREATING_CONTAINER') {
  return {
    correlation_id: oneOffRequest.correlationId,
    provider: 'meta/instagram',
    account_id: oneOffRequest.account.instagramAccountId,
    external_resource_id: state === 'PUBLISHED' ? 'media-existing' : null,
    state,
    idempotency_key: oneOffRequest.idempotencyKey,
    payload: { ...oneOffRequest },
    last_error: state === 'FAILED' ? 'ordinary-deterministic-failure' : null,
    updated_at: new Date(oneOffNow),
  };
}

describe('Postgres one-off publication consumption SQL contract', () => {
  it('reserves one committed CREATING_CONTAINER row before granting only an in-memory continuation', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rowCount: 1, rows: [oneOffDatabaseRow()] });
    const store = new PostgresPublicationExecutionStore({ query } as unknown as pg.Pool);
    const result = await store.consumeOneOff(oneOffRequest, oneOffNow);
    expect(result.publication.state).toBe('CREATING_CONTAINER');
    expect(result.advance).toBeTypeOf('function');
    expect(JSON.stringify(result)).not.toContain('advance');
    expect(query).toHaveBeenCalledOnce();
    const [sql, parameters] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("'CREATING_CONTAINER'");
    expect(sql).toContain('on conflict (idempotency_key) do nothing');
    expect(sql).toContain('returning');
    expect(parameters).toEqual([
      oneOffRequest.correlationId,
      oneOffRequest.account.instagramAccountId,
      oneOffRequest.idempotencyKey,
      expect.any(String),
      oneOffNow,
    ]);
    expect(JSON.parse(parameters[3] as string)).toEqual(oneOffRequest);
  });

  it.each<PublicationState>([
    'DRAFT',
    'SCHEDULED',
    'CREATING_CONTAINER',
    'PROCESSING',
    'PUBLISHING',
    'PUBLISHED',
    'FAILED',
    'CANCELED',
  ])('returns no continuation for an exact existing %s row', async (state) => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [oneOffDatabaseRow(state)] });
    const store = new PostgresPublicationExecutionStore({ query } as unknown as pg.Pool);
    const result = await store.consumeOneOff(oneOffRequest, oneOffNow);
    expect(result.publication.state).toBe(state);
    expect(result.advance).toBeUndefined();
    expect(Object.keys(result)).toEqual(['publication']);
    expect(query).toHaveBeenCalledTimes(2);
  });

  const requestConflicts: ReadonlyArray<readonly [string, InstagramPublishRequest]> = [
    ['caption', { ...oneOffRequest, caption: 'different caption' }],
    ['asset URL', { ...oneOffRequest, mediaUrls: ['https://example.com/different.jpg'] }],
    ['asset hash', { ...oneOffRequest, publicationAssetSha256: 'c'.repeat(64) }],
    [
      'Instagram account',
      { ...oneOffRequest, account: { ...oneOffRequest.account, instagramAccountId: 'ig-other' } },
    ],
    ['page', { ...oneOffRequest, account: { ...oneOffRequest.account, pageId: 'page-other' } }],
    ['correlation', { ...oneOffRequest, correlationId: 'corr-other' }],
    ['media type', { ...oneOffRequest, mediaType: 'STORY' }],
    [
      'command envelope',
      { ...oneOffRequest, oneOff: { ...oneOff, commandEnvelopeSha256: 'd'.repeat(64) } },
    ],
    [
      'valid from',
      { ...oneOffRequest, oneOff: { ...oneOff, validFrom: '2026-08-12T11:00:00.000Z' } },
    ],
    [
      'valid until',
      { ...oneOffRequest, oneOff: { ...oneOff, validUntil: '2026-08-12T15:00:00.000Z' } },
    ],
  ];

  it.each(requestConflicts)(
    'rejects a changed %s under the same consumption identity',
    async (_field, changed) => {
      expect(changed.idempotencyKey).toBe(oneOffRequest.idempotencyKey);
      const query = vi
        .fn()
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [oneOffDatabaseRow()] });
      const store = new PostgresPublicationExecutionStore({ query } as unknown as pg.Pool);
      await expect(store.consumeOneOff(changed, oneOffNow)).rejects.toThrow(
        'INSTAGRAM_PUBLICATION_IDEMPOTENCY_CONFLICT',
      );
      expect(query).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    ['provider', { provider: 'different/provider' }],
    ['stored key', { idempotency_key: 'different-key' }],
    ['stored account', { account_id: 'different-account' }],
    ['stored correlation', { correlation_id: 'different-correlation' }],
    ['payload extension', { payload: { ...oneOffRequest, resumeAuthorized: true } }],
    [
      'nested evidence',
      { payload: { ...oneOffRequest, oneOff: { ...oneOff, _providerEvidence: {} } } },
    ],
    ['non-object payload', { payload: null }],
    ['array payload', { payload: [] }],
  ])('rejects a conflicting %s on the persisted row', async (_field, patch) => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ ...oneOffDatabaseRow(), ...patch }] });
    const store = new PostgresPublicationExecutionStore({ query } as unknown as pg.Pool);
    await expect(store.consumeOneOff(oneOffRequest, oneOffNow)).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_IDEMPOTENCY_CONFLICT',
    );
  });

  it('permits only the established top-level provider evidence augmentation in exact replay comparison', async () => {
    const row = oneOffDatabaseRow('PUBLISHED');
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            ...row,
            payload: {
              ...oneOffRequest,
              _providerEvidence: {
                permalink: 'https://example.com/published',
                reconciliationSource: 'WRITE_RESPONSE',
              },
            },
          },
        ],
      });
    const store = new PostgresPublicationExecutionStore({ query } as unknown as pg.Pool);
    const replay = await store.consumeOneOff(oneOffRequest, oneOffNow);
    expect(replay.advance).toBeUndefined();
    expect(replay.publication).toMatchObject({
      state: 'PUBLISHED',
      permalink: 'https://example.com/published',
    });
  });

  it('rejects malformed descriptors, alternate keys and invalid windows before any SQL', async () => {
    const query = vi.fn();
    const store = new PostgresPublicationExecutionStore({ query } as unknown as pg.Pool);
    await expect(
      store.consumeOneOff({ ...oneOffRequest, idempotencyKey: 'new-key' }, oneOffNow),
    ).rejects.toThrow();
    await expect(store.consumeOneOff(oneOffRequest, oneOff.validUntil)).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_ONE_OFF_AUTHORIZATION_EXPIRED',
    );
    await expect(store.consumeOneOff(oneOffRequest, '2026-08-12T11:59:59.999Z')).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_ONE_OFF_AUTHORIZATION_NOT_YET_VALID',
    );
    await expect(store.consumeOneOff(request, oneOffNow)).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_ONE_OFF_DESCRIPTOR_REQUIRED',
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('prohibits routing one-off requests through ordinary reserve and save', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    const store = new PostgresPublicationExecutionStore({ query } as unknown as pg.Pool);
    await expect(store.reserve(oneOffRequest, oneOffNow)).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_ONE_OFF_CONSUMPTION_REQUIRED',
    );
    expect(query).not.toHaveBeenCalled();
    await expect(store.save(consumedRecord('PROCESSING'))).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_UPDATE_CONFLICT',
    );
    expect(query.mock.calls[0]?.[0]).toContain("not (payload ? 'oneOff')");
  });

  it('treats a lost insert acknowledgement as UNKNOWN without reading back to reclaim authority', async () => {
    const query = vi.fn().mockRejectedValueOnce(new Error('connection reset after commit'));
    const store = new PostgresPublicationExecutionStore({ query } as unknown as pg.Pool);
    await expect(store.consumeOneOff(oneOffRequest, oneOffNow)).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_ONE_OFF_CONSUMPTION_UNKNOWN',
    );
    expect(query).toHaveBeenCalledOnce();
  });

  it('binds continuation CAS to the complete prior row and makes a failed CAS permanently unusable', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [oneOffDatabaseRow()] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const store = new PostgresPublicationExecutionStore({ query } as unknown as pg.Pool);
    const reservation = await store.consumeOneOff(oneOffRequest, oneOffNow);
    expect(reservation.advance).toBeDefined();
    const advance = reservation.advance!;
    const next = {
      ...reservation.publication,
      state: 'PROCESSING' as const,
      externalContainerId: 'container-1',
      updatedAt: '2026-08-12T13:00:01.000Z',
    };
    await expect(advance(next)).rejects.toThrow('INSTAGRAM_PUBLICATION_UPDATE_CONFLICT');
    const [sql, values] = query.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain("provider = 'meta/instagram'");
    expect(sql).toContain("payload - '_providerEvidence' = $9::jsonb");
    expect(sql).toContain('state = $10 and updated_at = $11::timestamptz');
    expect(sql).toContain('external_resource_id is not distinct from $12::text');
    expect(sql).toContain('last_error is not distinct from $13::text');
    expect(values.slice(7)).toEqual([
      oneOffRequest.account.instagramAccountId,
      expect.any(String),
      'CREATING_CONTAINER',
      oneOffNow,
      null,
      null,
    ]);
    expect(JSON.parse(values[8] as string)).toEqual(oneOffRequest);
    await expect(advance(next)).rejects.toThrow('INSTAGRAM_PUBLICATION_UPDATE_CONFLICT');
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('does not reuse a continuation after an uncertain update acknowledgement', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [oneOffDatabaseRow()] })
      .mockRejectedValueOnce(new Error('update acknowledgement lost'));
    const store = new PostgresPublicationExecutionStore({ query } as unknown as pg.Pool);
    const { publication, advance } = await store.consumeOneOff(oneOffRequest, oneOffNow);
    expect(advance).toBeDefined();
    const next = {
      ...publication,
      state: 'PROCESSING' as const,
      externalContainerId: 'container-1',
    };
    await expect(advance!(next)).rejects.toThrow('update acknowledgement lost');
    await expect(advance!(next)).rejects.toThrow('INSTAGRAM_PUBLICATION_UPDATE_CONFLICT');
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('invalidates the continuation after its terminal transition', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [oneOffDatabaseRow()] })
      .mockResolvedValue({ rowCount: 1, rows: [] });
    const store = new PostgresPublicationExecutionStore({ query } as unknown as pg.Pool);
    const { publication, advance } = await store.consumeOneOff(oneOffRequest, oneOffNow);
    expect(advance).toBeDefined();
    const failed = { ...publication, state: 'FAILED' as const, lastError: 'create failed' };
    await advance!(failed);
    await expect(advance!({ ...failed, state: 'CREATING_CONTAINER' })).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_UPDATE_CONFLICT',
    );
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('copies caller-owned nested fields before awaiting database consumption', async () => {
    const mutable = {
      ...oneOffRequest,
      account: { ...oneOffRequest.account },
      oneOff: { ...oneOff },
      mediaUrls: [...oneOffRequest.mediaUrls],
    };
    const query = vi.fn().mockResolvedValueOnce({ rowCount: 1, rows: [oneOffDatabaseRow()] });
    const store = new PostgresPublicationExecutionStore({ query } as unknown as pg.Pool);
    const consuming = store.consumeOneOff(mutable, oneOffNow);
    mutable.oneOff.commandEnvelopeSha256 = 'e'.repeat(64);
    mutable.account.instagramAccountId = 'attacker-account';
    mutable.mediaUrls[0] = 'https://example.com/changed-after-await.jpg';
    const result = await consuming;
    expect(result.advance).toBeTypeOf('function');
    const parameters = query.mock.calls[0]?.[1] as unknown[];
    expect(JSON.parse(parameters[3] as string)).toEqual(oneOffRequest);
  });
});

describe('InstagramPublicationExecutor one-off provider deadlines', () => {
  it.each(['create', 'status', 'publish'])(
    'does not retry a stalled %s or advance after its late successful response',
    async (stage) => {
      vi.useFakeTimers();
      try {
        const store = new OneOffMemoryStore();
        const transport = new FakePublicationTransport();
        const create = vi
          .spyOn(transport, 'createContainer')
          .mockResolvedValue({ containerId: 'container-1' });
        const status = vi.spyOn(transport, 'getContainerStatus').mockResolvedValue('FINISHED');
        const publish = vi
          .spyOn(transport, 'publishContainer')
          .mockResolvedValue({ mediaId: 'media-1' });
        let release: (() => void) | undefined;
        if (stage === 'create') {
          create.mockImplementation(
            () =>
              new Promise((resolve) => {
                release = () => resolve({ containerId: 'container-late' });
              }),
          );
        } else if (stage === 'status') {
          status.mockImplementation(
            () =>
              new Promise((resolve) => {
                release = () => resolve('FINISHED');
              }),
          );
        } else {
          publish.mockImplementation(
            () =>
              new Promise((resolve) => {
                release = () => resolve({ mediaId: 'media-late' });
              }),
          );
        }
        const executor = new InstagramPublicationExecutor(
          store,
          transport,
          () => oneOffNow,
          false,
          {
            operationTimeoutMs: 5,
            maxAttempts: 2,
            pollIntervalMs: 0,
          },
        );
        const outcome = expect(executor.execute(oneOffRequest)).rejects.toThrow(
          'INSTAGRAM_PUBLICATION_ONE_OFF_PROVIDER_TIMEOUT_RECONCILIATION_REQUIRED',
        );
        await vi.advanceTimersByTimeAsync(6);
        await outcome;
        expect(store.record?.state).toBe('FAILED');
        expect(store.record?.lastError).toBe(
          `${stage === 'publish' ? 'PUBLISH_UNCERTAIN:' : stage === 'create' ? 'CREATE_UNCERTAIN:' : ''}INSTAGRAM_PUBLICATION_ONE_OFF_PROVIDER_TIMEOUT_RECONCILIATION_REQUIRED`,
        );
        const saved = [...store.advances];
        expect(release).toBeDefined();
        release?.();
        await vi.runAllTimersAsync();
        expect(store.advances).toEqual(saved);
        await expect(executor.execute(oneOffRequest)).rejects.toThrow(
          'INSTAGRAM_PUBLICATION_ONE_OFF_CONSUMED_RECONCILIATION_REQUIRED',
        );
        expect(create).toHaveBeenCalledOnce();
        expect(status).toHaveBeenCalledTimes(stage === 'create' ? 0 : 1);
        expect(publish).toHaveBeenCalledTimes(stage === 'publish' ? 1 : 0);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('caps a pending provider call to the remaining authorization window', async () => {
    vi.useFakeTimers();
    try {
      const store = new OneOffMemoryStore();
      const transport = new FakePublicationTransport();
      const create = vi
        .spyOn(transport, 'createContainer')
        .mockImplementation(() => new Promise(() => {}));
      const executor = new InstagramPublicationExecutor(
        store,
        transport,
        () => '2026-08-12T13:59:59.998Z',
        false,
        {
          operationTimeoutMs: 30_000,
        },
      );
      const outcome = expect(executor.execute(oneOffRequest)).rejects.toThrow(
        'INSTAGRAM_PUBLICATION_ONE_OFF_PROVIDER_TIMEOUT_RECONCILIATION_REQUIRED',
      );
      await vi.advanceTimersByTimeAsync(2);
      await outcome;
      expect(create).toHaveBeenCalledOnce();
      expect(transport.statusCalls + transport.publishCalls).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps an acknowledged publication successful if optional evidence enrichment stalls', async () => {
    vi.useFakeTimers();
    try {
      const store = new OneOffMemoryStore();
      let resolveReadback: ((evidence: { mediaId: string; permalink: string }) => void) | undefined;
      const transport = Object.assign(new FakePublicationTransport(), {
        getPublishedMedia: vi.fn().mockImplementation(
          () =>
            new Promise((resolve) => {
              resolveReadback = resolve;
            }),
        ),
      });
      transport.status = 'FINISHED';
      const executor = new InstagramPublicationExecutor(store, transport, () => oneOffNow, false, {
        operationTimeoutMs: 5,
      });
      const outcome = executor.execute(oneOffRequest);
      await vi.advanceTimersByTimeAsync(6);
      await expect(outcome).resolves.toMatchObject({
        completed: true,
        publication: {
          state: 'PUBLISHED',
          externalMediaId: 'media-1',
          reconciliationSource: 'WRITE_RESPONSE',
        },
      });
      const saved = [...store.advances];
      resolveReadback?.({ mediaId: 'media-1', permalink: 'https://example.com/late-evidence' });
      await vi.runAllTimersAsync();
      expect(store.advances).toEqual(saved);
      expect(transport.publishCalls).toBe(1);
      await expect(executor.execute(oneOffRequest)).resolves.toMatchObject({ completed: true });
      expect(transport.publishCalls).toBe(1);
      expect(transport.getPublishedMedia).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    { operationTimeoutMs: 0 },
    { operationTimeoutMs: 60_001 },
    { operationTimeoutMs: 1.5 },
    { operationTimeoutMs: Number.NaN },
    { operationTimeoutMs: Number.POSITIVE_INFINITY },
    { maxAttempts: 0 },
    { maxAttempts: 21 },
    { maxAttempts: 1.5 },
    { pollIntervalMs: -1 },
    { pollIntervalMs: 30_001 },
    { pollIntervalMs: 1.5 },
  ])('rejects invalid polling limits %j before consumption', async (options) => {
    const store = new OneOffMemoryStore();
    const transport = new FakePublicationTransport();
    const executor = new InstagramPublicationExecutor(
      store,
      transport,
      () => oneOffNow,
      false,
      options,
    );
    await expect(executor.execute(oneOffRequest)).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_ONE_OFF_POLLING_INVALID',
    );
    expect(store.consumeCalls).toBe(0);
    expect(transport.createCalls + transport.statusCalls + transport.publishCalls).toBe(0);
  });

  it('fails closed rather than falling back to ordinary reserve without a durable one-off store', async () => {
    const store = new MemoryPublicationStore();
    const transport = new FakePublicationTransport();
    const executor = new InstagramPublicationExecutor(store, transport, () => oneOffNow);
    await expect(executor.execute(oneOffRequest)).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_ONE_OFF_DURABLE_STORE_REQUIRED',
    );
    expect(store.record).toBeUndefined();
    expect(transport.createCalls + transport.statusCalls + transport.publishCalls).toBe(0);
  });
});

describe('InstagramPublicationExecutor one-off independent protections', () => {
  it('still enforces creative-truth policy before consuming or publishing', async () => {
    const store = new OneOffMemoryStore();
    const transport = new FakePublicationTransport();
    const executor = new InstagramPublicationExecutor(store, transport, () => oneOffNow, true);
    await expect(executor.execute(oneOffRequest)).rejects.toThrow(
      'CREATIVE_TRUTH_BINDING_REQUIRED',
    );
    expect(store.consumeCalls).toBe(0);
    expect(transport.createCalls + transport.statusCalls + transport.publishCalls).toBe(0);
  });

  it.each(['correlationId', 'publicationId', 'idempotencyKey'])(
    'does not let a continuation mutate another publication through %s',
    async (field) => {
      const query = vi.fn().mockResolvedValueOnce({ rowCount: 1, rows: [oneOffDatabaseRow()] });
      const store = new PostgresPublicationExecutionStore({ query } as unknown as pg.Pool);
      const { publication, advance } = await store.consumeOneOff(oneOffRequest, oneOffNow);
      expect(advance).toBeDefined();
      await expect(
        advance!({ ...publication, state: 'PROCESSING', [field]: 'different-record' }),
      ).rejects.toThrow('INSTAGRAM_PUBLICATION_UPDATE_CONFLICT');
      expect(query).toHaveBeenCalledOnce();
    },
  );
});

describe('Postgres ordinary publication full-payload reservation matching', () => {
  const scheduledRequest: InstagramPublishRequest = {
    ...request,
    publicationAssetSha256: 'b'.repeat(64),
  };
  const requestConflicts: ReadonlyArray<readonly [string, InstagramPublishRequest]> = [
    ['caption', { ...scheduledRequest, caption: 'different caption' }],
    ['asset URL', { ...scheduledRequest, mediaUrls: ['https://example.com/different.jpg'] }],
    ['asset hash', { ...scheduledRequest, publicationAssetSha256: 'c'.repeat(64) }],
    [
      'Instagram account',
      {
        ...scheduledRequest,
        account: { ...scheduledRequest.account, instagramAccountId: 'different-account' },
      },
    ],
    [
      'page',
      { ...scheduledRequest, account: { ...scheduledRequest.account, pageId: 'different-page' } },
    ],
    ['correlation', { ...scheduledRequest, correlationId: 'different-correlation' }],
    ['media type', { ...scheduledRequest, mediaType: 'STORY' }],
  ];

  it.each(requestConflicts)(
    'rejects a conflicting %s instead of resuming the existing publication',
    async (_field, changed) => {
      const existing = {
        ...oneOffDatabaseRow('DRAFT'),
        idempotency_key: scheduledRequest.idempotencyKey,
        payload: scheduledRequest,
      };
      const query = vi
        .fn()
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [existing] });
      const store = new PostgresPublicationExecutionStore({ query } as unknown as pg.Pool);
      await expect(store.reserve(changed, oneOffNow)).rejects.toThrow(
        'INSTAGRAM_PUBLICATION_IDEMPOTENCY_CONFLICT',
      );
      expect(query).toHaveBeenCalledTimes(2);
    },
  );

  it('allows an exact scheduled request with stored provider evidence', async () => {
    const existing = {
      ...oneOffDatabaseRow('PROCESSING'),
      idempotency_key: scheduledRequest.idempotencyKey,
      external_resource_id: 'existing-container',
      payload: { ...scheduledRequest, _providerEvidence: {} },
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [existing] });
    const store = new PostgresPublicationExecutionStore({ query } as unknown as pg.Pool);
    await expect(store.reserve(scheduledRequest, oneOffNow)).resolves.toMatchObject({
      state: 'PROCESSING',
      externalContainerId: 'existing-container',
    });
  });

  it('preserves retry of an ordinary scheduled FAILED publication that was not publish-uncertain', async () => {
    const store = new MemoryPublicationStore();
    const transport = new FakePublicationTransport();
    transport.status = 'ERROR';
    const executor = new InstagramPublicationExecutor(store, transport);
    await expect(executor.execute(request)).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_CONTAINER_PROCESSING_FAILED',
    );
    expect(store.record?.state).toBe('FAILED');
    transport.status = 'FINISHED';
    await expect(executor.execute(request)).resolves.toMatchObject({
      completed: true,
      publication: { state: 'PUBLISHED' },
    });
    expect(transport.createCalls).toBe(2);
    expect(transport.publishCalls).toBe(1);
  });
});

import {
  MetaApiClient as RealMetaApiClient,
  type MetaApiResponse as RealMetaApiResponse,
  type MetaApiTransport as RealMetaApiTransport,
} from '../src/providers/meta/meta-api-client.js';
import type { SecretResolver as RealMetaSecretResolver } from '../src/core/secrets.js';

function deferredMetaValue<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function realMetaResponse(payload: unknown): RealMetaApiResponse {
  return { ok: true, status: 200, json: () => Promise.resolve(payload) };
}

function realMetaOneOffHarness(
  options: {
    readonly resolveToken?: RealMetaSecretResolver['resolve'];
    readonly response?: (
      url: string,
      init: RequestInit,
      callNumber: number,
    ) => Promise<RealMetaApiResponse>;
    readonly now?: () => string;
  } = {},
) {
  const calls: Array<{ url: string; init: RequestInit; abortedAtDispatch: boolean | undefined }> =
    [];
  const resolveToken = vi.fn(options.resolveToken ?? (() => Promise.resolve('synthetic-token')));
  const http: RealMetaApiTransport = {
    request: vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, init, abortedAtDispatch: init.signal?.aborted });
      if (options.response) return options.response(url, init, calls.length);
      const parsed = new URL(url);
      if (parsed.searchParams.get('fields') === 'status_code') {
        return Promise.resolve(realMetaResponse({ status_code: 'FINISHED' }));
      }
      if (init.method === 'GET') {
        return Promise.resolve(
          realMetaResponse({
            id: 'published-media',
            permalink: 'https://example.invalid/p/published-media',
          }),
        );
      }
      return Promise.resolve(
        realMetaResponse({
          id: parsed.pathname.endsWith('/media_publish')
            ? 'published-media'
            : `container-${calls.length}`,
        }),
      );
    }),
  };
  const client = new RealMetaApiClient(
    { graphBaseUrl: 'https://example.invalid', apiVersion: 'v0' },
    { resolve: resolveToken },
    { provider: 'synthetic', key: 'not-a-real-credential' },
    http,
  );
  const store = new OneOffMemoryStore();
  const transport = new MetaInstagramPublicationTransport(client);
  const executor = new InstagramPublicationExecutor(
    store,
    transport,
    options.now ?? (() => oneOffNow),
    false,
    { operationTimeoutMs: 5 },
  );
  return { calls, resolveToken, store, executor };
}

const realMetaCarouselRequest: InstagramPublishRequest = {
  ...oneOffRequest,
  mediaType: 'CAROUSEL',
  mediaUrls: ['https://example.com/child-1.jpg', 'https://example.com/child-2.jpg'],
};
const oneOffProviderTimeout =
  'INSTAGRAM_PUBLICATION_ONE_OFF_PROVIDER_TIMEOUT_RECONCILIATION_REQUIRED';

describe('Instagram one-off real Meta request dispatch fences', () => {
  it.each(['HTTP response', 'JSON body'] as const)(
    'does not dispatch the next carousel child or parent when the first %s settles after timeout',
    async (delayedBoundary) => {
      vi.useFakeTimers();
      try {
        const started = deferredMetaValue<void>();
        const delayedResponse = deferredMetaValue<RealMetaApiResponse>();
        const delayedBody = deferredMetaValue<unknown>();
        const { executor, store, calls } = realMetaOneOffHarness({
          response: (_url, _init, callNumber) => {
            if (callNumber !== 1)
              return Promise.resolve(realMetaResponse({ id: `late-${callNumber}` }));
            if (delayedBoundary === 'HTTP response') {
              started.resolve();
              return delayedResponse.promise;
            }
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () => {
                started.resolve();
                return delayedBody.promise;
              },
            });
          },
        });
        const outcome = expect(executor.execute(realMetaCarouselRequest)).rejects.toThrow(
          oneOffProviderTimeout,
        );
        await started.promise;
        expect(calls).toHaveLength(1);
        expect(calls[0]?.init.signal?.aborted).toBe(false);

        await vi.advanceTimersByTimeAsync(5);
        await outcome;
        expect(calls).toHaveLength(1);
        expect(calls[0]?.init.signal?.aborted).toBe(true);
        expect(store.record).toMatchObject({
          state: 'FAILED',
          lastError: `CREATE_UNCERTAIN:${oneOffProviderTimeout}`,
        });
        const persistedAtTimeout = [...store.advances];

        delayedResponse.resolve(realMetaResponse({ id: 'child-1' }));
        delayedBody.resolve({ id: 'child-1' });
        await vi.runAllTimersAsync();
        expect(calls).toHaveLength(1);
        expect(calls[0]?.init.method).toBe('POST');
        expect(new URL(calls[0]!.url).pathname).toBe('/v0/ig-1/media');
        expect(store.advances).toEqual(persistedAtTimeout);
        await expect(executor.execute(realMetaCarouselRequest)).rejects.toThrow(
          'INSTAGRAM_PUBLICATION_ONE_OFF_CONSUMED_RECONCILIATION_REQUIRED',
        );
        expect(calls).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('does not dispatch an image create after its credential resolves beyond the executor timeout', async () => {
    vi.useFakeTimers();
    try {
      const started = deferredMetaValue<void>();
      const credential = deferredMetaValue<string>();
      const { executor, store, calls, resolveToken } = realMetaOneOffHarness({
        resolveToken: () => {
          started.resolve();
          return credential.promise;
        },
      });
      const outcome = expect(executor.execute(oneOffRequest)).rejects.toThrow(
        oneOffProviderTimeout,
      );
      await started.promise;
      expect(resolveToken).toHaveBeenCalledOnce();
      expect(calls).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(5);
      await outcome;
      const persistedAtTimeout = [...store.advances];
      expect(store.record?.state).toBe('FAILED');
      credential.resolve('synthetic-token');
      await vi.runAllTimersAsync();
      expect(calls).toHaveLength(0);
      expect(store.advances).toEqual(persistedAtTimeout);
      await expect(executor.execute(oneOffRequest)).rejects.toThrow(
        'INSTAGRAM_PUBLICATION_ONE_OFF_CONSUMED_RECONCILIATION_REQUIRED',
      );
      expect(resolveToken).toHaveBeenCalledOnce();
      expect(calls).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not dispatch media_publish when its third credential resolution settles after timeout', async () => {
    vi.useFakeTimers();
    try {
      let resolutionCount = 0;
      const publishingCredentialStarted = deferredMetaValue<void>();
      const credential = deferredMetaValue<string>();
      const { executor, store, calls, resolveToken } = realMetaOneOffHarness({
        resolveToken: () => {
          resolutionCount += 1;
          if (resolutionCount === 3) {
            publishingCredentialStarted.resolve();
            return credential.promise;
          }
          return Promise.resolve('synthetic-token');
        },
      });
      const outcome = expect(executor.execute(oneOffRequest)).rejects.toThrow(
        oneOffProviderTimeout,
      );
      await publishingCredentialStarted.promise;
      expect(calls).toHaveLength(2);
      expect(calls.map((call) => call.init.method)).toEqual(['POST', 'GET']);
      expect(store.record?.state).toBe('PUBLISHING');

      await vi.advanceTimersByTimeAsync(5);
      await outcome;
      expect(store.record).toMatchObject({
        state: 'FAILED',
        lastError: `PUBLISH_UNCERTAIN:${oneOffProviderTimeout}`,
      });
      const persistedAtTimeout = [...store.advances];
      credential.resolve('synthetic-token');
      await vi.runAllTimersAsync();
      expect(calls).toHaveLength(2);
      expect(calls.some((call) => new URL(call.url).pathname.endsWith('/media_publish'))).toBe(
        false,
      );
      expect(store.advances).toEqual(persistedAtTimeout);
      await expect(executor.execute(oneOffRequest)).rejects.toThrow(
        'INSTAGRAM_PUBLICATION_ONE_OFF_CONSUMED_RECONCILIATION_REQUIRED',
      );
      expect(resolveToken).toHaveBeenCalledTimes(3);
      expect(calls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('blocks the second carousel child and parent when the first child response crosses authorization expiry', async () => {
    vi.useFakeTimers();
    try {
      let now = oneOffNow;
      const { executor, store, calls, resolveToken } = realMetaOneOffHarness({
        now: () => now,
        response: (_url, _init, callNumber) =>
          Promise.resolve({
            ok: true,
            status: 200,
            json: () => {
              now = oneOff.validUntil;
              return Promise.resolve({ id: `child-${callNumber}` });
            },
          }),
      });
      await expect(executor.execute(realMetaCarouselRequest)).rejects.toThrow(
        'INSTAGRAM_PUBLICATION_ONE_OFF_AUTHORIZATION_EXPIRED',
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]?.init.method).toBe('POST');
      expect(resolveToken).toHaveBeenCalledOnce();
      expect(store.record?.state).toBe('FAILED');
      const persistedAtExpiry = [...store.advances];
      await vi.runAllTimersAsync();
      expect(calls).toHaveLength(1);
      expect(store.advances).toEqual(persistedAtExpiry);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shares a live carousel context but uses fresh contexts for status, publish, and readback after prior cleanup', async () => {
    vi.useFakeTimers();
    try {
      const { executor, store, calls, resolveToken } = realMetaOneOffHarness();
      await expect(executor.execute(realMetaCarouselRequest)).resolves.toMatchObject({
        completed: true,
        publication: {
          state: 'PUBLISHED',
          externalContainerId: 'container-3',
          externalMediaId: 'published-media',
          permalink: 'https://example.invalid/p/published-media',
          reconciliationSource: 'WRITE_RESPONSE',
        },
      });
      expect(calls.map((call) => call.init.method)).toEqual([
        'POST',
        'POST',
        'POST',
        'GET',
        'POST',
        'GET',
      ]);
      expect(calls.map((call) => call.abortedAtDispatch)).toEqual([
        false,
        false,
        false,
        false,
        false,
        false,
      ]);
      const signals = calls.map((call) => call.init.signal);
      expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
      expect(signals[1]).toBe(signals[0]);
      expect(signals[2]).toBe(signals[0]);
      expect(new Set(signals)).toHaveProperty('size', 4);
      expect(signals.every((signal) => signal?.aborted)).toBe(true);
      const parentBody = calls[2]?.init.body;
      expect(
        typeof parentBody === 'string'
          ? new URLSearchParams(parentBody).get('children')
          : undefined,
      ).toBe('container-1,container-2');
      expect(new URL(calls[4]!.url).pathname).toBe('/v0/ig-1/media_publish');
      const publishBody = calls[4]?.init.body;
      expect(
        typeof publishBody === 'string'
          ? new URLSearchParams(publishBody).get('creation_id')
          : undefined,
      ).toBe('container-3');
      expect(store.advances.map((record) => record.state)).toEqual([
        'PROCESSING',
        'PUBLISHING',
        'PUBLISHED',
      ]);
      expect(resolveToken).toHaveBeenCalledTimes(6);
      expect(vi.getTimerCount()).toBe(0);
      await expect(executor.execute(realMetaCarouselRequest)).resolves.toMatchObject({
        completed: true,
      });
      expect(calls).toHaveLength(6);
    } finally {
      vi.useRealTimers();
    }
  });
});

it('blocks late credential dispatch at the monotonic deadline even before the timeout callback runs', async () => {
  vi.useFakeTimers();
  const monotonic = vi.spyOn(performance, 'now').mockReturnValue(0);
  try {
    const started = deferredMetaValue<void>();
    const credential = deferredMetaValue<string>();
    const { executor, calls, store } = realMetaOneOffHarness({
      resolveToken: () => {
        started.resolve();
        return credential.promise;
      },
    });
    const outcome = expect(executor.execute(oneOffRequest)).rejects.toThrow(oneOffProviderTimeout);
    await started.promise;
    expect(vi.getTimerCount()).toBe(1);
    expect(calls).toHaveLength(0);

    // Move the monotonic clock without running the scheduled timeout callback.
    monotonic.mockReturnValue(5);
    credential.resolve('synthetic-token');
    await outcome;
    expect(calls).toHaveLength(0);
    expect(store.record?.state).toBe('FAILED');
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    monotonic.mockRestore();
    vi.useRealTimers();
  }
});

describe.each(['create', 'status', 'publish'] as const)(
  'Instagram one-off late fulfilled %s response',
  (stage) => {
    it.each(['HTTP response', 'JSON body'] as const)(
      'rejects a late %s before the timeout callback runs and never resumes the consumed request',
      async (delayedBoundary) => {
        vi.useFakeTimers();
        const monotonic = vi.spyOn(performance, 'now').mockReturnValue(0);
        try {
          const started = deferredMetaValue<void>();
          const delayedResponse = deferredMetaValue<RealMetaApiResponse>();
          const delayedBody = deferredMetaValue<unknown>();
          const delayedCall = stage === 'create' ? 1 : stage === 'status' ? 2 : 3;
          const payload =
            stage === 'status'
              ? { status_code: 'FINISHED' }
              : { id: stage === 'create' ? 'container-1' : 'published-media' };
          const { executor, store, calls, resolveToken } = realMetaOneOffHarness({
            response: (_url, _init, callNumber) => {
              if (callNumber !== delayedCall) {
                return Promise.resolve(
                  realMetaResponse(
                    callNumber === 2
                      ? { status_code: 'FINISHED' }
                      : { id: callNumber === 1 ? 'container-1' : 'published-media' },
                  ),
                );
              }
              if (delayedBoundary === 'HTTP response') {
                started.resolve();
                return delayedResponse.promise;
              }
              return Promise.resolve({
                ok: true,
                status: 200,
                json: () => {
                  started.resolve();
                  return delayedBody.promise;
                },
              });
            },
          });
          const expectedCalls = [
            { method: 'POST', path: '/v0/ig-1/media', fields: null },
            { method: 'GET', path: '/v0/container-1', fields: 'status_code' },
            { method: 'POST', path: '/v0/ig-1/media_publish', fields: null },
          ].slice(0, delayedCall);
          const expectedStates = [
            ...(['PROCESSING', 'PUBLISHING'] as const).slice(0, delayedCall - 1),
            'FAILED',
          ];
          const outcome = expect(executor.execute(oneOffRequest)).rejects.toThrow(
            oneOffProviderTimeout,
          );
          await started.promise;
          expect(calls).toHaveLength(delayedCall);
          expect(calls[delayedCall - 1]?.init.signal?.aborted).toBe(false);
          expect(vi.getTimerCount()).toBe(1);

          // Cross the deadline without advancing fake timers or running their callbacks.
          monotonic.mockReturnValue(5);
          if (delayedBoundary === 'HTTP response') {
            delayedResponse.resolve(realMetaResponse(payload));
          } else {
            delayedBody.resolve(payload);
          }
          await outcome;

          expect(
            calls.map((call) => ({
              method: call.init.method,
              path: new URL(call.url).pathname,
              fields: new URL(call.url).searchParams.get('fields'),
            })),
          ).toEqual(expectedCalls);
          expect(calls[delayedCall - 1]?.init.signal?.aborted).toBe(true);
          expect(resolveToken).toHaveBeenCalledTimes(delayedCall);
          expect(vi.getTimerCount()).toBe(0);
          expect(store.record).toMatchObject({
            state: 'FAILED',
            lastError: `${stage === 'create' ? 'CREATE_UNCERTAIN:' : stage === 'publish' ? 'PUBLISH_UNCERTAIN:' : ''}${oneOffProviderTimeout}`,
          });
          expect(store.record?.externalMediaId).toBeUndefined();
          expect(store.record?.permalink).toBeUndefined();
          expect(store.record?.reconciliationSource).toBeUndefined();
          expect(store.advances.map((record) => record.state)).toEqual(expectedStates);
          expect(store.advanceAttempts.map((record) => record.state)).toEqual(expectedStates);
          expect(store.reserve).not.toHaveBeenCalled();
          expect(store.save).not.toHaveBeenCalled();
          expect(store.consumeCalls).toBe(1);
          const persistedAtTimeout = [...store.advances];

          await expect(executor.execute(oneOffRequest)).rejects.toThrow(
            'INSTAGRAM_PUBLICATION_ONE_OFF_CONSUMED_RECONCILIATION_REQUIRED',
          );
          expect(store.consumeCalls).toBe(2);
          expect(store.advances).toEqual(persistedAtTimeout);
          expect(store.advanceAttempts).toEqual(persistedAtTimeout);
          expect(calls).toHaveLength(delayedCall);
          expect(resolveToken).toHaveBeenCalledTimes(delayedCall);
          expect(vi.getTimerCount()).toBe(0);
        } finally {
          monotonic.mockRestore();
          vi.useRealTimers();
        }
      },
    );
  },
);
