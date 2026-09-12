import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as systemSleep } from 'node:timers/promises';
import type { InstagramPublishRequest } from '../providers/instagram/instagram-contracts.js';
import {
  InstagramPublicationExecutor,
  type InstagramPublicationTransport,
  type PublishedMediaEvidence,
} from '../providers/instagram/instagram-publication-executor.js';
import { MetaInstagramPublicationTransport } from '../providers/instagram/meta-instagram-publication-transport.js';
import {
  GITHUB_NATIVE_PUBLICATION_TOLERANCE_MS,
  assertPublicationItemNotExpired,
  parseGithubNativePublicationQueue,
  selectDuePublicationItems,
  type GithubNativePublicationItem,
} from './github-native-publication-contracts.js';
import {
  FilePublicationExecutionStore,
  fingerprintPublicationRequest,
} from './file-publication-store.js';
import { createGithubNativeMetaClient } from './github-native-meta-client.js';

type PublicationMode = 'SHADOW' | 'CANARY' | 'LIMITED' | 'GENERAL';

type ItemEvidence = {
  readonly contentItemId: string;
  readonly scheduledAt: string;
  readonly assetSha256: string;
  readonly creativeTruthOutputSha256: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
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

type NativePublicationTransport = InstagramPublicationTransport & {
  listRecentPublishedStories?(
    instagramAccountId: string,
    limit?: number,
  ): Promise<readonly PublishedMediaEvidence[]>;
};

type RuntimeDependencies = {
  readonly now?: () => Date;
  readonly sleep?: (milliseconds: number) => Promise<unknown>;
  readonly fetch?: typeof fetch;
  readonly createTransport?: (env: NodeJS.ProcessEnv) => NativePublicationTransport;
};

const publicationAssetHost = 'raw.githubusercontent.com';

export async function runGithubNativePublicationCycle(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: RuntimeDependencies = {},
): Promise<CycleEvidence> {
  const now = dependencies.now ?? (() => new Date());
  const sleep = dependencies.sleep ?? ((milliseconds: number) => systemSleep(milliseconds));
  const fetchAsset = dependencies.fetch ?? fetch;
  const queuePath =
    env.TOCA_PUBLICATION_QUEUE_PATH?.trim() || 'control/github-native-publication-queue.json';
  const stateDirectory =
    env.TOCA_PUBLICATION_STATE_DIR?.trim() || '.publication-state-worktree/publication-state';
  const evidencePath =
    env.TOCA_PUBLICATION_EVIDENCE_PATH?.trim() || 'github-native-publication-evidence.json';
  const nowIso = now().toISOString();
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
    const request = toPublishRequest(item);
    const requestFingerprint = fingerprintPublicationRequest(request);
    const immutableEvidence = immutableItemEvidence(item, requestFingerprint);
    try {
      await waitUntilScheduled(item.scheduledAt, now, sleep);
      assertInsidePublicationWindow(item.scheduledAt, now());
      assertPublicationItemNotExpired(item, now().toISOString());
      await verifyExactAsset(item, fetchAsset);
      assertPublicationItemNotExpired(item, now().toISOString());

      if (mode === 'SHADOW') {
        evidence.push({ ...immutableEvidence, outcome: 'SHADOW_WOULD_PUBLISH' });
        continue;
      }

      if (!controllerSha) throw new Error('GITHUB_NATIVE_CONTROLLER_SHA_REQUIRED');
      if (!writesEnabled) throw new Error('GITHUB_NATIVE_PUBLICATION_WRITES_DISABLED');
      if (env.GITHUB_EVENT_NAME === 'repository_dispatch' && !manualConfirmation) {
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
      const transport =
        dependencies.createTransport?.(env) ??
        new MetaInstagramPublicationTransport(createGithubNativeMetaClient(env));
      const reserved = await store.reserve(request, now().toISOString());

      if (reserved.state === 'PUBLISHED') {
        const readback = await requirePublishedReadback(transport, reserved.externalMediaId);
        evidence.push({
          ...immutableEvidence,
          outcome: 'RECONCILED_ALREADY_PUBLISHED_READBACK_VERIFIED',
          externalMediaId: readback.mediaId,
          ...(readback.permalink ? { permalink: readback.permalink } : {}),
        });
        continue;
      }
      if (reserved.state === 'CANCELED') throw new Error('INSTAGRAM_PUBLICATION_CANCELED');

      if (reserved.state === 'DRAFT' || reserved.state === 'FAILED') {
        await assertNoUnprovenProviderDuplicate(transport, item);
      }

      assertPublicationItemNotExpired(item, now().toISOString());
      assertInsidePublicationWindow(item.scheduledAt, now());

      const executor = new InstagramPublicationExecutor(
        store,
        transport,
        () => now().toISOString(),
        true,
      );
      let result = await executor.execute(request);
      const pollDeadline = now().getTime() + 120_000;
      while (!result.completed && now().getTime() < pollDeadline) {
        await sleep(5_000);
        assertPublicationItemNotExpired(item, now().toISOString());
        assertInsidePublicationWindow(item.scheduledAt, now());
        result = await executor.execute(request);
      }
      if (!result.completed || !result.publication.externalMediaId) {
        throw new Error('GITHUB_NATIVE_PUBLICATION_PROVIDER_NOT_CONFIRMED');
      }

      const readback = await requirePublishedReadback(
        transport,
        result.publication.externalMediaId,
      );
      evidence.push({
        ...immutableEvidence,
        outcome: 'PUBLISHED_AND_READBACK_VERIFIED',
        externalMediaId: readback.mediaId,
        ...(readback.permalink ? { permalink: readback.permalink } : {}),
      });
    } catch (error) {
      evidence.push({
        ...immutableEvidence,
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

  if (evidence.some((item) => item.outcome === 'BLOCKED')) process.exitCode = 1;
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

function immutableItemEvidence(
  item: GithubNativePublicationItem,
  requestFingerprint: string,
): Omit<ItemEvidence, 'outcome' | 'externalMediaId' | 'permalink' | 'error'> {
  return {
    contentItemId: item.contentItemId,
    scheduledAt: item.scheduledAt,
    assetSha256: item.asset.sha256.toLowerCase(),
    creativeTruthOutputSha256: item.creativeTruthBinding.outputSha256.toLowerCase(),
    correlationId: item.correlationId,
    idempotencyKey: item.idempotencyKey,
    requestFingerprint,
  };
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

async function verifyExactAsset(
  item: GithubNativePublicationItem,
  fetchAsset: typeof fetch,
): Promise<void> {
  const sha = item.asset.sha256.toLowerCase();
  const url = new URL(item.asset.url);
  if (url.protocol !== 'https:') throw new Error('GITHUB_NATIVE_ASSET_HTTPS_REQUIRED');
  if (url.hostname !== publicationAssetHost) {
    throw new Error('GITHUB_NATIVE_ASSET_STAGING_HOST_REQUIRED');
  }
  if (!url.pathname.endsWith(`/publication-assets/publication-assets/${sha}.jpg`)) {
    throw new Error('GITHUB_NATIVE_ASSET_URL_NOT_CONTENT_ADDRESSED');
  }

  const response = await fetchAsset(url, { redirect: 'manual' });
  if (response.status >= 300 && response.status < 400) {
    throw new Error('GITHUB_NATIVE_ASSET_REDIRECT_DENIED');
  }
  if (!response.ok) throw new Error(`GITHUB_NATIVE_ASSET_FETCH_FAILED:${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw new Error('GITHUB_NATIVE_ASSET_NOT_JPEG');
  }
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== sha) throw new Error('GITHUB_NATIVE_ASSET_SHA256_MISMATCH');
  if (item.creativeTruthBinding.outputSha256.toLowerCase() !== actual) {
    throw new Error('GITHUB_NATIVE_CREATIVE_TRUTH_HASH_MISMATCH');
  }
}

async function assertNoUnprovenProviderDuplicate(
  transport: NativePublicationTransport,
  item: GithubNativePublicationItem,
): Promise<void> {
  const candidates =
    item.mediaType === 'STORY'
      ? await requireStoryList(transport, item.instagramAccountId)
      : await requireMediaList(transport, item.instagramAccountId);
  const matches = candidates.filter((candidate) => candidateMatchesTimeAndCaption(candidate, item));
  if (matches.length > 0) {
    throw new Error('GITHUB_NATIVE_RECONCILIATION_ASSET_IDENTITY_UNPROVEN');
  }
}

async function requireMediaList(
  transport: NativePublicationTransport,
  instagramAccountId: string,
): Promise<readonly PublishedMediaEvidence[]> {
  if (!transport.listRecentPublishedMedia) {
    throw new Error('GITHUB_NATIVE_PUBLICATION_RECONCILIATION_UNAVAILABLE');
  }
  return transport.listRecentPublishedMedia(instagramAccountId, 25);
}

async function requireStoryList(
  transport: NativePublicationTransport,
  instagramAccountId: string,
): Promise<readonly PublishedMediaEvidence[]> {
  if (!transport.listRecentPublishedStories) {
    throw new Error('GITHUB_NATIVE_STORY_RECONCILIATION_UNAVAILABLE');
  }
  return transport.listRecentPublishedStories(instagramAccountId, 25);
}

function candidateMatchesTimeAndCaption(
  candidate: PublishedMediaEvidence,
  item: GithubNativePublicationItem,
): boolean {
  if (!candidate.timestamp) return false;
  const providerAt = Date.parse(candidate.timestamp);
  const scheduledAt = Date.parse(item.scheduledAt);
  if (
    !Number.isFinite(providerAt) ||
    Math.abs(providerAt - scheduledAt) > GITHUB_NATIVE_PUBLICATION_TOLERANCE_MS
  ) {
    return false;
  }
  if (item.mediaType === 'IMAGE' && candidate.mediaType !== 'IMAGE') return false;
  if (
    item.mediaType === 'IMAGE' &&
    normalizeCaption(candidate.caption) !== normalizeCaption(item.caption)
  ) {
    return false;
  }
  return true;
}

async function requirePublishedReadback(
  transport: NativePublicationTransport,
  externalMediaId: string | undefined,
): Promise<PublishedMediaEvidence> {
  if (!externalMediaId) throw new Error('GITHUB_NATIVE_PUBLICATION_MEDIA_ID_REQUIRED');
  if (!transport.getPublishedMedia)
    throw new Error('GITHUB_NATIVE_PUBLICATION_READBACK_UNAVAILABLE');
  const readback = await transport.getPublishedMedia(externalMediaId);
  if (readback.mediaId !== externalMediaId) {
    throw new Error('GITHUB_NATIVE_PUBLICATION_READBACK_ID_MISMATCH');
  }
  return readback;
}

async function waitUntilScheduled(
  scheduledAt: string,
  now: () => Date,
  sleep: (milliseconds: number) => Promise<unknown>,
): Promise<void> {
  const scheduled = Date.parse(scheduledAt);
  const current = now().getTime();
  if (!Number.isFinite(scheduled) || !Number.isFinite(current)) {
    throw new Error('GITHUB_NATIVE_PUBLICATION_TIME_INVALID');
  }
  const waitMs = scheduled - current;
  if (waitMs > 0) await sleep(Math.min(waitMs, GITHUB_NATIVE_PUBLICATION_TOLERANCE_MS));
}

function assertInsidePublicationWindow(scheduledAt: string, current: Date): void {
  const delta = current.getTime() - Date.parse(scheduledAt);
  if (!Number.isFinite(delta) || Math.abs(delta) > GITHUB_NATIVE_PUBLICATION_TOLERANCE_MS) {
    throw new Error('GITHUB_NATIVE_PUBLICATION_OUTSIDE_TOLERANCE_WINDOW');
  }
}

function normalizeCaption(value: string | undefined): string {
  return (value ?? '').replace(/\r\n/g, '\n').trim();
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
