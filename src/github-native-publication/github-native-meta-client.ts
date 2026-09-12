import { EnvironmentSecretResolver } from '../core/secrets.js';
import { MetaApiClient } from '../providers/meta/meta-api-client.js';

export function createGithubNativeMetaClient(env: NodeJS.ProcessEnv = process.env): MetaApiClient {
  const graphBaseUrl = env.META_GRAPH_BASE_URL?.trim() || 'https://graph.facebook.com';
  const apiVersion = env.META_GRAPH_API_VERSION?.trim() || 'v24.0';
  const tokenEnvKey = env.META_ACCESS_TOKEN_ENV_KEY?.trim() || 'META_ACCESS_TOKEN';

  if (!/^v\d+\.\d+$/.test(apiVersion)) {
    throw new Error('GITHUB_NATIVE_META_API_VERSION_INVALID');
  }

  return new MetaApiClient({ graphBaseUrl, apiVersion }, new EnvironmentSecretResolver(env), {
    provider: 'env',
    key: tokenEnvKey,
  });
}
