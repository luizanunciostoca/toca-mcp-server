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
  it('persists a scheduled publication without calling Meta', async () => {
    const scheduler = new InMemoryScheduler();
    const managed = new TocaManagedInstagramScheduler(scheduler, () => 'job-1');
    const job = await managed.schedule(payload());

    expect(job.id).toBe('job-1');
    expect(job.status).toBe('SCHEDULED');
    expect(job.toolName).toBe('internal.instagram.publication.toca-managed.execute');
    expect(job.runAt).toBe('2026-08-14T09:00:00-03:00');
  });

  it('rejects a changed schedule when the approved descriptor hash is stale', async () => {
    const scheduler = new InMemoryScheduler();
    const managed = new TocaManagedInstagramScheduler(scheduler);
    const approved = payload();
    const changed = { ...approved, scheduledFor: '2026-08-14T10:00:00-03:00' };

    await expect(managed.schedule(changed)).rejects.toThrow(
      'TOCA_MANAGED_INSTAGRAM_APPROVAL_MISMATCH',
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
