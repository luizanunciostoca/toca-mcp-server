import { describe, expect, it, vi } from 'vitest';
import type { StaticCreativeQualityEvidence } from '../src/creative/static-creative-quality-gate.js';
import type { InstagramPublicationExecutor } from '../src/providers/instagram/instagram-publication-executor.js';
import { InMemoryScheduler } from '../src/scheduler/in-memory-scheduler.js';
import {
  TocaManagedInstagramPublicationJobHandler,
  TocaManagedInstagramScheduler,
  hashTocaManagedInstagramApprovalDescriptor,
  type TocaManagedInstagramAsset,
  type TocaManagedInstagramSchedulePayload,
} from '../src/scheduler/toca-managed-instagram-scheduler.js';

const TEST_NOW = new Date('2026-08-14T08:00:00-03:00');

const imageAsset = (suffix: string, sha = 'a'.repeat(64)): TocaManagedInstagramAsset => ({
  assetId: `MM-SUN-${suffix}`,
  objectName: `instagram/corr/MM-SUN-${suffix}-${sha.slice(0, 16)}.jpg`,
  sha256: sha,
  contentType: 'image/jpeg',
});

const videoAsset = (suffix: string): TocaManagedInstagramAsset => ({
  assetId: `VID-SUN-${suffix}`,
  objectName: `instagram/corr/VID-SUN-${suffix}-aabbccddeeff0011.mp4`,
  sha256: 'c'.repeat(64),
  contentType: 'video/mp4',
});

function qualityEvidence(asset: TocaManagedInstagramAsset): StaticCreativeQualityEvidence {
  return {
    evidenceId: `STATIC-QA:${asset.assetId}`,
    assetId: asset.assetId,
    outputSha256: asset.sha256,
    policyId: 'TOCA_STATIC_CREATIVE_QUALITY_POLICY_V1',
    policyVersion: '1.0',
    format: 'FEED_4_5',
    overallStatus: 'PASS',
    sourceRole: 'ORIGINAL_MASTER',
    sourceLineageStatus: 'PASS',
    exactSourceMasterBinding: true,
    sourceMasterSha256: 'b'.repeat(64),
    sourceResolutionStatus: 'PASS',
    effectiveUpscaleRatio: 1,
    safeAreaStatus: 'PASS',
    typographyStatus: 'PASS',
    rightsStatus: 'PASS',
    brandIntegrityStatus: 'PASS',
    venueFidelityStatus: 'PASS',
    copyQaStatus: 'PASS',
    informationQaStatus: 'PASS',
    visualArtifactStatus: 'PASS',
    failureCodes: [],
  };
}

function payload(overrides: Partial<TocaManagedInstagramSchedulePayload> = {}) {
  const baseAsset = imageAsset('0001-V1');
  const base: TocaManagedInstagramSchedulePayload = {
    schemaVersion: 1,
    contentItemId: 'MKT-20260814-SUNSET-FEED-0900',
    scheduledFor: '2026-08-14T09:00:00-03:00',
    timezone: 'America/Bahia',
    account: { pageId: 'page-1', instagramAccountId: 'ig-1' },
    mediaType: 'IMAGE',
    asset: baseAsset,
    creativeQualityEvidence: [qualityEvidence(baseAsset)],
    caption: 'Legenda final.',
    correlationId: 'corr-1',
    publicationIdempotencyKey: 'publish-1',
    approval: {
      mode: 'EXPLICIT_APPROVAL',
      status: 'APPROVED',
      approvedDescriptorSha256: '0'.repeat(64),
    },
  };
  const merged = { ...base, ...overrides } as TocaManagedInstagramSchedulePayload;
  if (overrides.assets !== undefined) delete merged.asset;
  if (overrides.asset !== undefined) delete merged.assets;

  if (overrides.creativeQualityEvidence === undefined) {
    const assets = merged.assets ?? (merged.asset ? [merged.asset] : []);
    merged.creativeQualityEvidence = assets
      .filter((asset) => asset.contentType !== 'video/mp4')
      .map(qualityEvidence);
  }

  return {
    ...merged,
    approval: {
      ...merged.approval,
      approvedDescriptorSha256: hashTocaManagedInstagramApprovalDescriptor(merged),
    },
  };
}

function managed(scheduler: InMemoryScheduler, createId: () => string = () => 'job-1') {
  return new TocaManagedInstagramScheduler(scheduler, createId, () => TEST_NOW);
}

describe('TOCA-managed Instagram scheduler', () => {
  it('persists a quality-bound single-image scheduled publication without calling Meta', async () => {
    const scheduler = new InMemoryScheduler();
    const job = await managed(scheduler).schedule(payload());

    expect(job.id).toBe('job-1');
    expect(job.status).toBe('SCHEDULED');
    expect(job.toolName).toBe('internal.instagram.publication.toca-managed.execute');
    expect(job.runAt).toBe('2026-08-14T09:00:00-03:00');
  });

  it('rejects a new static schedule without exact creative quality evidence', () => {
    const scheduler = new InMemoryScheduler();
    const missing = payload({ creativeQualityEvidence: [] });
    expect(() => managed(scheduler).schedule(missing)).toThrow(
      'TOCA_MANAGED_INSTAGRAM_STATIC_CREATIVE_QUALITY_REQUIRED',
    );
  });

  it('rejects quality evidence bound to a different output hash', () => {
    const scheduler = new InMemoryScheduler();
    const asset = imageAsset('HASH-V1', '1'.repeat(64));
    const evidence = { ...qualityEvidence(asset), outputSha256: '2'.repeat(64) };
    const invalid = payload({ asset, creativeQualityEvidence: [evidence] });
    expect(() => managed(scheduler).schedule(invalid)).toThrow(
      'STATIC_CREATIVE_QUALITY_OUTPUT_SHA256_MISMATCH',
    );
  });

  it('rejects a changed schedule when the approved descriptor hash is stale', () => {
    const scheduler = new InMemoryScheduler();
    const approved = payload();
    const changed = { ...approved, scheduledFor: '2026-08-14T10:00:00-03:00' };

    expect(() => managed(scheduler).schedule(changed)).toThrow(
      'TOCA_MANAGED_INSTAGRAM_APPROVAL_MISMATCH',
    );
  });

  it('rejects a schedule that is not in the future', () => {
    const scheduler = new InMemoryScheduler();
    const past = payload({ scheduledFor: '2026-08-14T07:59:59-03:00' });

    expect(() => managed(scheduler).schedule(past)).toThrow(
      'TOCA_MANAGED_INSTAGRAM_SCHEDULE_MUST_BE_FUTURE',
    );
  });

  it('reschedule atomically cancels the old immutable job and creates a replacement', async () => {
    const scheduler = new InMemoryScheduler();
    const ids = ['job-1', 'job-2'];
    const instance = managed(scheduler, () => ids.shift()!);
    await instance.schedule(payload());
    const replacement = payload({ scheduledFor: '2026-08-14T10:00:00-03:00' });
    const next = await instance.reschedule('job-1', replacement);

    expect((await instance.status('job-1'))?.status).toBe('CANCELED');
    expect(next.id).toBe('job-2');
    expect(next.status).toBe('SCHEDULED');
  });

  it('accepts a Reel only when its single asset is video/mp4', async () => {
    const scheduler = new InMemoryScheduler();
    const reel = payload({ mediaType: 'REEL', asset: videoAsset('0001-V1') });
    await expect(managed(scheduler).schedule(reel)).resolves.toMatchObject({ status: 'SCHEDULED' });

    expect(() => payload({ mediaType: 'REEL', asset: imageAsset('0002-V1') })).toThrow(
      'REEL requires exactly one video/mp4 asset.',
    );
  });

  it('supports a video Story and an ordered quality-bound image carousel', async () => {
    const storyScheduler = new InMemoryScheduler();
    const story = payload({ mediaType: 'STORY', asset: videoAsset('STORY-1') });
    await expect(managed(storyScheduler).schedule(story)).resolves.toMatchObject({
      status: 'SCHEDULED',
    });

    const carouselScheduler = new InMemoryScheduler();
    const carousel = payload({
      mediaType: 'CAROUSEL',
      assets: [imageAsset('CAR-1', '1'.repeat(64)), imageAsset('CAR-2', '2'.repeat(64))],
    });
    await expect(managed(carouselScheduler).schedule(carousel)).resolves.toMatchObject({
      status: 'SCHEDULED',
    });
  });

  it('rejects a carousel with fewer than two assets', () => {
    expect(() => payload({ mediaType: 'CAROUSEL', assets: [imageAsset('CAR-1')] })).toThrow(
      'CAROUSEL requires between two and ten JPEG, PNG, or WebP assets.',
    );
  });

  it('verifies every scheduled asset by SHA-256 and preserves carousel order', async () => {
    const assets = [imageAsset('CAR-1', '1'.repeat(64)), imageAsset('CAR-2', '2'.repeat(64))];
    const verified = vi.fn((objectName: string) =>
      Promise.resolve(`https://storage.example/${objectName}`),
    );
    const execute = vi.fn((request: unknown) => {
      void request;
      return Promise.resolve({ completed: true, publication: {} });
    });
    const handler = new TocaManagedInstagramPublicationJobHandler(
      { createVerifiedDeliveryUrl: verified },
      { execute } as unknown as InstagramPublicationExecutor,
    );

    await handler.execute(payload({ mediaType: 'CAROUSEL', assets }));

    expect(verified).toHaveBeenNthCalledWith(
      1,
      assets[0]!.objectName,
      assets[0]!.sha256,
      assets[0]!.contentType,
    );
    expect(verified).toHaveBeenNthCalledWith(
      2,
      assets[1]!.objectName,
      assets[1]!.sha256,
      assets[1]!.contentType,
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![0]).toMatchObject({
      mediaType: 'CAROUSEL',
      mediaUrls: [
        `https://storage.example/${assets[0]!.objectName}`,
        `https://storage.example/${assets[1]!.objectName}`,
      ],
    });
  });

  it('fails closed on asset SHA mismatch before invoking the Instagram executor', async () => {
    const execute = vi.fn();
    const handler = new TocaManagedInstagramPublicationJobHandler(
      {
        createVerifiedDeliveryUrl: vi.fn(() =>
          Promise.reject(new Error('PUBLICATION_ASSET_SHA256_MISMATCH')),
        ),
      },
      { execute } as unknown as InstagramPublicationExecutor,
    );

    await expect(handler.execute(payload())).rejects.toThrow('PUBLICATION_ASSET_SHA256_MISMATCH');
    expect(execute).not.toHaveBeenCalled();
  });
});
