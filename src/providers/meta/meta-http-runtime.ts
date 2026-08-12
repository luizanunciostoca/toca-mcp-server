import type { RuntimeConfig } from '../../config.js';
import { GcpSecretManagerStore } from '../../core/gcp-secret-manager-store.js';
import { EnvSecretResolver, InMemorySecretStore, type SecretStore } from '../../core/secrets.js';
import { MetaGraphManagedAssetDiscovery, type MetaManagedAsset } from './meta-assets.js';
import type { MetaConnectionState, MetaTokenExchangeResult } from './meta-connection.js';
import { FetchMetaHttpTransport } from './meta-graph.js';
import {
  FetchMetaOAuthTransport,
  InMemoryOAuthStateStore,
  MetaOAuthService,
} from './meta-oauth.js';

export interface MetaHttpRuntime {
  readonly oauth: MetaOAuthService;
  readonly tokenStore: SecretStore;
  discoverAssets(result: MetaTokenExchangeResult): Promise<readonly MetaManagedAsset[]>;
}

function createTokenStore(config: RuntimeConfig): SecretStore {
  if (config.META_TOKEN_STORE_PROVIDER === 'gcp-secret-manager') {
    if (!config.GCP_PROJECT_ID || !config.META_TOKEN_SECRET_ID) {
      throw new Error(
        'GCP_PROJECT_ID and META_TOKEN_SECRET_ID are required for the GCP Secret Manager token store',
      );
    }
    return new GcpSecretManagerStore({
      projectId: config.GCP_PROJECT_ID,
      secretId: config.META_TOKEN_SECRET_ID,
    });
  }
  return new InMemorySecretStore('memory');
}

export function createMetaHttpRuntime(
  config: RuntimeConfig,
  env: NodeJS.ProcessEnv = process.env,
): MetaHttpRuntime | undefined {
  if (!config.META_ENABLED) return undefined;

  if (
    !config.META_APP_ID ||
    !config.META_APP_SECRET_PROVIDER ||
    !config.META_APP_SECRET_KEY ||
    !config.META_AUTHORIZATION_ENDPOINT ||
    !config.META_TOKEN_ENDPOINT ||
    !config.META_REDIRECT_URI ||
    !config.META_REQUESTED_SCOPES ||
    !config.META_GRAPH_BASE_URL ||
    !config.META_GRAPH_API_VERSION
  ) {
    throw new Error('Meta runtime configuration is incomplete');
  }

  if (config.META_APP_SECRET_PROVIDER !== 'env') {
    throw new Error(`Unsupported Meta app secret provider: ${config.META_APP_SECRET_PROVIDER}`);
  }

  const appSecrets = new EnvSecretResolver(env, config.META_APP_SECRET_PROVIDER);
  const tokenStore = createTokenStore(config);
  const graphConfig = {
    graphBaseUrl: config.META_GRAPH_BASE_URL,
    apiVersion: config.META_GRAPH_API_VERSION,
  };
  const transport = new FetchMetaOAuthTransport(appSecrets, tokenStore, graphConfig);
  const oauth = new MetaOAuthService(
    {
      appId: config.META_APP_ID,
      appSecret: {
        provider: config.META_APP_SECRET_PROVIDER,
        key: config.META_APP_SECRET_KEY,
      },
      authorizationEndpoint: config.META_AUTHORIZATION_ENDPOINT,
      tokenEndpoint: config.META_TOKEN_ENDPOINT,
      redirectUri: config.META_REDIRECT_URI,
      requestedScopes: config.META_REQUESTED_SCOPES.split(',')
        .map((scope) => scope.trim())
        .filter(Boolean),
    },
    new InMemoryOAuthStateStore(),
    transport,
  );
  const assetDiscovery = new MetaGraphManagedAssetDiscovery(
    graphConfig,
    tokenStore,
    new FetchMetaHttpTransport(),
  );

  return {
    oauth,
    tokenStore,
    discoverAssets(result) {
      const connectedAt = new Date().toISOString();
      const tokenReference = `${result.accessToken.provider}:${result.accessToken.key}`;
      const state: MetaConnectionState = {
        account: {
          id: 'meta-oauth-staging',
          provider: 'meta',
          externalAccountId: 'oauth-user',
          label: 'TOCA Meta OAuth',
          scopes: [...result.grantedScopes],
          status: 'CONNECTED',
          tokenReference,
          ...(result.expiresAt ? { expiresAt: result.expiresAt } : {}),
        },
        accessToken: result.accessToken,
        grantedScopes: result.grantedScopes,
        connectedAt,
        ...(result.expiresAt ? { expiresAt: result.expiresAt } : {}),
      };
      return assetDiscovery.list(state);
    },
  };
}
