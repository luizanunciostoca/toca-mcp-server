import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import {
  deriveInstagramOneOffIdempotencyKey,
  type InstagramPublishRequest,
} from '../src/providers/instagram/instagram-contracts.js';
import {
  InstagramPublicationExecutor,
  type InstagramPublicationTransport,
  type PublicationExecutionStore,
} from '../src/providers/instagram/instagram-publication-executor.js';
import type { PublicationRecord } from '../src/providers/instagram/publication-state.js';
import {
  hashInstagramPublicationApprovalPayload,
  InstagramPublicationApprovalAuditGate,
} from '../src/worker/instagram-publication-boundary.js';
import { InstagramPublicationRuntimeGate } from '../src/worker/instagram-publication-runtime-gate.js';
import type { ScheduledJob } from '../src/scheduler/scheduler-contracts.js';
import { InMemoryScheduler } from '../src/scheduler/in-memory-scheduler.js';
import {
  INSTAGRAM_PUBLICATION_JOB,
  InstagramPublicationJobHandler,
  InstagramPublicationJobScheduler,
  parseInstagramPublishRequest,
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

const oneOff: NonNullable<InstagramPublishRequest['oneOff']> = {
  mode: 'ONE_OFF',
  authorizationRef: 'approval:instagram:first-feed',
  authorizationId: 'approval-2026-08-12',
  commandEnvelopeSha256: 'a'.repeat(64),
  validFrom: '2026-08-12T12:00:00.000Z',
  validUntil: '2026-08-12T14:00:00.000Z',
  maxPublications: 1,
};
const oneOffRequest: InstagramPublishRequest = {
  ...request,
  caption: 'Exactly approved caption',
  publicationAssetSha256: 'c'.repeat(64),
  oneOff,
  idempotencyKey: deriveInstagramOneOffIdempotencyKey(oneOff),
};

function approvalJob(payload: unknown): ScheduledJob {
  return {
    id: 'one-off-approval-job',
    toolName: INSTAGRAM_PUBLICATION_JOB,
    payload,
    runAt: '2026-08-12T13:00:00.000Z',
    timezone: 'UTC',
    idempotencyKey: oneOffRequest.idempotencyKey,
    status: 'RUNNING',
    attempts: 1,
  };
}

describe('Instagram one-off publication request contract', () => {
  it('preserves the complete descriptor through parsing and scheduling', async () => {
    expect(parseInstagramPublishRequest(oneOffRequest)).toEqual(oneOffRequest);
    const scheduler = new InMemoryScheduler();
    const bridge = new InstagramPublicationJobScheduler(scheduler, () => 'one-off-job');
    const job = await bridge.schedule(oneOffRequest, oneOff.validFrom, 'UTC');
    expect(job.payload).toEqual(oneOffRequest);
  });

  it.each([
    ['mode', 'SCHEDULED'],
    ['authorizationRef', ''],
    ['authorizationId', ''],
    ['commandEnvelopeSha256', 'not-a-sha256'],
    ['commandEnvelopeSha256', 'g'.repeat(64)],
    ['validFrom', 'not-a-date'],
    ['validUntil', 'not-a-date'],
    ['validFrom', '2026-08-12'],
    ['validUntil', '2026-08-12'],
    ['maxPublications', 0],
    ['maxPublications', 2],
    ['maxPublications', '1'],
    ['approvedRequestSha256', 'a'.repeat(64)],
    ['advance', 'serialized-capability'],
  ])('rejects malformed or unrecognized descriptor field %s=%s', (field, value) => {
    expect(() =>
      parseInstagramPublishRequest({
        ...oneOffRequest,
        oneOff: { ...oneOff, [field]: value },
      }),
    ).toThrow();
  });

  it.each(Object.keys(oneOff))('rejects a descriptor missing %s', (field) => {
    const descriptor: Record<string, unknown> = { ...oneOff };
    delete descriptor[field];
    expect(() => parseInstagramPublishRequest({ ...oneOffRequest, oneOff: descriptor })).toThrow();
  });

  it.each([null, true, [], 'ONE_OFF'])('rejects a non-object descriptor %j', (descriptor) => {
    expect(() => parseInstagramPublishRequest({ ...oneOffRequest, oneOff: descriptor })).toThrow();
  });

  it.each([oneOff.validFrom, '2026-08-12T11:59:59.999Z'])(
    'rejects an empty or reversed authorization window ending %s',
    (validUntil) => {
      expect(() =>
        parseInstagramPublishRequest({
          ...oneOffRequest,
          oneOff: { ...oneOff, validUntil },
        }),
      ).toThrow();
    },
  );

  it('rejects a caller-selected idempotency key rather than opening another consumption slot', () => {
    expect(() =>
      parseInstagramPublishRequest({ ...oneOffRequest, idempotencyKey: 'fresh-caller-key' }),
    ).toThrow();
  });

  it('derives the consumption identity only from authorization reference and ID', () => {
    const original = deriveInstagramOneOffIdempotencyKey(oneOff);
    const changedDescriptor = {
      ...oneOff,
      commandEnvelopeSha256: 'b'.repeat(64),
      validFrom: '2026-08-12T11:00:00.000Z',
      validUntil: '2026-08-12T15:00:00.000Z',
    };
    expect(deriveInstagramOneOffIdempotencyKey(changedDescriptor)).toBe(original);
    expect(
      deriveInstagramOneOffIdempotencyKey({ ...oneOff, authorizationRef: 'another-reference' }),
    ).not.toBe(original);
    expect(
      deriveInstagramOneOffIdempotencyKey({ ...oneOff, authorizationId: 'another-approval' }),
    ).not.toBe(original);
    expect(
      deriveInstagramOneOffIdempotencyKey({
        ...oneOff,
        authorizationRef: 'a:b',
        authorizationId: 'c',
      }),
    ).not.toBe(
      deriveInstagramOneOffIdempotencyKey({
        ...oneOff,
        authorizationRef: 'a',
        authorizationId: 'b:c',
      }),
    );
  });

  it('does not classify incomplete one-off execution as safe worker retry', async () => {
    const execute = vi.fn().mockResolvedValue({
      completed: false,
      publication: {
        publicationId: oneOffRequest.correlationId,
        correlationId: oneOffRequest.correlationId,
        idempotencyKey: oneOffRequest.idempotencyKey,
        state: 'PROCESSING',
        updatedAt: oneOff.validFrom,
      },
    });
    const handler = new InstagramPublicationJobHandler({
      execute,
    } as unknown as InstagramPublicationExecutor);
    await expect(handler.execute(oneOffRequest)).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_ONE_OFF_CONSUMED_RECONCILIATION_REQUIRED',
    );
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(oneOffRequest);
  });
});

describe('Instagram one-off approval binding', () => {
  const changes: ReadonlyArray<readonly [string, InstagramPublishRequest]> = [
    [
      'authorization reference',
      {
        ...oneOffRequest,
        oneOff: { ...oneOff, authorizationRef: 'different-reference' },
        idempotencyKey: deriveInstagramOneOffIdempotencyKey({
          ...oneOff,
          authorizationRef: 'different-reference',
        }),
      },
    ],
    [
      'authorization ID',
      {
        ...oneOffRequest,
        oneOff: { ...oneOff, authorizationId: 'different-id' },
        idempotencyKey: deriveInstagramOneOffIdempotencyKey({
          ...oneOff,
          authorizationId: 'different-id',
        }),
      },
    ],
    [
      'command envelope',
      { ...oneOffRequest, oneOff: { ...oneOff, commandEnvelopeSha256: 'b'.repeat(64) } },
    ],
    [
      'valid-from',
      { ...oneOffRequest, oneOff: { ...oneOff, validFrom: '2026-08-12T11:00:00.000Z' } },
    ],
    [
      'valid-until',
      { ...oneOffRequest, oneOff: { ...oneOff, validUntil: '2026-08-12T15:00:00.000Z' } },
    ],
    ['caption', { ...oneOffRequest, caption: 'Changed caption' }],
    ['asset bytes', { ...oneOffRequest, publicationAssetSha256: 'd'.repeat(64) }],
    ['asset URL', { ...oneOffRequest, mediaUrls: ['https://example.com/other.jpg'] }],
    [
      'account',
      { ...oneOffRequest, account: { ...oneOffRequest.account, instagramAccountId: 'ig-2' } },
    ],
    ['page', { ...oneOffRequest, account: { ...oneOffRequest.account, pageId: 'page-2' } }],
    ['correlation', { ...oneOffRequest, correlationId: 'different-correlation' }],
    ['media type', { ...oneOffRequest, mediaType: 'STORY' }],
  ];

  it.each(changes)(
    'binds parsed %s to the externally configured approval hash',
    async (_field, changed) => {
      const approved = hashInstagramPublicationApprovalPayload(
        parseInstagramPublishRequest(oneOffRequest),
      );
      const parsed = parseInstagramPublishRequest(changed);
      expect(hashInstagramPublicationApprovalPayload(parsed)).not.toBe(approved);
      const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
      const execute = vi.fn().mockResolvedValue(undefined);
      const gate = new InstagramPublicationApprovalAuditGate(
        { query } as unknown as pg.Pool,
        approved,
        { execute },
      );
      await expect(gate.execute(parsed, approvalJob(parsed))).rejects.toThrow(
        'INSTAGRAM_PUBLICATION_APPROVAL_MISMATCH',
      );
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it.each([
    { ...oneOffRequest, oneOff: { ...oneOff, mode: 'SCHEDULED' } },
    { ...oneOffRequest, oneOff: { ...oneOff, maxPublications: 2 } },
    { ...oneOffRequest, idempotencyKey: 'changed-key' },
  ])(
    'binds fixed descriptor fields and key, while the parser rejects their mutation',
    (changed) => {
      expect(hashInstagramPublicationApprovalPayload(changed)).not.toBe(
        hashInstagramPublicationApprovalPayload(oneOffRequest),
      );
      expect(() => parseInstagramPublishRequest(changed)).toThrow();
    },
  );

  it('does not let caller-supplied approval metadata authorize an otherwise valid one-off', async () => {
    const supplied = {
      ...oneOffRequest,
      approvedRequestSha256: hashInstagramPublicationApprovalPayload(oneOffRequest),
      approved: true,
      source: { approvedRequestSha256: hashInstagramPublicationApprovalPayload(oneOffRequest) },
    };
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const execute = vi.fn().mockResolvedValue(undefined);
    const gate = new InstagramPublicationApprovalAuditGate(
      { query } as unknown as pg.Pool,
      undefined,
      { execute },
    );
    await expect(gate.execute(supplied, approvalJob(supplied))).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_APPROVAL_REQUIRED',
    );
    expect(execute).not.toHaveBeenCalled();
    expect(parseInstagramPublishRequest(supplied)).toEqual(oneOffRequest);
  });
});

describe('Instagram one-off independent runtime and approval gates', () => {
  it('does not let one-off provenance or caller flags bypass disabled runtime writes', async () => {
    const supplied = { ...oneOffRequest, writesEnabled: true, approved: true };
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const execute = vi.fn().mockResolvedValue(undefined);
    const approvalGate = new InstagramPublicationApprovalAuditGate(
      { query } as unknown as pg.Pool,
      hashInstagramPublicationApprovalPayload(supplied),
      { execute },
    );
    const runtimeGate = new InstagramPublicationRuntimeGate(false, approvalGate);
    await expect(runtimeGate.execute(supplied, approvalJob(supplied))).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_WRITES_DISABLED',
    );
    expect(query).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('requires the externally configured exact whole-request hash even when writes are enabled', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const execute = vi.fn().mockResolvedValue(undefined);
    const approvalGate = new InstagramPublicationApprovalAuditGate(
      { query } as unknown as pg.Pool,
      hashInstagramPublicationApprovalPayload(oneOffRequest),
      { execute },
    );
    const runtimeGate = new InstagramPublicationRuntimeGate(true, approvalGate);
    await runtimeGate.execute(oneOffRequest, approvalJob(oneOffRequest));
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(oneOffRequest, approvalJob(oneOffRequest));
    expect(query).toHaveBeenCalledTimes(2);
  });
});
