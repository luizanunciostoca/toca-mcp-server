import type { RuntimeConfig } from '../../config.js';
import { GcpSecretManagerStore } from '../../core/gcp-secret-manager-store.js';
import type { SecretReference } from '../../core/secrets.js';
import { MetaApiClient } from './meta-api-client.js';

export function createMetaPublicationTokenReference(config: RuntimeConfig): SecretReference {
  if (config.META_TOKEN_STORE_PROVIDER !== 'gcp-secret-manager') {
    throw new Error('META_PUBLICATION_TOKEN_STORE_MUST_BE_GCP_SECRET_MANAGER');
  }
  if (!config.META_TOKEN_SECRET_ID) throw new Error('META_TOKEN_SECRET_ID_REQUIRED');
  return {
    provider: 'gcp-secret-manager',
    key: `${config.META_TOKEN_SECRET_ID}/versions/latest`,
  };
}

export function createMetaPublicationApiClient(config: RuntimeConfig): MetaApiClient {
  if (!config.GCP_PROJECT_ID || !config.META_TOKEN_SECRET_ID) {
    throw new Error('META_PUBLICATION_SECRET_MANAGER_CONFIG_INCOMPLETE');
  }
  const store = new GcpSecretManagerStore({
    projectId: config.GCP_PROJECT_ID,
    secretId: config.META_TOKEN_SECRET_ID,
  });
  return new MetaApiClient(
    {
      graphBaseUrl: config.META_GRAPH_BASE_URL,
      apiVersion: config.META_GRAPH_API_VERSION,
    },
    store,
    createMetaPublicationTokenReference(config),
  );
}
