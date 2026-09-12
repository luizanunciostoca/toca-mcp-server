import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import type { InstagramPublishRequest } from '../providers/instagram/instagram-contracts.js';
import { InstagramPublicationExecutor } from '../providers/instagram/instagram-publication-executor.js';
import { InstagramPublicationReconciler } from '../providers/instagram/instagram-publication-reconciler.js';
import { MetaInstagramPublicationTransport } from '../providers/instagram/meta-instagram-publication-transport.js';
import {
  GITHUB_NATIVE_PUBLICATION_TOLERANCE_MS,
  parseGithubNativePublicationQueue,
  selectDuePublicationItems,
  type GithubNativePublicationItem,
} from './github-native-publication-contracts.js';
import { FilePublicationExecutionStore } from './file-publication-store.js';
import { createGithubNativeMetaClient } from './github-native-meta-client.js';

type PublicationMode = 'SHADOW' | 'CANARY' | 'LIMITED' | 'GENERAL';

type ItemEvidence = {
  readonly contentItemId: string;
  readonly scheduledAt: string;
  readonly outcome: string;
  readonly externalMediaId?: string;
  readonly permalink?: string;
  readonly error?: string;
};

type CycleEvidence = {
  readonly schemaVersion: 1;
  readonly runAt: string;
  readonly mode: PublicationMode;
  readonly writesEnabled: boolean;
  readonly queuePath: string;
  readonly stateDirectory: string;
  readonly controllerSha?: string;
  readonly workflowRunId?: string;
  readonly workflowRunAttempt?: string;
  readonly items: readonly ItemEvidence[];
};

const deniedAssetHosts = new Set(['storage.googleapis.com', 'storage.cloud.google.com']);

export async function runGithubNativePublicationCycle(
  env: NodeJS.ProcessEnv = process.env,
): Promise<CycleEvidence> {
  const queuePath = env.TOCA_PUBLICATION_QUEUE_PATH?.trim() || 'control/github-native-publication-queue.json';
  const stateDirectory =
    env.TOCA_PUBLICATION_STATE_DIR?.trim() || '.publication-state-worktree/publication-state';
  const evidencePath =
    env.TOCA_PUBLICATION_EVIDENCE_PATH?.trim() || 'github-native-publication-evidence.json';
  const nowOverride = env.TOCA_PUBLICATION_NOW?.trim();
  const nowIso = nowOverride || new Date().toISOString();
  const mode = parseMode(env.TOCA_GITHUB_NATIVE_PUBLICATION_MODE);
  const writesEnabled = env.TOCA_GITHUB_NATIVE_PUBLICATION_WRITES_ENABLED === 'true';
  const controllerSha = env.TOCA_GITHUB_NATIVE_CONTROLLER_SHA?.trim();
  const manualConfirmation = env.TOCA_GITHUB_NATIVE_MANUAL_WRITE_CONFIRMATION === 'true';
  const queue = parseGithubNativePublicationQueue(JSON.parse(await readFile(queuePath, 'utf8')));
  const due = selectDuePublicationItems(queue, nowIso);
  const evidence: ItemEvidence[] = [];

  if (controllerSha && !/^[a-f0-9]{40}$/i.test(controllerSha)) {
    throw new Error('GITHUB_NATIVE_CONTROLLER_SHA_INVALID');
  }

  for (const item of due) {
    try {
      await waitUntilScheduled(item.scheduledAt, nowIso, Boolean(nowOverride));
      assertInsidePublicationWindow(item.scheduledAt, Boolean(nowOverride));
      await verifyExactAsset(item);

      if (mode === 'SHADOW') {
        evidence.push({
          contentItemId: item.contentItemId,
          scheduledAt: item.scheduledAt,
          outcome: 'SHADOW_WOULD_PUBLISH',
        });
        continue;
      }

      if (!controllerSha) throw new Error('GITHUB_NATIVE_CONTROLLER_SHA_REQUIRED');
      if (!writesEnabled) throw new Error('GITHUB_NATIVE_PUBLICATION_WRITES_DISABLED');
      if (env.GITHUB_EVENT_NAME === 'workflow_dispatch' && !manualConfirmation) {
        throw new Error('GITHUB_NATIVE_MANUAL_WRITE_CONFIRMATION_REQUIRED');
      }
      if (mode === 'CANARY') {
        const canary = env.TOCA_GITHUB_NATIVE_CANARY_CONTENT_ITEM_ID?.trim();
        if (!canary || canary !== item.contentItemId) {
          throw new Error('GITHUB_NATIVE_CANARY_CONTENT_ITEM_MISMATCH');
        }
      }

      const configuredAccount = env.INSTAGRAM_BUSINESS_ACCOUNT_ID?.trim();
      if (!configuredAccount || configuredAccount !== item.instagramAccountId) {
        throw new Error('GITHUB_NATIVE_INSTAGRAM_ACCOUNT_MISMATCH');
      }

      const store = new FilePublicationExecutionStore(stateDirectory);
      const transport = new MetaInstagramPublicationTransport(createGithubNativeMetaClient(env));
      const request = toPublishRequest(item);
      const reconciler = new InstagramPublicationReconciler(store, transport);
      const reconciled = await reconciler.reconcile(request, {
        scheduledFor: item.scheduledAt,
        mediaType: item.mediaType,
        ...(item.caption !== undefined ? { caption: item.caption } : {}),
        toleranceMs: GITHUB_NATIVE_PUBLICATION_TOLERANCE_MS,
      });

      if (reconciled?.completed) {
        evidence.push({
          contentItemId: item.contentItemId,
          scheduledAt: item.scheduledAt,
          outcome: 'RECONCILED_ALREADY_PUBLISHED',
          ...(reconciled.publication.externalMediaId
            ? { externalMediaId: reconciled.publication.externalMediaId }
            : {}),
          ...(reconciled.publication.permalink
            ? { permalink: reconciled.publication.permalink }
            : {}),
        });
        continue;
      }

      const executor = new InstagramPublicationExecutor(store, transport, undefined, true);
      let result = await executor.execute(request);
      const deadline = Date.now() + 120_000;
      while (!result.completed && Date.now() < deadline) {
        await sleep(5_000);
        result = await executor.execute(request);
      }
      if (!result.completed || !result.publication.externalMediaId) {
        throw new Error('GITHUB_NATIVE_PUBLICATION_PROVIDER_NOT_CONFIRMED');
      }

      const readback = await transport.getPublishedMedia(result.publication.externalMediaId);
      if (readback.mediaId !== result.publication.externalMediaId) {
        throw new Error('GITHUB_NATIVE_PUBLICATION_READBACK_ID_MISMATCH');
      }

      evidence.push({
        contentItemId: item.contentItemId,
        scheduledAt: item.scheduledAt,
        outcome: 'PUBLISHED_AND_READBACK_VERIFIED',
        externalMediaId: readback.mediaId,
        ...(readback.permalink ? { permalink: readback.permalink } : {}),
      });
    } catch (error) {
      evidence.push({
        contentItemId: item.contentItemId,
        scheduledAt: item.scheduledAt,
        outcome: 'BLOCKED',
        error: normalizeError(error),
      });
    }
  }

  const cycle: CycleEvidence = {
    schemaVersion: 1,
    runAt: nowIso,
    mode,
    writesEnabled,
    queuePath,
    stateDirectory,
    ...(controllerSha ? { controllerSha } : {}),
    ...(env.TOCA_GITHUB_NATIVE_WORKFLOW_RUN_ID
      ? { workflowRunId: env.TOCA_GITHUB_NATIVE_WORKFLOW_RUN_ID }
      : {}),
    ...(env.TOCA_GITHUB_NATIVE_WORKFLOW_RUN_ATTEMPT
      ? { workflowRunAttempt: env.TOCA_GITHUB_NATIVE_WORKFLOW_RUN_ATTEMPT }
      : {}),
    items: evidence,
  };
  await writeFile(evidencePath, `${JSON.stringify(cycle, null, 2)}\n`, 'utf8');

  if (evidence.some((item) => item.outcome === 'BLOCKED')) {
    process.exitCode = 1;
  }
  return cycle;
}

function parseMode(value: string | undefined): PublicationMode {
  const normalized = value?.trim() || 'SHADOW';
  if (
    normalized !== 'SHADOW' &&
    normalized !== 'CANARY' &&
    normalized !== 'LIMITED' &&
    normalized !== 'GENERAL'
  ) {
    throw new Error('GITHUB_NATIVE_PUBLICATION_MODE_INVALID');
  }
  return normalized;
}

function toPublishRequest(item: GithubNativePublicationItem): InstagramPublishRequest {
  return {
    account: {
      pageId: item.pageId ?? 'GITHUB_NATIVE_DIRECT',
      instagramAccountId: item.instagramAccountId,
    },
    mediaType: item.mediaType,
    mediaUrls: [item.asset.url],
    ...(item.caption !== undefined ? { caption: item.caption } : {}),
    correlationId: item.correlationId,
    idempotencyKey: item.idempotencyKey,
    creativeTruthBinding: item.creativeTruthBinding,
    publicationAssetSha256: item.asset.sha256.toLowerCase(),
  };
}

async function verifyExactAsset(item: GithubNativePublicationItem): Promise<void> {
  const url = new URL(item.asset.url);
  if (url.protocol !== 'https:') throw new Error('GITHUB_NATIVE_ASSET_HTTPS_REQUIRED');
  if (deniedAssetHosts.has(url.hostname) || url.hostname.endsWith('.run.app')) {
    throw new Error('GITHUB_NATIVE_GCP_ASSET_HOST_DENIED');
  }
  if (!url.pathname.toLowerCase().includes(item.asset.sha256.toLowerCase())) {
    throw new Error('GITHUB_NATIVE_ASSET_URL_NOT_CONTENT_ADDRESSED');
  }

  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`GITHUB_NATIVE_ASSET_FETCH_FAILED:${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw new Error('GITHUB_NATIVE_ASSET_NOT_JPEG');
  }
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== item.asset.sha256.toLowerCase()) {
    throw new Error('GITHUB_NATIVE_ASSET_SHA256_MISMATCH');
  }
  if (item.creativeTruthBinding.outputSha256.toLowerCase() !== actual) {
    throw new Error('GITHUB_NATIVE_CREATIVE_TRUTH_HASH_MISMATCH');
  }
}

async function waitUntilScheduled(
  scheduledAt: string,
  initialNowIso: string,
  hasNowOverride: boolean,
): Promise<void> {
  if (hasNowOverride) return;
  const scheduled = Date.parse(scheduledAt);
  const initial = Date.parse(initialNowIso);
  if (!Number.isFinite(scheduled) || !Number.isFinite(initial)) {
    throw new Error('GITHUB_NATIVE_PUBLICATION_TIME_INVALID');
  }
  const waitMs = scheduled - Date.now();
  if (waitMs > 0) await sleep(Math.min(waitMs, GITHUB_NATIVE_PUBLICATION_TOLERANCE_MS));
}

function assertInsidePublicationWindow(scheduledAt: string, hasNowOverride: boolean): void {
  if (hasNowOverride) return;
  const delta = Date.now() - Date.parse(scheduledAt);
  if (!Number.isFinite(delta) || Math.abs(delta) > GITHUB_NATIVE_PUBLICATION_TOLERANCE_MS) {
    throw new Error('GITHUB_NATIVE_PUBLICATION_OUTSIDE_TOLERANCE_WINDOW');
  }
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : 'UNKNOWN_GITHUB_NATIVE_PUBLICATION_ERROR';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runGithubNativePublicationCycle().catch((error: unknown) => {
    console.error(normalizeError(error));
    process.exitCode = 1;
  });
}
