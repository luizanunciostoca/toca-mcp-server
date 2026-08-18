import { readFile, writeFile } from 'node:fs/promises';
import { ControlledPhotoToVideoGenerationService } from './creative/controlled-photo-to-video-generation.js';
import {
  photoToVideoRouteTypeSchema,
  type PhotoToVideoRouteType,
} from './contracts/photo-to-video.js';
import { EnvironmentSecretResolver } from './core/secrets.js';
import { GoogleDriveCreativeTruthBrandAssetLoader } from './providers/google-drive/creative-truth-brand-asset-loader.js';
import { GoogleDriveCreativeVideoSourceLoader } from './providers/google-drive/creative-video-source-loader.js';
import { GoogleSheetsRestClient } from './providers/google-sheets/client.js';
import { GoogleSheetsPhotoToVideoContentWriteback } from './providers/google-sheets/photo-to-video-content-writeback.js';
import { GoogleSheetsPhotoToVideoRegistry } from './providers/google-sheets/photo-to-video-registry.js';
import { LocalPhotoMotionVideoComposer } from './providers/local/local-photo-motion-video-composer.js';
import { LocalPhotoToVideoBrandComposer } from './providers/local/local-photo-to-video-brand-composer.js';
import { OpenAiSceneContinuationVideoProvider } from './providers/openai/openai-scene-continuation-video-provider.js';

const args = parseArgs(process.argv.slice(2));
const secrets = new EnvironmentSecretResolver(process.env);
const sheetsTokenEnvKey = requiredEnv('GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY');
const driveTokenEnvKey =
  process.env.GOOGLE_DRIVE_ACCESS_TOKEN_ENV_KEY?.trim() || sheetsTokenEnvKey;
const openAiApiKeyEnvKey = process.env.OPENAI_API_KEY_ENV_KEY?.trim() || 'OPENAI_API_KEY';
const openAiVideoModel = parseVideoModel(process.env.OPENAI_VIDEO_MODEL?.trim());
const sheets = new GoogleSheetsRestClient(secrets, {
  tokenReference: { provider: 'env', key: sheetsTokenEnvKey },
});
const registry = new GoogleSheetsPhotoToVideoRegistry(sheets);
const writeback = new GoogleSheetsPhotoToVideoContentWriteback(sheets);
const sourceLoader = new GoogleDriveCreativeVideoSourceLoader({
  secretResolver: secrets,
  accessTokenReference: { provider: 'env', key: driveTokenEnvKey },
});
const brandLoader = new GoogleDriveCreativeTruthBrandAssetLoader({
  secretResolver: secrets,
  accessTokenReference: { provider: 'env', key: driveTokenEnvKey },
});
const service = new ControlledPhotoToVideoGenerationService({
  registry,
  writeback,
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
const creativeDirection = await resolveCreativeDirection(args);
const result = await service.generate({
  contentItemId: args.contentItemId,
  routeType: args.routeType,
  ...(creativeDirection ? { creativeDirection } : {}),
});
await writeFile(args.output, result.outputBytes);
await writeFile(args.manifest, `${JSON.stringify(result.manifest, null, 2)}\n`, 'utf8');
process.stdout.write(
  `${JSON.stringify({
    status: result.manifest.status,
    contentItemId: result.manifest.contentItemId,
    productId: result.manifest.productId,
    operation: result.manifest.operation,
    routeType: result.manifest.routeType,
    standardId: result.manifest.standardId,
    sourceAssetId: result.manifest.sourceAssetId,
    sourceSha256: result.manifest.sourceSha256,
    outputSha256: result.manifest.outputSha256,
    provider: result.manifest.provider,
    providerJobId: result.manifest.providerJobId ?? null,
    outputPath: args.output,
    manifestPath: args.manifest,
    canonicalCandidateWriteback: true,
    requiresPostGenerationHumanReview: true,
    publicationEligible: false,
  })}\n`,
);

interface CliArgs {
  readonly contentItemId: string;
  readonly routeType: PhotoToVideoRouteType;
  readonly output: string;
  readonly manifest: string;
  readonly creativeDirection?: string;
  readonly creativeDirectionFile?: string;
}

async function resolveCreativeDirection(args: CliArgs): Promise<string | undefined> {
  if (args.routeType === 'REAL_PHOTO_TO_MOTION_VIDEO') return undefined;
  if (args.creativeDirection) return args.creativeDirection;
  if (!args.creativeDirectionFile) {
    throw new Error('VIDEO_GENERATE_CREATIVE_DIRECTION_REQUIRED');
  }
  const value = (await readFile(args.creativeDirectionFile, 'utf8')).trim();
  if (!value) throw new Error('VIDEO_GENERATE_CREATIVE_DIRECTION_EMPTY');
  return value;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value) throw new Error('VIDEO_GENERATE_ARGS_INVALID');
    values.set(key.slice(2), value);
  }
  if (values.has('now-iso')) throw new Error('VIDEO_GENERATE_CALLER_TIME_FORBIDDEN');
  const routeType = photoToVideoRouteTypeSchema.parse(required(values, 'route'));
  const output = required(values, 'output');
  const creativeDirection = values.get('creative-direction')?.trim();
  const creativeDirectionFile = values.get('creative-direction-file')?.trim();
  if (
    routeType === 'GENERATIVE_SCENE_CONTINUATION_VIDEO' &&
    (creativeDirection ? 1 : 0) + (creativeDirectionFile ? 1 : 0) !== 1
  ) {
    throw new Error('VIDEO_GENERATE_EXACTLY_ONE_CREATIVE_DIRECTION_SOURCE_REQUIRED');
  }
  return {
    contentItemId: required(values, 'content-item-id'),
    routeType,
    output,
    manifest: values.get('manifest')?.trim() || `${output}.manifest.json`,
    ...(creativeDirection ? { creativeDirection } : {}),
    ...(creativeDirectionFile ? { creativeDirectionFile } : {}),
  };
}

function parseVideoModel(value: string | undefined): 'sora-2' | 'sora-2-pro' | undefined {
  if (!value) return undefined;
  if (value === 'sora-2' || value === 'sora-2-pro') return value;
  throw new Error('OPENAI_VIDEO_MODEL_UNSUPPORTED');
}

function required(values: ReadonlyMap<string, string>, key: string): string {
  const value = values.get(key)?.trim();
  if (!value) throw new Error(`VIDEO_GENERATE_ARG_REQUIRED:${key}`);
  return value;
}

function requiredEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`VIDEO_GENERATE_ENV_REQUIRED:${key}`);
  return value;
}
