import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  InstagramPublicationTransport,
  PublishedMediaEvidence,
} from '../src/providers/instagram/instagram-publication-executor.js';
import { runGithubNativePublicationCycle } from '../src/github-native-publication/github-native-publication-runtime.js';

const directories: string[] = [];
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const sha256 = createHash('sha256').update(jpeg).digest('hex');
const controllerSha = 'b'.repeat(40);

type TestTransport = InstagramPublicationTransport & {
  listRecentPublishedStories?(
    instagramAccountId: string,
    limit?: number,
  ): Promise<readonly PublishedMediaEvidence[]>;
};

type TransportFixture = {
  readonly transport: TestTransport;
  readonly createContainer: ReturnType<typeof vi.fn>;
  readonly getContainerStatus: ReturnType<typeof vi.fn>;
  readonly publishContainer: ReturnType<typeof vi.fn>;
  readonly getPublishedMedia: ReturnType<typeof vi.fn>;
  readonly listRecentPublishedMedia: ReturnType<typeof vi.fn>;
  readonly listRecentPublishedStories: ReturnType<typeof vi.fn>;
};

async function workspace(overrides: Record<string, unknown> = {}): Promise<{
  readonly root: string;
  readonly queuePath: string;
  readonly stateDirectory: string;
  readonly evidencePath: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'toca-github-native-runtime-'));
  directories.push(root);
  const queuePath = join(root, 'queue.json');
  const stateDirectory = join(root, 'state');
  const evidencePath = join(root, 'evidence.json');
  await writeFile(
    queuePath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        timezone: 'America/Bahia',
        generatedAt: '2026-09-12T08:55:00-03:00',
        items: [publicationItem(overrides)],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return { root, queuePath, stateDirectory, evidencePath };
}

function publicationItem(overrides: Record<string, unknown> = {}) {
  return {
    contentItemId: 'MKT-20260912-SUNSET-FEED-0900',
    scheduledAt: '2026-09-12T09:00:00-03:00',
    expiresAt: '2026-09-12T09:05:00-03:00',
    operation: 'SUNSET',
    channel: 'INSTAGRAM',
    contentStatus: 'PRODUCED',
    approvalStatus: 'APPROVED',
    publicationIntent: 'SCHEDULED',
    mediaType: 'IMAGE',
    instagramAccountId: 'ig-account',
    pageId: 'page',
    caption: 'Teste',
    asset: {
      url: `https://raw.githubusercontent.com/luizanunciostoca/toca-mcp-server/publication-assets/publication-assets/${sha256}.jpg`,
      contentType: 'image/jpeg',
      sha256,
    },
    correlationId: 'corr-1',
    idempotencyKey: 'idemp-1',
    creativeTruthBinding: {
      policyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
      standardId: 'SUNSET_FEED_IMAGE_V1',
      creativeId: 'CR-1',
      outputSha256: sha256,
      brandIntegrityStatus: 'PASSED',
      venueFidelityStatus: 'PASSED',
      qualityGateStatus: 'PASSED',
      exactAssetBinding: true,
    },
    ...overrides,
  };
}

function envFor(paths: Awaited<ReturnType<typeof workspace>>): NodeJS.ProcessEnv {
  return {
    TOCA_PUBLICATION_QUEUE_PATH: paths.queuePath,
    TOCA_PUBLICATION_STATE_DIR: paths.stateDirectory,
    TOCA_PUBLICATION_EVIDENCE_PATH: paths.evidencePath,
    TOCA_GITHUB_NATIVE_PUBLICATION_MODE: 'CANARY',
    TOCA_GITHUB_NATIVE_PUBLICATION_WRITES_ENABLED: 'true',
    TOCA_GITHUB_NATIVE_MANUAL_WRITE_CONFIRMATION: 'true',
    TOCA_GITHUB_NATIVE_CANARY_CONTENT_ITEM_ID: 'MKT-20260912-SUNSET-FEED-0900',
    TOCA_GITHUB_NATIVE_CONTROLLER_SHA: controllerSha,
    INSTAGRAM_BUSINESS_ACCOUNT_ID: 'ig-account',
    GITHUB_EVENT_NAME: 'repository_dispatch',
  };
}

function okAssetFetch() {
  return vi.fn(() => Promise.resolve(new Response(jpeg, { status: 200 }))) as unknown as typeof fetch;
}

function transport(overrides: Partial<TestTransport> = {}): TransportFixture {
  const createContainer = vi.fn(() => Promise.resolve({ containerId: 'container-1' }));
  const getContainerStatus = vi.fn(() => Promise.resolve('FINISHED' as const));
  const publishContainer = vi.fn(() => Promise.resolve({ mediaId: 'media-1' }));
  const getPublishedMedia = vi.fn((mediaId: string) =>
    Promise.resolve({
      mediaId,
      mediaType: 'IMAGE',
      permalink: `https://www.instagram.com/p/${mediaId}/`,
      timestamp: '2026-09-12T12:00:01Z',
    }),
  );
  const listRecentPublishedMedia = vi.fn(() => Promise.resolve([] as readonly PublishedMediaEvidence[]));
  const listRecentPublishedStories = vi.fn(() => Promise.resolve([] as readonly PublishedMediaEvidence[]));
  return {
    transport: {
      createContainer,
      getContainerStatus,
      publishContainer,
      getPublishedMedia,
      listRecentPublishedMedia,
      listRecentPublishedStories,
      ...overrides,
    },
    createContainer,
    getContainerStatus,
    publishContainer,
    getPublishedMedia,
    listRecentPublishedMedia,
    listRecentPublishedStories,
  };
}

afterEach(async () => {
  process.exitCode = undefined;
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
  vi.restoreAllMocks();
});

describe('GitHub-native publication runtime', () => {
  it('publishes one canary and records immutable binding evidence after provider readback', async () => {
    const paths = await workspace();
    const provider = transport();
    const now = () => new Date('2026-09-12T12:00:00Z');

    const cycle = await runGithubNativePublicationCycle(envFor(paths), {
      now,
      fetch: okAssetFetch(),
      createTransport: () => provider.transport,
    });

    expect(provider.publishContainer).toHaveBeenCalledTimes(1);
    expect(provider.getPublishedMedia).toHaveBeenCalledTimes(2);
    expect(cycle.items[0]).toMatchObject({
      contentItemId: 'MKT-20260912-SUNSET-FEED-0900',
      assetSha256: sha256,
      creativeTruthOutputSha256: sha256,
      correlationId: 'corr-1',
      idempotencyKey: 'idemp-1',
      outcome: 'PUBLISHED_AND_READBACK_VERIFIED',
      externalMediaId: 'media-1',
    });
    expect(cycle.items[0]?.requestFingerprint).toMatch(/^[a-f0-9]{64}$/);

    const persisted = JSON.parse(await readFile(paths.evidencePath, 'utf8')) as {
      items: Array<Record<string, unknown>>;
    };
    expect(persisted.items[0]?.assetSha256).toBe(sha256);
  });

  it('requires a fresh provider readback for an already-published local record and never republishes it', async () => {
    const paths = await workspace();
    const provider = transport();
    const now = () => new Date('2026-09-12T12:00:00Z');
    const dependencies = {
      now,
      fetch: okAssetFetch(),
      createTransport: () => provider.transport,
    };

    await runGithubNativePublicationCycle(envFor(paths), dependencies);
    const firstReadbackCount = provider.getPublishedMedia.mock.calls.length;
    const second = await runGithubNativePublicationCycle(envFor(paths), dependencies);

    expect(provider.publishContainer).toHaveBeenCalledTimes(1);
    expect(provider.getPublishedMedia.mock.calls.length).toBe(firstReadbackCount + 1);
    expect(second.items[0]?.outcome).toBe('RECONCILED_ALREADY_PUBLISHED_READBACK_VERIFIED');
  });

  it('fails closed when provider media near the slot cannot be proven to be the exact approved asset', async () => {
    const paths = await workspace();
    const listRecentPublishedMedia = vi.fn(() =>
      Promise.resolve([
        {
          mediaId: 'existing-media',
          mediaType: 'IMAGE',
          caption: 'Teste',
          timestamp: '2026-09-12T12:00:30Z',
        },
      ]),
    );
    const provider = transport({ listRecentPublishedMedia });

    const cycle = await runGithubNativePublicationCycle(envFor(paths), {
      now: () => new Date('2026-09-12T12:00:00Z'),
      fetch: okAssetFetch(),
      createTransport: () => provider.transport,
    });

    expect(provider.createContainer).not.toHaveBeenCalled();
    expect(provider.publishContainer).not.toHaveBeenCalled();
    expect(cycle.items[0]).toMatchObject({
      outcome: 'BLOCKED',
      error: 'GITHUB_NATIVE_RECONCILIATION_ASSET_IDENTITY_UNPROVEN',
    });
  });

  it('uses the dedicated Stories readback path before a Story write', async () => {
    const paths = await workspace({ mediaType: 'STORY', caption: undefined });
    const listStories = vi.fn(() => Promise.resolve([] as readonly PublishedMediaEvidence[]));
    const listMedia = vi.fn(() => Promise.reject(new Error('MEDIA_COLLECTION_MUST_NOT_BE_USED_FOR_STORY')));
    const storyReadback = vi.fn((mediaId: string) =>
      Promise.resolve({
        mediaId,
        mediaType: 'IMAGE',
        timestamp: '2026-09-12T12:00:01Z',
      }),
    );
    const provider = transport({
      listRecentPublishedMedia: listMedia,
      listRecentPublishedStories: listStories,
      getPublishedMedia: storyReadback,
    });

    const cycle = await runGithubNativePublicationCycle(envFor(paths), {
      now: () => new Date('2026-09-12T12:00:00Z'),
      fetch: okAssetFetch(),
      createTransport: () => provider.transport,
    });

    expect(listStories).toHaveBeenCalledTimes(1);
    expect(listMedia).not.toHaveBeenCalled();
    expect(cycle.items[0]?.outcome).toBe('PUBLISHED_AND_READBACK_VERIFIED');
  });

  it('blocks redirects from the content-addressed publication asset URL', async () => {
    const paths = await workspace();
    const providerFactory = vi.fn(() => transport().transport);
    const redirectingFetch = vi.fn(() =>
      Promise.resolve(
        new Response(null, { status: 302, headers: { location: 'https://example.com/x' } }),
      ),
    ) as unknown as typeof fetch;

    const cycle = await runGithubNativePublicationCycle(envFor(paths), {
      now: () => new Date('2026-09-12T12:00:00Z'),
      fetch: redirectingFetch,
      createTransport: providerFactory,
    });

    expect(providerFactory).not.toHaveBeenCalled();
    expect(cycle.items[0]).toMatchObject({
      outcome: 'BLOCKED',
      error: 'GITHUB_NATIVE_ASSET_REDIRECT_DENIED',
    });
  });

  it('rechecks expiry after asset verification and blocks before provider side effects', async () => {
    const paths = await workspace({ expiresAt: '2026-09-12T09:00:10-03:00' });
    let current = Date.parse('2026-09-12T12:00:00Z');
    const providerFactory = vi.fn(() => transport().transport);
    const delayedFetch = vi.fn(() => {
      current += 20_000;
      return Promise.resolve(new Response(jpeg, { status: 200 }));
    }) as unknown as typeof fetch;

    const cycle = await runGithubNativePublicationCycle(envFor(paths), {
      now: () => new Date(current),
      fetch: delayedFetch,
      createTransport: providerFactory,
    });

    expect(providerFactory).not.toHaveBeenCalled();
    expect(cycle.items[0]).toMatchObject({
      outcome: 'BLOCKED',
      error: 'GITHUB_NATIVE_PUBLICATION_EXPIRED',
    });
  });

  it('validates exact asset bytes in SHADOW without constructing a provider client', async () => {
    const paths = await workspace();
    const providerFactory = vi.fn(() => transport().transport);
    const shadowEnv = {
      ...envFor(paths),
      TOCA_GITHUB_NATIVE_PUBLICATION_MODE: 'SHADOW',
      TOCA_GITHUB_NATIVE_PUBLICATION_WRITES_ENABLED: 'false',
    };

    const cycle = await runGithubNativePublicationCycle(shadowEnv, {
      now: () => new Date('2026-09-12T12:00:00Z'),
      fetch: okAssetFetch(),
      createTransport: providerFactory,
    });

    expect(providerFactory).not.toHaveBeenCalled();
    expect(cycle.items[0]).toMatchObject({
      outcome: 'SHADOW_WOULD_PUBLISH',
      assetSha256: sha256,
      creativeTruthOutputSha256: sha256,
    });
  });
});
