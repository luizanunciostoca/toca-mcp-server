import { PhotoEnhancementRuntimeService } from './creative/photo-enhancement-runtime.js';
import {
  GcpGoogleWorkspaceTokenResolver,
  GOOGLE_DRIVE_READONLY_SCOPE,
  GOOGLE_WORKSPACE_SCOPED_TOKEN_PROVIDER,
} from './providers/gcp/google-workspace-token-resolver.js';
import { GcsPhotoEnhancementArtifactStore } from './providers/gcp/gcs-photo-enhancement-artifact-store.js';
import { GoogleDrivePhotoSourceLoader } from './providers/google-drive/photo-source-loader.js';
import { LocalPhotoEnhancer } from './providers/local/local-photo-enhancer.js';

interface SmokeArgs {
  readonly contentItemId: string;
  readonly sourceAssetId: string;
  readonly sourceDriveFileId: string;
  readonly correlationId: string;
}

const args = parseArgs(process.argv.slice(2));
const projectId = requiredEnv('GCP_PROJECT_ID');
const bucketName = requiredEnv('INSTAGRAM_PUBLICATION_ASSET_BUCKET');
const serviceAccountEmail =
  process.env.TOCA_CREATIVE_GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim() ||
  requiredEnv('INSTAGRAM_ENGAGEMENT_GOOGLE_SERVICE_ACCOUNT_EMAIL');
const tokenResolver = new GcpGoogleWorkspaceTokenResolver({
  serviceAccountEmail,
  scopes: [GOOGLE_DRIVE_READONLY_SCOPE],
});
const runtime = new PhotoEnhancementRuntimeService({
  sourceLoader: new GoogleDrivePhotoSourceLoader({
    secretResolver: tokenResolver,
    accessTokenReference: {
      provider: GOOGLE_WORKSPACE_SCOPED_TOKEN_PROVIDER,
      key: 'drive-readonly',
    },
  }),
  enhancer: new LocalPhotoEnhancer(),
  artifactStore: new GcsPhotoEnhancementArtifactStore({ projectId, bucketName }),
});

const result = await runtime.enhance(args);
process.stdout.write(`${JSON.stringify(result)}\n`);

function parseArgs(values: readonly string[]): SmokeArgs {
  const parsed = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag?.startsWith('--') || !value?.trim()) {
      throw new Error('PHOTO_ENHANCEMENT_SMOKE_ARGS_INVALID');
    }
    parsed.set(flag.slice(2), value.trim());
  }
  return {
    contentItemId: requiredArg(parsed, 'content-item-id'),
    sourceAssetId: requiredArg(parsed, 'source-asset-id'),
    sourceDriveFileId: requiredArg(parsed, 'source-drive-file-id'),
    correlationId: requiredArg(parsed, 'correlation-id'),
  };
}

function requiredArg(values: ReadonlyMap<string, string>, key: string): string {
  const value = values.get(key)?.trim();
  if (!value) throw new Error(`PHOTO_ENHANCEMENT_SMOKE_ARG_REQUIRED:${key}`);
  return value;
}

function requiredEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`PHOTO_ENHANCEMENT_SMOKE_ENV_REQUIRED:${key}`);
  return value;
}
