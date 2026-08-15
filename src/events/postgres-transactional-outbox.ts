import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import {
  assertJsonSerializable,
  assertOutboxLimit,
  assertTimestamp,
  mergeEventEvidence,
  requireEventEvidence,
  validateDomainEvent,
  type ClaimedOutboxEvent,
  type ConsumerReceiptStatus,
  type DomainEventEnvelope,
  type EventOutboxStore,
  type OutboxDeliveryAttemptStatus,
  type OutboxRecord,
  type OutboxStatus,
} from './transactional-outbox.js';

interface OutboxRow {
  readonly event_id: string;
  readonly event_key: string;
  readonly event_type: string;
  readonly schema_version: string;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly aggregate_version: number;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly correlation_id: string;
  readonly causation_id: string | null;
  readonly occurred_at: Date | string;
  readonly payload: unknown;
  readonly evidence: unknown;
  readonly status: OutboxStatus;
  readonly available_at: Date | string;
  readonly attempts: number;
  readonly max_attempts: number;
  readonly claimed_by: string | null;
  readonly claim_execution_id: string | null;
  readonly claimed_at: Date | string | null;
  readonly delivered_at: Date | string | null;
  readonly last_error_code: string | null;
  readonly version: number;
}

interface DeliveryAttemptRow {
  readonly execution_id: string;
  readonly event_id: string;
  readonly worker_id: string;
  readonly attempt_number: number;
  readonly status: OutboxDeliveryAttemptStatus;
  readonly claimed_at: Date | string;
  readonly completed_at: Date | string | null;
  readonly error_code: string | null;
  readonly evidence: unknown;
}

interface ConsumerReceiptRow {
  readonly consumer_id: string;
  readonly event_id: string;
  readonly execution_id: string;
  readonly status: ConsumerReceiptStatus;
  readonly claimed_at: Date | string;
  readonly processed_at: Date | string | null;
  readonly evidence: unknown;
  readonly version: number;
}

export interface PostgresTransactionalOutboxOptions {
  readonly createId?: () => string;
  readonly defaultMaxAttempts?: number;
}

export class PostgresTransactionalOutbox implements EventOutboxStore {
  readonly #createId: () => string;
  readonly #defaultMaxAttempts: number;

  constructor(
    private readonly pool: pg.Pool,
    options: PostgresTransactionalOutboxOptions = {},
  ) {
    this.#createId = options.createId ?? randomUUID;
    this.#defaultMaxAttempts = options.defaultMaxAttempts ?? 5;
    assertMaxAttempts(this.#defaultMaxAttempts);
  }

  async enqueue(
    client: pg.PoolClient,
    event: DomainEventEnvelope,
    options: { readonly availableAt?: string; readonly maxAttempts?: number } = {},
  ): Promise<void> {
    validateDomainEvent(event);
    const availableAt = options.availableAt ?? event.occurredAt;
    const maxAttempts = options.maxAttempts ?? this.#defaultMaxAttempts;
    assertTimestamp(availableAt, 'OUTBOX_AVAILABLE_AT_INVALID');
    assertMaxAttempts(maxAttempts);

    try {
      const inserted = await client.query<{ event_id: string }>(
        `insert into event_outbox (
           event_id, event_key, event_type, schema_version, aggregate_type, aggregate_id,
           aggregate_version, tenant_id, workspace_id, organization_id, correlation_id,
           causation_id, occurred_at, payload, evidence, status, available_at, attempts,
           max_attempts, claimed_by, claim_execution_id, claimed_at, delivered_at,
           last_error_code, version
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
           $13::timestamptz, $14::jsonb, $15::jsonb, 'PENDING', $16::timestamptz,
           0, $17, null, null, null, null, null, 1
         )
         on conflict (event_id) do nothing
         returning event_id`,
        [
          event.eventId,
          event.eventKey,
          event.eventType,
          event.schemaVersion,
          event.aggregateType,
          event.aggregateId,
          event.aggregateVersion,
          event.tenantId,
          event.workspaceId,
          event.organizationId,
          event.correlationId,
          event.causationId,
          event.occurredAt,
          json(event.payload),
          json(event.evidence),
          availableAt,
          maxAttempts,
        ],
      );
      if (inserted.rowCount === 1) return;

      const existing = await client.query<OutboxRow>(
        'select * from event_outbox where event_id = $1',
        [event.eventId],
      );
      const row = existing.rows[0];
      if (!row || !sameDomainEvent(outboxFromRow(row), event))
        throw new Error('OUTBOX_EVENT_ID_CONFLICT');
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error('OUTBOX_EVENT_KEY_CONFLICT');
      throw error;
    }
  }

  async get(eventId: string): Promise<OutboxRecord | undefined> {
    requireText(eventId, 'OUTBOX_EVENT_ID_REQUIRED');
    const result = await this.pool.query<OutboxRow>(
      'select * from event_outbox where event_id = $1',
      [eventId],
    );
    const row = result.rows[0];
    return row ? outboxFromRow(row) : undefined;
  }

  async claimAvailable(input: {
    readonly workerId: string;
    readonly now: string;
    readonly limit: number;
  }): Promise<readonly ClaimedOutboxEvent[]> {
    requireText(input.workerId, 'OUTBOX_WORKER_ID_REQUIRED');
    assertTimestamp(input.now, 'OUTBOX_NOW_INVALID');
    assertOutboxLimit(input.limit);
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const candidates = await client.query<OutboxRow>(
        `select * from event_outbox
         where status in ('PENDING', 'FAILED_RETRYABLE')
           and available_at <= $1::timestamptz
           and attempts < max_attempts
         order by available_at asc, occurred_at asc, event_id asc
         for update skip locked
         limit $2`,
        [input.now, input.limit],
      );

      const claimed: ClaimedOutboxEvent[] = [];
      for (const row of candidates.rows) {
        const executionId = this.#createId();
        const attemptNumber = row.attempts + 1;
        const updated = await client.query<OutboxRow>(
          `update event_outbox set
             status = 'CLAIMED', attempts = $2, claimed_by = $3,
             claim_execution_id = $4, claimed_at = $5::timestamptz,
             delivered_at = null, last_error_code = null, version = version + 1
           where event_id = $1 and version = $6
           returning *`,
          [row.event_id, attemptNumber, input.workerId, executionId, input.now, row.version],
        );
        if (updated.rowCount !== 1) throw new Error('OUTBOX_CLAIM_VERSION_CONFLICT');

        await client.query(
          `insert into event_outbox_delivery_attempts (
             execution_id, event_id, worker_id, attempt_number, status,
             claimed_at, completed_at, error_code, evidence
           ) values ($1, $2, $3, $4, 'CLAIMED', $5::timestamptz, null, null, '[]'::jsonb)`,
          [executionId, row.event_id, input.workerId, attemptNumber, input.now],
        );
        const updatedRow = updated.rows[0];
        if (!updatedRow) throw new Error('OUTBOX_CLAIM_ROW_MISSING');
        claimed.push({
          record: outboxFromRow(updatedRow),
          delivery: {
            executionId,
            eventId: row.event_id,
            workerId: input.workerId,
            attemptNumber,
            status: 'CLAIMED',
            claimedAt: input.now,
            completedAt: null,
            errorCode: null,
            evidence: [],
          },
        });
      }
      await client.query('commit');
      return claimed;
    } catch (error) {
      await client.query('rollback');
      if (isUniqueViolation(error)) throw new Error('OUTBOX_EXECUTION_ID_CONFLICT');
      throw error;
    } finally {
      client.release();
    }
  }

  async markDelivered(input: {
    readonly eventId: string;
    readonly executionId: string;
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<OutboxRecord> {
    requireText(input.eventId, 'OUTBOX_EVENT_ID_REQUIRED');
    requireText(input.executionId, 'OUTBOX_EXECUTION_ID_REQUIRED');
    const evidence = requireEventEvidence(input.evidence);
    assertTimestamp(input.now, 'OUTBOX_NOW_INVALID');
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const row = await this.#lockClaimedEvent(client, input.eventId, input.executionId);
      const attempt = await client.query<DeliveryAttemptRow>(
        `select * from event_outbox_delivery_attempts
         where execution_id = $1 and event_id = $2 for update`,
        [input.executionId, input.eventId],
      );
      const attemptRow = attempt.rows[0];
      if (!attemptRow || attemptRow.status !== 'CLAIMED')
        throw new Error('OUTBOX_DELIVERY_ATTEMPT_NOT_CLAIMED');
      const attemptUpdate = await client.query(
        `update event_outbox_delivery_attempts set
           status = 'DELIVERED', completed_at = $2::timestamptz,
           error_code = null, evidence = $3::jsonb
         where execution_id = $1 and status = 'CLAIMED'`,
        [
          input.executionId,
          input.now,
          json(mergeEventEvidence(asStringArray(attemptRow.evidence), evidence)),
        ],
      );
      if (attemptUpdate.rowCount !== 1) throw new Error('OUTBOX_DELIVERY_ATTEMPT_STATE_CONFLICT');

      const updated = await client.query<OutboxRow>(
        `update event_outbox set
           status = 'DELIVERED', delivered_at = $2::timestamptz,
           claimed_by = null, claim_execution_id = null, claimed_at = null,
           last_error_code = null, version = version + 1
         where event_id = $1 and version = $3
         returning *`,
        [input.eventId, input.now, row.version],
      );
      if (updated.rowCount !== 1) throw new Error('OUTBOX_DELIVER_VERSION_CONFLICT');
      await client.query('commit');
      return outboxFromRow(requireRow(updated.rows[0], 'OUTBOX_DELIVER_ROW_MISSING'));
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async markFailed(input: {
    readonly eventId: string;
    readonly executionId: string;
    readonly errorCode: string;
    readonly evidence: readonly string[];
    readonly now: string;
    readonly nextAttemptAt?: string;
  }): Promise<OutboxRecord> {
    requireText(input.eventId, 'OUTBOX_EVENT_ID_REQUIRED');
    requireText(input.executionId, 'OUTBOX_EXECUTION_ID_REQUIRED');
    requireText(input.errorCode, 'OUTBOX_ERROR_CODE_REQUIRED');
    const evidence = requireEventEvidence(input.evidence);
    assertTimestamp(input.now, 'OUTBOX_NOW_INVALID');
    if (input.nextAttemptAt) assertTimestamp(input.nextAttemptAt, 'OUTBOX_NEXT_ATTEMPT_AT_INVALID');
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const row = await this.#lockClaimedEvent(client, input.eventId, input.executionId);
      const terminal = row.attempts >= row.max_attempts;
      const status: OutboxStatus = terminal ? 'DEAD_LETTER' : 'FAILED_RETRYABLE';
      const attemptStatus: OutboxDeliveryAttemptStatus = terminal
        ? 'DEAD_LETTER'
        : 'FAILED_RETRYABLE';
      const attempt = await client.query<DeliveryAttemptRow>(
        `select * from event_outbox_delivery_attempts
         where execution_id = $1 and event_id = $2 for update`,
        [input.executionId, input.eventId],
      );
      const attemptRow = attempt.rows[0];
      if (!attemptRow || attemptRow.status !== 'CLAIMED')
        throw new Error('OUTBOX_DELIVERY_ATTEMPT_NOT_CLAIMED');
      const attemptUpdate = await client.query(
        `update event_outbox_delivery_attempts set
           status = $2, completed_at = $3::timestamptz,
           error_code = $4, evidence = $5::jsonb
         where execution_id = $1 and status = 'CLAIMED'`,
        [
          input.executionId,
          attemptStatus,
          input.now,
          input.errorCode,
          json(mergeEventEvidence(asStringArray(attemptRow.evidence), evidence)),
        ],
      );
      if (attemptUpdate.rowCount !== 1) throw new Error('OUTBOX_DELIVERY_ATTEMPT_STATE_CONFLICT');

      const availableAt = terminal ? row.available_at : (input.nextAttemptAt ?? input.now);
      const updated = await client.query<OutboxRow>(
        `update event_outbox set
           status = $2, available_at = $3::timestamptz,
           claimed_by = null, claim_execution_id = null, claimed_at = null,
           last_error_code = $4, version = version + 1
         where event_id = $1 and version = $5
         returning *`,
        [input.eventId, status, availableAt, input.errorCode, row.version],
      );
      if (updated.rowCount !== 1) throw new Error('OUTBOX_FAILURE_VERSION_CONFLICT');
      await client.query('commit');
      return outboxFromRow(requireRow(updated.rows[0], 'OUTBOX_FAILURE_ROW_MISSING'));
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async recoverStaleClaims(input: {
    readonly staleBefore: string;
    readonly now: string;
    readonly limit: number;
    readonly evidence: readonly string[];
    readonly nextAttemptAt?: string;
  }): Promise<readonly string[]> {
    assertTimestamp(input.staleBefore, 'OUTBOX_STALE_BEFORE_INVALID');
    assertTimestamp(input.now, 'OUTBOX_NOW_INVALID');
    assertOutboxLimit(input.limit);
    const evidence = requireEventEvidence(input.evidence);
    if (input.nextAttemptAt) assertTimestamp(input.nextAttemptAt, 'OUTBOX_NEXT_ATTEMPT_AT_INVALID');
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const stale = await client.query<OutboxRow>(
        `select * from event_outbox
         where status = 'CLAIMED' and claimed_at <= $1::timestamptz
         order by claimed_at asc, event_id asc
         for update skip locked
         limit $2`,
        [input.staleBefore, input.limit],
      );
      const recovered: string[] = [];
      for (const row of stale.rows) {
        if (!row.claim_execution_id) throw new Error('OUTBOX_STALE_CLAIM_EXECUTION_ID_MISSING');
        const terminal = row.attempts >= row.max_attempts;
        const status: OutboxStatus = terminal ? 'DEAD_LETTER' : 'FAILED_RETRYABLE';
        const attemptStatus: OutboxDeliveryAttemptStatus = terminal
          ? 'DEAD_LETTER'
          : 'FAILED_RETRYABLE';
        const attempt = await client.query<DeliveryAttemptRow>(
          `select * from event_outbox_delivery_attempts
           where execution_id = $1 and event_id = $2 for update`,
          [row.claim_execution_id, row.event_id],
        );
        const attemptRow = attempt.rows[0];
        if (!attemptRow || attemptRow.status !== 'CLAIMED')
          throw new Error('OUTBOX_STALE_ATTEMPT_NOT_CLAIMED');
        const attemptUpdate = await client.query(
          `update event_outbox_delivery_attempts set
             status = $2, completed_at = $3::timestamptz,
             error_code = 'STALE_CLAIM_RECOVERED', evidence = $4::jsonb
           where execution_id = $1 and status = 'CLAIMED'`,
          [
            row.claim_execution_id,
            attemptStatus,
            input.now,
            json(mergeEventEvidence(asStringArray(attemptRow.evidence), evidence)),
          ],
        );
        if (attemptUpdate.rowCount !== 1) throw new Error('OUTBOX_STALE_ATTEMPT_STATE_CONFLICT');

        const availableAt = terminal ? row.available_at : (input.nextAttemptAt ?? input.now);
        const updated = await client.query(
          `update event_outbox set
             status = $2, available_at = $3::timestamptz,
             claimed_by = null, claim_execution_id = null, claimed_at = null,
             last_error_code = 'STALE_CLAIM_RECOVERED', version = version + 1
           where event_id = $1 and version = $4`,
          [row.event_id, status, availableAt, row.version],
        );
        if (updated.rowCount !== 1) throw new Error('OUTBOX_STALE_RECOVERY_VERSION_CONFLICT');
        recovered.push(row.event_id);
      }
      await client.query('commit');
      return recovered;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
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
    requireText(input.consumerId, 'OUTBOX_CONSUMER_ID_REQUIRED');
    requireText(input.eventId, 'OUTBOX_EVENT_ID_REQUIRED');
    requireText(input.executionId, 'OUTBOX_CONSUMER_EXECUTION_ID_REQUIRED');
    const evidence = requireEventEvidence(input.evidence);
    assertTimestamp(input.now, 'OUTBOX_NOW_INVALID');
    try {
      const inserted = await client.query<{ consumer_id: string }>(
        `insert into event_consumer_receipts (
           consumer_id, event_id, execution_id, status, claimed_at,
           processed_at, evidence, version
         ) values ($1, $2, $3, 'PROCESSING', $4::timestamptz, null, $5::jsonb, 1)
         on conflict (consumer_id, event_id) do nothing
         returning consumer_id`,
        [input.consumerId, input.eventId, input.executionId, input.now, json(evidence)],
      );
      if (inserted.rowCount === 1) return 'CLAIMED';

      const existing = await client.query<ConsumerReceiptRow>(
        `select * from event_consumer_receipts
         where consumer_id = $1 and event_id = $2 for update`,
        [input.consumerId, input.eventId],
      );
      const row = existing.rows[0];
      if (!row) throw new Error('OUTBOX_CONSUMER_RECEIPT_MISSING');
      return row.status === 'PROCESSED' ? 'ALREADY_PROCESSED' : 'IN_PROGRESS';
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error('OUTBOX_CONSUMER_EXECUTION_ID_CONFLICT');
      throw error;
    }
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
    requireText(input.consumerId, 'OUTBOX_CONSUMER_ID_REQUIRED');
    requireText(input.eventId, 'OUTBOX_EVENT_ID_REQUIRED');
    requireText(input.executionId, 'OUTBOX_CONSUMER_EXECUTION_ID_REQUIRED');
    const evidence = requireEventEvidence(input.evidence);
    assertTimestamp(input.now, 'OUTBOX_NOW_INVALID');
    const current = await client.query<ConsumerReceiptRow>(
      `select * from event_consumer_receipts
       where consumer_id = $1 and event_id = $2 for update`,
      [input.consumerId, input.eventId],
    );
    const row = current.rows[0];
    if (!row) throw new Error('OUTBOX_CONSUMER_RECEIPT_MISSING');
    if (row.status === 'PROCESSED') return;
    if (row.execution_id !== input.executionId)
      throw new Error('OUTBOX_CONSUMER_EXECUTION_ID_MISMATCH');
    const updated = await client.query(
      `update event_consumer_receipts set
         status = 'PROCESSED', processed_at = $4::timestamptz,
         evidence = $5::jsonb, version = version + 1
       where consumer_id = $1 and event_id = $2 and execution_id = $3
         and status = 'PROCESSING' and version = $6`,
      [
        input.consumerId,
        input.eventId,
        input.executionId,
        input.now,
        json(mergeEventEvidence(asStringArray(row.evidence), evidence)),
        row.version,
      ],
    );
    if (updated.rowCount !== 1) throw new Error('OUTBOX_CONSUMER_RECEIPT_STATE_CONFLICT');
  }

  async #lockClaimedEvent(
    client: pg.PoolClient,
    eventId: string,
    executionId: string,
  ): Promise<OutboxRow> {
    const result = await client.query<OutboxRow>(
      'select * from event_outbox where event_id = $1 for update',
      [eventId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('OUTBOX_EVENT_NOT_FOUND');
    if (row.status !== 'CLAIMED') throw new Error('OUTBOX_EVENT_NOT_CLAIMED');
    if (row.claim_execution_id !== executionId) throw new Error('OUTBOX_CLAIM_MISMATCH');
    return row;
  }
}

function outboxFromRow(row: OutboxRow): OutboxRecord {
  return {
    eventId: row.event_id,
    eventKey: row.event_key,
    eventType: row.event_type,
    schemaVersion: row.schema_version,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    aggregateVersion: row.aggregate_version,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    occurredAt: iso(row.occurred_at),
    payload: row.payload,
    evidence: asStringArray(row.evidence),
    status: row.status,
    availableAt: iso(row.available_at),
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    claimedBy: row.claimed_by,
    claimExecutionId: row.claim_execution_id,
    claimedAt: row.claimed_at ? iso(row.claimed_at) : null,
    deliveredAt: row.delivered_at ? iso(row.delivered_at) : null,
    lastErrorCode: row.last_error_code,
    version: row.version,
  };
}

function sameDomainEvent(record: OutboxRecord, event: DomainEventEnvelope): boolean {
  return (
    record.eventId === event.eventId &&
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
    record.causationId === event.causationId &&
    record.occurredAt === event.occurredAt &&
    stableJson(record.payload) === stableJson(event.payload) &&
    stableJson(record.evidence) === stableJson(event.evidence)
  );
}

function asStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
    throw new Error('OUTBOX_EVIDENCE_INVALID');
  return value as string[];
}

function json(value: unknown): string {
  assertJsonSerializable(value);
  return JSON.stringify(value);
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function requireText(value: string, errorCode: string): void {
  if (!value.trim()) throw new Error(errorCode);
}

function assertMaxAttempts(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 100)
    throw new Error('OUTBOX_MAX_ATTEMPTS_INVALID');
}

function requireRow<T>(row: T | undefined, errorCode: string): T {
  if (!row) throw new Error(errorCode);
  return row;
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505');
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('OUTBOX_PAYLOAD_NOT_JSON_SERIALIZABLE');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  throw new Error('OUTBOX_PAYLOAD_NOT_JSON_SERIALIZABLE');
}
