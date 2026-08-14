import type pg from 'pg';
import type { RuntimeConfig } from '../config.js';
import type { Telemetry } from '../core/observability.js';
import type { StructuredLogger } from '../core/structured-logger.js';
import { PostgresPublicationExecutionStore } from '../persistence/postgres-publication-store.js';
import { GcsPublicationAssetDelivery } from '../providers/gcp/gcs-publication-asset-delivery.js';
import { InstagramPublicationExecutor } from '../providers/instagram/instagram-publication-executor.js';
import { InstagramPublicationReconciler } from '../providers/instagram/instagram-publication-reconciler.js';
import { MetaInstagramPublicationTransport } from '../providers/instagram/meta-instagram-publication-transport.js';
import { createMetaPublicationApiClient } from '../providers/meta/meta-publication-client.js';
import {
  TOCA_MANAGED_INSTAGRAM_PUBLICATION_JOB,
  TocaManagedInstagramPublicationJobHandler,
} from '../scheduler/toca-managed-instagram-scheduler.js';
import { TocaManagedInstagramApprovalAuditGate } from './toca-managed-instagram-approval-audit.js';
import { runWorkerBatch } from './worker-runtime.js';
import type { JobHandler } from './worker.js';

export interface TocaManagedInstagramWorkerRuntimeOptions {
  readonly config: RuntimeConfig;
  readonly pool: pg.Pool;
  readonly telemetry?: Telemetry;
  readonly logger?: StructuredLogger;
}

export function createTocaManagedInstagramRuntimeHandlers(
  config: RuntimeConfig,
  pool: pg.Pool,
): ReadonlyMap<string, JobHandler> {
  if (!config.TOCA_MANAGED_INSTAGRAM_EXECUTOR_ENABLED) return new Map();
  if (!config.TOCA_MANAGED_INSTAGRAM_SCHEDULER_ENABLED) return new Map();
  if (!config.META_ENABLED) return new Map();
  if (config.META_TOKEN_STORE_PROVIDER !== 'gcp-secret-manager') return new Map();
  if (!config.GCP_PROJECT_ID || !config.META_TOKEN_SECRET_ID) return new Map();
  if (!config.INSTAGRAM_PUBLICATION_ASSET_BUCKET) return new Map();

  const store = new PostgresPublicationExecutionStore(pool);
  const transport = new MetaInstagramPublicationTransport(createMetaPublicationApiClient(config));
  const executor = new InstagramPublicationExecutor(store, transport);
  const reconciler = new InstagramPublicationReconciler(store, transport);
  const delivery = new GcsPublicationAssetDelivery({
    projectId: config.GCP_PROJECT_ID,
    bucketName: config.INSTAGRAM_PUBLICATION_ASSET_BUCKET,
    signedUrlTtlSeconds: 15 * 60,
  });
  const publication = new TocaManagedInstagramPublicationJobHandler(delivery, executor, reconciler);
  const handler = new TocaManagedInstagramApprovalAuditGate(pool, publication);

  return new Map([[TOCA_MANAGED_INSTAGRAM_PUBLICATION_JOB, handler]]);
}

export async function runTocaManagedInstagramWorkerBatch(
  options: TocaManagedInstagramWorkerRuntimeOptions,
): Promise<number> {
  if (!options.config.TOCA_MANAGED_INSTAGRAM_EXECUTOR_ENABLED) return 0;

  const handlers = createTocaManagedInstagramRuntimeHandlers(options.config, options.pool);
  if (!handlers.has(TOCA_MANAGED_INSTAGRAM_PUBLICATION_JOB)) {
    throw new Error('TOCA_MANAGED_INSTAGRAM_RUNTIME_NOT_CONFIGURED');
  }

  return runWorkerBatch({
    pool: options.pool,
    handlers,
    claimToolName: TOCA_MANAGED_INSTAGRAM_PUBLICATION_JOB,
    ...(options.telemetry ? { telemetry: options.telemetry } : {}),
    ...(options.logger ? { logger: options.logger } : {}),
  });
}
