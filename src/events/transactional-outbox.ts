import type pg from 'pg';

export const OUTBOX_STATUSES = [
  'PENDING',
  'CLAIMED',
  'FAILED_RETRYABLE',
  'DELIVERED',
  'DEAD_LETTER',
] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export const OUTBOX_DELIVERY_ATTEMPT_STATUSES = [
  'CLAIMED',
  'DELIVERED',
  'FAILED_RETRYABLE',
  'DEAD_LETTER',
] as const;
export type OutboxDeliveryAttemptStatus = (typeof OUTBOX_DELIVERY_ATTEMPT_STATUSES)[number];

export const CONSUMER_RECEIPT_STATUSES = ['PROCESSING', 'PROCESSED'] as const;
export type ConsumerReceiptStatus = (typeof CONSUMER_RECEIPT_STATUSES)[number];

export interface DomainEventEnvelope {
  readonly eventId: string;
  readonly eventType: string;
  readonly schemaVersion: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly occurredAt: string;
  readonly payload: unknown;
  readonly evidence: readonly string[];
}

export interface OutboxRecord extends DomainEventEnvelope {
  readonly status: OutboxStatus;
  readonly availableAt: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly claimedBy: string | null;
  readonly claimExecutionId: string | null;
  readonly claimedAt: string | null;
  readonly deliveredAt: string | null;
  readonly lastErrorCode: string | null;
  readonly version: number;
}

export interface OutboxDeliveryAttempt {
  readonly executionId: string;
  readonly eventId: string;
  readonly workerId: string;
  readonly attemptNumber: number;
  readonly status: OutboxDeliveryAttemptStatus;
  readonly claimedAt: string;
  readonly completedAt: string | null;
  readonly errorCode: string | null;
  readonly evidence: readonly string[];
}

export interface ClaimedOutboxEvent {
  readonly record: OutboxRecord;
  readonly delivery: OutboxDeliveryAttempt;
}

export interface ConsumerReceipt {
  readonly consumerId: string;
  readonly eventId: string;
  readonly executionId: string;
  readonly status: ConsumerReceiptStatus;
  readonly claimedAt: string;
  readonly processedAt: string | null;
  readonly evidence: readonly string[];
  readonly version: number;
}

export interface TransactionalOutboxWriter {
  enqueue(
    client: pg.PoolClient,
    event: DomainEventEnvelope,
    options?: { readonly availableAt?: string; readonly maxAttempts?: number },
  ): Promise<void>;
}

export interface EventOutboxStore extends TransactionalOutboxWriter {
  get(eventId: string): Promise<OutboxRecord | undefined>;
  claimAvailable(input: {
    readonly workerId: string;
    readonly now: string;
    readonly limit: number;
  }): Promise<readonly ClaimedOutboxEvent[]>;
  markDelivered(input: {
    readonly eventId: string;
    readonly executionId: string;
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<OutboxRecord>;
  markFailed(input: {
    readonly eventId: string;
    readonly executionId: string;
    readonly errorCode: string;
    readonly evidence: readonly string[];
    readonly now: string;
    readonly nextAttemptAt?: string;
  }): Promise<OutboxRecord>;
  recoverStaleClaims(input: {
    readonly staleBefore: string;
    readonly now: string;
    readonly limit: number;
    readonly evidence: readonly string[];
    readonly nextAttemptAt?: string;
  }): Promise<readonly string[]>;
  beginConsumerReceipt(
    client: pg.PoolClient,
    input: {
      readonly consumerId: string;
      readonly eventId: string;
      readonly executionId: string;
      readonly evidence: readonly string[];
      readonly now: string;
    },
  ): Promise<'CLAIMED' | 'ALREADY_PROCESSED' | 'IN_PROGRESS'>;
  completeConsumerReceipt(
    client: pg.PoolClient,
    input: {
      readonly consumerId: string;
      readonly eventId: string;
      readonly executionId: string;
      readonly evidence: readonly string[];
      readonly now: string;
    },
  ): Promise<void>;
}

export function validateDomainEvent(event: DomainEventEnvelope): void {
  requireText(event.eventId, 'OUTBOX_EVENT_ID_REQUIRED');
  requireText(event.eventType, 'OUTBOX_EVENT_TYPE_REQUIRED');
  requireText(event.schemaVersion, 'OUTBOX_SCHEMA_VERSION_REQUIRED');
  requireText(event.aggregateType, 'OUTBOX_AGGREGATE_TYPE_REQUIRED');
  requireText(event.aggregateId, 'OUTBOX_AGGREGATE_ID_REQUIRED');
  if (!Number.isInteger(event.aggregateVersion) || event.aggregateVersion < 1)
    throw new Error('OUTBOX_AGGREGATE_VERSION_INVALID');
  requireText(event.tenantId, 'OUTBOX_TENANT_ID_REQUIRED');
  requireText(event.workspaceId, 'OUTBOX_WORKSPACE_ID_REQUIRED');
  requireText(event.organizationId, 'OUTBOX_ORGANIZATION_ID_REQUIRED');
  requireText(event.correlationId, 'OUTBOX_CORRELATION_ID_REQUIRED');
  if (event.causationId !== null) requireText(event.causationId, 'OUTBOX_CAUSATION_ID_INVALID');
  assertTimestamp(event.occurredAt, 'OUTBOX_OCCURRED_AT_INVALID');
  assertJsonSerializable(event.payload);
  requireEventEvidence(event.evidence, 'OUTBOX_EVENT_EVIDENCE_REQUIRED');
}

export function requireEventEvidence(
  evidence: readonly string[],
  errorCode = 'OUTBOX_EVIDENCE_REQUIRED',
): readonly string[] {
  const normalized = [...new Set(evidence.map((item) => item.trim()).filter(Boolean))].sort();
  if (normalized.length === 0) throw new Error(errorCode);
  return normalized;
}

export function assertOutboxLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error('OUTBOX_LIMIT_INVALID');
}

export function assertTimestamp(value: string, errorCode: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(errorCode);
}

export function assertJsonSerializable(value: unknown): void {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error('undefined');
  } catch {
    throw new Error('OUTBOX_PAYLOAD_NOT_JSON_SERIALIZABLE');
  }
}

export function mergeEventEvidence(
  current: readonly string[],
  next: readonly string[],
): readonly string[] {
  return [...new Set([...current, ...next].map((item) => item.trim()).filter(Boolean))].sort();
}

function requireText(value: string, errorCode: string): void {
  if (!value.trim()) throw new Error(errorCode);
}
