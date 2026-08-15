import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import {
  assertOutboxLimit,
  assertTimestamp,
  mergeEventEvidence,
  requireEventEvidence,
  validateDomainEvent,
  type ClaimedOutboxEvent,
  type ConsumerReceipt,
  type DomainEventEnvelope,
  type EventOutboxStore,
  type OutboxDeliveryAttempt,
  type OutboxRecord,
} from './transactional-outbox.js';

export interface InMemoryEventOutboxOptions {
  readonly createId?: () => string;
}

export class InMemoryEventOutboxStore implements EventOutboxStore {
  readonly #records = new Map<string, OutboxRecord>();
  readonly #eventKeys = new Map<string, string>();
  readonly #deliveries = new Map<string, OutboxDeliveryAttempt>();
  readonly #receipts = new Map<string, ConsumerReceipt>();
  readonly #createId: () => string;

  constructor(options: InMemoryEventOutboxOptions = {}) {
    this.#createId = options.createId ?? randomUUID;
  }

  async enqueue(
    client: pg.PoolClient,
    event: DomainEventEnvelope,
    options: { readonly availableAt?: string; readonly maxAttempts?: number } = {},
  ): Promise<void> {
    void client;
    await Promise.resolve();
    validateDomainEvent(event);
    const availableAt = options.availableAt ?? event.occurredAt;
    assertTimestamp(availableAt, 'OUTBOX_AVAILABLE_AT_INVALID');
    const maxAttempts = options.maxAttempts ?? 5;
    assertMaxAttempts(maxAttempts);

    const existing = this.#records.get(event.eventId);
    if (existing) {
      if (!sameEventIdentity(existing, event)) throw new Error('OUTBOX_EVENT_ID_CONFLICT');
      return;
    }

    const eventKey = scopedEventKey(event);
    const existingEventId = this.#eventKeys.get(eventKey);
    if (existingEventId && existingEventId !== event.eventId)
      throw new Error('OUTBOX_EVENT_KEY_CONFLICT');

    this.#records.set(event.eventId, {
      ...event,
      evidence: requireEventEvidence(event.evidence),
      status: 'PENDING',
      availableAt,
      attempts: 0,
      maxAttempts,
      claimedBy: null,
      claimExecutionId: null,
      claimedAt: null,
      deliveredAt: null,
      lastErrorCode: null,
      version: 1,
    });
    this.#eventKeys.set(eventKey, event.eventId);
  }

  async get(eventId: string): Promise<OutboxRecord | undefined> {
    await Promise.resolve();
    requireText(eventId, 'OUTBOX_EVENT_ID_REQUIRED');
    return this.#records.get(eventId);
  }

  async claimAvailable(input: {
    readonly workerId: string;
    readonly now: string;
    readonly limit: number;
  }): Promise<readonly ClaimedOutboxEvent[]> {
    await Promise.resolve();
    requireText(input.workerId, 'OUTBOX_WORKER_ID_REQUIRED');
    assertTimestamp(input.now, 'OUTBOX_NOW_INVALID');
    assertOutboxLimit(input.limit);

    const nowMs = Date.parse(input.now);
    const candidates = [...this.#records.values()]
      .filter(
        (record) =>
          ['PENDING', 'FAILED_RETRYABLE'].includes(record.status) &&
          Date.parse(record.availableAt) <= nowMs &&
          record.attempts < record.maxAttempts,
      )
      .sort((left, right) =>
        [left.availableAt, left.occurredAt, left.eventId]
          .join('|')
          .localeCompare([right.availableAt, right.occurredAt, right.eventId].join('|')),
      )
      .slice(0, input.limit);

    const claimed: ClaimedOutboxEvent[] = [];
    for (const record of candidates) {
      const executionId = this.#createId();
      if (this.#deliveries.has(executionId)) throw new Error('OUTBOX_EXECUTION_ID_CONFLICT');
      const attemptNumber = record.attempts + 1;
      const delivery: OutboxDeliveryAttempt = {
        executionId,
        eventId: record.eventId,
        workerId: input.workerId,
        attemptNumber,
        status: 'CLAIMED',
        claimedAt: input.now,
        completedAt: null,
        errorCode: null,
        evidence: [],
      };
      const updated: OutboxRecord = {
        ...record,
        status: 'CLAIMED',
        attempts: attemptNumber,
        claimedBy: input.workerId,
        claimExecutionId: executionId,
        claimedAt: input.now,
        lastErrorCode: null,
        version: record.version + 1,
      };
      this.#deliveries.set(executionId, delivery);
      this.#records.set(record.eventId, updated);
      claimed.push({ record: updated, delivery });
    }
    return claimed;
  }

  async markDelivered(input: {
    readonly eventId: string;
    readonly executionId: string;
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<OutboxRecord> {
    await Promise.resolve();
    const evidence = requireEventEvidence(input.evidence);
    assertTimestamp(input.now, 'OUTBOX_NOW_INVALID');
    return this.#finishClaim({
      eventId: input.eventId,
      executionId: input.executionId,
      evidence,
      now: input.now,
      outcome: 'DELIVERED',
      errorCode: null,
      nextAttemptAt: input.now,
    });
  }

  async markFailed(input: {
    readonly eventId: string;
    readonly executionId: string;
    readonly errorCode: string;
    readonly evidence: readonly string[];
    readonly now: string;
    readonly nextAttemptAt?: string;
  }): Promise<OutboxRecord> {
    await Promise.resolve();
    requireText(input.errorCode, 'OUTBOX_ERROR_CODE_REQUIRED');
    const evidence = requireEventEvidence(input.evidence);
    assertTimestamp(input.now, 'OUTBOX_NOW_INVALID');
    const nextAttemptAt = input.nextAttemptAt ?? input.now;
    assertTimestamp(nextAttemptAt, 'OUTBOX_NEXT_ATTEMPT_AT_INVALID');
    return this.#finishClaim({
      eventId: input.eventId,
      executionId: input.executionId,
      evidence,
      now: input.now,
      outcome: 'FAILED',
      errorCode: input.errorCode,
      nextAttemptAt,
    });
  }

  async recoverStaleClaims(input: {
    readonly staleBefore: string;
    readonly now: string;
    readonly limit: number;
    readonly evidence: readonly string[];
    readonly nextAttemptAt?: string;
  }): Promise<readonly string[]> {
    await Promise.resolve();
    assertTimestamp(input.staleBefore, 'OUTBOX_STALE_BEFORE_INVALID');
    assertTimestamp(input.now, 'OUTBOX_NOW_INVALID');
    assertOutboxLimit(input.limit);
    const evidence = requireEventEvidence(input.evidence);
    const nextAttemptAt = input.nextAttemptAt ?? input.now;
    assertTimestamp(nextAttemptAt, 'OUTBOX_NEXT_ATTEMPT_AT_INVALID');
    const staleBeforeMs = Date.parse(input.staleBefore);

    const candidates = [...this.#records.values()]
      .filter(
        (record) =>
          record.status === 'CLAIMED' &&
          record.claimedAt !== null &&
          Date.parse(record.claimedAt) < staleBeforeMs,
      )
      .sort((left, right) =>
        `${left.claimedAt ?? ''}|${left.eventId}`.localeCompare(
          `${right.claimedAt ?? ''}|${right.eventId}`,
        ),
      )
      .slice(0, input.limit);

    const recovered: string[] = [];
    for (const record of candidates) {
      const executionId = record.claimExecutionId;
      if (!executionId) throw new Error('OUTBOX_CLAIM_EXECUTION_ID_MISSING');
      const delivery = this.#deliveries.get(executionId);
      if (!delivery || delivery.eventId !== record.eventId || delivery.status !== 'CLAIMED')
        throw new Error('OUTBOX_STALE_ATTEMPT_NOT_CLAIMED');
      const deadLetter = record.attempts >= record.maxAttempts;
      const status = deadLetter ? 'DEAD_LETTER' : 'FAILED_RETRYABLE';
      this.#deliveries.set(executionId, {
        ...delivery,
        status,
        completedAt: input.now,
        errorCode: 'OUTBOX_STALE_CLAIM',
        evidence,
      });
      this.#records.set(record.eventId, {
        ...record,
        status,
        availableAt: nextAttemptAt,
        claimedBy: null,
        claimExecutionId: null,
        claimedAt: null,
        lastErrorCode: 'OUTBOX_STALE_CLAIM',
        version: record.version + 1,
      });
      recovered.push(record.eventId);
    }
    return recovered;
  }

  async beginConsumerReceipt(
    client: pg.PoolClient,
    input: {
      readonly consumerId: string;
      readonly eventId: string;
      readonly executionId: string;
      readonly evidence: readonly string[];
      readonly now: string;
    },
  ): Promise<'CLAIMED' | 'ALREADY_PROCESSED' | 'IN_PROGRESS'> {
    void client;
    await Promise.resolve();
    validateReceiptInput(input);
    const key = receiptKey(input.consumerId, input.eventId);
    const existing = this.#receipts.get(key);
    if (existing?.status === 'PROCESSED') return 'ALREADY_PROCESSED';
    if (existing) return 'IN_PROGRESS';
    this.#receipts.set(key, {
      consumerId: input.consumerId,
      eventId: input.eventId,
      executionId: input.executionId,
      status: 'PROCESSING',
      claimedAt: input.now,
      processedAt: null,
      evidence: requireEventEvidence(input.evidence),
      version: 1,
    });
    return 'CLAIMED';
  }

  async completeConsumerReceipt(
    client: pg.PoolClient,
    input: {
      readonly consumerId: string;
      readonly eventId: string;
      readonly executionId: string;
      readonly evidence: readonly string[];
      readonly now: string;
    },
  ): Promise<void> {
    void client;
    await Promise.resolve();
    validateReceiptInput(input);
    const evidence = requireEventEvidence(input.evidence);
    const key = receiptKey(input.consumerId, input.eventId);
    const receipt = this.#receipts.get(key);
    if (!receipt) throw new Error('OUTBOX_CONSUMER_RECEIPT_NOT_FOUND');
    if (receipt.status === 'PROCESSED') {
      if (receipt.executionId !== input.executionId)
        throw new Error('OUTBOX_CONSUMER_RECEIPT_ALREADY_PROCESSED');
      return;
    }
    if (receipt.executionId !== input.executionId)
      throw new Error('OUTBOX_CONSUMER_RECEIPT_STALE');
    this.#receipts.set(key, {
      ...receipt,
      status: 'PROCESSED',
      processedAt: input.now,
      evidence: mergeEventEvidence(receipt.evidence, evidence),
      version: receipt.version + 1,
    });
  }

  #finishClaim(input: {
    readonly eventId: string;
    readonly executionId: string;
    readonly evidence: readonly string[];
    readonly now: string;
    readonly outcome: 'DELIVERED' | 'FAILED';
    readonly errorCode: string | null;
    readonly nextAttemptAt: string;
  }): OutboxRecord {
    requireText(input.eventId, 'OUTBOX_EVENT_ID_REQUIRED');
    requireText(input.executionId, 'OUTBOX_EXECUTION_ID_REQUIRED');
    const record = this.#records.get(input.eventId);
    if (!record) throw new Error('OUTBOX_EVENT_NOT_FOUND');
    if (record.status !== 'CLAIMED' || record.claimExecutionId !== input.executionId)
      throw new Error('OUTBOX_STALE_CLAIM');
    const delivery = this.#deliveries.get(input.executionId);
    if (!delivery || delivery.eventId !== input.eventId || delivery.status !== 'CLAIMED')
      throw new Error('OUTBOX_DELIVERY_ATTEMPT_STALE');

    const deadLetter = input.outcome === 'FAILED' && record.attempts >= record.maxAttempts;
    const status =
      input.outcome === 'DELIVERED'
        ? 'DELIVERED'
        : deadLetter
          ? 'DEAD_LETTER'
          : 'FAILED_RETRYABLE';
    this.#deliveries.set(input.executionId, {
      ...delivery,
      status,
      completedAt: input.now,
      errorCode: input.errorCode,
      evidence: input.evidence,
    });
    const updated: OutboxRecord = {
      ...record,
      status,
      availableAt: input.nextAttemptAt,
      claimedBy: null,
      claimExecutionId: null,
      claimedAt: null,
      deliveredAt: status === 'DELIVERED' ? input.now : record.deliveredAt,
      lastErrorCode: input.errorCode,
      version: record.version + 1,
    };
    this.#records.set(input.eventId, updated);
    return updated;
  }
}

function scopedEventKey(event: DomainEventEnvelope): string {
  return [event.tenantId, event.aggregateType, event.aggregateId, event.eventKey].join('|');
}

function sameEventIdentity(record: OutboxRecord, event: DomainEventEnvelope): boolean {
  return (
    record.eventKey === event.eventKey &&
    record.eventType === event.eventType &&
    record.schemaVersion === event.schemaVersion &&
    record.aggregateType === event.aggregateType &&
    record.aggregateId === event.aggregateId &&
    record.aggregateVersion === event.aggregateVersion &&
    record.tenantId === event.tenantId &&
    record.workspaceId === event.workspaceId &&
    record.organizationId === event.organizationId &&
    record.correlationId === event.correlationId &&
    record.causationId === event.causationId
  );
}

function validateReceiptInput(input: {
  readonly consumerId: string;
  readonly eventId: string;
  readonly executionId: string;
  readonly evidence: readonly string[];
  readonly now: string;
}): void {
  requireText(input.consumerId, 'OUTBOX_CONSUMER_ID_REQUIRED');
  requireText(input.eventId, 'OUTBOX_EVENT_ID_REQUIRED');
  requireText(input.executionId, 'OUTBOX_EXECUTION_ID_REQUIRED');
  requireEventEvidence(input.evidence);
  assertTimestamp(input.now, 'OUTBOX_NOW_INVALID');
}

function receiptKey(consumerId: string, eventId: string): string {
  return `${consumerId}|${eventId}`;
}

function assertMaxAttempts(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 100)
    throw new Error('OUTBOX_MAX_ATTEMPTS_INVALID');
}

function requireText(value: string, errorCode: string): void {
  if (!value.trim()) throw new Error(errorCode);
}
