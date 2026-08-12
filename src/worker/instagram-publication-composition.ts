import type pg from 'pg';
import { PostgresPublicationExecutionStore } from '../persistence/postgres-publication-store.js';
import { InstagramPublicationExecutor } from '../providers/instagram/instagram-publication-executor.js';
import { MetaInstagramPublicationTransport } from '../providers/instagram/meta-instagram-publication-transport.js';
import type { MetaApiClient } from '../providers/meta/meta-api-client.js';
import {
  INSTAGRAM_PUBLICATION_JOB,
  InstagramPublicationJobHandler,
} from './instagram-publication-job.js';
import { InstagramPublicationRuntimeGate } from './instagram-publication-runtime-gate.js';
import type { JobHandler } from './worker.js';

export interface InstagramPublicationWorkerCompositionOptions {
  readonly pool: pg.Pool;
  readonly metaClient: MetaApiClient;
  readonly writesEnabled: boolean;
}

export function createInstagramPublicationWorkerHandlers(
  options: InstagramPublicationWorkerCompositionOptions,
): ReadonlyMap<string, JobHandler> {
  const store = new PostgresPublicationExecutionStore(options.pool);
  const transport = new MetaInstagramPublicationTransport(options.metaClient);
  const executor = new InstagramPublicationExecutor(store, transport);
  const handler = new InstagramPublicationJobHandler(executor);
  const gated = new InstagramPublicationRuntimeGate(options.writesEnabled, handler);

  return new Map([[INSTAGRAM_PUBLICATION_JOB, gated]]);
}
