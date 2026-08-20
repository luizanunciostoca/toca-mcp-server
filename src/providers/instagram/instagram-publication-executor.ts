import { creativeTruthPublicationBindingSchema } from '../../contracts/creative-truth.js';
import { assertCreativePublicationAssetHash } from '../../creative/creative-truth.js';
import { ExecutionError } from '../../core/errors.js';
import type { InstagramPublishRequest } from './instagram-contracts.js';
import {
  transitionPublication,
  type PublicationRecord,
  type PublicationState,
} from './publication-state.js';

export interface PublishedMediaEvidence {
  readonly mediaId: string;
  readonly caption?: string;
  readonly mediaType?: string;
  readonly permalink?: string;
  readonly timestamp?: string;
}

export interface InstagramPublicationTransport {
  createContainer(request: InstagramPublishRequest): Promise<{ readonly containerId: string }>;
  getContainerStatus(containerId: string): Promise<'IN_PROGRESS' | 'FINISHED' | 'ERROR'>;
  publishContainer(
    instagramAccountId: string,
    containerId: string,
  ): Promise<{ readonly mediaId: string }>;
  getPublishedMedia?(mediaId: string): Promise<PublishedMediaEvidence>;
  listRecentPublishedMedia?(
    instagramAccountId: string,
    limit?: number,
  ): Promise<readonly PublishedMediaEvidence[]>;
}

export interface PublicationExecutionStore {
  reserve(request: InstagramPublishRequest, nowIso: string): Promise<PublicationRecord>;
  save(record: PublicationRecord): Promise<void>;
}

export interface PublicationExecutionResult {
  readonly publication: PublicationRecord;
  readonly completed: boolean;
}

export class InstagramPublicationExecutor {
  constructor(
    private readonly store: PublicationExecutionStore,
    private readonly transport: InstagramPublicationTransport,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly requireCreativeTruthBinding = false,
  ) {}

  async execute(request: InstagramPublishRequest): Promise<PublicationExecutionResult> {
    if (this.requireCreativeTruthBinding) assertCreativeTruthBinding(request);

    let record = await this.store.reserve(request, this.now());
    let publishingAuthorizedThisRun = false;

    if (record.state === 'PUBLISHED') {
      return { publication: record, completed: true };
    }

    if (record.state === 'CANCELED') {
      throw new Error('INSTAGRAM_PUBLICATION_CANCELED');
    }

    if (record.state === 'PUBLISHING' || isPublishUncertain(record)) {
      throw new Error('INSTAGRAM_PUBLICATION_MANUAL_RECONCILIATION_REQUIRED');
    }

    try {
      if (record.state === 'DRAFT' || record.state === 'FAILED') {
        record = transitionPublication(withoutLastError(record), 'CREATING_CONTAINER', this.now());
        await this.store.save(record);

        const created = await this.transport.createContainer(request);
        record = transitionPublication(record, 'PROCESSING', this.now(), {
          externalContainerId: created.containerId,
        });
        await this.store.save(record);
      }

      if (record.state === 'CREATING_CONTAINER') {
        throw new Error('INSTAGRAM_PUBLICATION_CONTAINER_ID_MISSING');
      }

      if (record.state === 'PROCESSING') {
        if (!record.externalContainerId) {
          throw new Error('INSTAGRAM_PUBLICATION_CONTAINER_ID_MISSING');
        }
        const status = await this.transport.getContainerStatus(record.externalContainerId);
        if (status === 'IN_PROGRESS') {
          return { publication: record, completed: false };
        }
        if (status === 'ERROR') {
          throw new Error('INSTAGRAM_PUBLICATION_CONTAINER_PROCESSING_FAILED');
        }
        record = transitionPublication(record, 'PUBLISHING', this.now());
        await this.store.save(record);
        publishingAuthorizedThisRun = true;
      }

      if (record.state === 'PUBLISHING') {
        if (!publishingAuthorizedThisRun) {
          throw new Error('INSTAGRAM_PUBLICATION_MANUAL_RECONCILIATION_REQUIRED');
        }
        if (!record.externalContainerId) {
          throw new Error('INSTAGRAM_PUBLICATION_CONTAINER_ID_MISSING');
        }
        try {
          const published = await this.transport.publishContainer(
            request.account.instagramAccountId,
            record.externalContainerId,
          );
          const evidence = await getPublishedEvidence(this.transport, published.mediaId);
          record = transitionPublication(record, 'PUBLISHED', this.now(), {
            externalMediaId: published.mediaId,
            ...(evidence.permalink ? { permalink: evidence.permalink } : {}),
            ...(evidence.timestamp ? { providerPublishedAt: evidence.timestamp } : {}),
            reconciliationSource: 'WRITE_RESPONSE',
          });
          await this.store.save(record);
        } catch (error) {
          if (record.state === 'PUBLISHING') {
            const normalized = normalizeError(error);
            const failed = transitionPublication(record, 'FAILED', this.now(), {
              lastError: `PUBLISH_UNCERTAIN:${normalized}`,
            });
            await this.store.save(failed);
            record = failed;
          }
          throw error;
        }
      }

      return { publication: record, completed: record.state === 'PUBLISHED' };
    } catch (error) {
      if (canFail(record.state)) {
        const failed = transitionPublication(record, 'FAILED', this.now(), {
          lastError: normalizeError(error),
        });
        await this.store.save(failed);
      }
      throw error;
    }
  }
}

export function assertCreativeTruthBinding(request: InstagramPublishRequest): void {
  if (!request.creativeTruthBinding) {
    throw new ExecutionError('POLICY_DENIED', 'CREATIVE_TRUTH_BINDING_REQUIRED', false);
  }
  const parsed = creativeTruthPublicationBindingSchema.safeParse(request.creativeTruthBinding);
  if (!parsed.success) {
    throw new ExecutionError('POLICY_DENIED', 'CREATIVE_TRUTH_BINDING_INVALID', false);
  }
  if (!request.publicationAssetSha256 || !/^[a-f0-9]{64}$/i.test(request.publicationAssetSha256)) {
    throw new ExecutionError('POLICY_DENIED', 'CREATIVE_TRUTH_PUBLICATION_ASSET_HASH_REQUIRED', false);
  }
  assertCreativePublicationAssetHash(parsed.data, request.publicationAssetSha256);
}

async function getPublishedEvidence(
  transport: InstagramPublicationTransport,
  mediaId: string,
): Promise<PublishedMediaEvidence> {
  if (!transport.getPublishedMedia) return { mediaId };
  try {
    return await transport.getPublishedMedia(mediaId);
  } catch {
    return { mediaId };
  }
}

function withoutLastError(record: PublicationRecord): PublicationRecord {
  const clean = { ...record };
  delete clean.lastError;
  return clean;
}

function isPublishUncertain(record: PublicationRecord): boolean {
  return record.state === 'FAILED' && record.lastError?.startsWith('PUBLISH_UNCERTAIN:') === true;
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : 'UNKNOWN_PUBLICATION_ERROR';
}

function canFail(state: PublicationState): boolean {
  return state === 'SCHEDULED' || state === 'CREATING_CONTAINER' || state === 'PROCESSING';
}
