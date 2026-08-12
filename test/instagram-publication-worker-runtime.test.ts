import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { loadConfig } from '../src/config.js';
import { runInstagramPublicationWorkerBatch } from '../src/worker/instagram-publication-worker-runtime.js';

function createPool(): { pool: pg.Pool; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn();
  return { pool: { query } as unknown as pg.Pool, query };
}

describe('Instagram publication worker runtime', () => {
  it('exits before touching PostgreSQL when publication writes are disabled', async () => {
    const config = loadConfig({ NODE_ENV: 'test', META_ENABLED: 'false' });
    const { pool, query } = createPool();

    await expect(runInstagramPublicationWorkerBatch({ config, pool })).resolves.toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});
