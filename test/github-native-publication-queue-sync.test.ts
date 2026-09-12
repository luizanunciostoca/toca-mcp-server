import { describe, expect, it } from 'vitest';
import {
  CANONICAL_CONTENT_REGISTRY_SHEET_NAME,
  CANONICAL_CONTENT_REGISTRY_SPREADSHEET_ID,
  compileGithubNativePublicationQueue,
} from '../src/github-native-publication/github-native-publication-queue-sync.js';

const sha256 = 'b'.repeat(64);
const nowIso = '2026-09-12T10:00:00-03:00';

function validCandidate(overrides: Record<string, unknown> = {}) {
  return {
    rowRef: '201',
    contentItemId: 'MKT-20260913-SUNSET-FEED-0900',
    scheduledAt: '2026-09-13T09:00:00-03:00',
    operation: 'SUNSET',
    channel: 'INSTAGRAM',
    format: 'FEED',
    status: 'PRODUCED',
    approvalStatus: 'APPROVED',
    publicationIntent: 'SCHEDULED',
    instagramAccountId: '17841402033495654',
    caption: 'Viva o Sunset na Toca.',
    finalDriveFileId: '1-P3RdbWi_X4H1_X5L_xrLiY2UA3cte1o',
    finalAssetSha256: sha256,
    correlationId: 'CORR-MKT-20260913-SUNSET-FEED-0900-V1',
    idempotencyKey: 'PROD:MKT-20260913-SUNSET-FEED-0900:V1',
    creativeTruthBinding: {
      policyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
      standardId: 'SUNSET_FEED_IMAGE_V1',
      creativeId: 'CR-MKT-20260913-SUNSET-FEED-0900-V1',
      outputSha256: sha256,
      brandIntegrityStatus: 'PASSED',
      venueFidelityStatus: 'PASSED',
      qualityGateStatus: 'PASSED',
      exactAssetBinding: true,
    },
    ...overrides,
  };
}

function snapshot(candidates: unknown[], fetchedAt = '2026-09-12T09:55:00-03:00') {
  return {
    schemaVersion: 1,
    source: {
      spreadsheetId: CANONICAL_CONTENT_REGISTRY_SPREADSHEET_ID,
      sheetName: CANONICAL_CONTENT_REGISTRY_SHEET_NAME,
      fetchedAt,
      registryRevision: 'MKTREG-20260912-R1',
    },
    candidates,
  };
}

describe('GitHub-native publication queue sync', () => {
  it('mirrors only a future canonical item that is fully approved and bound', () => {
    const result = compileGithubNativePublicationQueue(snapshot([validCandidate()]), nowIso);

    expect(result.queue.items).toHaveLength(1);
    expect(result.queue.items[0]).toMatchObject({
      contentItemId: 'MKT-20260913-SUNSET-FEED-0900',
      contentStatus: 'PRODUCED',
      approvalStatus: 'APPROVED',
      publicationIntent: 'SCHEDULED',
      mediaType: 'IMAGE',
      asset: {
        sha256,
        sourceDriveFileId: '1-P3RdbWi_X4H1_X5L_xrLiY2UA3cte1o',
      },
      sourceRegistry: {
        driveFileId: CANONICAL_CONTENT_REGISTRY_SPREADSHEET_ID,
        sheetName: CANONICAL_CONTENT_REGISTRY_SHEET_NAME,
        rowRef: '201',
      },
    });
    expect(result.queue.items[0]?.asset.url).toBe(
      `https://raw.githubusercontent.com/luizanunciostoca/toca-mcp-server/publication-assets/publication-assets/${sha256}.jpg`,
    );
    expect(result.evidence.mirroredCount).toBe(1);
    expect(result.evidence.skippedCount).toBe(0);
  });

  it('skips BRIEFED content without requiring publication-only fields', () => {
    const candidate = validCandidate({
      status: 'BRIEFED',
      approvalStatus: undefined,
      publicationIntent: undefined,
      finalDriveFileId: undefined,
      finalAssetSha256: undefined,
      correlationId: undefined,
      idempotencyKey: undefined,
      creativeTruthBinding: undefined,
    });

    const result = compileGithubNativePublicationQueue(snapshot([candidate]), nowIso);
    expect(result.queue.items).toHaveLength(0);
    expect(result.evidence.decisions[0]).toMatchObject({
      decision: 'SKIPPED',
      reason: 'STATUS_NOT_PRODUCED',
    });
  });

  it('skips a produced item whose approval is not explicit', () => {
    const result = compileGithubNativePublicationQueue(
      snapshot([validCandidate({ approvalStatus: 'PENDING' })]),
      nowIso,
    );
    expect(result.queue.items).toHaveLength(0);
    expect(result.evidence.decisions[0]?.reason).toBe('APPROVAL_NOT_APPROVED');
  });

  it('does not backfill expired or already due slots', () => {
    const result = compileGithubNativePublicationQueue(
      snapshot([validCandidate({ scheduledAt: '2026-09-12T09:00:00-03:00' })]),
      nowIso,
    );
    expect(result.queue.items).toHaveLength(0);
    expect(result.evidence.decisions[0]?.reason).toBe('SCHEDULE_NOT_FUTURE');
  });

  it('requires enough lead time for protected CI and asset staging', () => {
    const result = compileGithubNativePublicationQueue(
      snapshot([validCandidate({ scheduledAt: '2026-09-12T10:20:00-03:00' })]),
      nowIso,
    );
    expect(result.queue.items).toHaveLength(0);
    expect(result.evidence.decisions[0]?.reason).toBe('INSUFFICIENT_LEAD_TIME');
  });

  it('rejects a stale canonical snapshot', () => {
    expect(() =>
      compileGithubNativePublicationQueue(
        snapshot([validCandidate()], '2026-09-12T09:30:00-03:00'),
        nowIso,
      ),
    ).toThrow('GITHUB_NATIVE_QUEUE_SYNC_SNAPSHOT_STALE');
  });

  it('rejects a snapshot from a non-canonical registry', () => {
    expect(() =>
      compileGithubNativePublicationQueue(
        {
          ...snapshot([validCandidate()]),
          source: {
            ...snapshot([]).source,
            spreadsheetId: 'not-the-canonical-registry',
          },
        },
        nowIso,
      ),
    ).toThrow();
  });

  it('fails closed when an otherwise eligible item lacks Creative Truth', () => {
    expect(() =>
      compileGithubNativePublicationQueue(
        snapshot([validCandidate({ creativeTruthBinding: undefined })]),
        nowIso,
      ),
    ).toThrow('GITHUB_NATIVE_QUEUE_SYNC_CREATIVE_TRUTH_REQUIRED');
  });

  it('fails closed when Creative Truth does not bind the exact publication bytes', () => {
    expect(() =>
      compileGithubNativePublicationQueue(
        snapshot([
          validCandidate({
            creativeTruthBinding: {
              ...validCandidate().creativeTruthBinding,
              outputSha256: 'c'.repeat(64),
            },
          }),
        ]),
        nowIso,
      ),
    ).toThrow('GITHUB_NATIVE_QUEUE_SYNC_CREATIVE_TRUTH_HASH_MISMATCH');
  });

  it('maps STORY candidates without introducing a caption requirement', () => {
    const result = compileGithubNativePublicationQueue(
      snapshot([validCandidate({ format: 'STORY', caption: undefined })]),
      nowIso,
    );
    expect(result.queue.items[0]?.mediaType).toBe('STORY');
    expect(result.queue.items[0]?.caption).toBeUndefined();
  });
});
