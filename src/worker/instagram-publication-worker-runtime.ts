import type pg from 'pg';
import type { RuntimeConfig } from '../config.js';
import { createInstagramPublicationRuntimeHandlers } from './instagram-publication-runtime-bootstrap.js';
import { INSTAGRAM_PUBLICATION_JOB } from './instagram-publication-job.js';
import { runWorkerBatch } from './worker-runtime.js';

export interface InstagramPublicationWorkerRuntimeOptions {
  readonly config: RuntimeConfig;
  readonly pool: pg.Pool;
  readonly tenantId: string;
}

export async function runInstagramPublicationWorkerBatch(
  options: InstagramPublicationWorkerRuntimeOptions,
): Promise<number> {
  if (!options.config.INSTAGRAM_PUBLICATION_WRITES_ENABLED) return 0;

  const handlers = createInstagramPublicationRuntimeHandlers(options.config, options.pool);
  if (!handlers.has(INSTAGRAM_PUBLICATION_JOB)) {
    throw new Error('INSTAGRAM_PUBLICATION_RUNTIME_NOT_CONFIGURED');
  }

  return runWorkerBatch({
    pool: options.pool,
    tenantId: options.tenantId,
    handlers,
    claimToolName: INSTAGRAM_PUBLICATION_JOB,
  });
}
