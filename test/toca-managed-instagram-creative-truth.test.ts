import { describe, expect, it, vi } from 'vitest';
import type { InstagramPublishRequest } from '../src/providers/instagram/instagram-contracts.js';
import {
  InstagramPublicationExecutor,
  type InstagramPublicationTransport,
  type PublicationExecutionStore,
} from '../src/providers/instagram/instagram-publication-executor.js';
import type { PublicationRecord } from '../src/providers/instagram/publication-state.js';
import {
  TocaManagedInstagramPublicationJobHandler,
  hashTocaManagedInstagramApprovalDescriptor,
  type TocaManagedInstagramSchedulePayload,
} from '../src/scheduler/toca-managed-instagram-scheduler.js';

class MemoryStore implements PublicationExecutionStore {
  private record: PublicationRecord | undefined;

  reserve(request: InstagramPublishRequest, nowIso: string): Promise<PublicationRecord> {
    this.record ??= {
      publicationId: request.correlationId,
      correlationId: request.correlationId,
      idempotencyKey: request.idempotencyKey,
      state: 'DRAFT',
      updatedAt: nowIso,
    };
    return Promise.resolve(this.record);
  }

  save(record: PublicationRecord): Promise<void> {
    this.record = record;
    return Promise.resolve();
  }
}

class CapturingTransport implements InstagramPublicationTransport {
  request: InstagramPublishRequest | undefined;

  createContainer(request: InstagramPublishRequest): Promise<{ readonly containerId: string }> {
    this.request = request;
    return Promise.resolve({ containerId: 'container-1' });
  }

  getContainerStatus(): Promise<'FINISHED'> {
    return Promise.resolve('FINISHED');
  }

  publishContainer(): Promise<{ readonly mediaId: string }> {
    return Promise.resolve({ mediaId: 'media-1' });
  }
}

function approvedPayload(): TocaManagedInstagramSchedulePayload {
  const base: TocaManagedInstagramSchedulePayload = {
    schemaVersion: 1,
    contentItemId: 'MKT-SUNSET-001',
    scheduledFor: '2026-08-18T09:00:00-03:00',
    timezone: 'America/Bahia',
    account: { pageId: 'page-1', instagramAccountId: 'ig-1' },
    mediaType: 'IMAGE',
    asset: {
      assetId: 'CREATIVE-SUNSET-001',
      objectName: 'instagram/corr-1/CREATIVE-SUNSET-001-aaaaaaaaaaaaaaaa.jpg',
      sha256: 'a'.repeat(64),
      contentType: 'image/jpeg',
    },
    creativeTruthBinding: {
      policyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
      standardId: 'SUNSET_FEED_V1',
      creativeId: 'CREATIVE-SUNSET-001',
      outputSha256: 'a'.repeat(64),
      brandIntegrityStatus: 'PASSED',
      venueFidelityStatus: 'PASSED',
      qualityGateStatus: 'PASSED',
      assetLocators: [{ kind: 'DRIVE_FILE_ID', value: 'drive-final-creative' }],
      exactAssetBinding: true,
    },
    caption: 'Sunset real da Toca.',
    correlationId: 'corr-1',
    publicationIdempotencyKey: 'publish-1',
    approval: {
      mode: 'EXPLICIT_APPROVAL',
      status: 'APPROVED',
      approvedDescriptorSha256: '0'.repeat(64),
    },
  };
  return {
    ...base,
    approval: {
      ...base.approval,
      approvedDescriptorSha256: hashTocaManagedInstagramApprovalDescriptor(base),
    },
  };
}

describe('TOCA-managed Instagram Creative Truth handoff', () => {
  it('verifies object bytes, MIME and approved hash before binding the runtime URL for Meta', async () => {
    const deliveryUrl = 'https://storage.googleapis.com/bucket/creative.jpg?signature=runtime';
    const createVerifiedDeliveryUrl = vi.fn(() => Promise.resolve(deliveryUrl));
    const transport = new CapturingTransport();
    const executor = new InstagramPublicationExecutor(
      new MemoryStore(),
      transport,
      () => '2026-08-18T12:00:00.000Z',
      true,
    );
    const handler = new TocaManagedInstagramPublicationJobHandler(
      { createVerifiedDeliveryUrl },
      executor,
    );
    const payload = approvedPayload();

    await handler.execute(payload);

    expect(createVerifiedDeliveryUrl).toHaveBeenCalledWith(
      payload.asset.objectName,
      payload.asset.sha256,
      payload.asset.contentType,
    );
    expect(transport.request?.mediaUrls).toEqual([deliveryUrl]);
    expect(transport.request?.creativeTruthBinding?.outputSha256).toBe(payload.asset.sha256);
    expect(transport.request?.creativeTruthBinding?.assetLocators).toContainEqual({
      kind: 'MEDIA_URL',
      value: deliveryUrl,
    });
  });

  it('does not call Meta when delivery byte verification fails', async () => {
    const createVerifiedDeliveryUrl = vi.fn(() =>
      Promise.reject(new Error('PUBLICATION_ASSET_SHA256_MISMATCH')),
    );
    const transport = new CapturingTransport();
    const executor = new InstagramPublicationExecutor(new MemoryStore(), transport, undefined, true);
    const handler = new TocaManagedInstagramPublicationJobHandler(
      { createVerifiedDeliveryUrl },
      executor,
    );

    await expect(handler.execute(approvedPayload())).rejects.toThrow(
      'PUBLICATION_ASSET_SHA256_MISMATCH',
    );
    expect(transport.request).toBeUndefined();
  });
});
