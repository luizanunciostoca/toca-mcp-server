import { IntelligentVideoAssetSelectorService } from '../creative/intelligent-video-asset-selector.js';
import {
  EnvironmentSecretResolver,
  type SecretReference,
  type SecretResolver,
} from '../core/secrets.js';
import { GoogleOAuthRefreshSecretResolver } from '../orchestrator/google-oauth-secret-resolver.js';
import { GoogleServiceIdentityOAuthResolver } from '../providers/gcp/google-service-identity-oauth-resolver.js';
import { GoogleSheetsRestClient } from '../providers/google-sheets/client.js';

export interface VideoAssetSelectionRuntime {
  readonly selector: IntelligentVideoAssetSelectorService;
}

export type VideoAssetSelectionRuntimeResolver = () => VideoAssetSelectionRuntime;

interface GoogleSheetsBinding {
  readonly resolver: SecretResolver;
  readonly tokenReference: SecretReference;
}

export function createLazyVideoAssetSelectionRuntimeResolver(
  env: NodeJS.ProcessEnv = process.env,
): VideoAssetSelectionRuntimeResolver {
  let runtime: VideoAssetSelectionRuntime | undefined;
  return () => {
    runtime ??= createVideoAssetSelectionRuntimeFromEnvironment(env);
    return runtime;
  };
}

export function videoAssetSelectionRuntimeConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return googleSheetsAccessConfigured(env);
}

export function createVideoAssetSelectionRuntimeFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): VideoAssetSelectionRuntime {
  if (!videoAssetSelectionRuntimeConfigured(env)) {
    throw new Error('VIDEO_ASSET_SELECTION_RUNTIME_NOT_CONFIGURED');
  }
  const secrets = new EnvironmentSecretResolver(env);
  const google = resolveGoogleSheetsBinding(env, secrets);
  const sheets = new GoogleSheetsRestClient(google.resolver, {
    tokenReference: google.tokenReference,
  });
  return { selector: new IntelligentVideoAssetSelectorService(sheets) };
}

function googleSheetsAccessConfigured(env: NodeJS.ProcessEnv): boolean {
  if (env.VIDEO_GOOGLE_AUTH_MODE?.trim().toUpperCase() === 'GCP_SERVICE_IDENTITY') return true;
  const accessTokenEnvKey = env.GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY?.trim();
  if (accessTokenEnvKey && env[accessTokenEnvKey]?.trim()) return true;
  const oauth = googleOAuthConfig(env);
  return Boolean(
    oauth.clientIdEnvKey &&
    oauth.clientSecretEnvKey &&
    oauth.refreshTokenEnvKey &&
    env[oauth.clientIdEnvKey]?.trim() &&
    env[oauth.clientSecretEnvKey]?.trim() &&
    env[oauth.refreshTokenEnvKey]?.trim(),
  );
}

function resolveGoogleSheetsBinding(
  env: NodeJS.ProcessEnv,
  secrets: EnvironmentSecretResolver,
): GoogleSheetsBinding {
  if (env.VIDEO_GOOGLE_AUTH_MODE?.trim().toUpperCase() === 'GCP_SERVICE_IDENTITY') {
    return {
      resolver: new GoogleServiceIdentityOAuthResolver(),
      tokenReference: {
        provider: 'gcp-service-identity-oauth',
        key: 'video-asset-selection-workspace',
      },
    };
  }
  const accessTokenEnvKey = env.GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY?.trim();
  if (accessTokenEnvKey && env[accessTokenEnvKey]?.trim()) {
    return {
      resolver: secrets,
      tokenReference: { provider: 'env', key: accessTokenEnvKey },
    };
  }
  const oauth = googleOAuthConfig(env);
  if (!oauth.clientIdEnvKey || !oauth.clientSecretEnvKey || !oauth.refreshTokenEnvKey) {
    throw new Error('VIDEO_ASSET_SELECTION_GOOGLE_AUTH_NOT_CONFIGURED');
  }
  return {
    resolver: new GoogleOAuthRefreshSecretResolver({
      clientIdReference: { provider: 'env', key: oauth.clientIdEnvKey },
      clientSecretReference: { provider: 'env', key: oauth.clientSecretEnvKey },
      refreshTokenReference: { provider: 'env', key: oauth.refreshTokenEnvKey },
      secrets,
      tokenEndpoint: oauth.tokenEndpoint,
    }),
    tokenReference: { provider: 'google-oauth', key: 'video-asset-selection-sheets' },
  };
}

function googleOAuthConfig(env: NodeJS.ProcessEnv): {
  readonly clientIdEnvKey: string | undefined;
  readonly clientSecretEnvKey: string | undefined;
  readonly refreshTokenEnvKey: string | undefined;
  readonly tokenEndpoint: string;
} {
  return {
    clientIdEnvKey:
      env.VIDEO_GOOGLE_OAUTH_CLIENT_ID_ENV_KEY?.trim() ||
      env.AG01_GOOGLE_OAUTH_CLIENT_ID_ENV_KEY?.trim(),
    clientSecretEnvKey:
      env.VIDEO_GOOGLE_OAUTH_CLIENT_SECRET_ENV_KEY?.trim() ||
      env.AG01_GOOGLE_OAUTH_CLIENT_SECRET_ENV_KEY?.trim(),
    refreshTokenEnvKey:
      env.VIDEO_GOOGLE_OAUTH_REFRESH_TOKEN_ENV_KEY?.trim() ||
      env.AG01_GOOGLE_OAUTH_REFRESH_TOKEN_ENV_KEY?.trim(),
    tokenEndpoint:
      env.VIDEO_GOOGLE_OAUTH_TOKEN_ENDPOINT?.trim() ||
      env.AG01_GOOGLE_OAUTH_TOKEN_ENDPOINT?.trim() ||
      'https://oauth2.googleapis.com/token',
  };
}
