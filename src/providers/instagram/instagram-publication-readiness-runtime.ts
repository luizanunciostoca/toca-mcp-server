import type pg from 'pg';
import type { RuntimeConfig } from '../../config.js';
import type { MetaApiClient } from '../meta/meta-api-client.js';
import { createMetaPublicationApiClient } from '../meta/meta-publication-client.js';
import {
  checkInstagramPublicationReadiness,
  type InstagramPublicationReadinessResult,
} from './instagram-publication-readiness-preflight.js';

export interface InstagramPublicationReadinessRuntimeOptions {
  readonly config: RuntimeConfig;
  readonly pool: pg.Pool;
  readonly metaClient?: MetaApiClient;
}

export async function runInstagramPublicationReadinessPreflight(
  options: InstagramPublicationReadinessRuntimeOptions,
): Promise<InstagramPublicationReadinessResult> {
  if (!options.config.META_ENABLED) throw new Error('META_ENABLED_REQUIRED');
  if (options.config.META_TOKEN_STORE_PROVIDER !== 'gcp-secret-manager') {
    throw new Error('META_PUBLICATION_TOKEN_STORE_MUST_BE_GCP_SECRET_MANAGER');
  }
  if (!options.config.GCP_PROJECT_ID || !options.config.META_TOKEN_SECRET_ID) {
    throw new Error('META_PUBLICATION_SECRET_MANAGER_CONFIG_INCOMPLETE');
  }
  if (!options.config.INSTAGRAM_BUSINESS_ACCOUNT_ID) {
    throw new Error('INSTAGRAM_BUSINESS_ACCOUNT_ID_REQUIRED');
  }

  return checkInstagramPublicationReadiness({
    pool: options.pool,
    metaClient: options.metaClient ?? createMetaPublicationApiClient(options.config),
    instagramBusinessAccountId: options.config.INSTAGRAM_BUSINESS_ACCOUNT_ID,
  });
}
