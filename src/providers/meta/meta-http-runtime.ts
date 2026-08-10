import type { RuntimeConfig } from '../../config.js';
import { EnvSecretResolver, InMemorySecretStore } from '../../core/secrets.js';
import {
  FetchMetaOAuthTransport,
  InMemoryOAuthStateStore,
  MetaOAuthService,
} from './meta-oauth.js';

export interface MetaHttpRuntime {
  readonly oauth: MetaOAuthService;
  readonly tokenStore: InMemorySecretStore;
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
    !config.META_REQUESTED_SCOPES
  ) {
    throw new Error('Meta runtime configuration is incomplete');
  }

  if (config.META_APP_SECRET_PROVIDER !== 'env') {
    throw new Error(`Unsupported Meta app secret provider: ${config.META_APP_SECRET_PROVIDER}`);
  }

  const appSecrets = new EnvSecretResolver(env, config.META_APP_SECRET_PROVIDER);
  const tokenStore = new InMemorySecretStore('memory');
  const transport = new FetchMetaOAuthTransport(appSecrets, tokenStore);
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

  return { oauth, tokenStore };
}
