import type { InstagramPublishRequest } from './instagram-contracts.js';
import {
  transitionPublication,
  type PublicationRecord,
  type PublicationState,
} from './publication-state.js';

export interface InstagramPublicationTransport {
  createContainer(request: InstagramPublishRequest): Promise<{ readonly containerId: string }>;
  getContainerStatus(containerId: string): Promise<'IN_PROGRESS' | 'FINISHED' | 'ERROR'>;
  publishContainer(
    instagramAccountId: string,
    containerId: string,
  ): Promise<{ readonly mediaId: string }>;
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
  ) {}

  async execute(request: InstagramPublishRequest): Promise<PublicationExecutionResult> {
    let record = await this.store.reserve(request, this.now());

    if (record.state === 'PUBLISHED') {
      return { publication: record, completed: true };
    }

    if (record.state === 'CANCELED') {
      throw new Error('INSTAGRAM_PUBLICATION_CANCELED');
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
      }

      if (record.state === 'PUBLISHING') {
        if (!record.externalContainerId) {
          throw new Error('INSTAGRAM_PUBLICATION_CONTAINER_ID_MISSING');
        }
        const published = await this.transport.publishContainer(
          request.account.instagramAccountId,
          record.externalContainerId,
        );
        record = transitionPublication(record, 'PUBLISHED', this.now(), {
          externalMediaId: published.mediaId,
        });
        await this.store.save(record);
      }

      return { publication: record, completed: record.state === 'PUBLISHED' };
    } catch (error) {
      if (canFail(record.state)) {
        const normalized = error instanceof Error ? error.message : 'UNKNOWN_PUBLICATION_ERROR';
        const failed = transitionPublication(record, 'FAILED', this.now(), {
          lastError: normalized,
        });
        await this.store.save(failed);
      }
      throw error;
    }
  }
}

function withoutLastError(record: PublicationRecord): PublicationRecord {
  const clean = { ...record };
  delete clean.lastError;
  return clean;
}

function canFail(state: PublicationState): boolean {
  return (
    state === 'SCHEDULED' ||
    state === 'CREATING_CONTAINER' ||
    state === 'PROCESSING' ||
    state === 'PUBLISHING'
  );
}
