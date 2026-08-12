import type pg from 'pg';
import type { RuntimeConfig } from '../config.js';
import { createMetaPublicationApiClient } from '../providers/meta/meta-publication-client.js';
import { createInstagramPublicationWorkerHandlers } from './instagram-publication-composition.js';
import type { JobHandler } from './worker.js';

export function createInstagramPublicationRuntimeHandlers(
  config: RuntimeConfig,
  pool: pg.Pool,
): ReadonlyMap<string, JobHandler> {
  if (!config.META_ENABLED) return new Map();
  if (config.META_TOKEN_STORE_PROVIDER !== 'gcp-secret-manager') return new Map();
  if (!config.GCP_PROJECT_ID || !config.META_TOKEN_SECRET_ID) return new Map();

  return createInstagramPublicationWorkerHandlers({
    pool,
    metaClient: createMetaPublicationApiClient(config),
    writesEnabled: config.INSTAGRAM_PUBLICATION_WRITES_ENABLED,
    approvedRequestSha256: config.INSTAGRAM_PUBLICATION_APPROVED_REQUEST_SHA256,
  });
}
