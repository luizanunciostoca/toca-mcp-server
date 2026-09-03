import { readFile, writeFile } from 'node:fs/promises';
import {
  photoToVideoRouteTypeSchema,
  type PhotoToVideoRouteType,
} from './contracts/photo-to-video.js';
import { createVideoGenerativeRuntimeFromEnvironment } from './mcp/video-generative-runtime.js';

const args = parseArgs(process.argv.slice(2));
const runtime = createVideoGenerativeRuntimeFromEnvironment(process.env);
const creativeDirection = await resolveCreativeDirection(args);
const result = await runtime.generation.generate({
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
    artifactRef: result.manifest.artifactRef,
    artifactObjectName: result.manifest.artifactObjectName,
    provider: result.manifest.provider,
    providerJobId: result.manifest.providerJobId ?? null,
    providerModel: result.manifest.providerModel ?? null,
    outputPath: args.output,
    manifestPath: args.manifest,
    canonicalParentPolicyChecked: true,
    canonicalCandidateWriteback: true,
    durableArtifactPersisted: true,
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

function required(values: ReadonlyMap<string, string>, key: string): string {
  const value = values.get(key)?.trim();
  if (!value) throw new Error(`VIDEO_GENERATE_ARG_REQUIRED:${key}`);
  return value;
}
