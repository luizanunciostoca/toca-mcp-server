import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stageGithubNativeDriveAssets } from '../src/github-native-publication/github-native-drive-asset-stager.js';

const directories: string[] = [];
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const sha256 = createHash('sha256').update(jpeg).digest('hex');

async function workspace(overrides: Record<string, unknown> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'toca-drive-stager-'));
  directories.push(root);
  const queuePath = join(root, 'queue.json');
  const assetDirectory = join(root, 'assets');
  const evidencePath = join(root, 'evidence.json');
  await writeFile(
    queuePath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        timezone: 'America/Bahia',
        generatedAt: '2026-09-12T08:00:00-03:00',
        items: [
          {
            contentItemId: 'MKT-20260912-SUNSET-FEED-0900',
            scheduledAt: '2026-09-12T09:00:00-03:00',
            operation: 'SUNSET',
            channel: 'INSTAGRAM',
            contentStatus: 'PRODUCED',
            approvalStatus: 'APPROVED',
            publicationIntent: 'SCHEDULED',
            mediaType: 'IMAGE',
            instagramAccountId: 'ig-account',
            caption: 'Teste',
            asset: {
              url: `https://raw.githubusercontent.com/example/repo/publication-assets/publication-assets/${sha256}.jpg`,
              contentType: 'image/jpeg',
              sha256,
              sourceDriveFileId: '1-P3RdbWi_X4H1_X5L_xrLiY2UA3cte1o',
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
          },
        ],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return { root, queuePath, assetDirectory, evidencePath };
}

function envFor(paths: Awaited<ReturnType<typeof workspace>>): NodeJS.ProcessEnv {
  return {
    TOCA_PUBLICATION_QUEUE_PATH: paths.queuePath,
    TOCA_PUBLICATION_ASSET_DIR: paths.assetDirectory,
    TOCA_PUBLICATION_ASSET_STAGING_EVIDENCE_PATH: paths.evidencePath,
    TOCA_GITHUB_NATIVE_CONTROLLER_SHA: 'c'.repeat(40),
    TOCA_GITHUB_NATIVE_WORKFLOW_RUN_ID: '12345',
  };
}

function fetchResponse(bytes: Buffer, url = 'https://drive.usercontent.google.com/download') {
  const response = new Response(new Uint8Array(bytes), { status: 200 });
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

afterEach(async () => {
  process.exitCode = undefined;
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
  vi.restoreAllMocks();
});

describe('GitHub-native Drive asset stager', () => {
  it('stages exact approved JPEG bytes and records immutable evidence', async () => {
    const paths = await workspace();
    const fetchSource = vi.fn(() => Promise.resolve(fetchResponse(jpeg)));

    const cycle = await stageGithubNativeDriveAssets(envFor(paths), { fetch: fetchSource });

    expect(cycle.items[0]).toMatchObject({
      contentItemId: 'MKT-20260912-SUNSET-FEED-0900',
      assetSha256: sha256,
      outcome: 'STAGED',
      effectiveSourceHost: 'drive.usercontent.google.com',
    });
    expect(await readFile(join(paths.assetDirectory, `${sha256}.jpg`))).toEqual(jpeg);
    expect(fetchSource).toHaveBeenCalledTimes(1);
  });

  it('does not download again when identical bytes are already staged', async () => {
    const paths = await workspace();
    await import('node:fs/promises').then(({ mkdir }) => mkdir(paths.assetDirectory, { recursive: true }));
    await writeFile(join(paths.assetDirectory, `${sha256}.jpg`), jpeg);
    const fetchSource = vi.fn(() => Promise.reject(new Error('FETCH_MUST_NOT_RUN')));

    const cycle = await stageGithubNativeDriveAssets(envFor(paths), { fetch: fetchSource });

    expect(fetchSource).not.toHaveBeenCalled();
    expect(cycle.items[0]?.outcome).toBe('ALREADY_STAGED');
  });

  it('blocks when downloaded bytes do not match the approved hash', async () => {
    const paths = await workspace();
    const other = Buffer.from([0xff, 0xd8, 0xff, 0x00]);

    const cycle = await stageGithubNativeDriveAssets(envFor(paths), {
      fetch: vi.fn(() => Promise.resolve(fetchResponse(other))),
    });

    expect(cycle.items[0]).toMatchObject({
      outcome: 'BLOCKED',
      error: 'GITHUB_NATIVE_ASSET_SHA256_MISMATCH',
    });
  });

  it('blocks a final redirect host outside the Google Drive allowlist', async () => {
    const paths = await workspace();

    const cycle = await stageGithubNativeDriveAssets(envFor(paths), {
      fetch: vi.fn(() => Promise.resolve(fetchResponse(jpeg, 'https://example.com/asset.jpg'))),
    });

    expect(cycle.items[0]).toMatchObject({
      outcome: 'BLOCKED',
      error: 'GITHUB_NATIVE_DRIVE_ASSET_REDIRECT_TARGET_DENIED',
    });
  });

  it('blocks queue items that lack a canonical Drive source asset id', async () => {
    const paths = await workspace({
      asset: {
        url: `https://raw.githubusercontent.com/example/repo/publication-assets/publication-assets/${sha256}.jpg`,
        contentType: 'image/jpeg',
        sha256,
      },
    });
    const fetchSource = vi.fn(() => Promise.resolve(fetchResponse(jpeg)));

    const cycle = await stageGithubNativeDriveAssets(envFor(paths), { fetch: fetchSource });

    expect(fetchSource).not.toHaveBeenCalled();
    expect(cycle.items[0]).toMatchObject({
      outcome: 'BLOCKED',
      error: 'GITHUB_NATIVE_ASSET_SOURCE_DRIVE_ID_REQUIRED',
    });
  });
});
