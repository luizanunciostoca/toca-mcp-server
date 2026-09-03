import { ControlledPhotoToVideoFinalizationService } from '../creative/controlled-photo-to-video-finalization.js';
import { ControlledPhotoToVideoGenerationService } from '../creative/controlled-photo-to-video-generation.js';
import {
  EnvironmentSecretResolver,
  type SecretReference,
  type SecretResolver,
} from '../core/secrets.js';
import { GoogleOAuthRefreshSecretResolver } from '../orchestrator/google-oauth-secret-resolver.js';
import { GcsPhotoToVideoArtifactStore } from '../providers/gcp/gcs-photo-to-video-artifact-store.js';
import { GoogleMetadataAccessTokenResolver } from '../providers/gcp/google-metadata-access-token-resolver.js';
import { GoogleServiceIdentityOAuthResolver } from '../providers/gcp/google-service-identity-oauth-resolver.js';
import { VertexVeoSceneContinuationVideoProvider } from '../providers/gcp/vertex-veo-scene-continuation-video-provider.js';
import { GoogleDriveCreativeTruthBrandAssetLoader } from '../providers/google-drive/creative-truth-brand-asset-loader.js';
import { GoogleDriveCreativeVideoSourceLoader } from '../providers/google-drive/creative-video-source-loader.js';
import { GoogleSheetsRestClient } from '../providers/google-sheets/client.js';
import { GoogleSheetsPhotoToVideoContentWriteback } from '../providers/google-sheets/photo-to-video-content-writeback.js';
import { GoogleSheetsPhotoToVideoParentPolicyGuard } from '../providers/google-sheets/photo-to-video-policy-guard.js';
import { GoogleSheetsPhotoToVideoRegistry } from '../providers/google-sheets/photo-to-video-registry.js';
import { LocalGeneratedVideoPostProcessor } from '../providers/local/local-generated-video-postprocessor.js';
import { LocalPhotoMotionVideoComposer } from '../providers/local/local-photo-motion-video-composer.js';
import { LocalPhotoToVideoBrandComposer } from '../providers/local/local-photo-to-video-brand-composer.js';
import { OpenAiSceneContinuationVideoProvider } from '../providers/openai/openai-scene-continuation-video-provider.js';

export interface VideoGenerativeRuntime {
  readonly generation: ControlledPhotoToVideoGenerationService;
  readonly finalization: ControlledPhotoToVideoFinalizationService;
  readonly postProcessor: LocalGeneratedVideoPostProcessor;
}

export type VideoGenerativeRuntimeResolver = () => VideoGenerativeRuntime;
type SceneContinuationProviderId = 'OPENAI_VIDEO_API' | 'GOOGLE_VERTEX_VEO';

interface GoogleAccessBinding {
  readonly resolver: SecretResolver;
  readonly sheetsTokenReference: SecretReference;
  readonly driveTokenReference: SecretReference;
}

export function createLazyVideoGenerativeRuntimeResolver(
  env: NodeJS.ProcessEnv = process.env,
): VideoGenerativeRuntimeResolver {
  let runtime: VideoGenerativeRuntime | undefined;
  return () => {
    runtime ??= createVideoGenerativeRuntimeFromEnvironment(env);
    return runtime;
  };
}

export function videoGenerativeRuntimeConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  if (
    !env.GCP_PROJECT_ID?.trim() ||
    !env.INSTAGRAM_PUBLICATION_ASSET_BUCKET?.trim() ||
    !googleAccessConfigured(env)
  ) {
    return false;
  }
  const provider = resolveSceneContinuationProviderId(env);
  if (provider === 'GOOGLE_VERTEX_VEO') return true;
  const openAiApiKeyEnvKey = resolveOpenAiApiKeyEnvKey(env);
  return Boolean(env[openAiApiKeyEnvKey]?.trim());
}

export function createVideoGenerativeRuntimeFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): VideoGenerativeRuntime {
  if (!videoGenerativeRuntimeConfigured(env)) {
    throw new Error('VIDEO_GENERATIVE_RUNTIME_NOT_CONFIGURED');
  }

  const secrets = new EnvironmentSecretResolver(env);
  const google = resolveGoogleAccessBinding(env, secrets);
  const gcpProjectId = requiredEnv(env, 'GCP_PROJECT_ID');
  const artifactBucket = requiredEnv(env, 'INSTAGRAM_PUBLICATION_ASSET_BUCKET');
  const sheets = new GoogleSheetsRestClient(google.resolver, {
    tokenReference: google.sheetsTokenReference,
  });
  const policyGuard = new GoogleSheetsPhotoToVideoParentPolicyGuard(sheets);
  const registry = new GoogleSheetsPhotoToVideoRegistry(sheets);
  const writeback = new GoogleSheetsPhotoToVideoContentWriteback(sheets);
  const artifactStore = new GcsPhotoToVideoArtifactStore({
    projectId: gcpProjectId,
    bucketName: artifactBucket,
  });
  const sourceLoader = new GoogleDriveCreativeVideoSourceLoader({
    secretResolver: google.resolver,
    accessTokenReference: google.driveTokenReference,
  });
  const brandLoader = new GoogleDriveCreativeTruthBrandAssetLoader({
    secretResolver: google.resolver,
    accessTokenReference: google.driveTokenReference,
  });
  const sceneContinuationProvider = createSceneContinuationProvider(env, {
    secrets,
    gcpProjectId,
    artifactBucket,
  });
  const generation = new ControlledPhotoToVideoGenerationService({
    policyGuard,
    registry,
    writeback,
    artifactStore,
    sourceLoader,
    brandLoader,
    photoMotionComposer: new LocalPhotoMotionVideoComposer(),
    sceneContinuationProvider,
    brandComposer: new LocalPhotoToVideoBrandComposer(),
  });
  const finalization = new ControlledPhotoToVideoFinalizationService({
    policyGuard,
    registry,
    writeback,
    artifactStore,
    sourceLoader,
    brandLoader,
  });

  return {
    generation,
    finalization,
    postProcessor: new LocalGeneratedVideoPostProcessor(),
  };
}

function createSceneContinuationProvider(
  env: NodeJS.ProcessEnv,
  input: {
    readonly secrets: EnvironmentSecretResolver;
    readonly gcpProjectId: string;
    readonly artifactBucket: string;
  },
) {
  const provider = resolveSceneContinuationProviderId(env);
  if (provider === 'GOOGLE_VERTEX_VEO') {
    const cloudIdentity = new GoogleMetadataAccessTokenResolver();
    return new VertexVeoSceneContinuationVideoProvider({
      projectId: input.gcpProjectId,
      artifactBucket: input.artifactBucket,
      accessTokenResolver: cloudIdentity,
      accessTokenReference: { provider: 'gcp-metadata-oauth', key: 'cloud-platform' },
      location: env.VERTEX_VEO_LOCATION?.trim() || 'us-central1',
      model: parseVertexVeoModel(env.VERTEX_VEO_MODEL?.trim()),
    });
  }

  const openAiApiKeyEnvKey = resolveOpenAiApiKeyEnvKey(env);
  const openAiVideoModel = parseOpenAiVideoModel(env.OPENAI_VIDEO_MODEL?.trim());
  return new OpenAiSceneContinuationVideoProvider({
    secretResolver: input.secrets,
    apiKeyReference: { provider: 'env', key: openAiApiKeyEnvKey },
    ...(openAiVideoModel ? { model: openAiVideoModel } : {}),
  });
}

function googleAccessConfigured(env: NodeJS.ProcessEnv): boolean {
  if (env.VIDEO_GOOGLE_AUTH_MODE?.trim().toUpperCase() === 'GCP_SERVICE_IDENTITY') return true;

  const sheetsTokenEnvKey = env.GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY?.trim();
  const driveTokenEnvKey = env.GOOGLE_DRIVE_ACCESS_TOKEN_ENV_KEY?.trim() || sheetsTokenEnvKey;
  if (
    sheetsTokenEnvKey &&
    driveTokenEnvKey &&
    env[sheetsTokenEnvKey]?.trim() &&
    env[driveTokenEnvKey]?.trim()
  ) {
    return true;
  }

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

function resolveGoogleAccessBinding(
  env: NodeJS.ProcessEnv,
  secrets: EnvironmentSecretResolver,
): GoogleAccessBinding {
  if (env.VIDEO_GOOGLE_AUTH_MODE?.trim().toUpperCase() === 'GCP_SERVICE_IDENTITY') {
    const resolver = new GoogleServiceIdentityOAuthResolver();
    const tokenReference = {
      provider: 'gcp-service-identity-oauth',
      key: 'video-workspace',
    } as const;
    return {
      resolver,
      sheetsTokenReference: tokenReference,
      driveTokenReference: tokenReference,
    };
  }

  const sheetsTokenEnvKey = env.GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY?.trim();
  const driveTokenEnvKey = env.GOOGLE_DRIVE_ACCESS_TOKEN_ENV_KEY?.trim() || sheetsTokenEnvKey;
  if (
    sheetsTokenEnvKey &&
    driveTokenEnvKey &&
    env[sheetsTokenEnvKey]?.trim() &&
    env[driveTokenEnvKey]?.trim()
  ) {
    return {
      resolver: secrets,
      sheetsTokenReference: { provider: 'env', key: sheetsTokenEnvKey },
      driveTokenReference: { provider: 'env', key: driveTokenEnvKey },
    };
  }

  const oauth = googleOAuthConfig(env);
  if (!oauth.clientIdEnvKey || !oauth.clientSecretEnvKey || !oauth.refreshTokenEnvKey) {
    throw new Error('VIDEO_GENERATIVE_GOOGLE_AUTH_NOT_CONFIGURED');
  }
  const resolver = new GoogleOAuthRefreshSecretResolver({
    clientIdReference: { provider: 'env', key: oauth.clientIdEnvKey },
    clientSecretReference: { provider: 'env', key: oauth.clientSecretEnvKey },
    refreshTokenReference: { provider: 'env', key: oauth.refreshTokenEnvKey },
    secrets,
    tokenEndpoint: oauth.tokenEndpoint,
  });
  const tokenReference = { provider: 'google-oauth', key: 'sheets-readonly' } as const;
  return {
    resolver,
    sheetsTokenReference: tokenReference,
    driveTokenReference: tokenReference,
  };
}

function resolveSceneContinuationProviderId(env: NodeJS.ProcessEnv): SceneContinuationProviderId {
  const value = env.VIDEO_SCENE_CONTINUATION_PROVIDER?.trim().toUpperCase();
  if (!value || value === 'OPENAI_VIDEO_API') return 'OPENAI_VIDEO_API';
  if (value === 'GOOGLE_VERTEX_VEO') return 'GOOGLE_VERTEX_VEO';
  throw new Error('VIDEO_SCENE_CONTINUATION_PROVIDER_UNSUPPORTED');
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

function resolveOpenAiApiKeyEnvKey(env: NodeJS.ProcessEnv): string {
  const explicit = env.OPENAI_API_KEY_ENV_KEY?.trim() || env.AG01_OPENAI_API_KEY_ENV_KEY?.trim();
  if (explicit) return explicit;
  if (
    env.AG01_MODEL_PROVIDER?.trim().toLowerCase() === 'openai' &&
    env.AG01_MODEL_API_KEY_ENV_KEY?.trim()
  ) {
    return env.AG01_MODEL_API_KEY_ENV_KEY.trim();
  }
  return 'OPENAI_API_KEY';
}

function parseOpenAiVideoModel(value: string | undefined): 'sora-2' | 'sora-2-pro' | undefined {
  if (!value) return undefined;
  if (value === 'sora-2' || value === 'sora-2-pro') return value;
  throw new Error('OPENAI_VIDEO_MODEL_UNSUPPORTED');
}

function parseVertexVeoModel(
  value: string | undefined,
): 'veo-3.1-generate-001' | 'veo-3.1-fast-generate-001' | undefined {
  if (!value) return undefined;
  if (value === 'veo-3.1-generate-001' || value === 'veo-3.1-fast-generate-001') return value;
  throw new Error('VERTEX_VEO_MODEL_UNSUPPORTED');
}

function requiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`VIDEO_GENERATIVE_ENV_REQUIRED:${key}`);
  return value;
}
