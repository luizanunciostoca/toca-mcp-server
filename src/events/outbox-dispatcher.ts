import type { ClaimedOutboxEvent, EventOutboxStore, OutboxRecord } from './transactional-outbox.js';

export interface EventDeliveryReceipt {
  readonly evidence: readonly string[];
}

export interface EventTransport {
  deliver(event: OutboxRecord): Promise<EventDeliveryReceipt>;
}

export interface OutboxDispatcherLogger {
  info(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export interface OutboxRetryPolicy {
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export interface OutboxDispatcherOptions {
  readonly store: EventOutboxStore;
  readonly transport: EventTransport;
  readonly workerId: string;
  readonly logger: OutboxDispatcherLogger;
  readonly retry: OutboxRetryPolicy;
  readonly batchSize?: number;
  readonly now?: () => Date;
}

export class OutboxDispatcher {
  readonly #batchSize: number;
  readonly #now: () => Date;

  constructor(private readonly options: OutboxDispatcherOptions) {
    if (!options.workerId.trim()) throw new Error('OUTBOX_WORKER_ID_REQUIRED');
    if (!Number.isInteger(options.retry.baseDelayMs) || options.retry.baseDelayMs < 0)
      throw new Error('OUTBOX_RETRY_BASE_DELAY_INVALID');
    if (!Number.isInteger(options.retry.maxDelayMs) || options.retry.maxDelayMs < options.retry.baseDelayMs)
      throw new Error('OUTBOX_RETRY_MAX_DELAY_INVALID');
    this.#batchSize = options.batchSize ?? 10;
    if (!Number.isInteger(this.#batchSize) || this.#batchSize < 1 || this.#batchSize > 100)
      throw new Error('OUTBOX_LIMIT_INVALID');
    this.#now = options.now ?? (() => new Date());
  }

  async runOnce(): Promise<number> {
    const now = this.#now().toISOString();
    const claimed = await this.options.store.claimAvailable({
      workerId: this.options.workerId,
      now,
      limit: this.#batchSize,
    });
    for (const event of claimed) await this.#deliver(event);
    return claimed.length;
  }

  async recoverStaleOnce(input: {
    readonly staleBefore: string;
    readonly evidence: readonly string[];
  }): Promise<readonly string[]> {
    return this.options.store.recoverStaleClaims({
      staleBefore: input.staleBefore,
      now: this.#now().toISOString(),
      limit: this.#batchSize,
      evidence: input.evidence,
    });
  }

  async #deliver(claimed: ClaimedOutboxEvent): Promise<void> {
    const { record, delivery } = claimed;
    this.options.logger.info('outbox.delivery.started', {
      eventId: record.eventId,
      eventType: record.eventType,
      executionId: delivery.executionId,
      attempt: delivery.attemptNumber,
    });

    try {
      const receipt = await this.options.transport.deliver(record);
      const evidence = normalizeEvidence(receipt.evidence);
      await this.options.store.markDelivered({
        eventId: record.eventId,
        executionId: delivery.executionId,
        evidence,
        now: this.#now().toISOString(),
      });
      this.options.logger.info('outbox.delivery.succeeded', {
        eventId: record.eventId,
        eventType: record.eventType,
        executionId: delivery.executionId,
        attempt: delivery.attemptNumber,
      });
    } catch (error) {
      const errorCode = normalizeErrorCode(error);
      const nextAttemptAt = new Date(
        this.#now().getTime() + retryDelayMs(delivery.attemptNumber, this.options.retry),
      ).toISOString();
      const failed = await this.options.store.markFailed({
        eventId: record.eventId,
        executionId: delivery.executionId,
        errorCode,
        evidence: [`outbox:delivery-error:${errorCode}:${delivery.executionId}`],
        now: this.#now().toISOString(),
        nextAttemptAt,
      });
      this.options.logger.error('outbox.delivery.failed', {
        eventId: record.eventId,
        eventType: record.eventType,
        executionId: delivery.executionId,
        attempt: delivery.attemptNumber,
        errorCode,
        terminal: failed.status === 'DEAD_LETTER',
      });
    }
  }
}

function retryDelayMs(attempt: number, policy: OutboxRetryPolicy): number {
  const exponential = policy.baseDelayMs * 2 ** Math.max(0, attempt - 1);
  return Math.min(exponential, policy.maxDelayMs);
}

function normalizeEvidence(evidence: readonly string[]): readonly string[] {
  const normalized = [...new Set(evidence.map((item) => item.trim()).filter(Boolean))].sort();
  if (normalized.length === 0) throw new Error('OUTBOX_DELIVERY_EVIDENCE_REQUIRED');
  return normalized;
}

function normalizeErrorCode(error: unknown): string {
  if (error instanceof Error) {
    const code = error.name === 'Error' ? error.message : `${error.name}:${error.message}`;
    return code.slice(0, 240) || 'OUTBOX_DELIVERY_FAILED';
  }
  return String(error).slice(0, 240) || 'OUTBOX_DELIVERY_FAILED';
}
