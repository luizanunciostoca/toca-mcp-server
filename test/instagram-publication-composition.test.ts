import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import type { MetaApiClient } from '../src/providers/meta/meta-api-client.js';
import type { ScheduledJob } from '../src/scheduler/scheduler-contracts.js';
import { createInstagramPublicationWorkerHandlers } from '../src/worker/instagram-publication-composition.js';
import { INSTAGRAM_PUBLICATION_JOB } from '../src/worker/instagram-publication-job.js';

const job: ScheduledJob = {
  id: 'job-1',
  toolName: INSTAGRAM_PUBLICATION_JOB,
  payload: { malformed: true },
  runAt: '2026-08-12T15:00:00.000Z',
  timezone: 'America/Bahia',
  idempotencyKey: 'internal:instagram:publication:test',
  status: 'RUNNING',
  attempts: 1,
};

function createDependencies(): { pool: pg.Pool; metaClient: MetaApiClient; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn();
  const pool = { query } as unknown as pg.Pool;
  const metaClient = {
    get: vi.fn(),
    post: vi.fn(),
  } as unknown as MetaApiClient;
  return { pool, metaClient, query };
}

describe('Instagram publication worker composition', () => {
  it('registers only the internal publication job behind the disabled runtime gate', async () => {
    const { pool, metaClient, query } = createDependencies();
    const handlers = createInstagramPublicationWorkerHandlers({
      pool,
      metaClient,
      writesEnabled: false,
    });
    const handler = handlers.get(INSTAGRAM_PUBLICATION_JOB);

    expect([...handlers.keys()]).toEqual([INSTAGRAM_PUBLICATION_JOB]);
    await expect(handler?.execute(job.payload, job)).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_WRITES_DISABLED',
    );
    expect(query).not.toHaveBeenCalled();
    expect(metaClient.get).not.toHaveBeenCalled();
    expect(metaClient.post).not.toHaveBeenCalled();
  });

  it('reaches payload validation when the runtime gate is explicitly enabled', async () => {
    const { pool, metaClient, query } = createDependencies();
    const handlers = createInstagramPublicationWorkerHandlers({
      pool,
      metaClient,
      writesEnabled: true,
    });
    const handler = handlers.get(INSTAGRAM_PUBLICATION_JOB);

    await expect(handler?.execute(job.payload, job)).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    expect(metaClient.get).not.toHaveBeenCalled();
    expect(metaClient.post).not.toHaveBeenCalled();
  });
});
