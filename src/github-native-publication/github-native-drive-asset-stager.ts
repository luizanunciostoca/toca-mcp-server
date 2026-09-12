import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  parseGithubNativePublicationQueue,
  type GithubNativePublicationItem,
} from './github-native-publication-contracts.js';

type StageOutcome = 'STAGED' | 'ALREADY_STAGED' | 'BLOCKED';

type AssetStageEvidence = {
  readonly contentItemId: string;
  readonly sourceDriveFileId?: string;
  readonly assetSha256: string;
  readonly outcome: StageOutcome;
  readonly effectiveSourceHost?: string;
  readonly error?: string;
};

type AssetStageCycleEvidence = {
  readonly schemaVersion: 1;
  readonly runAt: string;
  readonly queuePath: string;
  readonly assetDirectory: string;
  readonly controllerSha?: string;
  readonly workflowRunId?: string;
  readonly items: readonly AssetStageEvidence[];
};

type StagerDependencies = {
  readonly now?: () => Date;
  readonly fetch?: typeof fetch;
};

const maxAssetBytes = 25 * 1024 * 1024;
const driveDownloadHost = 'drive.usercontent.google.com';

export async function stageGithubNativeDriveAssets(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: StagerDependencies = {},
): Promise<AssetStageCycleEvidence> {
  const now = dependencies.now ?? (() => new Date());
  const fetchSource = dependencies.fetch ?? fetch;
  const queuePath =
    env.TOCA_PUBLICATION_QUEUE_PATH?.trim() || 'control/github-native-publication-queue.json';
  const assetDirectory =
    env.TOCA_PUBLICATION_ASSET_DIR?.trim() || '.publication-assets-worktree/publication-assets';
  const evidencePath =
    env.TOCA_PUBLICATION_ASSET_STAGING_EVIDENCE_PATH?.trim() ||
    'github-native-asset-staging-evidence.json';
  const controllerSha = env.TOCA_GITHUB_NATIVE_CONTROLLER_SHA?.trim();

  if (controllerSha && !/^[a-f0-9]{40}$/i.test(controllerSha)) {
    throw new Error('GITHUB_NATIVE_CONTROLLER_SHA_INVALID');
  }

  const queue = parseGithubNativePublicationQueue(JSON.parse(await readFile(queuePath, 'utf8')));
  const evidence: AssetStageEvidence[] = [];

  await mkdir(assetDirectory, { recursive: true });

  for (const item of queue.items) {
    const immutable = immutableEvidence(item);
    try {
      const sourceDriveFileId = item.asset.sourceDriveFileId;
      if (!sourceDriveFileId) {
        throw new Error('GITHUB_NATIVE_ASSET_SOURCE_DRIVE_ID_REQUIRED');
      }
      if (
        item.creativeTruthBinding.outputSha256.toLowerCase() !== item.asset.sha256.toLowerCase()
      ) {
        throw new Error('GITHUB_NATIVE_CREATIVE_TRUTH_HASH_MISMATCH');
      }

      const targetPath = join(assetDirectory, `${item.asset.sha256.toLowerCase()}.jpg`);
      const existing = await readExistingAsset(targetPath);
      if (existing) {
        assertExactJpeg(existing, item.asset.sha256);
        evidence.push({ ...immutable, outcome: 'ALREADY_STAGED' });
        continue;
      }

      const sourceUrl = driveDownloadUrl(sourceDriveFileId);
      const response = await fetchSource(sourceUrl, { redirect: 'follow' });
      if (!response.ok) {
        throw new Error(`GITHUB_NATIVE_DRIVE_ASSET_FETCH_FAILED:${response.status}`);
      }
      const effectiveUrl = new URL(response.url || sourceUrl);
      assertAllowedDriveUrl(effectiveUrl);

      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > maxAssetBytes) throw new Error('GITHUB_NATIVE_ASSET_TOO_LARGE');
      assertExactJpeg(bytes, item.asset.sha256);

      await writeFile(targetPath, bytes);
      await writeFile(
        join(assetDirectory, `${item.asset.sha256.toLowerCase()}.json`),
        `${JSON.stringify(
          {
            schemaVersion: 1,
            contentItemId: item.contentItemId,
            sourceDriveFileId,
            sha256: item.asset.sha256.toLowerCase(),
            contentType: 'image/jpeg',
            stagedAt: now().toISOString(),
            ...(controllerSha ? { controllerSha } : {}),
            ...(env.TOCA_GITHUB_NATIVE_WORKFLOW_RUN_ID
              ? { workflowRunId: env.TOCA_GITHUB_NATIVE_WORKFLOW_RUN_ID }
              : {}),
            effectiveSourceHost: effectiveUrl.hostname.toLowerCase(),
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      evidence.push({
        ...immutable,
        outcome: 'STAGED',
        effectiveSourceHost: effectiveUrl.hostname.toLowerCase(),
      });
    } catch (error) {
      evidence.push({
        ...immutable,
        outcome: 'BLOCKED',
        error: normalizeError(error),
      });
    }
  }

  const cycle: AssetStageCycleEvidence = {
    schemaVersion: 1,
    runAt: now().toISOString(),
    queuePath,
    assetDirectory,
    ...(controllerSha ? { controllerSha } : {}),
    ...(env.TOCA_GITHUB_NATIVE_WORKFLOW_RUN_ID
      ? { workflowRunId: env.TOCA_GITHUB_NATIVE_WORKFLOW_RUN_ID }
      : {}),
    items: evidence,
  };
  await writeFile(evidencePath, `${JSON.stringify(cycle, null, 2)}\n`, 'utf8');

  if (evidence.some((item) => item.outcome === 'BLOCKED')) process.exitCode = 1;
  return cycle;
}

function immutableEvidence(
  item: GithubNativePublicationItem,
): Omit<AssetStageEvidence, 'outcome' | 'effectiveSourceHost' | 'error'> {
  return {
    contentItemId: item.contentItemId,
    ...(item.asset.sourceDriveFileId ? { sourceDriveFileId: item.asset.sourceDriveFileId } : {}),
    assetSha256: item.asset.sha256.toLowerCase(),
  };
}

function driveDownloadUrl(fileId: string): string {
  const url = new URL(`https://${driveDownloadHost}/download`);
  url.searchParams.set('id', fileId);
  url.searchParams.set('export', 'download');
  url.searchParams.set('confirm', 't');
  return url.toString();
}

function assertAllowedDriveUrl(url: URL): void {
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:') throw new Error('GITHUB_NATIVE_DRIVE_ASSET_HTTPS_REQUIRED');
  if (
    host !== 'drive.google.com' &&
    host !== driveDownloadHost &&
    host !== 'googleusercontent.com' &&
    !host.endsWith('.googleusercontent.com')
  ) {
    throw new Error('GITHUB_NATIVE_DRIVE_ASSET_REDIRECT_TARGET_DENIED');
  }
}

function assertExactJpeg(bytes: Buffer, expectedSha256: string): void {
  if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw new Error('GITHUB_NATIVE_ASSET_NOT_JPEG');
  }
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expectedSha256.toLowerCase()) {
    throw new Error('GITHUB_NATIVE_ASSET_SHA256_MISMATCH');
  }
}

async function readExistingAsset(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : 'UNKNOWN_GITHUB_NATIVE_ASSET_STAGING_ERROR';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  stageGithubNativeDriveAssets().catch((error: unknown) => {
    console.error(normalizeError(error));
    process.exitCode = 1;
  });
}
