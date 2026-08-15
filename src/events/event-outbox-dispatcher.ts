import type {
  ClaimedOutboxEvent,
  EventOutboxStore,
  OutboxRecord,
} from './transactional-outbox.js';

export interface EventPublisher {
  publish(event: OutboxRecord, delivery: ClaimedOutboxEvent['delivery']): Promise<readonly string[]>;
}

export interface EventDispatcherLogger {
  info(event: string, fields?: Readonly<Record<string, unknown>>): void;
  error(event: string, fields?: Readonly<Record<string, unknown>>): void;
}

export interface EventDispatcherRetryPolicy {
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export interface EventOutboxDispatcherOptions {
  readonly store: EventOutboxStore;
  readonly publisher: EventPublisher;
  readonly logger: EventDispatcherLogger;
  readonly workerId: string;
  readonly retry: EventDispatcherRetryPolicy;
  readonly batchSize?: number;
  readonly now?: () => Date;
}

export class EventOutboxDispatcher {
  readonly #batchSize: number;
  readonly #now: () => Date;

  constructor(private readonly options: EventOutboxDispatcherOptions) {
    if (!options.workerId.trim()) throw new Error('OUTBOX_WORKER_ID_REQUIRED');
    assertRetryPolicy(options.retry);
    this.#batchSize = options.batchSize ?? 25;
    if (!Number.isInteger(this.#batchSize) || this.#batchSize < 1 || this.#batchSize > 100)
      throw new Error('OUTBOX_BATCH_SIZE_INVALID');
    this.#now = options.now ?? (() => new Date());
  }

  async runOnce(): Promise<number> {
    const now = this.#now().toISOString();
    const claimed = await this.options.store.claimAvailable({
      workerId: this.options.workerId,
      now,
      limit: this.#batchSize,
    });

    for (const item of claimed) await this.#deliver(item);
    return claimed.length;
  }

  async #deliver(item: ClaimedOutboxEvent): Promise<void> {
    this.options.logger.info('outbox.delivery.started', {
      eventId: item.record.eventId,
      eventType: item.record.eventType,
      executionId: item.delivery.executionId,
      attempt: item.delivery.attemptNumber,
    });

    try {
      const publisherEvidence = normalizeEvidence(
        await this.options.publisher.publish(item.record, item.delivery),
      );
      if (publisherEvidence.length === 0) throw new Error('OUTBOX_PUBLISH_EVIDENCE_REQUIRED');
      const now = this.#now().toISOString();
      await this.options.store.markDelivered({
        eventId: item.record.eventId,
        executionId: item.delivery.executionId,
        evidence: publisherEvidence,
        now,
      });
      this.options.logger.info('outbox.delivery.succeeded', {
        eventId: item.record.eventId,
        eventType: item.record.eventType,
        executionId: item.delivery.executionId,
        attempt: item.delivery.attemptNumber,
      });
    } catch (error) {
      const nowDate = this.#now();
      const errorCode = normalizeErrorCode(error);
      const delayMs = retryDelayMs(item.delivery.attemptNumber, this.options.retry);
      const nextAttemptAt = new Date(nowDate.getTime() + delayMs).toISOString();
      await this.options.store.markFailed({
        eventId: item.record.eventId,
        executionId: item.delivery.executionId,
        errorCode,
        evidence: [`dispatcher:${item.delivery.executionId}`, `error:${errorCode}`],
        now: nowDate.toISOString(),
        nextAttemptAt,
      });
      this.options.logger.error('outbox.delivery.failed', {
        eventId: item.record.eventId,
        eventType: item.record.eventType,
        executionId: item.delivery.executionId,
        attempt: item.delivery.attemptNumber,
        errorCode,
      });
    }
  }
}

function retryDelayMs(attempt: number, policy: EventDispatcherRetryPolicy): number {
  const exponential = policy.baseDelayMs * 2 ** Math.max(0, attempt - 1);
  return Math.min(exponential, policy.maxDelayMs);
}

function assertRetryPolicy(policy: EventDispatcherRetryPolicy): void {
  if (!Number.isFinite(policy.baseDelayMs) || policy.baseDelayMs < 0)
    throw new Error('OUTBOX_RETRY_BASE_DELAY_INVALID');
  if (!Number.isFinite(policy.maxDelayMs) || policy.maxDelayMs < policy.baseDelayMs)
    throw new Error('OUTBOX_RETRY_MAX_DELAY_INVALID');
}

function normalizeErrorCode(error: unknown): string {
  const raw = error instanceof Error ? `${error.name}:${error.message}` : String(error);
  const normalized = raw.trim().replace(/\s+/g, '_').slice(0, 240);
  return normalized || 'OUTBOX_DELIVERY_FAILED';
}

function normalizeEvidence(evidence: readonly string[]): readonly string[] {
  return [...new Set(evidence.map((item) => item.trim()).filter(Boolean))].sort();
}
