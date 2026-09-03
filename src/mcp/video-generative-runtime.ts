import { ControlledPhotoToVideoFinalizationService } from '../creative/controlled-photo-to-video-finalization.js';
import { ControlledPhotoToVideoGenerationService } from '../creative/controlled-photo-to-video-generation.js';
import { EnvironmentSecretResolver } from '../core/secrets.js';
import { GcsPhotoToVideoArtifactStore } from '../providers/gcp/gcs-photo-to-video-artifact-store.js';
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
  const sheetsTokenEnvKey = env.GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY?.trim();
  const driveTokenEnvKey =
    env.GOOGLE_DRIVE_ACCESS_TOKEN_ENV_KEY?.trim() || sheetsTokenEnvKey;
  const openAiApiKeyEnvKey = env.OPENAI_API_KEY_ENV_KEY?.trim() || 'OPENAI_API_KEY';
  return Boolean(
    sheetsTokenEnvKey &&
      driveTokenEnvKey &&
      env.GCP_PROJECT_ID?.trim() &&
      env.INSTAGRAM_PUBLICATION_ASSET_BUCKET?.trim() &&
      env[sheetsTokenEnvKey]?.trim() &&
      env[driveTokenEnvKey]?.trim() &&
      env[openAiApiKeyEnvKey]?.trim(),
  );
}

export function createVideoGenerativeRuntimeFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): VideoGenerativeRuntime {
  if (!videoGenerativeRuntimeConfigured(env)) {
    throw new Error('VIDEO_GENERATIVE_RUNTIME_NOT_CONFIGURED');
  }

  const secrets = new EnvironmentSecretResolver(env);
  const sheetsTokenEnvKey = requiredEnv(env, 'GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY');
  const driveTokenEnvKey =
    env.GOOGLE_DRIVE_ACCESS_TOKEN_ENV_KEY?.trim() || sheetsTokenEnvKey;
  const openAiApiKeyEnvKey = env.OPENAI_API_KEY_ENV_KEY?.trim() || 'OPENAI_API_KEY';
  const openAiVideoModel = parseVideoModel(env.OPENAI_VIDEO_MODEL?.trim());
  const gcpProjectId = requiredEnv(env, 'GCP_PROJECT_ID');
  const artifactBucket = requiredEnv(env, 'INSTAGRAM_PUBLICATION_ASSET_BUCKET');
  const sheets = new GoogleSheetsRestClient(secrets, {
    tokenReference: { provider: 'env', key: sheetsTokenEnvKey },
  });
  const policyGuard = new GoogleSheetsPhotoToVideoParentPolicyGuard(sheets);
  const registry = new GoogleSheetsPhotoToVideoRegistry(sheets);
  const writeback = new GoogleSheetsPhotoToVideoContentWriteback(sheets);
  const artifactStore = new GcsPhotoToVideoArtifactStore({
    projectId: gcpProjectId,
    bucketName: artifactBucket,
  });
  const sourceLoader = new GoogleDriveCreativeVideoSourceLoader({
    secretResolver: secrets,
    accessTokenReference: { provider: 'env', key: driveTokenEnvKey },
  });
  const brandLoader = new GoogleDriveCreativeTruthBrandAssetLoader({
    secretResolver: secrets,
    accessTokenReference: { provider: 'env', key: driveTokenEnvKey },
  });
  const generation = new ControlledPhotoToVideoGenerationService({
    policyGuard,
    registry,
    writeback,
    artifactStore,
    sourceLoader,
    brandLoader,
    photoMotionComposer: new LocalPhotoMotionVideoComposer(),
    sceneContinuationProvider: new OpenAiSceneContinuationVideoProvider({
      secretResolver: secrets,
      apiKeyReference: { provider: 'env', key: openAiApiKeyEnvKey },
      ...(openAiVideoModel ? { model: openAiVideoModel } : {}),
    }),
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

function parseVideoModel(value: string | undefined): 'sora-2' | 'sora-2-pro' | undefined {
  if (!value) return undefined;
  if (value === 'sora-2' || value === 'sora-2-pro') return value;
  throw new Error('OPENAI_VIDEO_MODEL_UNSUPPORTED');
}

function requiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`VIDEO_GENERATIVE_ENV_REQUIRED:${key}`);
  return value;
}
