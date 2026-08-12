import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import type { MetaApiClient } from '../src/providers/meta/meta-api-client.js';
import type { ScheduledJob } from '../src/scheduler/scheduler-contracts.js';
import { hashInstagramPublicationApprovalPayload } from '../src/worker/instagram-publication-boundary.js';
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

function createDependencies(): {
  pool: pg.Pool;
  metaClient: MetaApiClient;
  query: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
  const get = vi.fn();
  const post = vi.fn();
  const pool = { query } as unknown as pg.Pool;
  const metaClient = { get, post } as unknown as MetaApiClient;
  return { pool, metaClient, query, get, post };
}

describe('Instagram publication worker composition', () => {
  it('registers only the internal publication job behind the disabled runtime gate', async () => {
    const { pool, metaClient, query, get, post } = createDependencies();
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
    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('denies enabled writes when no exact approved request hash is configured', async () => {
    const { pool, metaClient, query, get, post } = createDependencies();
    const handlers = createInstagramPublicationWorkerHandlers({
      pool,
      metaClient,
      writesEnabled: true,
    });
    const handler = handlers.get(INSTAGRAM_PUBLICATION_JOB);

    await expect(handler?.execute(job.payload, job)).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_APPROVAL_REQUIRED',
    );
    expect(query).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('denies a request whose payload does not match the approved hash', async () => {
    const { pool, metaClient, query, get, post } = createDependencies();
    const handlers = createInstagramPublicationWorkerHandlers({
      pool,
      metaClient,
      writesEnabled: true,
      approvedRequestSha256: 'a'.repeat(64),
    });
    const handler = handlers.get(INSTAGRAM_PUBLICATION_JOB);

    await expect(handler?.execute(job.payload, job)).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_APPROVAL_MISMATCH',
    );
    expect(query).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('reaches payload validation only after the exact payload has been approved and audited', async () => {
    const { pool, metaClient, query, get, post } = createDependencies();
    const handlers = createInstagramPublicationWorkerHandlers({
      pool,
      metaClient,
      writesEnabled: true,
      approvedRequestSha256: hashInstagramPublicationApprovalPayload(job.payload),
    });
    const handler = handlers.get(INSTAGRAM_PUBLICATION_JOB);

    await expect(handler?.execute(job.payload, job)).rejects.toThrow();
    expect(query).toHaveBeenCalledTimes(2);
    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });
});
