import { creativeTruthPublicationBindingSchema } from '../../contracts/creative-truth.js';
import { assertCreativePublicationAssetHash } from '../../creative/creative-truth.js';
import { ExecutionError } from '../../core/errors.js';
import type { MetaApiRequestContext } from '../meta/meta-api-client.js';
import { parseInstagramPublishRequest } from '../../worker/instagram-publication-job.js';
import {
  assertInstagramOneOffWindow,
  type InstagramPublishRequest,
} from './instagram-contracts.js';
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
  createContainer(
    request: InstagramPublishRequest,
    context?: MetaApiRequestContext,
  ): Promise<{ readonly containerId: string }>;
  getContainerStatus(
    containerId: string,
    context?: MetaApiRequestContext,
  ): Promise<'IN_PROGRESS' | 'FINISHED' | 'ERROR'>;
  publishContainer(
    instagramAccountId: string,
    containerId: string,
    context?: MetaApiRequestContext,
  ): Promise<{ readonly mediaId: string }>;
  getPublishedMedia?(
    mediaId: string,
    context?: MetaApiRequestContext,
  ): Promise<PublishedMediaEvidence>;
  listRecentPublishedMedia?(
    instagramAccountId: string,
    limit?: number,
  ): Promise<readonly PublishedMediaEvidence[]>;
}

export interface OneOffPublicationReservation {
  readonly publication: PublicationRecord;
  /** In-memory, single-invocation continuation; absent for every replayed row. */
  readonly advance?: (next: PublicationRecord) => Promise<void>;
}

export interface OneOffPublicationPollingOptions {
  readonly operationTimeoutMs?: number;
  readonly maxAttempts?: number;
  readonly pollIntervalMs?: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export interface PublicationExecutionStore {
  consumeOneOff?(
    request: InstagramPublishRequest,
    nowIso: string,
  ): Promise<OneOffPublicationReservation>;
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
    private readonly oneOffPolling: OneOffPublicationPollingOptions = {},
  ) {}

  async execute(request: InstagramPublishRequest): Promise<PublicationExecutionResult> {
    if (request.oneOff) {
      const canonical = parseInstagramPublishRequest(request);
      if (this.requireCreativeTruthBinding) assertCreativeTruthBinding(canonical);
      return this.executeOneOff(canonical);
    }
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

  private async executeOneOff(
    request: InstagramPublishRequest,
  ): Promise<PublicationExecutionResult> {
    const descriptor = request.oneOff;
    if (!descriptor || !this.store.consumeOneOff) {
      throw new Error('INSTAGRAM_PUBLICATION_ONE_OFF_DURABLE_STORE_REQUIRED');
    }
    const operationTimeoutMs = this.oneOffPolling.operationTimeoutMs ?? 30_000;
    const maxAttempts = this.oneOffPolling.maxAttempts ?? 20;
    const pollIntervalMs = this.oneOffPolling.pollIntervalMs ?? 3_000;
    if (
      !Number.isInteger(operationTimeoutMs) ||
      operationTimeoutMs < 1 ||
      operationTimeoutMs > 60_000 ||
      !Number.isInteger(maxAttempts) ||
      maxAttempts < 1 ||
      maxAttempts > 20 ||
      !Number.isInteger(pollIntervalMs) ||
      pollIntervalMs < 0 ||
      pollIntervalMs > 30_000
    ) {
      throw new Error('INSTAGRAM_PUBLICATION_ONE_OFF_POLLING_INVALID');
    }
    const sleep =
      this.oneOffPolling.sleep ??
      ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
    assertInstagramOneOffWindow(descriptor, this.now());
    const reservation = await this.store.consumeOneOff(request, this.now());
    let record = reservation.publication;
    const advance = reservation.advance;
    if (!advance) {
      // Replays are read-only. Even ordinary FAILED/DRAFT must never receive a grant.
      if (record.state === 'PUBLISHED') return { publication: record, completed: true };
      throw new Error('INSTAGRAM_PUBLICATION_ONE_OFF_CONSUMED_RECONCILIATION_REQUIRED');
    }
    if (record.state !== 'CREATING_CONTAINER') {
      throw new Error('INSTAGRAM_PUBLICATION_ONE_OFF_CONSUMPTION_UNKNOWN');
    }
    let canAdvance = true;
    let createStarted = false;
    let createAcknowledged = false;
    let publishStarted = false;
    const boundedProviderCall = <T>(
      operation: (context: MetaApiRequestContext) => Promise<T>,
    ): Promise<T> => {
      const nowIso = this.now();
      assertInstagramOneOffWindow(descriptor, nowIso);
      const remaining = Date.parse(descriptor.validUntil) - Date.parse(nowIso);
      return withOneOffTimeout(operation, Math.min(operationTimeoutMs, remaining), () => {
        assertInstagramOneOffWindow(descriptor, this.now());
      });
    };
    const persist = async (next: PublicationRecord): Promise<void> => {
      // Any zero-row CAS or lost save acknowledgement invalidates this invocation.
      canAdvance = false;
      await advance(next);
      record = next;
      canAdvance = true;
    };
    try {
      assertInstagramOneOffWindow(descriptor, this.now());
      const created = await boundedProviderCall((context) => {
        createStarted = true;
        return this.transport.createContainer(request, context);
      });
      createAcknowledged = true;
      await persist(
        transitionPublication(record, 'PROCESSING', this.now(), {
          externalContainerId: created.containerId,
        }),
      );
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        assertInstagramOneOffWindow(descriptor, this.now());
        const status = await boundedProviderCall((context) =>
          this.transport.getContainerStatus(created.containerId, context),
        );
        if (status === 'ERROR') {
          throw new Error('INSTAGRAM_PUBLICATION_CONTAINER_PROCESSING_FAILED');
        }
        if (status === 'FINISHED') {
          assertInstagramOneOffWindow(descriptor, this.now());
          await persist(transitionPublication(record, 'PUBLISHING', this.now()));
          // Recheck after the awaited CAS, immediately before the sole publish call.
          assertInstagramOneOffWindow(descriptor, this.now());
          const published = await boundedProviderCall((context) => {
            publishStarted = true;
            return this.transport.publishContainer(
              request.account.instagramAccountId,
              created.containerId,
              context,
            );
          });
          // Readback failure must not create another write attempt; the write response
          // remains evidence even when optional enrichment is unavailable.
          const evidence = await withOneOffTimeout(
            (context) => getPublishedEvidence(this.transport, published.mediaId, context),
            operationTimeoutMs,
          ).catch((): PublishedMediaEvidence => ({ mediaId: published.mediaId }));
          await persist(
            transitionPublication(record, 'PUBLISHED', this.now(), {
              externalMediaId: published.mediaId,
              ...(evidence.permalink ? { permalink: evidence.permalink } : {}),
              ...(evidence.timestamp ? { providerPublishedAt: evidence.timestamp } : {}),
              reconciliationSource: 'WRITE_RESPONSE',
            }),
          );
          return { publication: record, completed: true };
        }
        if (attempt < maxAttempts) await sleep(pollIntervalMs);
      }
      // Never return PROCESSING_PENDING to an outer retry loop for a one-off.
      throw new Error('INSTAGRAM_PUBLICATION_ONE_OFF_PROCESSING_TIMEOUT_RECONCILIATION_REQUIRED');
    } catch (error) {
      if (canAdvance && canFailOneOff(record.state)) {
        await persist(
          transitionPublication(record, 'FAILED', this.now(), {
            lastError: `${publishStarted ? 'PUBLISH_UNCERTAIN:' : createStarted && !createAcknowledged ? 'CREATE_UNCERTAIN:' : ''}${normalizeError(error)}`,
          }),
        );
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
    throw new ExecutionError(
      'POLICY_DENIED',
      'CREATIVE_TRUTH_PUBLICATION_ASSET_HASH_REQUIRED',
      false,
    );
  }
  assertCreativePublicationAssetHash(parsed.data, request.publicationAssetSha256);
}

async function getPublishedEvidence(
  transport: InstagramPublicationTransport,
  mediaId: string,
  context?: MetaApiRequestContext,
): Promise<PublishedMediaEvidence> {
  if (!transport.getPublishedMedia) return { mediaId };
  try {
    return await (context
      ? transport.getPublishedMedia(mediaId, context)
      : transport.getPublishedMedia(mediaId));
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

function canFailOneOff(state: PublicationState): boolean {
  return canFail(state) || state === 'PUBLISHING';
}

// Abort is best effort for an already dispatched request, never proof that a
// remote write did not occur. The synchronous guard also blocks later dispatch
// after a delayed credential/child response, even if the transport ignores abort.
async function withOneOffTimeout<T>(
  operation: (context: MetaApiRequestContext) => Promise<T>,
  milliseconds: number,
  assertActive?: () => void,
): Promise<T> {
  const controller = new AbortController();
  const deadlineAt = performance.now() + milliseconds;
  const timeoutError = new Error(
    'INSTAGRAM_PUBLICATION_ONE_OFF_PROVIDER_TIMEOUT_RECONCILIATION_REQUIRED',
  );
  const context: MetaApiRequestContext = {
    signal: controller.signal,
    assertActive: () => {
      controller.signal.throwIfAborted();
      // The event loop may delay the timer, so dispatch also checks the deadline.
      if (performance.now() >= deadlineAt) {
        controller.abort(timeoutError);
        throw timeoutError;
      }
      assertActive?.();
    },
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort(timeoutError);
        reject(timeoutError);
      }, milliseconds);
    });
    context.assertActive?.();
    const result = await Promise.race([operation(context), deadline]);
    // A fulfilled response can beat a delayed timer callback even after expiry.
    // Do not let that late completion open a fresh context for the next operation.
    context.assertActive?.();
    return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    // A distinct context is made for each operation, so closing this one cannot
    // cancel a later authorized status/publish call in the same winning invocation.
    controller.abort(new Error('INSTAGRAM_PUBLICATION_ONE_OFF_OPERATION_CLOSED'));
  }
}
