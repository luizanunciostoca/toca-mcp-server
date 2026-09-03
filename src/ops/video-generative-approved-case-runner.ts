import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as z from 'zod/v4';
import { EnvironmentSecretResolver } from '../core/secrets.js';
import { createVideoGenerativeRuntimeFromEnvironment } from '../mcp/video-generative-runtime.js';
import { GcsPublicationAssetStager } from '../providers/gcp/gcs-publication-asset-stager.js';
import { GoogleSheetsRestClient } from '../providers/google-sheets/client.js';
import { PHOTO_TO_VIDEO_CONTENT_REGISTRY_ID } from '../providers/google-sheets/photo-to-video-registry.js';

const commandSchema = z.object({
  schemaVersion: z.literal(1),
  action: z.literal('GENERATE'),
  commandId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
  contentItemId: z.string().trim().min(1).max(256),
  sourceAssetId: z.string().trim().min(1).max(128),
  expectedSourceSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  routeType: z.literal('GENERATIVE_SCENE_CONTINUATION_VIDEO'),
  overlayDriveFileId: z.string().regex(/^[A-Za-z0-9_-]{10,128}$/),
  derivativeSeconds: z.literal(5),
  creativeDirection: z.string().trim().min(1).max(16_000),
  approvalRef: z.string().trim().min(1).max(512),
});

const commandPath = process.env.VIDEO_GENERATIVE_COMMAND_PATH?.trim() ||
  'control/video-generative-command.json';
const command = commandSchema.parse(JSON.parse(await readFile(commandPath, 'utf8')));
const googleTokenEnvKey = requiredEnv('GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY');
const googleToken = requiredEnv(googleTokenEnvKey);
const secrets = new EnvironmentSecretResolver(process.env);
const sheets = new GoogleSheetsRestClient(secrets, {
  tokenReference: { provider: 'env', key: googleTokenEnvKey },
});

await assertNoExistingCandidate(sheets, command.contentItemId);

const runtime = createVideoGenerativeRuntimeFromEnvironment(process.env);
const generated = await runtime.generation.generate({
  contentItemId: command.contentItemId,
  routeType: command.routeType,
  creativeDirection: command.creativeDirection,
});

if (
  generated.manifest.sourceAssetId !== command.sourceAssetId ||
  generated.manifest.sourceSha256.toLowerCase() !== command.expectedSourceSha256.toLowerCase()
) {
  throw new Error('VIDEO_GENERATIVE_COMMAND_SOURCE_BINDING_MISMATCH');
}

const trimmed = await runtime.postProcessor.trim({
  videoBytes: generated.outputBytes,
  startSeconds: 0,
  durationSeconds: command.derivativeSeconds,
});
const overlayBytes = await downloadDriveFile(command.overlayDriveFileId, googleToken);
const approval = await runtime.postProcessor.overlayStaticGraphics({
  videoBytes: trimmed.outputBytes,
  overlayPngBytes: overlayBytes,
});

const workspace = await mkdtemp(join(tmpdir(), 'toca-video-generative-smoke-'));
try {
  const approvalPath = join(workspace, 'approval-5s.mp4');
  await writeFile(approvalPath, approval.outputBytes);
  const stager = new GcsPublicationAssetStager({
    projectId: requiredEnv('GCP_PROJECT_ID'),
    bucketName: requiredEnv('INSTAGRAM_PUBLICATION_ASSET_BUCKET'),
    signedUrlTtlSeconds: 6 * 60 * 60,
  });
  const staged = await stager.stage({
    assetId: `video-gen-${command.sourceAssetId}-5s`,
    correlationId: 'video-generative-approval',
    sourcePath: approvalPath,
    contentType: 'video/mp4',
  });

  process.stdout.write(
    `TOCA_VIDEO_GENERATIVE_RESULT=${JSON.stringify({
      status: 'GENERATED_APPROVAL_DERIVATIVE',
      commandId: command.commandId,
      contentItemId: command.contentItemId,
      sourceAssetId: command.sourceAssetId,
      approvalRef: command.approvalRef,
      candidate: {
        outputSha256: generated.manifest.outputSha256,
        artifactRef: generated.manifest.artifactRef,
        provider: generated.manifest.provider,
        providerJobId: generated.manifest.providerJobId ?? null,
        providerModel: generated.manifest.providerModel ?? null,
        seconds: generated.manifest.seconds,
        size: generated.manifest.size,
        publicationEligible: false,
      },
      derivative: {
        seconds: command.derivativeSeconds,
        outputSha256: staged.sha256,
        objectName: staged.objectName,
        signedUrl: staged.publicUrl,
        signedUrlTtlSeconds: 6 * 60 * 60,
        overlayDriveFileId: command.overlayDriveFileId,
      },
      requiresHumanReview: true,
      publicationAuthorized: false,
    })}\n`,
  );
} finally {
  await rm(workspace, { recursive: true, force: true });
}

async function assertNoExistingCandidate(
  client: GoogleSheetsRestClient,
  contentItemId: string,
): Promise<void> {
  const rows = await client.readRange(
    PHOTO_TO_VIDEO_CONTENT_REGISTRY_ID,
    'CONTENT_ITEMS!A1:CH1000',
  );
  if (rows.length === 0) throw new Error('VIDEO_GENERATIVE_CONTENT_REGISTRY_EMPTY');
  const headers = new Map<string, number>();
  for (const [index, value] of (rows[0] ?? []).entries()) {
    headers.set(String(value ?? '').trim(), index);
  }
  const idIndex = requiredHeader(headers, 'content_item_id');
  const candidateIndex = requiredHeader(headers, 'video_candidate_sha256');
  const matches = rows.slice(1).filter((row) => String(row[idIndex] ?? '').trim() === contentItemId);
  if (matches.length !== 1) throw new Error('VIDEO_GENERATIVE_CONTENT_ITEM_NOT_RESOLVED');
  if (String(matches[0]?.[candidateIndex] ?? '').trim()) {
    throw new Error('VIDEO_GENERATIVE_CANDIDATE_ALREADY_EXISTS');
  }
}

async function downloadDriveFile(fileId: string, token: string): Promise<Uint8Array> {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set('alt', 'media');
  url.searchParams.set('supportsAllDrives', 'true');
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`VIDEO_GENERATIVE_OVERLAY_DOWNLOAD_FAILED:${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error('VIDEO_GENERATIVE_OVERLAY_DOWNLOAD_EMPTY');
  return bytes;
}

function requiredHeader(headers: ReadonlyMap<string, number>, name: string): number {
  const index = headers.get(name);
  if (index === undefined) throw new Error(`VIDEO_GENERATIVE_CONTENT_COLUMN_MISSING:${name}`);
  return index;
}

function requiredEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`VIDEO_GENERATIVE_PROVIDER_SMOKE_ENV_REQUIRED:${key}`);
  return value;
}
