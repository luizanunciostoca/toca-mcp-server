import { describe, expect, it } from 'vitest';
import { InMemoryScheduler } from '../src/scheduler/in-memory-scheduler.js';
import {
  TocaManagedInstagramScheduler,
  hashTocaManagedInstagramApprovalDescriptor,
  type TocaManagedInstagramSchedulePayload,
} from '../src/scheduler/toca-managed-instagram-scheduler.js';

function payload(overrides: Partial<TocaManagedInstagramSchedulePayload> = {}) {
  const base: TocaManagedInstagramSchedulePayload = {
    schemaVersion: 1,
    contentItemId: 'MKT-20260814-SUNSET-FEED-0900',
    scheduledFor: '2026-08-14T09:00:00-03:00',
    timezone: 'America/Bahia',
    account: { pageId: 'page-1', instagramAccountId: 'ig-1' },
    mediaType: 'IMAGE',
    asset: {
      assetId: 'MM-SUN-0001-V1',
      objectName: 'instagram/corr/MM-SUN-0001-V1-aabbccddeeff0011.jpg',
      sha256: 'a'.repeat(64),
      contentType: 'image/jpeg',
    },
    creativeTruthBinding: {
      policyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
      standardId: 'SUNSET_FEED_V1',
      creativeId: 'CREATIVE-SUN-0001-V1',
      outputSha256: 'a'.repeat(64),
      brandIntegrityStatus: 'PASSED',
      venueFidelityStatus: 'PASSED',
      qualityGateStatus: 'PASSED',
      assetLocators: [{ kind: 'DRIVE_FILE_ID', value: 'drive-final-creative' }],
      exactAssetBinding: true,
    },
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
  return {
    ...merged,
    approval: {
      ...merged.approval,
      approvedDescriptorSha256: hashTocaManagedInstagramApprovalDescriptor(merged),
    },
  };
}

describe('TOCA-managed Instagram scheduler', () => {
  it('persists a scheduled publication with Creative Truth without calling Meta', async () => {
    const scheduler = new InMemoryScheduler();
    const managed = new TocaManagedInstagramScheduler(scheduler, () => 'job-1');
    const job = await managed.schedule(payload());

    expect(job.id).toBe('job-1');
    expect(job.status).toBe('SCHEDULED');
    expect(job.toolName).toBe('internal.instagram.publication.toca-managed.execute');
    expect(job.runAt).toBe('2026-08-14T09:00:00-03:00');
    expect(job.payload.creativeTruthBinding.outputSha256).toBe(job.payload.asset.sha256);
  });

  it('rejects a changed schedule when the approved descriptor hash is stale', () => {
    const scheduler = new InMemoryScheduler();
    const managed = new TocaManagedInstagramScheduler(scheduler);
    const approved = payload();
    const changed = { ...approved, scheduledFor: '2026-08-14T10:00:00-03:00' };

    expect(() => managed.schedule(changed)).toThrow('TOCA_MANAGED_INSTAGRAM_APPROVAL_MISMATCH');
  });

  it('rejects scheduling when the approved asset hash differs from Creative Truth output', () => {
    const scheduler = new InMemoryScheduler();
    const managed = new TocaManagedInstagramScheduler(scheduler);
    const mismatched = payload({
      asset: {
        assetId: 'MM-SUN-0001-V1',
        objectName: 'instagram/corr/MM-SUN-0001-V1-aabbccddeeff0011.jpg',
        sha256: 'b'.repeat(64),
        contentType: 'image/jpeg',
      },
    });

    expect(() => managed.schedule(mismatched)).toThrow(
      'TOCA_MANAGED_INSTAGRAM_CREATIVE_TRUTH_HASH_MISMATCH',
    );
  });

  it('reschedule cancels the old immutable job and creates a new one', async () => {
    const scheduler = new InMemoryScheduler();
    const ids = ['job-1', 'job-2'];
    const managed = new TocaManagedInstagramScheduler(scheduler, () => ids.shift()!);
    await managed.schedule(payload());
    const replacement = payload({ scheduledFor: '2026-08-14T10:00:00-03:00' });
    const next = await managed.reschedule('job-1', replacement);

    expect((await managed.status('job-1'))?.status).toBe('CANCELED');
    expect(next.id).toBe('job-2');
    expect(next.status).toBe('SCHEDULED');
  });
});
