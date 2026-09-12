import { describe, expect, it } from 'vitest';
import {
  parseGithubNativePublicationQueue,
  selectDuePublicationItems,
} from '../src/github-native-publication/github-native-publication-contracts.js';

const sha256 = 'a'.repeat(64);

function queueWith(scheduledAt: string, overrides: Record<string, unknown> = {}) {
  return parseGithubNativePublicationQueue({
    schemaVersion: 1,
    timezone: 'America/Bahia',
    generatedAt: '2026-09-12T08:55:00-03:00',
    items: [
      {
        contentItemId: 'MKT-20260912-SUNSET-FEED-0900',
        scheduledAt,
        operation: 'SUNSET',
        channel: 'INSTAGRAM',
        contentStatus: 'PRODUCED',
        approvalStatus: 'APPROVED',
        publicationIntent: 'SCHEDULED',
        mediaType: 'IMAGE',
        instagramAccountId: '17841402033495654',
        caption: 'Teste',
        asset: {
          url: `https://raw.githubusercontent.com/example/repo/publication-assets/publication-assets/${sha256}.jpg`,
          contentType: 'image/jpeg',
          sha256,
        },
        correlationId: 'CORR-1',
        idempotencyKey: 'IDEMP-1',
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
  });
}

describe('GitHub-native publication queue', () => {
  it('selects an item within the five-minute execution window', () => {
    const queue = queueWith('2026-09-12T09:00:00-03:00');
    expect(selectDuePublicationItems(queue, '2026-09-12T08:57:00-03:00')).toHaveLength(1);
  });

  it('does not backfill an item outside the five-minute execution window', () => {
    const queue = queueWith('2026-09-12T09:00:00-03:00');
    expect(selectDuePublicationItems(queue, '2026-09-12T09:06:00-03:00')).toHaveLength(0);
  });

  it('rejects duplicate idempotency keys', () => {
    const queue = queueWith('2026-09-12T09:00:00-03:00');
    const item = queue.items[0]!;
    expect(() =>
      parseGithubNativePublicationQueue({
        ...queue,
        items: [item, { ...item, contentItemId: 'MKT-OTHER' }],
      }),
    ).toThrow();
  });

  it('rejects timestamps without an explicit timezone offset', () => {
    expect(() => queueWith('2026-09-12T09:00:00')).toThrow();
  });

  it('rejects an expiry that is not after the scheduled instant', () => {
    expect(() =>
      queueWith('2026-09-12T09:00:00-03:00', {
        expiresAt: '2026-09-12T09:00:00-03:00',
      }),
    ).toThrow();
  });

  it('supports STORY items while preserving explicit offset scheduling', () => {
    const queue = queueWith('2026-09-12T09:00:00-03:00', {
      mediaType: 'STORY',
      caption: undefined,
    });
    expect(queue.items[0]?.mediaType).toBe('STORY');
  });
});
