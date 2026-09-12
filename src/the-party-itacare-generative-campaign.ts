import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { spawn } from 'node:child_process';
import {
  THE_PARTY_ITACARE_GENERATIVE_CAMPAIGN_ID,
  THE_PARTY_ITACARE_GENERATIVE_SCENE_COUNT,
  THE_PARTY_ITACARE_GENERATIVE_VIDEOS,
  type ItacareGenerativeVideoSpec,
} from './config/the-party-itacare-generative-campaign.js';
import type { PhotoToVideoRouteType } from './contracts/photo-to-video.js';
import { createVideoGenerativeRuntimeFromEnvironment } from './mcp/video-generative-runtime.js';
import { GcsPhotoToVideoArtifactStore } from './providers/gcp/gcs-photo-to-video-artifact-store.js';
import { GcsPublicationAssetDelivery } from './providers/gcp/gcs-publication-asset-delivery.js';

const FINAL_ARTIFACT_ROUTE = 'GENERATIVE_SCENE_CONTINUATION_VIDEO' as const;
const outputRoot =
  process.env.CAMPAIGN_OUTPUT_DIR?.trim() || join(tmpdir(), 'the-party-itacare-generative-campaign');
const concurrency = positiveInteger(process.env.CAMPAIGN_GENERATION_CONCURRENCY, 2);
const selectedVideoIds = new Set(
  (process.env.CAMPAIGN_VIDEO_IDS ?? '')
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean),
);
const videos = THE_PARTY_ITACARE_GENERATIVE_VIDEOS.filter(
  (video) => selectedVideoIds.size === 0 || selectedVideoIds.has(video.id),
);
if (videos.length === 0) throw new Error('ITACARE_CAMPAIGN_NO_VIDEO_SELECTED');

const gcpProjectId = requiredEnv('GCP_PROJECT_ID');
const artifactBucket = requiredEnv('INSTAGRAM_PUBLICATION_ASSET_BUCKET');
const runtime = createVideoGenerativeRuntimeFromEnvironment(process.env);
const artifactStore = new GcsPhotoToVideoArtifactStore({
  projectId: gcpProjectId,
  bucketName: artifactBucket,
});
const delivery = new GcsPublicationAssetDelivery({
  projectId: gcpProjectId,
  bucketName: artifactBucket,
  signedUrlTtlSeconds: 60 * 60,
});

await mkdir(outputRoot, { recursive: true });
const sceneSpecs = videos.flatMap((video) => video.scenes.map((scene) => ({ video, scene })));

const generatedScenes = await mapWithConcurrency(sceneSpecs, concurrency, async ({ video, scene }) => {
  const result = await runtime.generation.generate({
    contentItemId: scene.contentItemId,
    routeType: scene.routeType,
    ...(scene.routeType === 'GENERATIVE_SCENE_CONTINUATION_VIDEO'
      ? { creativeDirection: requiredCreativeDirection(scene.contentItemId, scene.creativeDirection) }
      : {}),
  });
  const sceneDir = join(outputRoot, video.id.toLowerCase());
  await mkdir(sceneDir, { recursive: true });
  const path = join(sceneDir, `${scene.contentItemId}.mp4`);
  await writeFile(path, result.outputBytes);
  const observed = sha256(result.outputBytes);
  if (observed !== result.manifest.outputSha256.toLowerCase()) {
    throw new Error(`ITACARE_CAMPAIGN_SCENE_HASH_MISMATCH:${scene.contentItemId}`);
  }
  if (result.manifest.routeType !== scene.routeType) {
    throw new Error(`ITACARE_CAMPAIGN_SCENE_ROUTE_MISMATCH:${scene.contentItemId}`);
  }
  await writeFile(`${path}.manifest.json`, `${JSON.stringify(result.manifest, null, 2)}\n`, 'utf8');
  return {
    videoId: video.id,
    contentItemId: scene.contentItemId,
    routeType: scene.routeType,
    sourceAssetId: result.manifest.sourceAssetId,
    sourceDriveFileId: result.manifest.sourceDriveFileId,
    sourceSha256: result.manifest.sourceSha256,
    path,
    sha256: observed,
    artifactRef: result.manifest.artifactRef,
    artifactObjectName: result.manifest.artifactObjectName,
    provider: result.manifest.provider,
    providerModel: result.manifest.providerModel ?? null,
    providerJobId: result.manifest.providerJobId ?? null,
    status: result.manifest.status,
  };
});

const finals = [];
for (const video of videos) {
  const sceneRows = video.scenes.map((scene) => {
    const found = generatedScenes.find((candidate) => candidate.contentItemId === scene.contentItemId);
    if (!found) throw new Error(`ITACARE_CAMPAIGN_SCENE_MISSING:${scene.contentItemId}`);
    return found;
  });
  const videoDir = join(outputRoot, video.id.toLowerCase());
  const finalPath = join(videoDir, `${video.finalContentItemId}.mp4`);
  await assembleVideo(
    sceneRows.map((scene) => scene.path),
    finalPath,
    video.targetSeconds,
  );
  const bytes = new Uint8Array(await readFile(finalPath));
  const finalSha256 = sha256(bytes);
  const stored = await artifactStore.store({
    contentItemId: video.finalContentItemId,
    routeType: FINAL_ARTIFACT_ROUTE,
    bytes,
    expectedSha256: finalSha256,
  });
  const deliveryUrl = await delivery.createVerifiedDeliveryUrl(
    stored.objectName,
    finalSha256,
    'video/mp4',
  );
  const manifest = buildFinalManifest(video, sceneRows, {
    outputSha256: finalSha256,
    artifactRef: stored.artifactRef,
    artifactObjectName: stored.objectName,
    sizeBytes: stored.sizeBytes,
    deliveryUrl,
  });
  const manifestPath = `${finalPath}.manifest.json`;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  finals.push({
    id: video.id,
    title: video.title,
    finalContentItemId: video.finalContentItemId,
    targetSeconds: video.targetSeconds,
    outputSha256: finalSha256,
    artifactRef: stored.artifactRef,
    artifactObjectName: stored.objectName,
    deliveryUrl,
    outputPath: finalPath,
    manifestPath,
    outputFileName: basename(finalPath),
    manifestFileName: basename(manifestPath),
    publicationAuthorized: false,
    reviewRequired: true,
  });
}

const result = {
  schemaVersion: 1,
  campaignId: THE_PARTY_ITACARE_GENERATIVE_CAMPAIGN_ID,
  status: 'GENERATED_REVIEW_REQUIRED',
  requestedVideoIds: videos.map((video) => video.id),
  requestedVideoCount: videos.length,
  configuredVideoCount: THE_PARTY_ITACARE_GENERATIVE_VIDEOS.length,
  configuredSceneCount: THE_PARTY_ITACARE_GENERATIVE_SCENE_COUNT,
  generatedSceneCount: generatedScenes.length,
  generatedVideoCount: finals.length,
  sceneRoutes: [...new Set(generatedScenes.map((scene) => scene.routeType))],
  publicationAuthorized: false,
  requiresPostGenerationHumanReview: true,
  videos: finals,
};
await writeFile(join(outputRoot, 'campaign-result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
process.stdout.write(`THE_PARTY_ITACARE_GENERATIVE_CAMPAIGN_RESULT=${JSON.stringify(result)}\n`);

function buildFinalManifest(
  video: ItacareGenerativeVideoSpec,
  sceneRows: readonly {
    readonly contentItemId: string;
    readonly routeType: PhotoToVideoRouteType;
    readonly sourceAssetId: string;
    readonly sourceDriveFileId: string;
    readonly sourceSha256: string;
    readonly sha256: string;
    readonly artifactRef: string;
    readonly artifactObjectName: string;
    readonly provider: string;
    readonly providerModel: string | null;
    readonly providerJobId: string | null;
  }[],
  output: {
    readonly outputSha256: string;
    readonly artifactRef: string;
    readonly artifactObjectName: string;
    readonly sizeBytes: number;
    readonly deliveryUrl: string;
  },
): object {
  return {
    schemaVersion: 1,
    campaignId: THE_PARTY_ITACARE_GENERATIVE_CAMPAIGN_ID,
    videoId: video.id,
    title: video.title,
    intent: video.intent,
    finalContentItemId: video.finalContentItemId,
    routeType: 'MIXED_GOVERNED_VIDEO_ASSEMBLY',
    targetSeconds: video.targetSeconds,
    assembly: 'FFMPEG_CONCAT_REENCODE_NO_AUDIO_V1',
    sourceScenes: sceneRows,
    output,
    requiresPostGenerationHumanReview: true,
    requiresSceneContinuationFidelityGate: sceneRows.some(
      (scene) => scene.routeType === 'GENERATIVE_SCENE_CONTINUATION_VIDEO',
    ),
    publicationEligible: false,
    publicationAuthorized: false,
  };
}

async function assembleVideo(
  scenePaths: readonly string[],
  outputPath: string,
  targetSeconds: number,
): Promise<void> {
  if (scenePaths.length === 0) throw new Error('ITACARE_CAMPAIGN_ASSEMBLY_SCENES_REQUIRED');
  const workspace = await mkdtemp(join(tmpdir(), 'itacare-assembly-'));
  try {
    const listPath = join(workspace, 'concat.txt');
    const list = scenePaths.map((path) => `file '${escapeConcatPath(path)}'`).join('\n');
    await writeFile(listPath, `${list}\n`, 'utf8');
    await runCommand(process.env.FFMPEG_BINARY?.trim() || 'ffmpeg', [
      '-y',
      '-fflags',
      '+genpts',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      '-t',
      String(targetSeconds),
      '-vf',
      'fps=30,format=yuv420p',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '18',
      '-an',
      '-movflags',
      '+faststart',
      outputPath,
    ]);
    const bytes = new Uint8Array(await readFile(outputPath));
    if (!isMp4(bytes)) throw new Error('ITACARE_CAMPAIGN_ASSEMBLY_INVALID_MP4');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function runCommand(command: string, args: readonly string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
      if (stderr.length > 12_000) stderr = stderr.slice(-12_000);
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(
        new Error(`ITACARE_CAMPAIGN_COMMAND_FAILED:${command}:${code}:${stderr.slice(-4000)}`),
      );
    });
  });
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  limit: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= values.length) return;
      results[index] = await worker(values[index] as T);
    }
  });
  await Promise.all(runners);
  return results;
}

function requiredCreativeDirection(contentItemId: string, value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`ITACARE_CAMPAIGN_CREATIVE_DIRECTION_REQUIRED:${contentItemId}`);
  return normalized;
}

function escapeConcatPath(path: string): string {
  return path.replaceAll("'", "'\\''");
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isMp4(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp';
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function requiredEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`ITACARE_CAMPAIGN_ENV_REQUIRED:${key}`);
  return value;
}
