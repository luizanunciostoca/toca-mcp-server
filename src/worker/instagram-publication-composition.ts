import type pg from 'pg';
import { PostgresPublicationExecutionStore } from '../persistence/postgres-publication-store.js';
import { InstagramPublicationExecutor } from '../providers/instagram/instagram-publication-executor.js';
import { MetaInstagramPublicationTransport } from '../providers/instagram/meta-instagram-publication-transport.js';
import type { MetaApiClient } from '../providers/meta/meta-api-client.js';
import { InstagramPublicationApprovalAuditGate } from './instagram-publication-boundary.js';
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
  readonly approvedRequestSha256?: string;
}

export function createInstagramPublicationWorkerHandlers(
  options: InstagramPublicationWorkerCompositionOptions,
): ReadonlyMap<string, JobHandler> {
  const store = new PostgresPublicationExecutionStore(options.pool);
  const transport = new MetaInstagramPublicationTransport(options.metaClient);
  const executor = new InstagramPublicationExecutor(
    store,
    transport,
    () => new Date().toISOString(),
    true,
  );
  const handler = new InstagramPublicationJobHandler(executor);
  const approvalAudit = new InstagramPublicationApprovalAuditGate(
    options.pool,
    options.approvedRequestSha256,
    handler,
  );
  const gated = new InstagramPublicationRuntimeGate(options.writesEnabled, approvalAudit);

  return new Map([[INSTAGRAM_PUBLICATION_JOB, gated]]);
}
